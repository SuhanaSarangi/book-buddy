
-- Drop and recreate search_book_chunks to scope results to a specific user's books
CREATE OR REPLACE FUNCTION public.search_book_chunks(search_query text, p_user_id uuid DEFAULT NULL, match_count integer DEFAULT 5)
 RETURNS TABLE(id uuid, book_id uuid, chunk_index integer, content text, rank real)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
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
  JOIN public.books b ON b.id = bc.book_id
  WHERE bc.fts @@ to_tsquery('simple',
    array_to_string(
      array(SELECT lexeme FROM unnest(to_tsvector('simple', search_query)) ORDER BY positions),
      ' | '
    )
  )
  AND (p_user_id IS NULL OR b.user_id = p_user_id)
  ORDER BY rank DESC
  LIMIT match_count;
$$;

-- Make RLS policies PERMISSIVE (default) instead of RESTRICTIVE
DROP POLICY IF EXISTS "Users manage own books" ON public.books;
CREATE POLICY "Users manage own books" ON public.books
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own book chunks" ON public.book_chunks;
CREATE POLICY "Users read own book chunks" ON public.book_chunks
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM books WHERE books.id = book_chunks.book_id AND books.user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated can insert book chunks" ON public.book_chunks;
CREATE POLICY "Authenticated can insert book chunks" ON public.book_chunks
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM books WHERE books.id = book_chunks.book_id AND books.user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated can delete book chunks" ON public.book_chunks;
CREATE POLICY "Authenticated can delete book chunks" ON public.book_chunks
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM books WHERE books.id = book_chunks.book_id AND books.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own conversations" ON public.conversations;
CREATE POLICY "Users manage own conversations" ON public.conversations
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own messages" ON public.messages;
CREATE POLICY "Users manage own messages" ON public.messages
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users manage own shelves" ON public.user_book_shelves;
CREATE POLICY "Users manage own shelves" ON public.user_book_shelves
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
