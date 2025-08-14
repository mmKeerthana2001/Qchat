# QChat Application Overview

## Introduction
QChat is a web-based chat application that allows users to create chat sessions, upload documents (PDF, DOC, DOCX), extract text from them, and query or chat with the extracted content using a backend powered by FastAPI and a frontend built with React. The backend handles session management, file processing, and query processing, while the frontend provides a user interface for chat management, message input, file uploads, and message display.

The application integrates frontend and backend via API calls (e.g., to `http://localhost:8000`). Key features include:
- Creating new chat sessions with unique IDs.
- Uploading multiple files per session for text extraction.
- Querying the extracted text in a conversational manner.
- Dynamic UI with sidebar for chats, input area for messages/files, message display, header controls, and a right sidebar for uploaded files.
- Dark theme with glass-card effects, auto-resizing textarea, toast notifications, and more.

The app is structured with a backend in Python (FastAPI) and a frontend in TypeScript (React with Shadcn UI components). Below is a detailed overview of the backend and frontend, including file-specific features.

## Backend Overview
The backend is a FastAPI application running on `http://localhost:8000`, with CORS enabled for `http://localhost:8080`. It uses libraries like UUID for session IDs, logging, and custom modules for file reading and context management. The main entry point is `main.py`, which defines three endpoints:
- `/create-session/`: Creates a new session ID.
- `/extract-text/{session_id}`: Extracts text from uploaded files and stores in the session.
- `/chat/{session_id}`: Processes user queries against the session's data.

### Backend Files and Features
- **main.py** (Main FastAPI App):
  - Defines the FastAPI app with CORS middleware and debug logging.
  - Endpoints:
    - `POST /create-session/`: Generates a UUID session ID and calls `context_manager.create_session`. Returns `{"session_id": <uuid>}`.
    - `POST /extract-text/{session_id}`: Accepts multiple files (PDF, DOC, DOCX), validates UUID, reads files in memory, extracts text using `read_files.py`, stores in session via `context_manager.py`. Returns session ID and extracted text mapping.
    - `POST /chat/{session_id}`: Accepts a query, validates UUID, processes the query using `context_manager.py` (likely involving LLM), returns response and history.
  - Uses `ReadFiles` for file reading and `ContextManager` for session/data management.
  - Features: In-memory file processing, UUID validation, logging of processing times, error handling (HTTPExceptions).

- **context_manager.py** (Session and Context Management):
  - Manages sessions using MongoDB/Qdrant for storage.
  - Features:
    - Create sessions (`create_session`).
    - Store extracted text in sessions (`store_session_data`).
    - Process queries against stored data (`process_query`), likely using an LLM or agent for responses and history.
  - Integrates with `agent.py` for query processing.

- **read_files.py** (File Reading and Text Extraction):
  - Defines `ReadFiles` class to extract text from PDF/DOC/DOCX files.
  - Features: Asynchronous file reading, support for multiple files, in-memory processing using libraries like PyPDF2 or docx for extraction.
  - Returns a dictionary of filename to extracted text.

- **agent.py** (LLM/Agent Logic):
  - Likely handles the core query processing using an LLM (e.g., Grok or OpenAI) to respond to user queries based on extracted text and conversation history.
  - Features: Natural language processing, context-aware responses, history management.
  - Integrated into `context_manager.py` for `process_query`.

Backend supports up to 500 files per upload (as per your description), with validation for allowed extensions and empty files.

## Frontend Overview
The frontend is a React application with Shadcn UI components, running on `http://localhost:8080`. It uses React Query for state management, React Router for routing, and Sonner for toasts. The entry point is `App.tsx` with `Index.tsx` rendering `ChatLayout.tsx`. Features include dynamic chat creation, file uploads, message sending, and display.

