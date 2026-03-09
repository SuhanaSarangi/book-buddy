
CREATE OR REPLACE FUNCTION public.match_book_chunks(
  query_embedding extensions.vector,
  p_user_id uuid DEFAULT NULL,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 5
)
RETURNS TABLE(id uuid, book_id uuid, chunk_index integer, content text, similarity double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    bc.id,
    bc.book_id,
    bc.chunk_index,
    bc.content,
    1 - (bc.embedding <=> query_embedding) AS similarity
  FROM public.book_chunks bc
  JOIN public.books b ON b.id = bc.book_id
  WHERE bc.embedding IS NOT NULL
    AND 1 - (bc.embedding <=> query_embedding) > match_threshold
    AND (p_user_id IS NULL OR b.user_id = p_user_id)
  ORDER BY bc.embedding <=> query_embedding
  LIMIT match_count;
$$;
