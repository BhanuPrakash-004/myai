# AI Personal Knowledge Base — Build TODO

> **Read `info.txt` first for the full specification.** This file breaks the project into sequential, actionable tasks. Complete them **in order**. Do not skip ahead to later phases.

---

## Project Summary

Build a web app where users chat naturally with an AI. The AI automatically captures, categorizes, stores, updates, and retrieves personal developer knowledge (syntax, APIs, DSA patterns, LeetCode approaches, common mistakes, etc.) as Markdown files. The user never manually organizes notes.

## Tech Stack

| Layer          | Technology                                    |
| -------------- | --------------------------------------------- |
| Framework      | Next.js (App Router) + TypeScript             |
| Styling        | Tailwind CSS + shadcn/ui                      |
| Database       | SQLite (via better-sqlite3 or Drizzle ORM)    |
| Knowledge      | Markdown files on disk (`vault/` directory)   |
| AI             | Ollama (local LLM, pluggable provider layer)  |
| Search (V1)    | SQLite FTS5                                   |
| Search (Later) | Embeddings + Qdrant                           |
| Auth (Later)   | Better Auth or equivalent                     |
| Deployment     | Docker + persistent volumes                   |

---

## Core Principles (Follow These Always)

1. AI-first — the chat is the primary interface, not a note editor.
2. Zero-friction capture — user just talks, AI handles everything.
3. Never save every conversation — only store actual knowledge.
4. Prefer UPDATE/MERGE over creating duplicates.
5. Markdown is the source of truth for knowledge.
6. SQLite stores metadata only (IDs, paths, categories, timestamps, stats).
7. Knowledge must be exportable and Obsidian-compatible.
8. Build and test each phase before moving to the next.

---

# PHASE 1 — Foundation

**Goal:** User can open the app, see a chat UI, and talk to a local AI via Ollama.

### Task 1.1 — Initialize Next.js Project
- [x] Run `npx create-next-app@latest` with TypeScript, Tailwind CSS, App Router, and `src/` directory enabled.
- [x] Verify the dev server starts with `npm run dev`.

### Task 1.2 — Install and Configure shadcn/ui
- [x] Run `npx shadcn@latest init` and configure it.
- [x] Install these shadcn components: `button`, `input`, `card`, `scroll-area`, `separator`, `badge`, `dialog`, `dropdown-menu`, `sheet`, `tabs`, `textarea`, `tooltip`, `avatar`.
- [x] Verify a shadcn Button renders correctly.

### Task 1.3 — Create Application Layout
- [x] Create a root layout in `src/app/layout.tsx` with:
  - Sidebar navigation (collapsible) with links: Chat, Knowledge, Search, Review, Quiz, Dashboard, Settings.
  - A main content area.
  - A header bar with the app name.
- [x] Make the layout responsive (sidebar collapses on mobile).
- [x] Use shadcn `Sheet` for mobile sidebar.

### Task 1.4 — Create the Chat Page (`/chat`)
- [x] Create `src/app/chat/page.tsx`.
- [x] Build a chat interface with:
  - A scrollable message list (user messages on right, AI messages on left).
  - A text input area at the bottom with a send button.
  - Message bubbles with timestamps.
  - Auto-scroll to latest message.
  - Loading indicator while AI is responding.
- [x] Messages should be stored in React state for now (no persistence yet).

### Task 1.5 — Set Up SQLite Database
- [x] Install `better-sqlite3` (or Drizzle ORM with better-sqlite3 driver).
- [x] Create `src/lib/db.ts` — initializes the SQLite database file at a configurable path (default: `./data/myai.db`).
- [x] Create initial schema with these tables:
  - `memories` — id, title, file_path, topic, subcategory, knowledge_type, importance (1-5), content_preview, created_at, updated_at.
  - `memory_interactions` — id, memory_id, interaction_type (viewed/queried/updated/quizzed/forgotten), created_at.
  - `chat_sessions` — id, title, created_at, updated_at.
  - `chat_messages` — id, session_id, role (user/assistant/system), content, created_at.
- [x] Run migrations automatically on app startup.

### Task 1.6 — Create the Markdown Vault System
- [x] Create `src/lib/vault.ts` with functions:
  - `getVaultPath()` — returns configurable vault directory (default: `./vault`).
  - `ensureDirectory(dirPath)` — creates directories recursively if they don't exist.
  - `writeKnowledge(filePath, content)` — writes a Markdown file inside the vault.
  - `readKnowledge(filePath)` — reads a Markdown file from the vault.
  - `listKnowledge(dirPath?)` — lists all `.md` files, optionally under a subdirectory.
  - `deleteKnowledge(filePath)` — deletes a Markdown file.
  - `knowledgeExists(filePath)` — checks if a file exists.
