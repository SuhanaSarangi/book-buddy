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

    // Validate auth with getClaims
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      console.error("Auth failed:", claimsError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;
    console.log(`Chat request from user ${userId}, mode: ${searchMode}`);

    // Validate input
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Messages array is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!conversationId || typeof conversationId !== "string") {
      return new Response(JSON.stringify({ error: "conversationId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validModes = ["books", "internet", "both"];
    if (!validModes.includes(searchMode)) {
      return new Response(JSON.stringify({ error: "Invalid searchMode" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify conversation belongs to user
    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .single();

    if (convErr || !conv) {
      console.error("Conversation not found or unauthorized:", convErr?.message);
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userMessage = messages[messages.length - 1]?.content || "";
    let context = "";
    let sources: any[] = [];

    // Search books scoped to user
    if (searchMode === "books" || searchMode === "both") {
      const { data: chunks, error: searchErr } = await supabase.rpc("search_book_chunks", {
        search_query: userMessage,
        p_user_id: userId,
        match_count: 8,
      });

      if (searchErr) {
        console.error("Book search failed:", searchErr.message);
      }

      if (chunks?.length) {
        const bookIds = [...new Set(chunks.map((c: any) => c.book_id))];
        const { data: books } = await supabase
          .from("books")
          .select("id, title, author")
          .in("id", bookIds)
          .eq("user_id", userId);

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
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      role: "user",
      content: userMessage,
      user_id: userId,
    });

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
      const status = response.status;
      console.error(`AI gateway error: ${status}`);
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "Credits exhausted. Add funds in Settings → Workspace → Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let fullContent = "";

    const transform = new TransformStream({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });
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
        if (conversationId && fullContent) {
          await supabase.from("messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: fullContent,
            sources: sources.length ? sources : null,
            user_id: userId,
          });
          console.log(`Saved assistant response (${fullContent.length} chars) to conversation ${conversationId}`);
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
