-- Add tsvector column for full-text search
ALTER TABLE public.book_chunks ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_book_chunks_fts ON public.book_chunks USING GIN (fts);

-- Create a full-text search function to replace vector search
CREATE OR REPLACE FUNCTION public.search_book_chunks(
  search_query text,
  match_count integer DEFAULT 5
)
RETURNS TABLE(id uuid, book_id uuid, chunk_index integer, content text, rank real)
LANGUAGE sql
STABLE
AS $$
  SELECT
    bc.id,
    bc.book_id,
    bc.chunk_index,
    bc.content,
    ts_rank(bc.fts, websearch_to_tsquery('english', search_query)) AS rank
  FROM public.book_chunks bc
  WHERE bc.fts @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC
  LIMIT match_count;
$$;