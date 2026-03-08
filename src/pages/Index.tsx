import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookSidebar } from "@/components/BookSidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { streamChat, type Message, type SearchMode } from "@/lib/chat";
import { Send, BookOpen, Globe, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Conversation = { id: string; title: string; updated_at: string };

const SEARCH_MODES: { value: SearchMode; label: string; icon: React.ReactNode }[] = [
  { value: "books", label: "Books", icon: <BookOpen className="h-3.5 w-3.5" /> },
  { value: "internet", label: "Web", icon: <Globe className="h-3.5 w-3.5" /> },
  { value: "both", label: "Both", icon: <Layers className="h-3.5 w-3.5" /> },
];

export default function Index() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>("both");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data as Conversation[]);
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    if (data) setMessages(data as Message[]);
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => { if (activeId) loadMessages(activeId); }, [activeId, loadMessages]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const createConversation = async () => {
    const { data } = await supabase
      .from("conversations")
      .insert({ title: "New Chat" })
      .select()
      .single();
    if (data) {
      setActiveId(data.id);
      setMessages([]);
      loadConversations();
    }
  };

  const send = async () => {
    if (!input.trim() || isLoading) return;

    let convId = activeId;
    if (!convId) {
      const { data } = await supabase
        .from("conversations")
        .insert({ title: input.slice(0, 50) })
        .select()
        .single();
      if (!data) return;
      convId = data.id;
      setActiveId(convId);
      loadConversations();
    }

    const userMsg: Message = { role: "user", content: input };
    const allMessages = [...messages, userMsg];
    setMessages(allMessages);
    setInput("");
    setIsLoading(true);

    let assistantContent = "";

    try {
      await streamChat({
        messages: allMessages,
        conversationId: convId,
        searchMode,
        onDelta: (chunk) => {
          assistantContent += chunk;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, content: assistantContent } : m
              );
            }
            return [...prev, { role: "assistant", content: assistantContent }];
          });
        },
        onDone: () => setIsLoading(false),
        onSources: (sources) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, sources } : m
              );
            }
            return prev;
          });
        },
      });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <BookSidebar
        conversations={conversations}
        activeConversationId={activeId}
        onSelectConversation={setActiveId}
        onNewConversation={createConversation}
        onBooksChange={() => {}}
      />

      {/* Chat area */}
      <main className="flex flex-1 flex-col">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <BookOpen className="mb-4 h-12 w-12 text-primary/30" />
              <h2 className="font-[var(--font-display)] text-2xl font-bold text-foreground/80">
                Ask your library anything
              </h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Upload books to your private library, then ask questions. Toggle between searching your books, the internet, or both.
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((m, i) => (
                <ChatMessage key={i} message={m} />
              ))}
              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex gap-3">
                  <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <BookOpen className="h-4 w-4" />
                  </div>
                  <div className="rounded-2xl bg-card border border-border px-4 py-3">
                    <span className="text-sm text-muted-foreground animate-pulse">Thinking…</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-border bg-background px-6 py-4">
          <div className="mx-auto max-w-3xl">
            {/* Search mode toggle */}
            <div className="mb-3 flex items-center gap-1">
              <span className="mr-2 text-xs text-muted-foreground">Search:</span>
              {SEARCH_MODES.map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => setSearchMode(mode.value)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    searchMode === mode.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {mode.icon}
                  {mode.label}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); send(); }}
              className="flex gap-2"
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  searchMode === "books"
                    ? "Ask about your books…"
                    : searchMode === "internet"
                    ? "Search the web…"
                    : "Ask anything…"
                }
                disabled={isLoading}
                className="flex-1"
              />
              <Button type="submit" disabled={isLoading || !input.trim()} size="icon">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