- [x] Create the `vault/` directory on startup if it doesn't exist.

### Task 1.7 — Create Environment / Configuration System
- [x] Create `src/lib/config.ts`.
- [x] Support configuration via `.env.local` with these variables:
  - `VAULT_PATH` — path to the Markdown vault (default: `./vault`).
  - `DATABASE_PATH` — path to SQLite DB (default: `./data/myai.db`).
  - `OLLAMA_BASE_URL` — Ollama API URL (default: `http://localhost:11434`).
  - `OLLAMA_MODEL` — model name (default: `llama3.1` or similar).
  - `APP_NAME` — application name (default: `MyAI`).
- [x] Create a `.env.example` file documenting all variables.

### Task 1.8 — Integrate Ollama AI
- [x] Create `src/lib/ai/provider.ts` — define an abstract AI provider interface:
  ```typescript
  interface AIProvider {
    chat(messages: ChatMessage[], options?: AIOptions): Promise<string>;
    chatStream(messages: ChatMessage[], options?: AIOptions): AsyncGenerator<string>;
    chatStructured<T>(messages: ChatMessage[], schema: object): Promise<T>;
  }
  ```
- [x] Create `src/lib/ai/ollama.ts` — implement the Ollama provider using the Ollama REST API (`/api/chat`).
  - Support streaming responses.
  - Support structured JSON output (using Ollama's `format: "json"` option).
  - Handle connection errors gracefully.
- [x] Create `src/lib/ai/index.ts` — factory that returns the configured provider.

### Task 1.9 — Create Chat API Route
- [x] Create `src/app/api/chat/route.ts` (POST).
- [x] Accept `{ messages: ChatMessage[], sessionId?: string }`.
- [x] Forward messages to Ollama via the AI provider.
- [x] Return a streaming response to the frontend.
- [x] Persist messages in the `chat_messages` table.
- [x] Create a new `chat_session` if `sessionId` is not provided.

### Task 1.10 — Connect Chat Frontend to Backend
- [x] Wire the chat page to call `POST /api/chat`.
- [x] Display streamed AI responses in real-time.
- [x] Handle errors (Ollama not running, model not available) with user-friendly messages.
- [x] Add a "New Chat" button that starts a fresh session.

### Task 1.11 — Add Docker Setup
- [x] Create a `Dockerfile` for the Next.js app (multi-stage build).
- [x] Create a `docker-compose.yml` with:
  - The Next.js app service.
  - Volume mounts for `vault/` and `data/` directories.
  - Network configuration to reach host Ollama (or bundled Ollama service).
- [x] Create a `.dockerignore` file.
- [x] Verify the app builds and runs inside Docker.

### Phase 1 Deliverable
> User can open the app, see a chat interface, send messages, and receive AI responses from a local Ollama model. Messages persist across page reloads. Docker is ready.

---

# PHASE 2 — Memory Engine

**Goal:** When a user sends a message, the AI automatically detects knowledge, categorizes it, and saves it as a Markdown file. Duplicates are avoided.

### Task 2.1 — Define Memory Schema and Knowledge Types
- [x] Create `src/lib/memory/types.ts` with TypeScript types:
  ```typescript
  type KnowledgeType = 'concept' | 'syntax' | 'api_function' | 'logic' | 'common_mistake' | 'code_snippet' | 'dsa_pattern' | 'leetcode_approach' | 'interview' | 'general';
  type MemoryAction = 'IGNORE' | 'CREATE' | 'UPDATE' | 'MERGE' | 'DELETE' | 'QUERY' | 'EXPLAIN' | 'QUIZ' | 'REVIEW';

  interface MemoryDecision {
    action: MemoryAction;
    topic: string;
    subcategory: string;
    knowledgeType: KnowledgeType;
    importance: 1 | 2 | 3 | 4 | 5;
    content: string;
    relatedFile?: string;
    reasoning: string;
  }
  ```

### Task 2.2 — Implement MemoryDetector
- [x] Create `src/lib/memory/detector.ts`.
- [x] Given a user message + conversation context, call the AI with a structured output prompt that returns a `MemoryDecision` JSON.
- [x] The prompt should instruct the AI to:
  - Determine if the message contains knowledge worth saving.
  - Classify the topic, subcategory, knowledge type, and importance.
  - Decide the action: IGNORE, CREATE, UPDATE, MERGE, QUERY, EXPLAIN, QUIZ, or REVIEW.
- [x] Parse and validate the structured JSON response.

### Task 2.3 — Implement MemoryClassifier
- [x] Create `src/lib/memory/classifier.ts`.
- [x] Given a `MemoryDecision`, determine the file path inside the vault.
  - Example: topic=`DSA`, subcategory=`Graph/BFS` -> `vault/DSA/Graph/BFS.md`.
  - Example: topic=`Java`, subcategory=`Collections/Map` -> `vault/Java/Collections/Map.md`.
- [x] Sanitize file/folder names (remove special characters, handle spaces).
- [x] Handle edge cases (empty subcategory, deeply nested paths).

### Task 2.4 — Implement MemoryRetriever
- [x] Create `src/lib/memory/retriever.ts`.
- [x] Search existing knowledge:
  - Check if a Markdown file already exists at the classified path.
  - Query the `memories` SQLite table for related entries (by topic, subcategory, or keyword).
- [x] Return existing content and metadata if found.

### Task 2.5 — Implement MemoryCreator
- [x] Create `src/lib/memory/creator.ts`.
- [x] When action is `CREATE`:
  - Generate well-structured Markdown content using the AI (following the format in `info.txt` section 10).
  - Write the Markdown file to the vault using `vault.writeKnowledge()`.
  - Insert a record into the `memories` table.
- [x] The Markdown should include sections like: Core Concept, Important Details, Common Mistakes, Code Examples, Personal Memory, Related Topics.

### Task 2.6 — Implement MemoryUpdater
- [x] Create `src/lib/memory/updater.ts`.
- [x] When action is `UPDATE`:
  - Read the existing Markdown file.
  - Send the existing content + new information to the AI.
  - AI generates updated Markdown that integrates the new info without losing existing content.
  - Write the updated file.
  - Update the `memories` table (updated_at timestamp).
- [x] Never blindly overwrite — always merge new info into existing content.

### Task 2.7 — Implement MemoryMerger
- [x] Create `src/lib/memory/merger.ts`.
- [x] When action is `MERGE`:
  - Find related existing knowledge files.
  - Combine content from multiple sources into one comprehensive file.
  - Update/delete old files as needed.
  - Update SQLite records.

### Task 2.8 — Implement Duplicate Detection
- [x] In the MemoryRetriever, add logic to detect if the incoming knowledge already exists.
- [x] Check by:
  - Exact file path match.
  - Similar topic + subcategory in SQLite.
  - Keyword overlap in content.
- [x] If a duplicate is found, route to UPDATE instead of CREATE.

### Task 2.9 — Implement MemoryImportanceScorer
- [x] Create `src/lib/memory/scorer.ts`.
- [x] Score each piece of knowledge 1-5 based on:
  - How frequently the user mentions similar topics.
  - Whether it is a common mistake (higher importance).
  - Whether it is syntax vs. concept (different baseline scores).
  - Explicit user signals ("this is really important").

### Task 2.10 — Create the Memory Engine Orchestrator
- [x] Create `src/lib/memory/engine.ts`.
- [x] Orchestrate the full flow:
  ```
  User Message -> MemoryDetector -> MemoryClassifier -> MemoryRetriever
  -> (Duplicate check) -> MemoryCreator / MemoryUpdater / MemoryMerger
  -> Write Markdown -> Update SQLite -> Return result
  ```
- [x] Return a `MemoryResult` that the chat can display to the user.

### Task 2.11 — Integrate Memory Engine into Chat
- [x] Modify `src/app/api/chat/route.ts`:
  - After receiving a user message, run it through the Memory Engine.
  - If knowledge was saved/updated, include that info in the AI's response context.
  - The AI response should acknowledge what was saved (e.g., "I saved this to DSA -> Graph -> BFS").
- [x] The AI should still respond conversationally — the memory operation happens in parallel/background.

### Task 2.12 — Add "Saved to Knowledge Base" UI Indicator
- [x] In the chat interface, when a message triggers a memory save:
  - Show a small notification/badge below the AI response.
  - Example: "Saved to DSA / Graph / BFS.md" (clickable link).
  - Show whether it was Created, Updated, or Merged.

### Phase 2 Deliverable
> User sends a message like "I always forget BFS needs q.size before the loop." The AI automatically detects this is knowledge, classifies it under DSA/Graph/BFS, creates or updates the Markdown file, stores metadata in SQLite, and confirms what was saved.

---

# PHASE 3 — Knowledge Browser

**Goal:** User can browse all their saved knowledge in a tree view, read rendered Markdown, and edit/delete entries.

### Task 3.1 — Build Knowledge Tree API
- [x] Create `src/app/api/knowledge/route.ts` (GET).
- [x] Scan the vault directory recursively.
- [x] Return a tree structure with name, type, children, and metadata from SQLite.

### Task 3.2 — Build Knowledge Detail API
- [x] Create `src/app/api/knowledge/[...path]/route.ts` (GET, PUT, DELETE).
- [x] GET: Read and return the Markdown content + SQLite metadata.
- [x] PUT: Update the Markdown content and metadata.
- [x] DELETE: Delete the file and SQLite record (with confirmation).

### Task 3.3 — Create the Knowledge Browser Page (`/knowledge`)
- [x] Create `src/app/knowledge/page.tsx`.
- [x] Left panel: interactive tree navigator (expandable folders, clickable files).
- [x] Right panel: rendered Markdown content of the selected file.
- [x] Style the tree with icons (folder/file), indentation, and expand/collapse.

### Task 3.4 — Render Markdown with Code Highlighting
- [x] Install `react-markdown`, `remark-gfm`, `rehype-highlight` (or `shiki`).
- [x] Render Markdown files with proper heading styles, code blocks with syntax highlighting, tables, lists, links, and GFM support.

### Task 3.5 — Show Knowledge Metadata
- [x] Below or beside the rendered Markdown, show:
  - Topic and subcategory (as breadcrumbs).
  - Knowledge type (badge).
  - Importance (stars or number).
  - Created date and last updated date.
  - Number of times accessed/queried.

### Task 3.6 — Add Edit Functionality
- [x] Add an "Edit" button on the knowledge detail view.
- [x] Switch to a Markdown text editor (a simple `textarea` with monospace font is fine for V1).
- [x] Save button sends PUT to the API. Show a "Saved" confirmation.

### Task 3.7 — Add Delete Functionality
- [x] Add a "Delete" button with a confirmation dialog.
- [x] Call DELETE on the API. Remove from tree. Show confirmation toast.

### Task 3.8 — Add Move / Recategorize
- [x] Add a "Move" option that lets the user change the topic/subcategory.
- [x] This renames/moves the Markdown file in the vault and updates SQLite.

### Task 3.9 — Add Recent Knowledge View
- [x] On the `/knowledge` page, add a "Recent" tab/section.
- [x] Query SQLite for the 20 most recently created or updated memories.

### Task 3.10 — Add Important Knowledge View
- [x] Add an "Important" tab/section.
- [x] Query SQLite for memories with importance >= 4.
- [x] Display sorted by importance (descending), then by last updated.

### Phase 3 Deliverable
> User can browse their entire knowledge base in a tree view, read beautifully rendered Markdown with syntax-highlighted code, edit entries, delete entries, and view recent/important knowledge.

---

# PHASE 4 — Search + AI Retrieval

**Goal:** User can search their knowledge base using natural language. AI answers questions using retrieved knowledge.

### Task 4.1 — Implement SQLite FTS5
- [x] Create an FTS5 virtual table in SQLite for full-text search.
- [x] Populate the FTS table whenever a memory is created/updated/deleted.
- [x] Create a search function that queries FTS5 and returns ranked results.

### Task 4.2 — Build Search API
- [x] Create `src/app/api/search/route.ts` (GET).
- [x] Accept a `q` query parameter.
- [x] Search using FTS5 + Markdown file content fallback.
- [x] Return results with: title, path, snippet, relevance score.

### Task 4.3 — Create the Search Page (`/search`)
- [x] Create `src/app/search/page.tsx`.
- [x] Search bar, result cards with topic breadcrumb and snippet, click to navigate.

### Task 4.4 — Build AI Search Tool
- [x] Create `src/lib/ai/tools/search.ts`.
- [x] Define a `search_knowledge` tool/function that the AI can call to search and synthesize.

### Task 4.5 — Implement AI Knowledge Retrieval in Chat
- [x] When message is QUERY/EXPLAIN: search knowledge, include in AI context, respond using user's own knowledge.
- [x] AI should clearly indicate it is answering from the user's saved knowledge.

### Task 4.6 — Add Source References
- [x] When the AI uses knowledge to answer, include clickable references in the response.

### Task 4.7 — (Later) Add Semantic Embeddings
- [x] Future enhancement — skip for MVP. When ready: embeddings + Qdrant.

### Phase 4 Deliverable
> User can search "What do I know about BFS?" and get results. In chat, the AI retrieves knowledge to answer questions, citing source files.

---

# PHASE 5 — Personalized Memory

**Goal:** System tracks what the user frequently forgets and surfaces insights.

### Task 5.1 — Track Memory Interactions
- [x] Log every knowledge access in `memory_interactions` table.

### Task 5.2 — Track Repeated Questions
- [x] Detect repeated queries on same topic. Increment query_count.

### Task 5.3 — Detect Frequently Forgotten Knowledge
- [x] Create `src/lib/memory/tracker.ts`. Calculate forgetting score based on query frequency, quiz failures, and time patterns.

### Task 5.4 — Calculate Weakness Signals
- [x] Aggregate forgetting scores by topic. Identify weak areas.

### Task 5.5 — Build Frequently Forgotten API
- [x] `src/app/api/insights/forgotten/route.ts`. Return top N forgotten items.

### Task 5.6 — Build Weak Areas API
- [x] `src/app/api/insights/weak-areas/route.ts`. Return topics ranked by weakness.

### Task 5.7 — Build Dashboard Page (`/dashboard`)
- [x] Total knowledge, recent, important, frequently forgotten, weak areas, recent reviews.

### Task 5.8 — Build Personalized Recommendations
- [x] Suggest what to review based on interaction patterns.

### Phase 5 Deliverable
> System knows what user frequently forgets. Dashboard shows insights, weak areas, and recommendations.

---

# PHASE 6 — Study / Review Mode

**Goal:** User can start personalized review sessions.

### Task 6.1 — Build Review Engine (`src/lib/review/engine.ts`)
### Task 6.2 — Build Quick Review (5-10 high-importance/forgotten items)
### Task 6.3 — Build Topic Review (all knowledge under a topic)
### Task 6.4 — Build Interview Review (DSA, Java, common mistakes, LeetCode)
### Task 6.5 — Build Weak Area Review (focus on struggle areas)
### Task 6.6 — Create the Review Page (`/review`) with mode selector and card-based interface
### Task 6.7 — Add Review History tracking
### Task 6.8 — (Later) Spaced Repetition

### Phase 6 Deliverable
> User starts review sessions. Reviews prioritize weak areas and frequently forgotten items.

---

# PHASE 7 — Quiz System

**Goal:** AI generates quizzes from user's knowledge. Results update weakness tracking.

### Task 7.1 — Build Quiz Generation Engine (`src/lib/quiz/generator.ts`)
### Task 7.2 — Create Quiz API (`src/app/api/quiz/route.ts`)
### Task 7.3 — Create the Quiz Page (`/quiz`) with setup and quiz interface
### Task 7.4 — Implement Answer Evaluation (AI judges correctness, explains)
### Task 7.5 — Show Quiz Results (score, breakdown, struggle topics)
### Task 7.6 — Update Weakness Metadata from Quiz results
### Task 7.7 — Generate Follow-Up Questions for wrong answers

### Phase 7 Deliverable
> User takes quizzes from their own knowledge. Results tracked, weakness data updated, AI explains mistakes.

---

# PHASE 8 — LeetCode Knowledge

**Goal:** Dedicated LeetCode problem knowledge system.

### Task 8.1 — Create LeetCode Markdown template
### Task 8.2 — Store LeetCode problem metadata in SQLite
### Task 8.3 — Capture LeetCode knowledge via chat
### Task 8.4 — Search LeetCode by pattern
### Task 8.5 — LeetCode-specific review and quiz

### Phase 8 Deliverable
> Dedicated LeetCode section with structured problems, pattern search, and LeetCode quizzes.

---

# PHASE 9 — Import / Export / Obsidian

**Goal:** Import existing Markdown, export vault, Obsidian compatibility.

### Task 9.1 — Import Markdown files (upload .md or ZIP)
### Task 9.2 — Import Obsidian vault (scan, classify, build metadata)
### Task 9.3 — Export complete vault as ZIP
### Task 9.4 — Ensure Obsidian compatibility (standard Markdown)
### Task 9.5 — Create Import/Export UI in /settings

### Phase 9 Deliverable
> User imports existing notes and exports their knowledge base. Files work in Obsidian.

---

# PHASE 10 — Authentication + Production

**Goal:** Multi-user, security, production deployment.

### Task 10.1 — Add authentication (Better Auth or NextAuth.js)
### Task 10.2 — User-specific vaults (vault/{userId}/)
### Task 10.3 — Secure all API routes
### Task 10.4 — Create Settings Page (`/settings`)
### Task 10.5 — Production Docker configuration
### Task 10.6 — Logging and error handling
### Task 10.7 — Performance and security (rate limiting, input sanitization)
### Task 10.8 — Deployment documentation and testing

### Phase 10 Deliverable
> Production-ready multi-user app with auth, security, Docker deployment, and persistent storage.

---

# MVP Stopping Point

The **minimum viable product** is complete after **Phases 1-4**:

```
Phase 1: Chat with AI works
Phase 2: AI auto-saves knowledge to Markdown
Phase 3: User can browse/edit knowledge
Phase 4: User can search and query their knowledge
```

Everything after Phase 4 is enhancement. **Get Phases 1-4 working perfectly before moving on.**

---

# File Structure Reference

```
myai/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with sidebar
│   │   ├── page.tsx                # Redirect to /chat
│   │   ├── chat/page.tsx           # Chat interface
│   │   ├── knowledge/page.tsx      # Knowledge browser
│   │   ├── search/page.tsx         # Search page
│   │   ├── review/page.tsx         # Review mode
│   │   ├── quiz/page.tsx           # Quiz system
│   │   ├── dashboard/page.tsx      # Dashboard / overview
│   │   ├── settings/page.tsx       # Settings
│   │   └── api/
│   │       ├── chat/route.ts
│   │       ├── knowledge/route.ts
│   │       ├── knowledge/[...path]/route.ts
│   │       ├── search/route.ts
│   │       ├── quiz/route.ts
│   │       ├── insights/forgotten/route.ts
│   │       ├── insights/weak-areas/route.ts
│   │       ├── import/route.ts
│   │       └── export/route.ts
│   ├── lib/
│   │   ├── db.ts                   # SQLite setup
│   │   ├── vault.ts                # Markdown vault operations
│   │   ├── config.ts               # Environment config
│   │   ├── ai/
│   │   │   ├── provider.ts         # AI provider interface
│   │   │   ├── ollama.ts           # Ollama implementation
│   │   │   ├── index.ts            # Provider factory
│   │   │   └── tools/              # AI function tools
│   │   ├── memory/
│   │   │   ├── types.ts            # Memory types
│   │   │   ├── engine.ts           # Orchestrator
│   │   │   ├── detector.ts         # Detect knowledge
│   │   │   ├── classifier.ts       # Classify topic/path
│   │   │   ├── retriever.ts        # Find existing knowledge
│   │   │   ├── creator.ts          # Create new knowledge
│   │   │   ├── updater.ts          # Update existing
│   │   │   ├── merger.ts           # Merge related
│   │   │   ├── scorer.ts           # Importance scoring
│   │   │   └── tracker.ts          # Interaction tracking
│   │   ├── review/
│   │   │   └── engine.ts           # Review session logic
│   │   └── quiz/
│   │       └── generator.ts        # Quiz generation
│   └── components/
│       ├── ui/                     # shadcn components
│       ├── layout/                 # Sidebar, Header
│       ├── chat/                   # Chat UI components
│       ├── knowledge/              # Tree, Markdown renderer
│       └── quiz/                   # Quiz UI components
├── vault/                          # Markdown knowledge files
├── data/                           # SQLite database
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .env.local
├── info.txt                        # Full project specification
├── TODO.md                         # This file
└── package.json
```

---

# Rules for the AI Agent Building This

1. **Read `info.txt` fully** before starting any work.
2. **Work phase by phase.** Do not jump ahead.
3. **Each task is atomic.** Complete it, test it, then move on.
4. **Do not rebuild existing functionality.** Check what exists first.
5. **Prefer mature libraries** (shadcn, react-markdown, better-sqlite3).
6. **Keep it simple.** No unnecessary abstractions or premature optimization.
7. **Test after each task.** Run `npm run build` and `npm run dev` to verify.
8. **Handle errors gracefully.** Never crash on bad input or missing Ollama.
9. **The chat experience is the product.** Everything else supports it.
10. **Markdown files must be human-readable** and Obsidian-compatible.
