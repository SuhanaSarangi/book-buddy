import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCachedChunk, prefetchAdjacentChunks } from "@/lib/bookCache";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft,
  ChevronRight,
  Highlighter,
  StickyNote,
  Trash2,
  X,
  FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";

type HighlightColor = "yellow" | "green" | "blue" | "pink";

const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: "bg-yellow-200/60 dark:bg-yellow-400/30",
  green: "bg-emerald-200/60 dark:bg-emerald-400/30",
  blue: "bg-blue-200/60 dark:bg-blue-400/30",
  pink: "bg-pink-200/60 dark:bg-pink-400/30",
};

const COLOR_BUTTONS: Record<HighlightColor, string> = {
  yellow: "bg-yellow-300 hover:bg-yellow-400",
  green: "bg-emerald-300 hover:bg-emerald-400",
  blue: "bg-blue-300 hover:bg-blue-400",
  pink: "bg-pink-300 hover:bg-pink-400",
};

type Highlight = {
  id: string;
  chunk_index: number;
  start_offset: number;
  end_offset: number;
  highlighted_text: string;
  color: HighlightColor;
};

type Note = {
  id: string;
  chunk_index: number;
  content: string;
  highlight_id: string | null;
  created_at: string;
};

type Chunk = {
  id: string;
  chunk_index: number;
  content: string;
};

