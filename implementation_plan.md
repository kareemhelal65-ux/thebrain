# Multi-Feature Implementation: Chat History, Delegation, Roadmap, and Decision Log Enhancements

This plan covers all the outstanding changes requested for The Brain AIOS.

## Summary of Changes

1. **Chat History per Agent** — Each agent gets its own isolated chat history; Brain has its own too. No system prompts shown.
2. **Brain Delegation** — The Brain delegates tasks to relevant agents when told to do something.
3. **Roadmap Sub-tasks** — Each task in the roadmap tab has sub-tasks.
4. **Roadmap Evaluation** — Company evaluation made by Finance and Investment agents.
5. **Remove "View Detailed Plan" button** — From the roadmap phase actions.
6. **Functional "Launch Related Agents" button** — Actually launches agents and provides feedback.
7. **Decision Log "Made by" inference** — Infer the decision maker from document metadata instead of "System".
8. **Decision Log "Roadmap Link" column** — Tag decisions with the Roadmap phase/objective they relate to.

---

## Proposed Changes

### 1. Chat History — Separate Per Agent/Brain

#### [MODIFY] [page.tsx](file:///c:/Users/HP/Desktop/The Brain/frontend/src/app/dashboard/chat/page.tsx)

**Problem**: Currently, when viewing chat history, it highlights as if talking to the Brain and shows system prompts. Agent conversations are mixed with Brain sessions.

**Changes**:
- When selecting an agent, load chat history filtered by `agent_name` from the `chat_history` table (using a new API param).
- When selecting Brain, load only Brain-specific sessions (where `agent_name` is null).
- Filter out any messages with `role === 'system'` from displayed history.
- Store `agent_name` on chat history records so they can be filtered.

#### [MODIFY] [orchestrationRoutes.js](file:///c:/Users/HP/Desktop/The Brain/src/api/orchestrationRoutes.js)

- In the `POST /agent-chat` endpoint: save `agent_name` alongside chat history entries.
- In the `POST /chat` endpoint: continue saving with `agent_name = null` for Brain chats.
- Add a `GET /api/orchestrator/agent-chat/history/:agentName` endpoint to retrieve per-agent history.

---

### 2. Brain Delegation to Agents

#### [MODIFY] [orchestrator.js](file:///c:/Users/HP/Desktop/The Brain/src/services/orchestrator.js)

- Add a `delegate_to_agents` tool definition to the Brain's tool set (only when `agentId` is null, i.e., Brain chat).
- When the Brain decides to delegate, it calls `delegate_to_agents` with a list of agent names and tasks.
- The orchestrator intercepts this tool call, launches the specified agents via the existing `/api/agents/launch` mechanism, and returns a summary.

#### [MODIFY] [orchestrationRoutes.js](file:///c:/Users/HP/Desktop/The Brain/src/api/orchestrationRoutes.js)

- In the `POST /chat` endpoint: handle the delegation result and persist the delegation action to chat history.

---

### 3. Roadmap Sub-tasks

#### [MODIFY] [page.tsx](file:///c:/Users/HP/Desktop/The Brain/frontend/src/app/dashboard/roadmap/page.tsx)

- The `RoadmapItem` interface already supports `children` recursively. The static `ROADMAP_PHASES` data already has sub-objectives under objectives.
- **Add a third level**: each sub_objective/task can have `children` of type `sub_task`.
- Update `RoadmapItemRow` to render sub-tasks (depth=2) with proper indentation.
- Add sub-tasks to the Pre-Seed phase's existing items as examples.

---

### 4. Roadmap Evaluation by Finance & Investment Agents

#### [MODIFY] [page.tsx](file:///c:/Users/HP/Desktop/The Brain/frontend/src/app/dashboard/roadmap/page.tsx)

- Add an "Evaluate Phase" button that calls a new API endpoint.
- Display evaluation results in the `evaluation_notes` field (already supported in the UI).

