# Walkthrough: Current Session Work & Learnings

This document summarizes the specific tasks executed, progress made, and technical insights gained during this chat session.

---

## 🛠️ Work Completed in This Session

### 1. Local Server Environment Setup
- **Backend Server**: Started the Express.js backend by executing `node server.js` in the project root directory. It runs successfully in the background.
- **Frontend Server**:
  - Initially diagnosed an error when trying to run `npm run dev` from the root directory due to a missing script.
  - Located the Next.js project inside the `/frontend` subdirectory and executed `npm run dev` there.
  - Identified that port `3000` was already occupied by an active `next dev` instance (PID `11800`) running in the environment, confirming the frontend was already active and accessible on port `3000`.

### 2. Database Migrations Execution
- Executed the `run_missing_migrations.js` script to bring the Supabase database schema up to date.
- **Migration Results (019 - 022)**:
  - `019_roadmap_plans.sql`: Skipped because the policy `"Users can only access their own company's roadmap"` already exists.
  - `020_question_choices.sql`: Successfully executed.
  - `021_decision_roadmap_columns.sql`: Successfully executed.
  - `022_agent_name_chat_history.sql`: Successfully executed.
- **Migration Results (023 - 027)**:
  - `023_v3_future_proof_schema.sql`: Successfully executed after modifying the script to drop policies if they exist.
  - `024_action_items_decision_id.sql`: Successfully executed.
  - `025_agent_examples.sql`: Successfully executed after modifying the script to drop policies if they exist.
  - `026_agent_action_approvals.sql`: Successfully executed after modifying the script to drop policies if they exist.
  - `027_roadmap_type.sql`: Successfully executed.

### 3. RAG (Retrieval-Augmented Generation) Optimizations
- **Context Retrieval Tuning**: Addressed "fish memory" issues where the AI forgot chat context or failed to pull relevant document information. Reduced the `match_threshold` to `0.15` in both `src/services/retrievalService.js` and `src/api/brainRoutes.js`. This tuning was critical because we utilize a local `Xenova/all-MiniLM-L6-v2` embedding model, requiring customized similarity thresholds to successfully surface relevant vectors from Supabase `pgvector`.
- **System Prompts Engineering**: Upgraded the system prompts in `src/services/orchestrator.js` and `src/api/brainRoutes.js`. The AI is now explicitly instructed to prioritize conversational history for follow-ups and meta-questions, improving conversational continuity and preventing the AI from losing track of the user's intent.

### 4. Authentication & User Provisioning
- **Auto-Provisioning**: Implemented an automated provisioning flow for the `users` table within `src/middleware/authMiddleware.js`. This guarantees that users are correctly registered in our PostgreSQL database upon their first interaction.
- **Department Metadata Integration**: Ensured that the newly provisioned users accurately receive their department metadata, which is crucial for our role-based access control (RBAC).

### 5. Security & Sentinel Middleware (RBAC)
- **Sentinel Refactoring**: Modified `src/middleware/sentinel.js`, which acts as the project's security gatekeeper enforcing department-based isolation. 
- **Tooling Bypass**: Created a specific bypass for cross-department isolation intended for native document-drafting tools, enabling the AI to proactively draft and create documents without hitting strict organizational barriers inappropriately.

### 6. Frontend Enhancements & Bug Fixes
- **Decision Log Navigation**: Fixed an issue where the action widget didn't show the action list in the decision log. Updated `frontend/src/app/dashboard/page.tsx` with the correct widget URLs, and integrated `useSearchParams` into `frontend/src/app/dashboard/decisions/page.tsx` to handle parameter-based tab switching effectively.

### 7. Infrastructure & Validation
- **Automated Testing**: Verified the stability of the new features using `test_taxonomy_flow.js` and `test_proactivity_flow.js` to ensure the taxonomy and proactivity notifications are triggering properly.

---

## 🧠 Key Technical Insights & Learnings

1. **Project Directory Layout**:
   - The codebase is structured with the Express backend located in the root directory (managed via `server.js`) and the Next.js frontend located in the `/frontend` subfolder.
2. **Server Execution Constraints**:
   - Starting the frontend dev server requires target commands to be executed directly within the `/frontend` workspace directory.
   - If port conflicts occur on port `3000`, check for pre-existing detached Next.js instances (e.g., PID `11800`).
