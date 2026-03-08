import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, conversationId, searchMode } = await req.json();
    // searchMode: "books" | "internet" | "both"

    // Get user from auth token
    const authHeader = req.headers.get("Authorization");
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(
      authHeader?.replace("Bearer ", "") || ""
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const userMessage = messages[messages.length - 1]?.content || "";
    let context = "";
    let sources: any[] = [];

    // Search books if mode includes books
    if (searchMode === "books" || searchMode === "both") {
      // Use full-text search instead of embeddings
      const { data: chunks } = await supabase.rpc("search_book_chunks", {
        search_query: userMessage,
        match_count: 8,
      });

      if (chunks?.length) {
        // Get book titles
        const bookIds = [...new Set(chunks.map((c: any) => c.book_id))];
        const { data: books } = await supabase
          .from("books")
          .select("id, title, author")
          .in("id", bookIds);

        const bookMap = new Map(books?.map((b: any) => [b.id, b]) || []);

        context += "\n\n--- BOOK EXCERPTS ---\n";
        for (const chunk of chunks) {
          const book = bookMap.get(chunk.book_id);
          const bookLabel = book ? `${book.title}${book.author ? ` by ${book.author}` : ""}` : "Unknown";
          context += `\n[From "${bookLabel}", chunk ${chunk.chunk_index}]:\n${chunk.content}\n`;
          sources.push({
            type: "book",
            title: book?.title || "Unknown",
            author: book?.author,
            chunkIndex: chunk.chunk_index,
          });
        }
      }
    }

    // Internet search via Lovable AI (let the model search)
    if (searchMode === "internet" || searchMode === "both") {
      context += "\n\n--- INSTRUCTION ---\nThe user also wants you to search the internet for relevant information. Use your knowledge to provide up-to-date information alongside any book context provided above.\n";
      sources.push({ type: "internet" });
    }

    const systemPrompt = `You are a knowledgeable research assistant with access to the user's private book library. 
${context ? `Here is relevant context from the user's sources:\n${context}` : "No relevant book context found."}

Guidelines:
- When citing books, reference the book title and author
- When using internet knowledge, mention it's from general knowledge
- Be thorough but concise
- Use markdown formatting for readability
- If you found book excerpts, always cite which book the information comes from`;

    // Save user message
    if (conversationId) {
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "user",
        content: userMessage,
        user_id: user.id,
      });
    }

    // Stream response from Lovable AI
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Credits exhausted. Add funds in Settings → Workspace → Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    // We need to collect the full response to save to DB, while streaming to client
    // Use TransformStream to intercept
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let fullContent = "";

    const transform = new TransformStream({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });
        // Parse SSE to collect content
        for (const line of text.split("\n")) {
          if (line.startsWith("data: ") && line.slice(6).trim() !== "[DONE]") {
            try {
              const parsed = JSON.parse(line.slice(6));
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) fullContent += delta;
            } catch {}
          }
        }
        controller.enqueue(chunk);
      },
      async flush() {
        // Save assistant message after stream completes
        if (conversationId && fullContent) {
          await supabase.from("messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: fullContent,
            sources: sources.length ? sources : null,
          });
        }
      },
    });

    const streamedBody = response.body!.pipeThrough(transform);

    return new Response(streamedBody, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Sources": JSON.stringify(sources),
      },
    });
  } catch (e) {
    console.error("Chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Chat failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
