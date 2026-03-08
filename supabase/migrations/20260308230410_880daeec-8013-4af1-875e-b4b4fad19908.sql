
ALTER TABLE public.user_book_shelves ADD COLUMN IF NOT EXISTS progress_percent integer DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100);
ALTER TABLE public.user_book_shelves ADD COLUMN IF NOT EXISTS current_page integer DEFAULT 0;
ALTER TABLE public.user_book_shelves ADD COLUMN IF NOT EXISTS total_pages integer;
ALTER TABLE public.user_book_shelves ADD COLUMN IF NOT EXISTS times_read integer DEFAULT 0;
ALTER TABLE public.user_book_shelves ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
