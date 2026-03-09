import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookSidebar } from "@/components/BookSidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { SkeletonMessage } from "@/components/SkeletonBook";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { streamChat, type Message, type SearchMode } from "@/lib/chat";
import { BookReader } from "@/components/BookReader";
import { PdfViewer } from "@/components/PdfViewer";
import { useConversations, useMessages, useCreateConversation } from "@/hooks/useQueries";
import { logger } from "@/lib/logger";
import { Send, BookOpen, Globe, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const SEARCH_MODES: { value: SearchMode; label: string; icon: React.ReactNode }[] = [
  { value: "books", label: "Books", icon: <BookOpen className="h-3.5 w-3.5" /> },
  { value: "internet", label: "Web", icon: <Globe className="h-3.5 w-3.5" /> },
  { value: "both", label: "Both", icon: <Layers className="h-3.5 w-3.5" /> },
];

export default function Index() {
  const { user } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>("both");
  const [readingBook, setReadingBook] = useState<{
    id: string;
    title: string;
    author: string | null;
    total_chunks: number;
    file_path: string | null;
  } | null>(null);
  const [viewMode, setViewMode] = useState<"pdf" | "text">("pdf");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // React Query hooks
  const { data: conversations = [] } = useConversations();
  const { data: fetchedMessages, isLoading: loadingMessages } = useMessages(activeId);
  const createConversation = useCreateConversation();

  // Sync fetched messages with local state (for streaming)
  useEffect(() => {
    if (fetchedMessages && !isLoading) {
      setLocalMessages(fetchedMessages);
    }
  }, [fetchedMessages, isLoading]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [localMessages]);

  const handleNewConversation = async () => {
    try {
      const data = await createConversation.mutateAsync({
        title: "New Chat",
        userId: user!.id,
      });
      setActiveId(data.id);
      setLocalMessages([]);
    } catch (err: any) {
      logger.error("Index", "Failed to create conversation", err);
      toast({ title: "Error", description: "Failed to create conversation.", variant: "destructive" });
    }
  };

  const send = async () => {
    if (!input.trim() || isLoading) return;

    let convId = activeId;
    if (!convId) {
      try {
        const data = await createConversation.mutateAsync({
          title: input.slice(0, 50),
          userId: user!.id,
        });
        convId = data.id;
        setActiveId(convId);
      } catch (err: any) {
        logger.error("Index", "Failed to create conversation for send", err);
        toast({ title: "Error", description: "Failed to start conversation.", variant: "destructive" });
        return;
      }
    }

    const userMsg: Message = { role: "user", content: input };
    const allMessages = [...localMessages, userMsg];
    setLocalMessages(allMessages);
    setInput("");
    setIsLoading(true);

    let assistantContent = "";

    logger.info("Index", `Sending message in conversation ${convId}`, { searchMode });

    try {
      await streamChat({
        messages: allMessages,
        conversationId: convId,
        searchMode,
        onDelta: (chunk) => {
          assistantContent += chunk;
          setLocalMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, content: assistantContent } : m
              );
            }
            return [...prev, { role: "assistant", content: assistantContent }];
          });
        },
        onDone: () => {
          setIsLoading(false);
          // Invalidate messages cache so it has the latest
          queryClient.invalidateQueries({ queryKey: ["messages", convId] });
          queryClient.invalidateQueries({ queryKey: ["conversations"] });
          logger.info("Index", "Chat response complete");
        },
        onSources: (sources) => {
          setLocalMessages((prev) => {
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
      logger.error("Index", "Chat stream failed", e);
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <ErrorBoundary>
        <BookSidebar
          conversations={conversations}
          activeConversationId={activeId}
          onSelectConversation={(id) => { setActiveId(id); setReadingBook(null); }}
          onNewConversation={() => { handleNewConversation(); setReadingBook(null); }}
          onBooksChange={() => {
            queryClient.invalidateQueries({ queryKey: ["books"] });
          }}
          onReadBook={(book) => setReadingBook({
            id: book.id,
            title: book.title,
            author: book.author,
            total_chunks: book.total_chunks || 0,
          })}
        />
      </ErrorBoundary>

      <main className="flex flex-1 flex-col">
        <ErrorBoundary>
          {readingBook ? (
            <BookReader
              bookId={readingBook.id}
              bookTitle={readingBook.title}
              bookAuthor={readingBook.author}
              totalChunks={readingBook.total_chunks}
              onClose={() => setReadingBook(null)}
            />
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8">
                {loadingMessages ? (
                  <div className="mx-auto max-w-3xl space-y-4">
                    <SkeletonMessage isUser />
                    <SkeletonMessage />
                    <SkeletonMessage isUser />
                    <SkeletonMessage />
                  </div>
                ) : localMessages.length === 0 ? (
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
                    {localMessages.map((m, i) => (
                      <ChatMessage key={i} message={m} />
                    ))}
                    {isLoading && localMessages[localMessages.length - 1]?.role === "user" && (
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

              <div className="border-t border-border bg-background px-6 py-4">
                <div className="mx-auto max-w-3xl">
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
            </>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
