
CREATE OR REPLACE FUNCTION public.match_book_chunks(query_embedding extensions.vector, match_threshold double precision DEFAULT 0.3, match_count integer DEFAULT 5)
 RETURNS TABLE(id uuid, book_id uuid, chunk_index integer, content text, similarity double precision)
 LANGUAGE sql
 STABLE
 SET search_path = public, extensions
AS $$
  SELECT
    bc.id,
    bc.book_id,
    bc.chunk_index,
    bc.content,
    1 - (bc.embedding <=> query_embedding) AS similarity
  FROM public.book_chunks bc
  WHERE 1 - (bc.embedding <=> query_embedding) > match_threshold
  ORDER BY bc.embedding <=> query_embedding
  LIMIT match_count;
$$;
