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
  const { extractText } = await import("npm:unpdf@0.12.1");
  const result = await extractText(buffer);
  console.log(`Extracted text from ${result.totalPages} pages`);
  const text = Array.isArray(result.text) ? result.text.join("\n\n") : String(result.text);
  return text;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
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

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const title = formData.get("title") as string || file?.name || "Untitled";
    const author = formData.get("author") as string || "";
    const genre = formData.get("genre") as string || null;

    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "File too large. Maximum size is 50MB." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate file type
    const allowedExtensions = [".txt", ".md", ".text", ".pdf"];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!allowedExtensions.includes(ext)) {
      return new Response(JSON.stringify({ error: `Unsupported file type: ${ext}. Allowed: ${allowedExtensions.join(", ")}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Upload request from user ${userId}: "${title}" (${file.name}, ${(file.size / 1024).toFixed(1)}KB)`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Read file content
    let text: string;
    const isPdf = ext === ".pdf" || file.type === "application/pdf";

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
    const filePath = `${userId}/${crypto.randomUUID()}-${file.name}`;
    const { error: storageErr } = await supabase.storage.from("books").upload(filePath, file);
    if (storageErr) {
      console.error("Storage upload failed:", storageErr.message);
      throw new Error("Failed to upload file to storage");
    }

    // Create book record
    const chunks = chunkText(text);
    console.log(`Created ${chunks.length} chunks`);
    
    const { data: book, error: bookErr } = await supabase.from("books").insert({
      title, author, genre, filename: file.name, file_path: filePath, total_chunks: chunks.length, user_id: userId,
    }).select().single();

    if (bookErr) {
      console.error("Book insert failed:", bookErr.message);
      // Clean up uploaded file
      await supabase.storage.from("books").remove([filePath]);
      throw bookErr;
    }

    // Insert chunks in batches
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE).map((content, j) => ({
        book_id: book.id,
        chunk_index: i + j,
        content,
      }));
      const { error: chunkErr } = await supabase.from("book_chunks").insert(batch);
      if (chunkErr) {
        console.error(`Chunk batch insert failed at index ${i}:`, chunkErr.message);
        throw chunkErr;
      }
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