3. **Database Migration Strategy**:
   - The migration script (`run_missing_migrations.js`) executes raw SQL migration files against Supabase sequentially.
   - Migration scripts do not gracefully overwrite existing RLS policies; they will log policy-already-exists errors and proceed to the next migrations.
4. **Vector Database Constraints**: 
   - Using `pgvector` inside **Supabase** in tandem with local transformer models (like `all-MiniLM-L6-v2`) requires careful manual tuning of vector distance thresholds. Default thresholds are often too strict, resulting in the AI claiming it "cannot find any relevant info" even when the data exists. 
5. **Security & State Management**:
   - **Sentinel is the Bottleneck**: Any new tool or action added to the orchestrator *must* pass through `sentinel.js`. When adding new agent capabilities (like creating documents in chat), Sentinel needs explicit configurations to permit those tools to execute across isolated departments.
   - **Frontend State Propagation**: Passing state via URL parameters (e.g., `?tab=actions`) using Next.js `useSearchParams` proved to be the most reliable way to link separate widgets (like the dashboard widget) directly to deeply nested UI states (like the Decisions Log tabs).
   - **Proactivity Lifecycle**: The agent's proactive behavior relies heavily on document upload triggers and taxonomy classification. For it to work, the ingestion pipeline must accurately flag the upload, index it, and subsequently alert the `orchestrator.js` to notify the frontend via the notifications tab.

### 8. Sub-Task and Chat UI Fixes
- **Dashboard Widget Sub-Tasks**: Fixed a React field mismatch in the Dashboard Action Items widget (`frontend/src/app/dashboard/page.tsx`), changing `{st.task}` to `{st.text}` to correctly render sub-task labels.
- **Agent Chat Capabilities**: The AI agent was failing to create documents because the `src/tools/document.tools.json` schema did not use standard JSON Schema properties structure. Refactored the tool configuration to use standard draft-07 object definitions, enabling Groq/OpenAI to correctly validate and call the `document_create_draft` and `document_edit_draft` tools.

### 9. Retrieval and Memory Improvements
- **Similarity Thresholds**: Lowered the `match_threshold` to `0.3` in `src/services/retrievalService.js` to ensure broader contexts like uploaded investor decks are correctly retrieved and not incorrectly filtered out.
- **Session Memory in Brain Query**: Overhauled `POST /api/brain/query` in `src/api/brainRoutes.js` to retrieve the last 20 messages from `chat_history` for the active session, resolving the chat assistant's "fish memory" behavior.

6. **Chat Context & LLM Prompts**:
   - It is crucial for the primary RAG endpoints to fetch and inject the `chat_history` for the active `sessionId` prior to the user's prompt. Without doing so, the LLM will lose the conversation thread.
7. **LLM Function Calling Requirements**:
   - Custom tool definitions strictly require standard JSON Schema formats. Defining parameters directly as strings (e.g., `"content": "string"`) causes function-calling parsers to fail silently or ignore the tools entirely, preventing the agent from taking action.

### 10. Intelligent Document Formatting & Dynamic User Prompts
- **HTML Formatting Generation**: Implemented a fully functional `generateHTML` document generator in `src/services/documentGenerationService.js`, mapping sections like headings, paragraphs, code, quotes, and tables into premium, self-contained HTML templates. These templates include visual dark/light mode toggles, tailored Inter Google Fonts, responsive layout scaling, and harmonized theme styling (consistent with the visual branding standards).
- **Format Normalization**: Integrated normalization logic mapping formats like `'doc'` to `'docx'`, `'markdown'` or `'plaintext'` to `'md'`, and registered HTML in the `FORMAT_GENERATORS` registry.
- **Tool Configuration Updates**: Expanded parameter format options to include `html` and `md` inside `src/tools/document.tools.json` for the `document_export` and `document_enhance` tools.
- **Clarification Decision Gateways**: Enhanced agent prompt structures in both `src/services/orchestrator.js` (for general AI operating tasks) and `src/services/agentOrchestrator.js` (for specialist startup agents like Finance/Marketing). Agents are now trained to:
  1. Differentiate target document formats based on the task type (e.g., PDFs for finalized deliverables, MD for internal specs, CSV for data lists, DOCX for formal reports, PPTX for pitch decks, and HTML for webpages).
  2. Proactively pause and prompt the user via the \`ask_user_question\` tool with clean, selectable choices (PDF, DOCX, MD, CSV, PPTX, HTML) if they cannot confidently determine the format from the query context.
