import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookOpen, Upload, Trash2, Plus, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Book = {
  id: string;
  title: string;
  author: string | null;
  filename: string;
  total_chunks: number | null;
  created_at: string;
};

type Conversation = {
  id: string;
  title: string;
  updated_at: string;
};

export function BookSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onBooksChange,
}: {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onBooksChange: () => void;
}) {
  const [books, setBooks] = useState<Book[]>([]);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const { toast } = useToast();

  const loadBooks = async () => {
    const { data } = await supabase.from("books").select("*").order("created_at", { ascending: false });
    if (data) setBooks(data as Book[]);
  };

  useEffect(() => { loadBooks(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title || file.name);
    formData.append("author", author);

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-book`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          body: formData,
        }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast({ title: "Book uploaded", description: `"${title || file.name}" has been processed.` });
      setTitle("");
      setAuthor("");
      loadBooks();
      onBooksChange();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const deleteBook = async (id: string) => {
    await supabase.from("books").delete().eq("id", id);
    loadBooks();
    onBooksChange();
  };

  return (
    <aside className="flex h-full w-72 flex-col border-r border-border bg-sidebar">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-sidebar-border p-4">
        <BookOpen className="h-5 w-5 text-primary" />
        <h1 className="font-[var(--font-display)] text-lg font-bold text-sidebar-foreground">
          Bibliotheca
        </h1>
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3">
          <Button onClick={onNewConversation} variant="outline" className="w-full justify-start gap-2" size="sm">
            <Plus className="h-3.5 w-3.5" /> New Chat
          </Button>
        </div>
        <div className="space-y-0.5 px-2">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelectConversation(c.id)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                c.id === activeConversationId
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{c.title}</span>
            </button>
          ))}
        </div>

        {/* Books section */}
        <div className="border-t border-sidebar-border p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Library ({books.length})
          </p>
          <div className="space-y-1">
            {books.map((b) => (
              <div
                key={b.id}
                className="group flex items-center justify-between rounded-md px-2 py-1.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{b.title}</p>
                  {b.author && <p className="truncate text-muted-foreground">{b.author}</p>}
                </div>
                <button
                  onClick={() => deleteBook(b.id)}
                  className="ml-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Upload section */}
      <div className="border-t border-sidebar-border p-3 space-y-2">
        <Input
          placeholder="Book title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-8 text-xs"
        />
        <Input
          placeholder="Author (optional)"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          className="h-8 text-xs"
        />
        <label className="block">
          <Button variant="secondary" className="w-full gap-2" size="sm" disabled={uploading}>
            <Upload className="h-3.5 w-3.5" />
            {uploading ? "Processing…" : "Upload Book (.txt)"}
          </Button>
          <input type="file" accept=".txt,.md,.text" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>
    </aside>
  );
}