### Frontend Files and Features
- **ChatLayout.tsx** (Main Layout Component):
  - Manages overall layout with left sidebar (chats), header, messages area, right sidebar (uploaded files), and input area.
  - Features: State for sessions, messages, uploaded files, thinkDeepMode, file sidebar toggle. Passes props like sessionId, addMessage, updateSessionTitle, addUploadedFile to child components. Uses `hasSetTitle` to ensure title is set only once.
  - Renders `ChatSidebar`, `ChatHeader`, `ChatMessages`, `ChatInput`.

- **ChatSidebar.tsx** (Left Sidebar for Chats):
  - Displays list of chats with title and timestamp (single title per chat, no preview).
  - Features: "New Chat" button calls `/create-session/` to create sessions, search input, dropdown menu for rename/archive/export/delete (placeholders). Selected chat highlighted with `bg-primary` and bold white text for title/timestamp.
  - Props: sessions, setSessions, selectedSession, setSelectedSession.

- **ChatHeader.tsx** (Header Component):
  - Features: Toggle for left sidebar, Think Deep mode button (toggles thinkDeepMode), file sidebar toggle (FileText icon), theme switch (Sun/Moon), user avatar dropdown (profile/settings/sign out).
  - Removed "Professional Mode" badge; kept "Think Deep" button.
  - Props: onToggleSidebar, sidebarOpen, thinkDeepMode, onToggleThinkDeep, onToggleFileSidebar, fileSidebarOpen.

- **ChatMessages.tsx** (Messages Display Component):
  - Displays conversation messages with user/assistant avatars, timestamps, action buttons (copy, refresh, edit, share, thumbs up/down).
  - Features: ScrollArea for messages, welcome message if no messages, no system messages for file uploads.
  - Props: thinkDeepMode, messages.

- **ChatInput.tsx** (Input Area Component):
  - Handles message input and file uploads.
  - Features: Textarea with auto-resize and Shift+Enter for new line, attachment dropdown (image/document/code), file count display ("N file(s) selected") with remove button, Send button. Processes uploads to `/extract-text/{sessionId}` and queries to `/chat/{sessionId}`. Updates title/preview, adds files to right sidebar. Toasts with 10-second duration.
  - Multiple file support: `multiple` on file input, `FormData` appends all files.
  - Generalized title set once on first submission.
  - Props: sessionId, addMessage, updateSessionPreview, updateSessionTitle, addUploadedFile, thinkDeepMode, isFirstMessage.

- **Index.tsx** (Page Entry):
  - Renders `ChatLayout`.

- **App.tsx** (App Entry):
  - Wraps with QueryClientProvider, ThemeProvider, TooltipProvider, Toaster, Sonner, BrowserRouter. Routes to Index or NotFound.

## Key Features and File References
- **Chat Session Creation**: Click "New Chat" in `ChatSidebar.tsx` calls `/create-session/` in `main.py`. Session stored in `context_manager.py`.
- **File Uploads**: In `ChatInput.tsx`, select files via dropdown (accepts multiple), displays count, submits to `/extract-text/{sessionId}` in `main.py`. Text extracted in `read_files.py`, stored in `context_manager.py`. Files listed in right sidebar (`ChatLayout.tsx`).
- **Chatting**: Send message in `ChatInput.tsx` calls `/chat/{sessionId}` in `main.py`, processed in `context_manager.py` (likely with `agent.py` for LLM). Messages displayed in `ChatMessages.tsx`.
- **Title Setting**: Generalized title from first query/file in `ChatInput.tsx`, set once via `isFirstMessage` from `ChatLayout.tsx`. Displayed in `ChatSidebar.tsx`.
- **UI Toggles**: Sidebar/file sidebar/theme in `ChatHeader.tsx`.
- **Notifications**: 10-second toasts in `ChatInput.tsx` for file selection/upload.
- **Search**: Chat title search in `ChatSidebar.tsx`.
- **Styling**: Dark theme, glass-card effects, bold white text for selected chats in `ChatSidebar.tsx`.
<img width="895" height="3436" alt="image" src="https://github.com/user-attachments/assets/47968e4b-44b3-4555-8013-24b8b1636201" />
