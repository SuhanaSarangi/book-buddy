import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, Upload, Plus, MessageSquare, LogOut, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { BookItem, type BookShelf } from "@/components/BookItem";

const GENRES = [
  "Fiction", "Non-Fiction", "Science Fiction", "Fantasy", "Mystery",
  "Romance", "Thriller", "Biography", "History", "Science",
  "Philosophy", "Self-Help", "Technology", "Poetry", "Other",
];

type ShelfStatus = "want_to_read" | "currently_reading" | "completed";

const SHELF_FILTER_LABELS: Record<ShelfStatus, string> = {
  want_to_read: "Want to Read",
  currently_reading: "Reading",
  completed: "Completed",
};

type Book = {
  id: string;
  title: string;
  author: string | null;
  genre: string | null;
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
  const [shelves, setShelves] = useState<BookShelf[]>([]);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [genre, setGenre] = useState("");
  const [filterGenre, setFilterGenre] = useState<string>("all");
  const [filterShelf, setFilterShelf] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user, signOut } = useAuth();

  const loadBooks = async () => {
    const { data } = await supabase.from("books").select("*").order("created_at", { ascending: false });
    if (data) setBooks(data as Book[]);
  };

  const loadShelves = async () => {
    const { data } = await supabase.from("user_book_shelves").select("book_id, status, progress_percent, current_page, total_pages, times_read");
    if (data) setShelves(data as BookShelf[]);
  };

  useEffect(() => { loadBooks(); loadShelves(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title || file.name);
    formData.append("author", author);
    formData.append("genre", genre);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-book`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          body: formData,
        }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast({ title: "Book uploaded", description: `"${title || file.name}" has been processed.` });
      setTitle("");
      setAuthor("");
      setGenre("");
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

  const getShelfStatus = (bookId: string): ShelfStatus | null => {
    return shelves.find((s) => s.book_id === bookId)?.status ?? null;
  };

  const filteredBooks = books.filter((b) => {
    if (filterGenre !== "all" && b.genre !== filterGenre) return false;
    if (filterShelf !== "all") {
      const shelf = getShelfStatus(b.id);
      if (shelf !== filterShelf) return false;
    }
    return true;
  });

  const uniqueGenres = [...new Set(books.map((b) => b.genre).filter(Boolean))] as string[];

  return (
    <aside className="flex h-full w-72 flex-col border-r border-border bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sidebar-border p-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h1 className="font-[var(--font-display)] text-lg font-bold text-sidebar-foreground">
            Bibliotheca
          </h1>
        </div>
        <button onClick={signOut} className="text-muted-foreground hover:text-foreground" title="Sign out">
          <LogOut className="h-4 w-4" />
        </button>
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
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Library ({filteredBooks.length})
            </p>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`rounded p-1 transition-colors ${showFilters ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Filter className="h-3.5 w-3.5" />
            </button>
          </div>

          {showFilters && (
            <div className="mb-2 space-y-1.5">
              <Select value={filterGenre} onValueChange={setFilterGenre}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="All genres" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All genres</SelectItem>
                  {uniqueGenres.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterShelf} onValueChange={setFilterShelf}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="All shelves" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All shelves</SelectItem>
                  {(Object.entries(SHELF_FILTER_LABELS) as [ShelfStatus, string][]).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            {filteredBooks.map((b) => (
              <BookItem
                key={b.id}
                book={b}
                shelf={shelves.find((s) => s.book_id === b.id) ?? null}
                onDelete={() => deleteBook(b.id)}
                onShelfChange={loadShelves}
              />
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
        <Select value={genre} onValueChange={setGenre}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select genre" />
          </SelectTrigger>
          <SelectContent>
            {GENRES.map((g) => (
              <SelectItem key={g} value={g}>{g}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="secondary"
          className="w-full gap-2"
          size="sm"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          {uploading ? "Processing…" : "Upload Book"}
        </Button>
        <input ref={fileInputRef} type="file" accept=".txt,.md,.text,.pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
      </div>
    </aside>
  );
}
