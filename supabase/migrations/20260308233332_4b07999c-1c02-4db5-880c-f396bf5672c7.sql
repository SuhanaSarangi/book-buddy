
-- Highlight color enum
CREATE TYPE public.highlight_color AS ENUM ('yellow', 'green', 'blue', 'pink');

-- Book highlights table
CREATE TABLE public.book_highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  start_offset integer NOT NULL,
  end_offset integer NOT NULL,
  highlighted_text text NOT NULL,
  color highlight_color NOT NULL DEFAULT 'yellow',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.book_highlights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own highlights" ON public.book_highlights
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Book notes table
CREATE TABLE public.book_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  highlight_id uuid REFERENCES public.book_highlights(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.book_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own notes" ON public.book_notes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_book_highlights_book_chunk ON public.book_highlights(book_id, chunk_index);
CREATE INDEX idx_book_notes_book_chunk ON public.book_notes(book_id, chunk_index);
