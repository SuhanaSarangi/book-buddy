import { useState, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, Upload, Plus, MessageSquare, LogOut, Filter, Search, ChevronDown, X, Tag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { BookItem, type BookShelf } from "@/components/BookItem";
import { SkeletonBook } from "@/components/SkeletonBook";
import { useDebounce } from "@/hooks/useDebounce";
import { useBooks, useDeleteBook, useShelves, useInvalidateShelves, useSubjects, useCreateSubject, useDeleteSubject } from "@/hooks/useQueries";
import { logger } from "@/lib/logger";

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
  onReadBook,
}: {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onBooksChange: () => void;
  onReadBook?: (book: { id: string; title: string; author: string | null; total_chunks: number | null }) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [subject, setSubject] = useState("");
  const [filterSubject, setFilterSubject] = useState<string>("all");
  const [filterShelf, setFilterShelf] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [showSubjectManager, setShowSubjectManager] = useState(false);
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
  const { data: subjects = [] } = useSubjects();
  const createSubjectMutation = useCreateSubject();
  const deleteSubjectMutation = useDeleteSubject();
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
    if (filterSubject !== "all" && b.genre !== filterSubject) return false;
    if (filterShelf !== "all") {
      const shelf = getShelfStatus(b.id);
      if (shelf !== filterShelf) return false;
    }
    return true;
  });

  const isLoading = loadingBooks && books.length === 0;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title || file.name);
    formData.append("author", author);
    formData.append("genre", subject); // Using genre column for subject

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
      setSubject("");
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

  const handleCreateSubject = () => {
    if (!newSubjectName.trim() || !user) return;
    createSubjectMutation.mutate(
      { name: newSubjectName.trim(), userId: user.id },
      {
        onSuccess: () => {
          setNewSubjectName("");
          toast({ title: "Subject created", description: `"${newSubjectName}" has been added.` });
        },
        onError: (err) => {
          toast({ title: "Failed to create subject", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const handleDeleteSubject = (id: string, name: string) => {
    deleteSubjectMutation.mutate(id, {
      onSuccess: () => {
        toast({ title: "Subject deleted", description: `"${name}" has been removed.` });
        if (subject === name) setSubject("");
        if (filterSubject === name) setFilterSubject("all");
      },
      onError: (err) => {
        toast({ title: "Failed to delete subject", description: err.message, variant: "destructive" });
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
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowSubjectManager(!showSubjectManager)}
                className={`rounded p-1 transition-colors ${showSubjectManager ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                title="Manage subjects"
              >
                <Tag className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`rounded p-1 transition-colors ${showFilters ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Filter className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Subject Manager */}
          {showSubjectManager && (
            <div className="mb-3 rounded-md border border-border bg-muted/30 p-2 space-y-2">
              <p className="text-xs font-medium text-foreground">My Subjects</p>
              <div className="flex gap-1">
                <Input
                  placeholder="New subject name"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateSubject()}
                  className="h-7 text-xs flex-1"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 px-2"
                  onClick={handleCreateSubject}
                  disabled={!newSubjectName.trim() || createSubjectMutation.isPending}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              {subjects.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {subjects.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                    >
                      {s.name}
                      <button
                        onClick={() => handleDeleteSubject(s.id, s.name)}
                        className="hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No subjects yet. Create one above.</p>
              )}
            </div>
          )}

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
              <Select value={filterSubject} onValueChange={setFilterSubject}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="All subjects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All subjects</SelectItem>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
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
                    onRead={onReadBook ? () => onReadBook(b) : undefined}
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
        <Select value={subject} onValueChange={setSubject}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select subject" />
          </SelectTrigger>
          <SelectContent>
            {subjects.length === 0 ? (
              <SelectItem value="none" disabled>Create subjects first</SelectItem>
            ) : (
              subjects.map((s) => (
                <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
              ))
            )}
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
