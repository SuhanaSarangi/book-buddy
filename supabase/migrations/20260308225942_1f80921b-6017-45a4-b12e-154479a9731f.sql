
-- Fix book_chunks insert policy to be user-scoped
DROP POLICY IF EXISTS "Service can insert book chunks" ON public.book_chunks;
CREATE POLICY "Authenticated can insert book chunks" ON public.book_chunks FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.books WHERE books.id = book_chunks.book_id AND books.user_id = auth.uid())
);
CREATE POLICY "Authenticated can delete book chunks" ON public.book_chunks FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.books WHERE books.id = book_chunks.book_id AND books.user_id = auth.uid())
);
