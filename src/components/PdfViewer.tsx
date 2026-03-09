import { useState, useEffect, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { X, ZoomIn, ZoomOut, FileText, BookOpenText, ChevronLeft, ChevronRight } from "lucide-react";
import { logger } from "@/lib/logger";
import { getCachedPdfUrl } from "@/lib/bookCache";
import { useTranslation } from "react-i18next";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

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
  const { t } = useTranslation();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.2);

  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      try {
        const url = await getCachedPdfUrl(filePath);
        if (!cancelled) {
          setPdfUrl(url);
          setLoading(false);
        }
      } catch (err) {
        logger.error("PdfViewer", "Failed to download PDF", err);
        if (!cancelled) {
          setError(t("reader.no_pdf"));
          setLoading(false);
        }
      }
    }

    loadPdf();

    return () => { cancelled = true; };
  }, [filePath]);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  }, []);

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
          {numPages > 0 && (
            <>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground">{Math.round(scale * 100)}%</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setScale((s) => Math.min(3, s + 0.2))}>
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onSwitchToReader}
            className="gap-1 text-xs"
            title={t("reader.switch_text")}
          >
            <BookOpenText className="h-3.5 w-3.5" />
            {t("reader.text_view")}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* PDF Content */}
      <div className="flex-1 overflow-auto bg-muted/20">
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
          <div className="flex flex-col items-center py-4">
            <Document
              file={pdfUrl!}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={
                <div className="flex items-center justify-center py-12">
                  <p className="text-sm text-muted-foreground animate-pulse">Rendering PDF…</p>
                </div>
              }
              error={
                <div className="text-center py-12">
                  <p className="text-sm text-destructive">Failed to render PDF</p>
                </div>
              }
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                loading={<Skeleton className="h-[800px] w-[600px]" />}
              />
            </Document>

            {numPages > 1 && (
              <div className="flex items-center gap-3 py-4">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={pageNumber <= 1}
                  onClick={() => setPageNumber((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  {pageNumber} / {numPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={pageNumber >= numPages}
                  onClick={() => setPageNumber((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
