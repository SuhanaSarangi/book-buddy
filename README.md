# 🐇 Rabbit Hole

**My Personal Knowledge Journey**

Rabbit Hole is a personal knowledge management application that lets you upload books, read them in-app, and chat with an AI assistant that draws answers from your private library and the web.

**Live App**: [gorabbithole.lovable.app](https://gorabbithole.lovable.app)

---

## ✨ Features

### 📚 Book Library
- **Upload books** in PDF, TXT, or Markdown format (up to 50 MB)
- Books are chunked and indexed for full-text search
- Filter and search your library by title, author, or genre
- Organize books into **subjects** (custom categories)

### 📖 Book Reader
- **PDF Viewer** — renders the original PDF with zoom and page navigation
- **Text Reader** — displays extracted text chunks with navigation
- **Highlighting** — select text to highlight in yellow, green, blue, or pink
- **Notes** — add notes to any chunk, optionally linked to highlights
- Switch between PDF and text views at any time

### 💬 AI Chat
- Conversational AI assistant powered by Lovable AI
- **Three search modes**:
  - **Books** — answers draw only from your uploaded library
  - **Web** — answers draw from general internet knowledge
  - **Both** — combines book excerpts and web knowledge
- Streaming responses with real-time token display
- Markdown-rendered answers with source citations
- Persistent conversation history

### 📊 Reading Shelf
- Track books as **Want to Read**, **Currently Reading**, or **Completed**
- Log current page, total pages, and reading progress percentage
- Track how many times you've read a book

### 🔐 Authentication
- Email/password sign-up and sign-in
- Protected routes — all features require authentication
- User profiles with display name

### 🌐 Internationalization
- English and Swedish language support
- Language switcher available on all pages

### 🎨 Theming
- Light and dark mode with system preference detection
- Theme toggle accessible from sidebar and auth page

---

## 🏗️ Architecture

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS + shadcn/ui |
| State | TanStack React Query |
| Routing | React Router v6 |
| Backend | Lovable Cloud (Supabase) |
| AI | Lovable AI Gateway |
| i18n | i18next + react-i18next |
| PDF | react-pdf |
| Markdown | react-markdown + remark-gfm |

### Project Structure

```
src/
├── assets/              # Static assets (logo)
├── components/
│   ├── ui/              # shadcn/ui primitives
│   ├── BookItem.tsx      # Book card with shelf management
│   ├── BookReader.tsx    # Text-based book reader with highlights/notes
│   ├── BookSidebar.tsx   # Sidebar: conversations, library, upload, subjects
│   ├── ChatMessage.tsx   # Chat bubble with markdown & sources
│   ├── ErrorBoundary.tsx # React error boundary
│   ├── LanguageSwitcher.tsx
│   ├── PdfViewer.tsx     # PDF renderer with zoom/navigation
│   ├── SkeletonBook.tsx  # Loading skeletons
│   └── ThemeToggle.tsx   # Dark/light mode toggle
├── hooks/
│   ├── useAuth.tsx       # Auth context provider & hook
│   ├── useQueries.ts     # React Query hooks (books, shelves, conversations, subjects)
│   ├── useDebounce.ts    # Debounce hook for search
│   └── use-mobile.tsx    # Mobile breakpoint detection
├── i18n/
│   ├── index.ts          # i18next configuration
│   └── locales/
│       ├── en.json       # English translations
│       └── sv.json       # Swedish translations
├── lib/
│   ├── bookCache.ts      # LRU cache for PDF URLs and book chunks
│   ├── chat.ts           # Chat streaming client (SSE)
│   ├── logger.ts         # Structured logging utility
│   └── utils.ts          # Tailwind merge utility
├── pages/
│   ├── Auth.tsx           # Login / sign-up page
│   ├── Index.tsx          # Main app (chat + reader)
│   └── NotFound.tsx       # 404 page
└── integrations/
    └── supabase/
        ├── client.ts      # Auto-generated Supabase client
        └── types.ts       # Auto-generated database types

supabase/
└── functions/
    ├── chat/              # AI chat with book search + streaming
    ├── manage-books/      # GET (list/search) and DELETE books
    ├── manage-profile/    # GET and PATCH user profiles
    ├── manage-shelves/    # CRUD for reading shelf
    └── upload-book/       # File upload, text extraction, chunking
```

### Core RAG Architecture

**Vector Database Setup (pgvector)**
- PostgreSQL `pgvector` extension enables vector embeddings and cosine similarity search
- `book_chunks.embedding` column stores vector embeddings (generated via `text-embedding-3-small` model)
- `match_book_chunks()` function performs similarity search with configurable threshold and user scoping

**Full-Text Search (TSVector)**
- PostgreSQL's built-in `TSVector` full-text search serves as keyword-based retrieval
- `search_book_chunks()` function ranks results using `ts_rank`
- Acts as complement to vector search and fallback when embeddings are unavailable

**Hybrid Search**
- Chat retrieval combines both vector similarity and full-text search for best results
- Vector search captures semantic meaning; full-text search captures exact keyword matches
- Results are deduplicated by chunk ID before being sent as context to the LLM

**RAG Workflow**

1. **Document Ingestion** (`supabase/functions/upload-book/index.ts`)
   - Extracts text from PDFs using the `unpdf` library
   - Chunks text into smaller pieces (1000 characters with 200-character overlap for context preservation)
   - Stores chunks in the database with metadata (chunk index, book ID, creation timestamp)
   - **Triggers vector embedding generation** asynchronously via `generate-embeddings` edge function

2. **Embedding Generation** (`supabase/functions/generate-embeddings/index.ts`)
   - Processes book chunks in batches of 20
   - Generates vector embeddings using the `text-embedding-3-small` model via Lovable AI Gateway
   - Stores embeddings in the `book_chunks.embedding` column
   - Runs asynchronously after upload — books are searchable via full-text immediately, with semantic search becoming available once embeddings complete

3. **Retrieval** (`supabase/functions/chat/index.ts`)
   - **Vector similarity search**: Embeds the user query, then finds semantically similar chunks via `match_book_chunks()`
   - **Full-text search**: Runs keyword search via `search_book_chunks()` as complement/fallback
   - Deduplicates and merges results from both search methods
   - Filters all results by user ownership for privacy and security

4. **Generation** (with Context)
   - Passes retrieved chunks as system context to the Lovable AI Gateway
   - LLM synthesizes a response combining book knowledge with general knowledge
   - Response is streamed to the client in real-time

5. **Search Modes**
   - **"books"** — Hybrid search (vector + full-text) in the user's personal book library
   - **"internet"** — Uses LLM general knowledge without book context
   - **"both"** — Combines retrieved book excerpts with internet knowledge for comprehensive answers

### Database Schema

| Table | Purpose |
|-------|---------|
| `books` | Book metadata (title, author, genre, file path) |
| `book_chunks` | Extracted text chunks with full-text search index + vector embeddings |
| `book_highlights` | User text highlights with color and position |
| `book_notes` | User notes, optionally linked to highlights |
| `conversations` | Chat conversation metadata |
| `messages` | Chat messages with role, content, and sources |
| `profiles` | User display names |
| `subjects` | User-defined book categories |
| `user_book_shelves` | Reading status, progress, and page tracking |

### Backend Functions

| Function | Description |
|----------|-------------|
| `chat` | Authenticates user, performs hybrid search (vector + full-text), builds context, streams AI response, saves messages |
| `upload-book` | Validates file, extracts text (PDF via unpdf), chunks text, uploads to storage, triggers embedding generation |
| `generate-embeddings` | Generates vector embeddings for book chunks using text-embedding-3-small model |
| `manage-books` | Lists books with pagination/search/filter; deletes books with cascade cleanup |
| `manage-shelves` | CRUD for reading shelf: add/update status, track progress, remove |
| `manage-profile` | Get and update user profile (display name) |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm

### Local Development

```sh
# Clone the repository
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>

# Install dependencies
npm install

# Start development server
npm run dev
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with HMR |
| `npm run build` | Production build |
| `npm run build:dev` | Development build |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |

---

## 📱 User Guide

### Getting Started
1. **Sign up** with your email and password at `/auth`
2. You'll be redirected to the main chat interface

### Uploading Books
1. Open the sidebar and expand the **Upload** section
2. Fill in the title, author (optional), and genre (optional)
3. Select a `.pdf`, `.txt`, or `.md` file
4. Click **Upload** — the book will be processed and added to your library

### Reading Books
1. Find a book in the sidebar library
2. Click the **Read** button on any book
3. Use PDF view for the original layout or switch to text view
4. In text view: select text to highlight, add notes to any section

### Chatting with Your Library
1. Type a question in the chat input
2. Select a search mode:
   - **Books** — searches only your uploaded books
   - **Web** — uses general knowledge
   - **Both** — combines both sources
3. The AI streams its response with source citations

### Managing Your Shelf
1. On any book, click a shelf status button (Want to Read / Reading / Completed)
2. Expand the book to update page progress and times read

---

## 🛠️ Deployment

Open [Lovable](https://lovable.dev/projects/ab4c627d-0856-4279-9d0b-b444caf7dd74) and click **Share → Publish**.

Custom domains can be connected via **Project → Settings → Domains**.
