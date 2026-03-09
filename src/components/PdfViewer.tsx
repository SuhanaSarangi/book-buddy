import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { X, ZoomIn, ZoomOut, FileText, BookOpenText } from "lucide-react";
import { logger } from "@/lib/logger";

export function PdfViewer({
  bookId,
  bookTitle,
  bookAuthor,
  filePath,
  onClose,
  onSwitchToReader,
}: {
  bookId: string;
  bookTitle: string;
  bookAuthor: string | null;
  filePath: string;
  onClose: () => void;
  onSwitchToReader: () => void;
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPdf() {
      setLoading(true);
      setError(null);

      const { data, error: dlError } = await supabase.storage
        .from("books")
        .download(filePath);

      if (dlError || !data) {
        logger.error("PdfViewer", "Failed to download PDF", dlError);
        setError("Could not load PDF. The file may not exist.");
        setLoading(false);
        return;
      }

      const url = URL.createObjectURL(data);
      setPdfUrl(url);
      setLoading(false);
    }

    loadPdf();

    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [filePath]);

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
          <Button
            variant="ghost"
            size="sm"
            onClick={onSwitchToReader}
            className="gap-1 text-xs"
            title="Switch to text reader"
          >
            <BookOpenText className="h-3.5 w-3.5" />
            Text View
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* PDF Content */}
      <div className="flex-1 overflow-hidden bg-muted/20">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="space-y-3 text-center">
              <Skeleton className="mx-auto h-64 w-48" />
              <p className="text-sm text-muted-foreground">Loading PDF…</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-3">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" onClick={onSwitchToReader}>
                View as Text
              </Button>
            </div>
          </div>
        ) : (
          <iframe
            src={pdfUrl + "#toolbar=1&navpanes=1"}
            className="h-full w-full border-0"
            title={`PDF: ${bookTitle}`}
          />
        )}
      </div>
    </div>
  );
}
