import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Trash2, BookMarked, Library, CheckCircle2, RotateCcw, ChevronDown, ChevronUp, BookOpenText } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type ShelfStatus = "want_to_read" | "currently_reading" | "completed";

const SHELF_LABELS: Record<ShelfStatus, { label: string; icon: React.ReactNode }> = {
  want_to_read: { label: "Want to Read", icon: <BookMarked className="h-3 w-3" /> },
  currently_reading: { label: "Reading", icon: <Library className="h-3 w-3" /> },
  completed: { label: "Completed", icon: <CheckCircle2 className="h-3 w-3" /> },
};

export type BookShelf = {
  book_id: string;
  status: ShelfStatus;
  progress_percent: number;
  current_page: number;
  total_pages: number | null;
  times_read: number;
};

type Book = {
  id: string;
  title: string;
  author: string | null;
  genre: string | null;
};

export function BookItem({
  book,
  shelf,
  onDelete,
  onShelfChange,
  onRead,
}: {
  book: Book;
  shelf: BookShelf | null;
  onDelete: () => void;
  onShelfChange: () => void;
  onRead?: () => void;
}) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [localPage, setLocalPage] = useState(String(shelf?.current_page || 0));
  const [localTotal, setLocalTotal] = useState(String(shelf?.total_pages || ""));

  const setShelfStatus = async (status: ShelfStatus | null) => {
    if (status === null) {
      await supabase.from("user_book_shelves").delete().eq("book_id", book.id).eq("user_id", user!.id);
    } else {
      const extra: Record<string, any> = { user_id: user!.id, book_id: book.id, status };
      if (status === "completed") {
        extra.progress_percent = 100;
        extra.times_read = (shelf?.times_read || 0) + (shelf?.status !== "completed" ? 1 : 0);
      }
      await supabase.from("user_book_shelves").upsert(extra as any, { onConflict: "user_id,book_id" });
    }
    onShelfChange();
  };

  const updateProgress = async (field: string, value: number | null) => {
    if (!shelf) return;
    const update: Record<string, any> = { [field]: value };
    // Auto-calc percent from pages
    if (field === "current_page" && shelf.total_pages) {
      update.progress_percent = Math.min(100, Math.round(((value || 0) / shelf.total_pages) * 100));
    }
    if (field === "total_pages" && value && shelf.current_page) {
      update.progress_percent = Math.min(100, Math.round((shelf.current_page / value) * 100));
    }
    await supabase.from("user_book_shelves").update(update).eq("book_id", book.id).eq("user_id", user!.id);
    onShelfChange();
  };

  const incrementTimesRead = async () => {
    if (!shelf) return;
    await supabase.from("user_book_shelves").update({ times_read: (shelf.times_read || 0) + 1 }).eq("book_id", book.id).eq("user_id", user!.id);
    onShelfChange();
  };

  const shelfStatus = shelf?.status ?? null;

  return (
    <div className="group rounded-md px-2 py-1.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent/50">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <p className="truncate font-medium">{book.title}</p>
          <div className="flex items-center gap-1 text-muted-foreground">
            {book.author && <span className="truncate">{book.author}</span>}
            {book.genre && (
              <>
                {book.author && <span>·</span>}
                <span className="truncate">{book.genre}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />}
          <button
            onClick={onDelete}
            className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </button>
        </div>
      </div>

      {/* Shelf buttons */}
      <div className="mt-1 flex gap-1">
        {(Object.entries(SHELF_LABELS) as [ShelfStatus, { label: string; icon: React.ReactNode }][]).map(
          ([status, { label, icon }]) => (
            <button
              key={status}
              onClick={() => setShelfStatus(shelfStatus === status ? null : status)}
              className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] transition-colors ${
                shelfStatus === status
                  ? "bg-primary/15 text-primary"
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}
              title={label}
            >
              {icon}
            </button>
          )
        )}
      </div>

      {/* Expanded progress section */}
      {expanded && shelf && (
        <div className="mt-2 space-y-1.5 rounded-md bg-background/50 p-2">
          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <Progress value={shelf.progress_percent || 0} className="h-1.5 flex-1" />
            <span className="text-[10px] font-medium text-muted-foreground">{shelf.progress_percent || 0}%</span>
          </div>

          {/* Page tracking */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">Page</span>
            <Input
              value={localPage}
              onChange={(e) => setLocalPage(e.target.value)}
              onBlur={() => updateProgress("current_page", parseInt(localPage) || 0)}
              className="h-5 w-12 px-1 text-[10px]"
              type="number"
              min={0}
            />
            <span className="text-[10px] text-muted-foreground">of</span>
            <Input
              value={localTotal}
              onChange={(e) => setLocalTotal(e.target.value)}
              onBlur={() => updateProgress("total_pages", parseInt(localTotal) || null)}
              className="h-5 w-12 px-1 text-[10px]"
              type="number"
              min={1}
              placeholder="?"
            />
          </div>

          {/* Times read */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              Read {shelf.times_read || 0} time{(shelf.times_read || 0) !== 1 ? "s" : ""}
            </span>
            <button
              onClick={incrementTimesRead}
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              title="Mark as re-read"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              +1
            </button>
          </div>
        </div>
      )}

      {/* Compact progress indicator when collapsed */}
      {!expanded && shelf && shelf.status === "currently_reading" && (shelf.progress_percent || 0) > 0 && (
        <div className="mt-1">
          <Progress value={shelf.progress_percent} className="h-1" />
        </div>
      )}
    </div>
  );
}
