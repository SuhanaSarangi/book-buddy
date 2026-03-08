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

    const url = new URL(req.url);
    const body = req.method !== "GET" ? await req.json() : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // --- Shelf Management ---

    if (req.method === "PUT") {
      // Upsert shelf status
      const { bookId, status, currentPage, totalPages, progressPercent, timesRead } = body;

      if (!bookId || !status) {
        return new Response(JSON.stringify({ error: "bookId and status are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const validStatuses = ["want_to_read", "currently_reading", "completed"];
      if (!validStatuses.includes(status)) {
        return new Response(JSON.stringify({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify book exists and belongs to user
      const { data: book } = await supabase
        .from("books")
        .select("id")
        .eq("id", bookId)
        .eq("user_id", userId)
        .single();

      if (!book) {
        return new Response(JSON.stringify({ error: "Book not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const upsertData: Record<string, any> = {
        user_id: userId,
        book_id: bookId,
        status,
      };

      if (currentPage !== undefined) upsertData.current_page = currentPage;
      if (totalPages !== undefined) upsertData.total_pages = totalPages;
      if (progressPercent !== undefined) upsertData.progress_percent = progressPercent;
      if (timesRead !== undefined) upsertData.times_read = timesRead;

      const { data: shelf, error: upsertErr } = await supabase
        .from("user_book_shelves")
        .upsert(upsertData, { onConflict: "user_id,book_id" })
        .select()
        .single();

      if (upsertErr) {
        console.error("Shelf upsert failed:", upsertErr.message);
        throw upsertErr;
      }

      console.log(`Shelf updated: user=${userId}, book=${bookId}, status=${status}`);
      return new Response(JSON.stringify({ success: true, shelf }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "PATCH") {
      // Update reading progress
      const { bookId, currentPage, totalPages } = body;

      if (!bookId) {
        return new Response(JSON.stringify({ error: "bookId is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const update: Record<string, any> = {};
      if (currentPage !== undefined) update.current_page = currentPage;
      if (totalPages !== undefined) update.total_pages = totalPages;

      // Auto-calculate progress
      if (currentPage !== undefined && totalPages) {
        update.progress_percent = Math.min(100, Math.round((currentPage / totalPages) * 100));
      }

      const { data: shelf, error: updateErr } = await supabase
        .from("user_book_shelves")
        .update(update)
        .eq("book_id", bookId)
        .eq("user_id", userId)
        .select()
        .single();

      if (updateErr) {
        console.error("Progress update failed:", updateErr.message);
        throw updateErr;
      }

      console.log(`Progress updated: user=${userId}, book=${bookId}`);
      return new Response(JSON.stringify({ success: true, shelf }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "DELETE") {
      // Remove from shelf
      const { bookId } = body;

      if (!bookId) {
        return new Response(JSON.stringify({ error: "bookId is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: deleteErr } = await supabase
        .from("user_book_shelves")
        .delete()
        .eq("book_id", bookId)
        .eq("user_id", userId);

      if (deleteErr) {
        console.error("Shelf delete failed:", deleteErr.message);
        throw deleteErr;
      }

      console.log(`Removed from shelf: user=${userId}, book=${bookId}`);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "GET") {
      // List user's shelves
      const { data: shelves, error: listErr } = await supabase
        .from("user_book_shelves")
        .select("*, books(id, title, author, genre)")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (listErr) {
        console.error("Shelf list failed:", listErr.message);
        throw listErr;
      }

      return new Response(JSON.stringify({ shelves }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Manage shelves error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Request failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
