import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { userId: null, error: "Missing authorization header" };
  }

  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabaseAuth.auth.getClaims(token);
  if (error || !data?.claims) {
    return { userId: null, error: "Invalid token" };
  }

  return { userId: data.claims.sub as string, error: null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { userId, error: authError } = await getAuthenticatedUser(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: authError }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (req.method === "DELETE") {
      const { bookId } = await req.json();

      if (!bookId) {
        return new Response(JSON.stringify({ error: "bookId is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify book belongs to user
      const { data: book } = await supabase
        .from("books")
        .select("id, file_path")
        .eq("id", bookId)
        .eq("user_id", userId)
        .single();

      if (!book) {
        return new Response(JSON.stringify({ error: "Book not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Delete in order: shelves → chunks → book → storage
      await supabase.from("user_book_shelves").delete().eq("book_id", bookId);
      await supabase.from("book_chunks").delete().eq("book_id", bookId);
      
      const { error: deleteErr } = await supabase.from("books").delete().eq("id", bookId);
      if (deleteErr) {
        console.error("Book delete failed:", deleteErr.message);
        throw deleteErr;
      }

      // Clean up storage
      if (book.file_path) {
        await supabase.storage.from("books").remove([book.file_path]);
      }

      console.log(`Book deleted: ${bookId} by user ${userId}`);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "GET") {
      // List user's books with pagination
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get("page") || "0");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
      const search = url.searchParams.get("search") || "";
      const genre = url.searchParams.get("genre") || "";

      let query = supabase
        .from("books")
        .select("*", { count: "exact" })
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(page * limit, (page + 1) * limit - 1);

      if (search) {
        query = query.or(`title.ilike.%${search}%,author.ilike.%${search}%`);
      }
      if (genre) {
        query = query.eq("genre", genre);
      }

      const { data: books, count, error: listErr } = await query;
      if (listErr) {
        console.error("Book list failed:", listErr.message);
        throw listErr;
      }

      return new Response(JSON.stringify({ books, total: count, page, limit }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Manage books error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Request failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
