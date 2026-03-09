import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 20;
const EMBEDDING_MODEL = "text-embedding-3-small";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/embeddings";

async function generateEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Embedding API error ${response.status}:`, errText);
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const result = await response.json();
  return result.data.map((d: any) => d.embedding);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { bookId } = await req.json();
    if (!bookId) {
      return new Response(JSON.stringify({ error: "bookId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch chunks without embeddings
    const { data: chunks, error: fetchErr } = await supabase
      .from("book_chunks")
      .select("id, content, chunk_index")
      .eq("book_id", bookId)
      .is("embedding", null)
      .order("chunk_index", { ascending: true });

    if (fetchErr) throw fetchErr;
    if (!chunks || chunks.length === 0) {
      console.log(`No chunks needing embeddings for book ${bookId}`);
      return new Response(JSON.stringify({ success: true, embedded: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Generating embeddings for ${chunks.length} chunks of book ${bookId}`);

    let totalEmbedded = 0;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.content.slice(0, 8000)); // truncate for safety

      try {
        const embeddings = await generateEmbeddings(texts, LOVABLE_API_KEY);

        for (let j = 0; j < batch.length; j++) {
          const embedding = embeddings[j];
          const vectorStr = `[${embedding.join(",")}]`;

          const { error: updateErr } = await supabase
            .from("book_chunks")
            .update({ embedding: vectorStr })
            .eq("id", batch[j].id);

          if (updateErr) {
            console.error(`Failed to update chunk ${batch[j].id}:`, updateErr.message);
          } else {
            totalEmbedded++;
          }
        }
      } catch (batchErr) {
        console.error(`Embedding batch at index ${i} failed:`, batchErr);
        // Continue with remaining batches
      }
    }

    console.log(`Embedded ${totalEmbedded}/${chunks.length} chunks for book ${bookId}`);
    return new Response(JSON.stringify({ success: true, embedded: totalEmbedded, total: chunks.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Embedding error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Embedding failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
