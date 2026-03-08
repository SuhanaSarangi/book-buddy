import { supabase } from "@/integrations/supabase/client";

export type SearchMode = "books" | "internet" | "both";

export type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: any[];
};

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

export async function streamChat({
  messages,
  conversationId,
  searchMode,
  onDelta,
  onDone,
  onSources,
}: {
  messages: Message[];
  conversationId: string;
  searchMode: SearchMode;
  onDelta: (text: string) => void;
  onDone: () => void;
  onSources?: (sources: any[]) => void;
}) {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      conversationId,
      searchMode,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `Failed with status ${resp.status}`);
  }

  // Parse sources header
  const sourcesHeader = resp.headers.get("X-Sources");
  if (sourcesHeader && onSources) {
    try {
      onSources(JSON.parse(sourcesHeader));
    } catch {}
  }

  if (!resp.body) throw new Error("No response body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (json === "[DONE]") { onDone(); return; }
      try {
        const parsed = JSON.parse(json);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) onDelta(content);
      } catch {
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }
  onDone();
}
