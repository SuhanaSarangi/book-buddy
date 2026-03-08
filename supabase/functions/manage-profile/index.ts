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

    if (req.method === "GET") {
      const { data: profile, error: getErr } = await supabase
        .from("profiles")
        .select("id, display_name, created_at")
        .eq("id", userId)
        .single();

      if (getErr) {
        console.error("Profile fetch failed:", getErr.message);
        throw getErr;
      }

      return new Response(JSON.stringify({ profile }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "PATCH") {
      const { displayName } = await req.json();

      if (!displayName || typeof displayName !== "string" || displayName.trim().length === 0) {
        return new Response(JSON.stringify({ error: "displayName is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (displayName.length > 100) {
        return new Response(JSON.stringify({ error: "displayName must be 100 characters or less" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: profile, error: updateErr } = await supabase
        .from("profiles")
        .update({ display_name: displayName.trim() })
        .eq("id", userId)
        .select()
        .single();

      if (updateErr) {
        console.error("Profile update failed:", updateErr.message);
        throw updateErr;
      }

      console.log(`Profile updated: user=${userId}, displayName=${displayName.trim()}`);
      return new Response(JSON.stringify({ success: true, profile }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Profile error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Request failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
