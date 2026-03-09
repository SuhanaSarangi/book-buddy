import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";

// ── LRU Cache for PDF Blob URLs ──

const MAX_PDF_CACHE = 10;
const pdfCache = new Map<string, { url: string; accessedAt: number }>();

function evictOldestPdf() {
  if (pdfCache.size <= MAX_PDF_CACHE) return;
  let oldest: string | null = null;
  let oldestTime = Infinity;
  for (const [key, val] of pdfCache) {
    if (val.accessedAt < oldestTime) {
      oldestTime = val.accessedAt;
      oldest = key;
    }
  }
  if (oldest) {
    URL.revokeObjectURL(pdfCache.get(oldest)!.url);
    pdfCache.delete(oldest);
    logger.debug("bookCache", `Evicted PDF cache: ${oldest}`);
  }
}

export async function getCachedPdfUrl(filePath: string): Promise<string> {
  const cached = pdfCache.get(filePath);
  if (cached) {
    cached.accessedAt = Date.now();
    logger.debug("bookCache", `PDF cache hit: ${filePath}`);
    return cached.url;
  }

  const { data, error } = await supabase.storage.from("books").download(filePath);
  if (error || !data) {
    logger.error("bookCache", "Failed to download PDF", error);
    throw error ?? new Error("No data returned");
  }

  const url = URL.createObjectURL(data);
  pdfCache.set(filePath, { url, accessedAt: Date.now() });
  evictOldestPdf();
  logger.debug("bookCache", `PDF cached: ${filePath}`);
  return url;
}

export function revokeCachedPdfUrl(filePath: string) {
  const cached = pdfCache.get(filePath);
  if (cached) {
    URL.revokeObjectURL(cached.url);
    pdfCache.delete(filePath);
  }
}

// ── LRU Cache for Book Chunks ──

const MAX_CHUNK_CACHE = 100;
type ChunkEntry = { id: string; chunk_index: number; content: string; accessedAt: number };
const chunkCache = new Map<string, ChunkEntry>();

function chunkKey(bookId: string, index: number) {
  return `${bookId}:${index}`;
}

function evictOldestChunk() {
  if (chunkCache.size <= MAX_CHUNK_CACHE) return;
  let oldest: string | null = null;
  let oldestTime = Infinity;
  for (const [key, val] of chunkCache) {
    if (val.accessedAt < oldestTime) {
      oldestTime = val.accessedAt;
      oldest = key;
    }
  }
  if (oldest) chunkCache.delete(oldest);
}

export async function getCachedChunk(bookId: string, chunkIndex: number) {
  const key = chunkKey(bookId, chunkIndex);
  const cached = chunkCache.get(key);
  if (cached) {
    cached.accessedAt = Date.now();
    return { id: cached.id, chunk_index: cached.chunk_index, content: cached.content };
  }

  const { data, error } = await supabase
    .from("book_chunks")
    .select("id, chunk_index, content")
    .eq("book_id", bookId)
    .eq("chunk_index", chunkIndex)
    .single();

  if (error) {
    logger.error("bookCache", `Failed to fetch chunk ${chunkIndex}`, error);
    throw error;
  }

  chunkCache.set(key, { ...data, accessedAt: Date.now() });
  evictOldestChunk();
  return data;
}

/** Prefetch adjacent chunks in the background */
export function prefetchAdjacentChunks(bookId: string, currentIndex: number, totalChunks: number) {
  const indices = [currentIndex - 1, currentIndex + 1].filter(
    (i) => i >= 0 && i < totalChunks && !chunkCache.has(chunkKey(bookId, i))
  );
  for (const idx of indices) {
    getCachedChunk(bookId, idx).catch(() => {});
  }
}
