-- Hybrid search using Reciprocal Rank Fusion (RRF)
-- Merges vector similarity search and full-text search results
CREATE OR REPLACE FUNCTION public.hybrid_search_book_chunks(
  query_embedding extensions.vector,
  search_query text,
  p_user_id uuid DEFAULT NULL,
  match_count integer DEFAULT 8,
  rrf_k integer DEFAULT 60
)
RETURNS TABLE(
  id uuid,
  book_id uuid,
  chunk_index integer,
  content text,
  rrf_score double precision,
  found_by text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  WITH vector_results AS (
    SELECT
      bc.id,
      bc.book_id,
      bc.chunk_index,
      bc.content,
      ROW_NUMBER() OVER (ORDER BY bc.embedding <=> query_embedding) AS vector_rank
    FROM public.book_chunks bc
    JOIN public.books b ON b.id = bc.book_id
    WHERE bc.embedding IS NOT NULL
      AND 1 - (bc.embedding <=> query_embedding) > 0.2
      AND (p_user_id IS NULL OR b.user_id = p_user_id)
    ORDER BY bc.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  fts_results AS (
    SELECT
      bc.id,
      bc.book_id,
      bc.chunk_index,
      bc.content,
      ROW_NUMBER() OVER (ORDER BY ts_rank(bc.fts, to_tsquery('simple',
        array_to_string(
          array(SELECT lexeme FROM unnest(to_tsvector('simple', search_query)) ORDER BY positions),
          ' | '
        )
      )) DESC) AS fts_rank
    FROM public.book_chunks bc
    JOIN public.books b ON b.id = bc.book_id
    WHERE bc.fts @@ to_tsquery('simple',
        array_to_string(
          array(SELECT lexeme FROM unnest(to_tsvector('simple', search_query)) ORDER BY positions),
          ' | '
        )
      )
      AND (p_user_id IS NULL OR b.user_id = p_user_id)
    ORDER BY fts_rank
    LIMIT match_count * 2
  ),
  combined AS (
    SELECT
      COALESCE(v.id, f.id) AS id,
      COALESCE(v.book_id, f.book_id) AS book_id,
      COALESCE(v.chunk_index, f.chunk_index) AS chunk_index,
      COALESCE(v.content, f.content) AS content,
      COALESCE(1.0 / (rrf_k + v.vector_rank), 0.0) +
      COALESCE(1.0 / (rrf_k + f.fts_rank), 0.0) AS rrf_score,
      CASE
        WHEN v.id IS NOT NULL AND f.id IS NOT NULL THEN 'both'
        WHEN v.id IS NOT NULL THEN 'vector'
        ELSE 'fts'
      END AS found_by
    FROM vector_results v
    FULL OUTER JOIN fts_results f ON v.id = f.id
  )
  SELECT id, book_id, chunk_index, content, rrf_score, found_by
  FROM combined
  ORDER BY rrf_score DESC
  LIMIT match_count;
$$;
