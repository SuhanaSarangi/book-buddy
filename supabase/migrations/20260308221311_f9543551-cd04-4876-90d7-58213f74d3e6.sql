-- Drop old generated column and recreate with 'simple' config for language-agnostic matching
ALTER TABLE public.book_chunks DROP COLUMN IF EXISTS fts;
ALTER TABLE public.book_chunks ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

-- Recreate index
DROP INDEX IF EXISTS idx_book_chunks_fts;
CREATE INDEX idx_book_chunks_fts ON public.book_chunks USING GIN (fts);

-- Update search function to use 'simple' config
CREATE OR REPLACE FUNCTION public.search_book_chunks(
  search_query text,
  match_count integer DEFAULT 5
)
RETURNS TABLE(id uuid, book_id uuid, chunk_index integer, content text, rank real)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    bc.id,
    bc.book_id,
    bc.chunk_index,
    bc.content,
    ts_rank(bc.fts, to_tsquery('simple', 
      array_to_string(
        array(SELECT lexeme FROM unnest(to_tsvector('simple', search_query)) ORDER BY positions),
        ' | '
      )
    )) AS rank
  FROM public.book_chunks bc
  WHERE bc.fts @@ to_tsquery('simple',
    array_to_string(
      array(SELECT lexeme FROM unnest(to_tsvector('simple', search_query)) ORDER BY positions),
      ' | '
    )
  )
  ORDER BY rank DESC
  LIMIT match_count;
$$;