#### [MODIFY] [orchestrationRoutes.js](file:///c:/Users/HP/Desktop/The Brain/src/api/orchestrationRoutes.js) or a new route file

- Add a `POST /api/roadmap/evaluate/:phaseId` endpoint that:
  1. Takes the phase data
  2. Calls the LLM with Finance Agent + Investment Agent personas
  3. Returns an evaluation summary
  4. Stores it in the roadmap data

---

### 5. Remove "View Detailed Plan" Button

#### [MODIFY] [page.tsx](file:///c:/Users/HP/Desktop/The Brain/frontend/src/app/dashboard/roadmap/page.tsx)

- Remove the `handleViewDetailedPlan` function.
- Remove the "View Detailed Plan" button from the phase action buttons area (lines 717-719).

---

### 6. Functional "Launch Related Agents" Button

#### [MODIFY] [page.tsx](file:///c:/Users/HP/Desktop/The Brain/frontend/src/app/dashboard/roadmap/page.tsx)

The `handleLaunchRelatedAgents` function already exists and calls the `/api/agents/launch` endpoint. It already navigates to the chat page after launching.

**Enhancements**:
- Add loading state while launching agents.
- Show a toast/notification with the names of launched agents.
- Add a brief delay between launches to avoid rate limiting.
- Show agent names in the button label when launching.

---

### 7. Decision Log "Made by" Inference

#### [MODIFY] [page.tsx](file:///c:/Users/HP/Desktop/The Brain/frontend/src/app/dashboard/decisions/page.tsx)

- Update the "Made by" column rendering to show the inferred name instead of "System".

#### Backend changes (document ingestion service)

- When extracting decisions during document ingestion, look at document metadata (author, meeting participants) to infer the decider.
- For investor decks → "Kareem" (the founder).
- For meeting transcripts → participants from the meeting metadata.
- If unknown → keep "System" but mark it as "Extracted" so it's clear it was auto-extracted.

> [!IMPORTANT]
> The actual decision extraction happens during document ingestion. To retroactively fix existing "System" entries, we'd need a migration or re-processing step. For now, we'll fix the extraction logic going forward and update the frontend display.

---

### 8. Decision Log "Roadmap Link" Column

#### [MODIFY] [page.tsx](file:///c:/Users/HP/Desktop/The Brain/frontend/src/app/dashboard/decisions/page.tsx)

- Add a "Roadmap Link" column to the decisions table (after the Source column).
- Display clickable links like "Pre-Seed → MVP Development" that navigate to the roadmap tab with that phase expanded.

#### Backend

- During decision extraction, use the LLM to tag each decision with a `roadmap_phase` and `roadmap_objective`.
- Add `roadmap_phase` and `roadmap_objective` fields to the Decision interface.
- For existing decisions, we can do a one-time batch tagging via an API endpoint.

> [!NOTE]
> Since the roadmap phases are well-defined (Pre-Seed, Seed, Series A, etc.), we can use keyword matching + LLM inference to tag decisions with roadmap phases. This will be stored in the decisions table.

---

## Open Questions

1. **Chat history migration**: Should existing chat history entries (currently without `agent_name`) all be treated as "Brain" conversations? This seems like the right default.

2. **Decision maker inference depth**: For meeting transcripts, should The Brain try to identify who specifically made each decision within a multi-person meeting, or just list all meeting participants as the "deciders"?

3. **Roadmap evaluation frequency**: Should the evaluation happen automatically when the roadmap is loaded, or only on-demand when the user clicks "Evaluate"?

---

## Verification Plan

### Automated Tests
- Restart the backend server and verify all new API endpoints respond correctly.
- Test the frontend by navigating to each modified page (Chat, Roadmap, Decisions).

### Manual Verification  
- Chat with an agent → verify separate chat history.
- Chat with Brain → verify no agent history mixing.
- Open Roadmap → verify sub-tasks render, "View Detailed Plan" removed, "Launch Related Agents" works.
- Open Decisions → verify "Roadmap Link" column appears and "Made by" shows inferred names.
