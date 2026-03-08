import { useState, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, Upload, Plus, MessageSquare, LogOut, Filter, Search, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { BookItem, type BookShelf } from "@/components/BookItem";
import { SkeletonBook } from "@/components/SkeletonBook";
import { useDebounce } from "@/hooks/useDebounce";
import { useBooks, useDeleteBook, useShelves, useInvalidateShelves } from "@/hooks/useQueries";
import { logger } from "@/lib/logger";

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
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [genre, setGenre] = useState("");
  const [filterGenre, setFilterGenre] = useState<string>("all");
  const [filterShelf, setFilterShelf] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user, signOut } = useAuth();

  const debouncedSearch = useDebounce(searchQuery, 300);

  // React Query hooks
  const {
    data: booksPages,
    isLoading: loadingBooks,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useBooks(debouncedSearch);

  const { data: shelves = [], isLoading: loadingShelves } = useShelves();
  const invalidateShelves = useInvalidateShelves();
  const deleteBookMutation = useDeleteBook();

  // Flatten paginated books
  const books = useMemo(
    () => booksPages?.pages.flatMap((p) => p.books) ?? [],
    [booksPages]
  );

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
  const isLoading = loadingBooks && books.length === 0;

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

      logger.info("BookSidebar", `Uploading book: ${title || file.name}`);

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

      logger.info("BookSidebar", `Book uploaded successfully: ${title || file.name}`);
      toast({ title: "Book uploaded", description: `"${title || file.name}" has been processed.` });
      setTitle("");
      setAuthor("");
      setGenre("");
      onBooksChange();
    } catch (err: any) {
      logger.error("BookSidebar", "Upload failed", err);
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = (id: string) => {
    deleteBookMutation.mutate(id, {
      onSuccess: () => onBooksChange(),
      onError: (err) => {
        logger.error("BookSidebar", "Delete failed", err);
        toast({ title: "Delete failed", description: err.message, variant: "destructive" });
      },
    });
  };

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
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search books…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-7 pl-7 text-xs"
                />
              </div>
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
            {isLoading || loadingShelves ? (
              <>
                <SkeletonBook />
                <SkeletonBook />
                <SkeletonBook />
              </>
            ) : (
              <>
                {filteredBooks.map((b) => (
                  <BookItem
                    key={b.id}
                    book={b}
                    shelf={shelves.find((s) => s.book_id === b.id) ?? null}
                    onDelete={() => handleDelete(b.id)}
                    onShelfChange={invalidateShelves}
                  />
                ))}
                {hasNextPage && (
                  <button
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="flex w-full items-center justify-center gap-1 rounded-md py-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors disabled:opacity-50"
                  >
                    <ChevronDown className="h-3 w-3" />
                    {isFetchingNextPage ? "Loading…" : "Load more"}
                  </button>
                )}
                {!isLoading && filteredBooks.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">No books found</p>
                )}
              </>
            )}
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
