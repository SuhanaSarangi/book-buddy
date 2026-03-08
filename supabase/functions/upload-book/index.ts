import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
  }
  return chunks;
}

async function extractPdfText(buffer: Uint8Array): Promise<string> {
  // Use unpdf which is built for serverless/edge environments
  const { extractText, getDocumentProxy } = await import("npm:unpdf@0.12.1");
  const { totalPages, text } = await extractText(buffer);
  console.log(`Extracted text from ${totalPages} pages`);
  return text;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const title = formData.get("title") as string || file.name;
    const author = formData.get("author") as string || "";

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Read file content - handle PDF vs text
    let text: string;
    const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";

    if (isPdf) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);
      text = await extractPdfText(buffer);
    } else {
      text = await file.text();
    }

    if (!text.trim()) {
      return new Response(JSON.stringify({ error: "Could not extract text from file" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Extracted ${text.length} characters, chunking...`);

    // Upload to storage
    const filePath = `${crypto.randomUUID()}-${file.name}`;
    await supabase.storage.from("books").upload(filePath, file);

    // Create book record
    const chunks = chunkText(text);
    console.log(`Created ${chunks.length} chunks`);
    
    const { data: book, error: bookErr } = await supabase.from("books").insert({
      title, author, filename: file.name, file_path: filePath, total_chunks: chunks.length,
    }).select().single();

    if (bookErr) throw bookErr;

    // Generate embeddings and insert chunks
    for (let i = 0; i < chunks.length; i++) {
      const embeddingRes = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: chunks[i],
          model: "text-embedding-004",
        }),
      });

      if (!embeddingRes.ok) {
        console.error(`Embedding error for chunk ${i}:`, await embeddingRes.text());
        await supabase.from("book_chunks").insert({
          book_id: book.id, chunk_index: i, content: chunks[i],
        });
        continue;
      }

      const embData = await embeddingRes.json();
      const embedding = embData.data?.[0]?.embedding;

      await supabase.from("book_chunks").insert({
        book_id: book.id, chunk_index: i, content: chunks[i],
        embedding: embedding ? JSON.stringify(embedding) : null,
      });
    }

    console.log(`Book "${title}" uploaded successfully with ${chunks.length} chunks`);
    return new Response(JSON.stringify({ success: true, book }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Upload error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Upload failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
