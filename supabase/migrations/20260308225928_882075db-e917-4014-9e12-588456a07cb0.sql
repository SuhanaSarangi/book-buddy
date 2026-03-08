
-- Add genre column to books
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS genre text;

-- Create shelf status enum
CREATE TYPE public.shelf_status AS ENUM ('want_to_read', 'currently_reading', 'completed');

-- Create profiles table
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Create trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create user_book_shelves table
CREATE TABLE public.user_book_shelves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  status shelf_status NOT NULL DEFAULT 'want_to_read',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, book_id)
);
ALTER TABLE public.user_book_shelves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own shelves" ON public.user_book_shelves FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Add user_id to books, conversations, messages for per-user data
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Update RLS policies for books to be per-user
DROP POLICY IF EXISTS "Allow all on books" ON public.books;
CREATE POLICY "Users manage own books" ON public.books FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Update RLS policies for conversations to be per-user
DROP POLICY IF EXISTS "Allow all on conversations" ON public.conversations;
CREATE POLICY "Users manage own conversations" ON public.conversations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Update RLS policies for messages to be per-user
DROP POLICY IF EXISTS "Allow all on messages" ON public.messages;
CREATE POLICY "Users manage own messages" ON public.messages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Keep book_chunks accessible for search (linked through books)
DROP POLICY IF EXISTS "Allow all on book_chunks" ON public.book_chunks;
CREATE POLICY "Users read own book chunks" ON public.book_chunks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.books WHERE books.id = book_chunks.book_id AND books.user_id = auth.uid()));
CREATE POLICY "Service can insert book chunks" ON public.book_chunks FOR INSERT TO authenticated WITH CHECK (true);