export function BookReader({
  bookId,
  bookTitle,
  bookAuthor,
  totalChunks,
  onClose,
  onSwitchToPdf,
}: {
  bookId: string;
  bookTitle: string;
  bookAuthor: string | null;
  totalChunks: number;
  onClose: () => void;
  onSwitchToPdf?: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [chunkIndex, setChunkIndex] = useState(0);
  const [chunk, setChunk] = useState<Chunk | null>(null);
  const [loading, setLoading] = useState(true);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedColor, setSelectedColor] = useState<HighlightColor>("yellow");
  const [newNote, setNewNote] = useState("");
  const [addingNoteForHighlight, setAddingNoteForHighlight] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const loadChunk = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCachedChunk(bookId, chunkIndex);
      setChunk(data as Chunk);
      prefetchAdjacentChunks(bookId, chunkIndex, totalChunks);
    } catch (err) {
      logger.error("BookReader", "Failed to load chunk", err);
    }
    setLoading(false);
  }, [bookId, chunkIndex, totalChunks]);

  const loadAnnotations = useCallback(async () => {
    const [{ data: hl }, { data: nt }] = await Promise.all([
      supabase
        .from("book_highlights")
        .select("*")
        .eq("book_id", bookId)
        .eq("chunk_index", chunkIndex)
        .eq("user_id", user!.id)
        .order("start_offset"),
      supabase
        .from("book_notes")
        .select("*")
        .eq("book_id", bookId)
        .eq("chunk_index", chunkIndex)
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false }),
    ]);
    setHighlights((hl ?? []) as Highlight[]);
    setNotes((nt ?? []) as Note[]);
  }, [bookId, chunkIndex, user]);

  useEffect(() => {
    loadChunk();
    loadAnnotations();
  }, [loadChunk, loadAnnotations]);

  const handleTextSelection = async () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !contentRef.current) return;

    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();
    if (!text) return;

    // Calculate offsets relative to the content container
    const preRange = document.createRange();
    preRange.setStart(contentRef.current, 0);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    const endOffset = startOffset + text.length;

    const { error } = await supabase.from("book_highlights").insert({
      user_id: user!.id,
      book_id: bookId,
      chunk_index: chunkIndex,
      start_offset: startOffset,
      end_offset: endOffset,
      highlighted_text: text,
      color: selectedColor,
    });

    if (error) {
      logger.error("BookReader", "Failed to create highlight", error);
      toast({ title: t("reader.failed_highlight"), description: error.message, variant: "destructive" });
    } else {
      selection.removeAllRanges();
      loadAnnotations();
    }
  };

  const deleteHighlight = async (id: string) => {
    await supabase.from("book_highlights").delete().eq("id", id).eq("user_id", user!.id);
    loadAnnotations();
  };

  const addNote = async (highlightId: string | null = null) => {
    if (!newNote.trim()) return;

    const { error } = await supabase.from("book_notes").insert({
      user_id: user!.id,
      book_id: bookId,
      chunk_index: chunkIndex,
      content: newNote.trim(),
      highlight_id: highlightId,
    });

    if (error) {
      logger.error("BookReader", "Failed to add note", error);
      toast({ title: t("reader.failed_note"), description: error.message, variant: "destructive" });
    } else {
      setNewNote("");
      setAddingNoteForHighlight(null);
      loadAnnotations();
    }
  };

  const deleteNote = async (id: string) => {
    await supabase.from("book_notes").delete().eq("id", id).eq("user_id", user!.id);
    loadAnnotations();
  };

  // Render content with highlights applied
  const renderHighlightedContent = () => {
    if (!chunk) return null;
    const text = chunk.content;

    if (highlights.length === 0) {
      return <span>{text}</span>;
    }

    // Sort highlights by start offset and merge/render
    const sorted = [...highlights].sort((a, b) => a.start_offset - b.start_offset);
    const parts: React.ReactNode[] = [];
    let lastEnd = 0;

    for (const hl of sorted) {
      // Text before highlight
      if (hl.start_offset > lastEnd) {
        parts.push(<span key={`t-${lastEnd}`}>{text.slice(lastEnd, hl.start_offset)}</span>);
      }
      // Highlighted text
      parts.push(
        <mark
          key={`h-${hl.id}`}
          className={`${HIGHLIGHT_COLORS[hl.color]} rounded-sm px-0.5 cursor-pointer relative group/hl`}
          title={`Click to add note or delete`}
          onClick={(e) => {
            e.stopPropagation();
            setAddingNoteForHighlight(addingNoteForHighlight === hl.id ? null : hl.id);
          }}
        >
          {text.slice(hl.start_offset, hl.end_offset)}
        </mark>
      );
      lastEnd = Math.max(lastEnd, hl.end_offset);
    }

    // Remaining text
    if (lastEnd < text.length) {
      parts.push(<span key={`t-${lastEnd}`}>{text.slice(lastEnd)}</span>);
    }

    return <>{parts}</>;
  };

  const chunkNotes = notes.filter((n) => !n.highlight_id);
  const getHighlightNotes = (hlId: string) => notes.filter((n) => n.highlight_id === hlId);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-[var(--font-display)] text-lg font-bold text-foreground truncate">
            {bookTitle}
          </h2>
          {bookAuthor && (
            <p className="text-xs text-muted-foreground">by {bookAuthor}</p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-4">
          {/* Color picker */}
          <div className="flex items-center gap-1">
            <Highlighter className="h-3.5 w-3.5 text-muted-foreground" />
            {(Object.entries(COLOR_BUTTONS) as [HighlightColor, string][]).map(
              ([color, cls]) => (
                <button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  className={`h-4 w-4 rounded-full ${cls} transition-transform ${
                    selectedColor === color ? "ring-2 ring-primary ring-offset-1 scale-110" : ""
                  }`}
                  title={color}
                />
              )
            )}
          </div>
          {onSwitchToPdf && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSwitchToPdf}
              className="gap-1 text-xs"
              title={t("reader.switch_pdf")}
            >
              <FileText className="h-3.5 w-3.5" />
              {t("reader.pdf")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowNotes(!showNotes)}
            className={`gap-1 ${showNotes ? "bg-primary/10 text-primary" : ""}`}
          >
            <StickyNote className="h-3.5 w-3.5" />
            <span className="text-xs">{notes.length}</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Reader */}
        <ScrollArea className="flex-1 px-8 py-6">
          <div className="mx-auto max-w-2xl">
            <p className="mb-4 text-xs text-muted-foreground">
              {t("reader.chunk_of", { current: chunkIndex + 1, total: totalChunks })}
            </p>

            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full" />
              </div>
            ) : (
              <div
                ref={contentRef}
                className="whitespace-pre-wrap font-[var(--font-body)] text-sm leading-relaxed text-foreground selection:bg-primary/20"
                onMouseUp={handleTextSelection}
              >
                {renderHighlightedContent()}
              </div>
            )}

            {/* Inline highlight note */}
            {addingNoteForHighlight && (
              <div className="mt-3 rounded-md border border-border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">{t("reader.note_on_highlight")}</p>
                  <button onClick={() => {
                    deleteHighlight(addingNoteForHighlight);
                    setAddingNoteForHighlight(null);
                  }}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </button>
                </div>
                {getHighlightNotes(addingNoteForHighlight).map((n) => (
                  <div key={n.id} className="flex items-start gap-2 text-xs bg-muted/30 rounded p-2">
                    <p className="flex-1 text-foreground">{n.content}</p>
                    <button onClick={() => deleteNote(n.id)}>
                      <Trash2 className="h-2.5 w-2.5 text-destructive" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder={t("reader.add_note")}
                    className="min-h-[60px] text-xs"
                  />
                  <Button
                    size="sm"
                    onClick={() => addNote(addingNoteForHighlight)}
                    disabled={!newNote.trim()}
                    className="self-end"
                  >
                    {t("reader.save")}
                  </Button>
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="mt-8 flex items-center justify-between border-t border-border pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={chunkIndex === 0}
                onClick={() => setChunkIndex((i) => i - 1)}
                className="gap-1"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                {chunkIndex + 1} / {totalChunks}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={chunkIndex >= totalChunks - 1}
                onClick={() => setChunkIndex((i) => i + 1)}
                className="gap-1"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </ScrollArea>

        {/* Notes panel */}
        {showNotes && (
          <div className="w-72 border-l border-border flex flex-col bg-card">
            <div className="border-b border-border px-4 py-3">
              <h3 className="font-[var(--font-display)] text-sm font-semibold text-foreground">
                Notes
              </h3>
              <p className="text-[10px] text-muted-foreground">Chunk {chunkIndex + 1}</p>
            </div>

            {/* Add general note */}
            <div className="border-b border-border p-3 space-y-2">
              <Textarea
                value={addingNoteForHighlight ? "" : newNote}
                onChange={(e) => {
                  setAddingNoteForHighlight(null);
                  setNewNote(e.target.value);
                }}
                placeholder="Add a note for this section…"
                className="min-h-[60px] text-xs"
              />
              <Button
                size="sm"
                className="w-full"
                onClick={() => addNote(null)}
                disabled={!newNote.trim() || !!addingNoteForHighlight}
              >
                Add Note
              </Button>
            </div>

            {/* Notes list */}
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {/* General notes */}
                {chunkNotes.map((n) => (
                  <div key={n.id} className="rounded-md border border-border bg-background p-2 space-y-1">
                    <p className="text-xs text-foreground whitespace-pre-wrap">{n.content}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(n.created_at).toLocaleDateString()}
                      </span>
                      <button onClick={() => deleteNote(n.id)}>
                        <Trash2 className="h-2.5 w-2.5 text-destructive" />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Highlight notes */}
                {highlights.map((hl) => {
                  const hlNotes = getHighlightNotes(hl.id);
                  if (hlNotes.length === 0) return null;
                  return (
                    <div key={hl.id} className="rounded-md border border-border bg-background p-2 space-y-1">
                      <div className={`rounded px-1.5 py-0.5 text-[10px] ${HIGHLIGHT_COLORS[hl.color]}`}>
                        "{hl.highlighted_text.slice(0, 80)}{hl.highlighted_text.length > 80 ? "…" : ""}"
                      </div>
                      {hlNotes.map((n) => (
                        <div key={n.id} className="flex items-start gap-1">
                          <p className="flex-1 text-xs text-foreground">{n.content}</p>
                          <button onClick={() => deleteNote(n.id)}>
                            <Trash2 className="h-2.5 w-2.5 text-destructive" />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}

                {chunkNotes.length === 0 && highlights.every((h) => getHighlightNotes(h.id).length === 0) && (
                  <p className="py-4 text-center text-xs text-muted-foreground">No notes yet</p>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
