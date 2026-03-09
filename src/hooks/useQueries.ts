import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import type { BookShelf } from "@/components/BookItem";

type Subject = { id: string; name: string; created_at: string };

const PAGE_SIZE = 20;

type Book = {
  id: string;
  title: string;
  author: string | null;
  genre: string | null;
  filename: string;
  file_path: string | null;
  total_chunks: number | null;
  created_at: string;
};

type Conversation = { id: string; title: string; updated_at: string };

type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: any[];
};

// ── Books (infinite query with search) ──

export function useBooks(search: string) {
  return useInfiniteQuery({
    queryKey: ["books", search],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("books")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to);

      if (search) {
        query = query.or(`title.ilike.%${search}%,author.ilike.%${search}%`);
      }

      const { data, error } = await query;
      if (error) {
        logger.error("useBooks", "Failed to fetch books", error);
        throw error;
      }
      logger.debug("useBooks", `Fetched page ${pageParam}`, { count: data?.length });
      return { books: (data ?? []) as Book[], page: pageParam };
    },
    getNextPageParam: (lastPage) =>
      lastPage.books.length === PAGE_SIZE ? lastPage.page + 1 : undefined,
    initialPageParam: 0,
    staleTime: 2 * 60 * 1000, // 2 min
    gcTime: 5 * 60 * 1000,    // 5 min garbage collection
  });
}

export function useDeleteBook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookId: string) => {
      const { error } = await supabase.from("books").delete().eq("id", bookId);
      if (error) {
        logger.error("useDeleteBook", "Failed to delete book", error);
        throw error;
      }
      logger.info("useDeleteBook", `Deleted book ${bookId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["books"] });
      queryClient.invalidateQueries({ queryKey: ["shelves"] });
    },
  });
}

// ── Shelves ──

export function useShelves() {
  return useQuery({
    queryKey: ["shelves"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_book_shelves")
        .select("book_id, status, progress_percent, current_page, total_pages, times_read");
      if (error) {
        logger.error("useShelves", "Failed to fetch shelves", error);
        throw error;
      }
      return (data ?? []) as BookShelf[];
    },
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export function useInvalidateShelves() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["shelves"] });
}

// ── Conversations ──

export function useConversations() {
  return useQuery({
    queryKey: ["conversations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) {
        logger.error("useConversations", "Failed to fetch conversations", error);
        throw error;
      }
      return (data ?? []) as Conversation[];
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ title, userId }: { title: string; userId: string }) => {
      const { data, error } = await supabase
        .from("conversations")
        .insert({ title, user_id: userId })
        .select()
        .single();
      if (error) {
        logger.error("useCreateConversation", "Failed to create conversation", error);
        throw error;
      }
      logger.info("useCreateConversation", `Created conversation ${data.id}`);
      return data as Conversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

// ── Messages ──

export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ["messages", conversationId],
    queryFn: async () => {
      if (!conversationId) return [];
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) {
        logger.error("useMessages", "Failed to fetch messages", error);
        throw error;
      }
      return (data ?? []) as Message[];
    },
    enabled: !!conversationId,
    staleTime: 10 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

// ── Subjects ──

export function useSubjects(userId?: string) {
  return useQuery({
    queryKey: ["subjects", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subjects")
        .select("*")
        .order("name", { ascending: true });
      if (error) {
        logger.error("useSubjects", "Failed to fetch subjects", error);
        throw error;
      }
      return (data ?? []) as Subject[];
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export function useCreateSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, userId }: { name: string; userId: string }) => {
      const { data, error } = await supabase
        .from("subjects")
        .insert({ name, user_id: userId })
        .select()
        .single();
      if (error) {
        logger.error("useCreateSubject", "Failed to create subject", error);
        throw error;
      }
      return data as Subject;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
    },
  });
}

export function useDeleteSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (subjectId: string) => {
      const { error } = await supabase.from("subjects").delete().eq("id", subjectId);
      if (error) {
        logger.error("useDeleteSubject", "Failed to delete subject", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
    },
  });
}

export function useRenameSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ subjectId, name }: { subjectId: string; name: string }) => {
      const { error } = await supabase.from("subjects").update({ name }).eq("id", subjectId);
      if (error) {
        logger.error("useRenameSubject", "Failed to rename subject", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
    },
  });
}
