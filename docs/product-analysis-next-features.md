# Just Maple: Product Analysis & Next Feature Recommendations

_Analysis Date: February 2026_

---

## Executive Summary

Just Maple is a self-hosted, privacy-first note-taking and collaboration platform with strong differentiation in offline-first architecture, passwordless authentication, and AI integration. The v0.9 release delivered five major features (AI Writing, Templates, Bi-directional Linking, Memo Versioning, Full-text Search, MCP Server), establishing a solid foundation for knowledge management.

This analysis identifies the next set of high-impact features based on:

1. Gaps in current functionality
2. **Competitive analysis** vs Microsoft Loop, OneNote, Notion, Obsidian, and local-first alternatives
3. **Unique opportunities** that leverage Just Maple's self-hosted + real-time collaboration positioning

---

## 1. Current Product State

### Core Value Proposition

Just Maple serves privacy-conscious users who want:

- **Full data ownership** through self-hosting
- **Offline-first** operation with seamless sync
- **AI-powered productivity** without sacrificing privacy
- **Cross-platform access** (Web, macOS, iOS, reMarkable)
- **Real-time collaboration** without cloud dependency

### Implemented Capabilities

| Category           | Features                                                                     |
| ------------------ | ---------------------------------------------------------------------------- |
| **Editing**        | Rich text (TipTap), Whiteboards, Enhanced Todos                              |
| **AI**             | Writing Assistant (9 actions), Bot integrations, MCP Server                  |
| **Knowledge Mgmt** | Bi-directional linking, Backlinks panel, Connection graph, Full-text search  |
| **Collaboration**  | Real-time sync (Y.js), Notebook sharing, Chat/messaging                      |
| **Organization**   | Templates, Notebooks (tags), Memo versioning                                 |
| **Platform**       | PWA, iOS/macOS native, Offline sync, Voice transcription                     |
| **Security**       | Passwordless auth (passkeys + magic links), Privacy-first push notifications |

### Technical Foundation

- **Frontend**: Angular 21 + Tailwind + TipTap
- **Backend**: Bun + Elysia + Cosmos DB (MongoDB API)
- **Sync**: Y.js CRDTs for conflict-free collaboration
- **Storage**: IndexedDB (offline) + MongoDB (server)
- **Native**: Swift + WKWebView hybrid

---

## 2. Competitive Analysis

### 2.1 Microsoft Loop & OneNote

**What they have that Just Maple is missing:**

| Feature                 | Description                                                                  | Priority for Just Maple                       |
| ----------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| **Loop Components**     | Embeddable, synced content blocks that stay live across Teams, Outlook, Word | **High** - Unique collaboration pattern       |
| **Copilot Notebooks**   | AI grounded in aggregated content (notes + files + recordings)               | **High** - Natural extension of AI Writing    |
| **Audio Overview**      | Generate audio summaries of notebooks for on-the-go listening                | **Medium** - WhisperKit infrastructure exists |
| **Video/Image → Notes** | AI transcribes videos, extracts text from images                             | **Medium** - Fits privacy-first positioning   |
| **Meeting Integration** | Auto-capture meeting notes, transcripts, action items                        | **Low** - Requires calendar integration first |

_Sources: [Microsoft Loop](https://www.microsoft.com/en-us/microsoft-loop), [Copilot Notebooks in OneNote](https://support.microsoft.com/en-us/topic/introducing-microsoft-365-copilot-notebooks-in-onenote-c91a851a-77d6-4b70-a898-8aaf718a95df)_

### 2.2 Notion

**What they have that Just Maple is missing:**

| Feature                  | Description                                     | Priority for Just Maple                 |
| ------------------------ | ----------------------------------------------- | --------------------------------------- |
| **Databases with Views** | Tables, boards, calendars, galleries, timelines | **Medium** - Complex but powerful       |
| **Synced Blocks**        | Same content in multiple pages, stays in sync   | **High** - Similar to Loop components   |
| **API & Integrations**   | Rich third-party ecosystem                      | **Low** - MCP provides alternative path |
| **Web Clipper**          | Browser extension for saving content            | **Medium** - Already on roadmap         |

### 2.3 Obsidian & Local-First Alternatives

**What they have:**

| Feature                | Obsidian           | LogSeq            | Anytype         |
| ---------------------- | ------------------ | ----------------- | --------------- |
| **Local-first**        | Yes (files)        | Yes (markdown)    | Yes (encrypted) |
| **Graph View**         | Core feature       | Plugin            | Basic           |
| **Real-time Collab**   | No (Sync is async) | No                | P2P only        |
| **AI Integration**     | Plugin-based       | Community plugins | Limited         |
| **Self-hosted Server** | No (local only)    | No                | No (P2P)        |

**Just Maple's Unique Position:**

Just Maple is the **only** platform that combines:

- ✅ Self-hosted server (full data ownership)
- ✅ Real-time collaboration (Y.js CRDTs)
- ✅ Native AI integration (Claude-powered)
- ✅ Knowledge graph (bi-directional linking)
- ✅ Cross-platform native apps

_Sources: [Obsidian](https://obsidian.md), [LogSeq](https://logseq.com/), [Anytype](https://anytype.io/)_

### 2.4 Competitive Gap Summary

| Capability          | Loop | OneNote | Notion | Obsidian | Anytype | **Just Maple**  |
| ------------------- | ---- | ------- | ------ | -------- | ------- | --------------- |
| Self-hosted         | ❌   | ❌      | ❌     | N/A      | P2P     | ✅              |
| Real-time collab    | ✅   | ✅      | ✅     | ❌       | Limited | ✅              |
| Knowledge graph     | ❌   | ❌      | ❌     | ✅       | ✅      | ✅              |
| Portable components | ✅   | ✅      | ✅     | ❌       | ❌      | ❌ **Gap**      |
| AI grounded in KB   | ✅   | ✅      | ✅     | Plugin   | ❌      | ❌ **Gap**      |
| On-device AI        | ❌   | ❌      | ❌     | Plugin   | ❌      | ✅ (WhisperKit) |
| Passwordless auth   | ❌   | ❌      | ❌     | N/A      | ❌      | ✅              |

---

## 3. Identified Opportunities

### 3.1 Features Partially Implemented or Hinted At

| Feature                           | Current State                            | Gap                                                                                       |
| --------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Connection Graph - Local View** | Notebook-wide graph exists               | Missing page-centered "local graph" with depth control (documented as future enhancement) |
| **Daily Notes**                   | Mentioned in bi-directional linking plan | No dedicated daily note workflow with auto-linking                                        |
| **Tag Filtering**                 | Tags exist on pages                      | No cross-notebook tag browsing or sidebar tag filter                                      |
| **Todo Reminders**                | Todos have due dates                     | No push notification reminders for upcoming/overdue tasks                                 |
| **Recurring Todos**               | Listed in roadmap (#15)                  | No implementation                                                                         |

### 3.2 Natural Extensions of Existing Capabilities

| Extension                           | Builds On                   | Why It Fits                                                     |
| ----------------------------------- | --------------------------- | --------------------------------------------------------------- |
| **Smart Template Suggestions**      | Templates + AI Writing      | AI suggests templates based on first few words typed            |
| **AI-Powered Backlink Suggestions** | Bi-directional linking + AI | Surface pages that should be linked but aren't                  |
| **Contextual Bot Triggers**         | Bots + Enhanced Todos       | Auto-invoke bots when todos are created (e.g., estimate effort) |
| **Graph-Based Navigation**          | Connection Graph            | Click through from local graph, breadcrumb trails               |
| **Version Comparison Diff**         | Memo Versioning             | Side-by-side diff view between any two versions                 |

### 3.3 Gaps Between Stated Goals and Current Functionality

| Stated Goal                            | Current Gap                                        |
| -------------------------------------- | -------------------------------------------------- |
| "Never miss a deadline" (Todos)        | No reminder notifications for due dates            |
| "Track tasks across notebooks" (Todos) | No unified cross-notebook todo view                |
| "Public sharing links" (Roadmap #14)   | All sharing requires authentication                |
| "Dashboard/Home View" (Roadmap #9)     | No personalized home with recents, todos, activity |
| "Web Clipper" (Roadmap #8)             | No browser extension for saving content            |
| "Calendar Integration" (Roadmap #10)   | No sync with Google/Apple Calendar                 |

---

## 4. Proposed Next Features

### 4.1 UNIQUE DIFFERENTIATORS (What Makes Just Maple Special)

These features leverage Just Maple's unique position and create defensible differentiation:

---

#### Feature A: Knowledge-Grounded AI ("Ask Your Notes")

**Problem**: Current AI Writing operates on single pages. Users can't ask questions across their entire knowledge base like OneNote Copilot or Notion AI can.

**Solution**: AI assistant that answers questions grounded in the user's full knowledge graph.

**Key Capabilities**:

- "Ask" command searches across all pages, grounds AI response in found content
- Shows source pages: "Based on: [[Meeting Notes]], [[Project Plan]]"
- Works in chat: "What did we decide about pricing?"
- Respects permissions (only searches accessible content)
- **Privacy-first**: can use on-server LLM (data never leaves your infrastructure)

**Why This Is Unique**:

- Competitors require cloud. Just Maple offers **on-server AI** - your data never leaves
- MCP Server provides external access; this is the internal equivalent
- Builds on existing search index and bi-directional linking

**Complexity**: **Medium-High** - RAG pipeline, context assembly, source attribution

---

#### Feature B: Portable Components ("Maple Blocks")

**Problem**: No way to embed live content across pages or share synced blocks externally. Loop and Notion have this; Just Maple doesn't.

**Solution**: Embeddable, synced content blocks that stay live wherever placed.

**Key Capabilities**:

- Create a "block" from any selection (text, table, todo list)
- Embed in other pages with `{{block-id}}` - changes sync everywhere
- Embed in external apps via URL (read-only public embed)
- Block-level permissions (some public, others private)
- Works offline - syncs via Y.js when reconnected

**Why This Is Unique**:

- Loop Components only work in Microsoft ecosystem
- Notion Synced Blocks require Notion cloud
- Just Maple offers **self-hosted portable blocks** with full data ownership

**Complexity**: **High** - New data model, embed renderer, permission layer

---

#### Feature C: Voice-to-Structured-Notes (On-Device)

**Problem**: Recording transcription exists but outputs raw text. Users want structured notes with action items.

**Solution**: On-device AI that converts voice recordings to structured, formatted notes.

**Key Capabilities**:

- Record → Transcribe (WhisperKit) → Structure (local LLM)
- Output formats: Meeting notes with action items, brainstorm bullets, Q&A
- Auto-extract todos and add to unified view
- **Fully offline** on device
- Privacy-first: nothing leaves device unless user chooses

**Why This Is Unique**:

- OneNote's voice features require Microsoft cloud
- WhisperKit already integrated - just add structuring layer
- Combine on-device transcription + on-device LLM (MLX models)

**Complexity**: **Medium** - Local LLM integration, prompt engineering

---

#### Feature D: Cross-Server Federation (Future Vision)

**Problem**: Self-hosted users can't share with users on different Just Maple servers.

**Solution**: Federated sharing protocol for cross-server collaboration.

**Key Capabilities**:

- Share notebook with user@their-maple-server.com
- Content syncs server-to-server
- Each server retains copy (no SPOF)
- Federated identity verification

**Why This Is Unique**:

- No competitor offers this - all are centralized
- Aligns with self-hosted ethos
- Creates network effect for Just Maple ecosystem

**Complexity**: **Very High** - Federation protocol, trust model (roadmap item)

---

### 4.2 CONSOLIDATED: Complete Task Management

Combining all todo features into one comprehensive release:

---

#### Feature 1: Task Management Suite

**Problem**: Todos have due dates but lack reminders, unified view, and recurrence. Feature is 60% complete.

**Solution**: Complete task management with all missing pieces in one release.

**Key Capabilities**:

| Capability                    | Description                                                            |
| ----------------------------- | ---------------------------------------------------------------------- |
| **Unified Todo View**         | Cross-notebook aggregation, filters (notebook, priority, date, status) |
| **Reminders & Notifications** | Push at configurable times, daily digest, overdue alerts               |
| **Recurring Todos**           | Daily/weekly/monthly, auto-create on completion, streak tracking       |
| **Bulk Actions**              | Multi-select, reschedule, reprioritize, move between pages             |
| **Calendar View**             | Visual calendar showing todos by due date                              |

**Why Now**: Push notification infrastructure exists. Makes Just Maple competitive with Todoist/Things.

**Complexity**: **Medium** - Multiple sub-features, all extend existing system

---

### 4.3 PRODUCTIVITY FEATURES

---

#### Feature 2: Dashboard/Home View

**Problem**: No unified entry point. Users must navigate to specific notebooks.

**Solution**: Personalized dashboard with recents, todos, activity, quick actions.

**Complexity**: **Medium**

---

#### Feature 3: Daily Notes with Auto-Linking

**Problem**: No streamlined journaling workflow.

**Solution**: "Today's Note" with auto-creation, date navigation, temporal linking.

**Complexity**: **Medium**

---

#### Feature 4: Local Graph View

**Problem**: Notebook-wide graph cluttered. Can't explore from specific page.

**Solution**: Page-centered graph with 1-3 hop depth slider.

**Complexity**: **Low** (backend already designed)

---

### 4.4 SHARING & CAPTURE

---

#### Feature 5: Public Sharing Links

**Problem**: All sharing requires authentication.

**Solution**: Generate public URLs with optional password/expiry.

**Complexity**: **Medium**

---

#### Feature 6: Web Clipper

**Problem**: No way to save web content.

**Solution**: Chrome/Firefox extension for clipping.

**Complexity**: **High**

---

## 5. Prioritization Matrix

| #   | Feature                   | User Impact | Effort      | Differentiation | Priority  |
| --- | ------------------------- | ----------- | ----------- | --------------- | --------- |
| A   | Knowledge-Grounded AI     | High        | Medium-High | **Unique**      | **10/10** |
| B   | Portable Components       | High        | High        | **Unique**      | **9/10**  |
| 1   | Task Management Suite     | High        | Medium      | Competitive     | **9/10**  |
| C   | Voice-to-Structured Notes | Medium      | Medium      | **Unique**      | **8/10**  |
| 2   | Dashboard/Home View       | High        | Medium      | Expected        | **8/10**  |
| 4   | Local Graph View          | Medium      | Low         | Competitive     | **7/10**  |
| 3   | Daily Notes               | Medium      | Medium      | Competitive     | **6/10**  |
| 5   | Public Sharing Links      | Medium      | Medium      | Expected        | **6/10**  |
| 6   | Web Clipper               | Medium      | High        | Expected        | **5/10**  |
| D   | Cross-Server Federation   | Low (niche) | Very High   | **Unique**      | **4/10**  |

---

## 6. Recommended Roadmap

### Phase 1: "Unique Value" (Highest Priority)

**Focus**: Build features that only Just Maple can offer

1. **Knowledge-Grounded AI** - "Ask Your Notes" with on-server privacy
2. **Task Management Suite** - Complete todos (reminders + unified view + recurrence)

**Rationale**: Knowledge-Grounded AI is the biggest differentiator. No competitor offers on-server RAG. Combined with complete task management, this makes Just Maple compelling vs. both privacy tools (Obsidian) and cloud tools (Notion).

### Phase 2: "Daily Productivity"

**Focus**: Make Just Maple the daily starting point

3. **Dashboard/Home View** - Unified entry point with recents and todos
4. **Portable Components** - Maple Blocks for synced content everywhere
5. **Voice-to-Structured Notes** - On-device meeting notes

**Rationale**: Increases daily engagement. Portable Components compete with Loop/Notion while maintaining privacy.

### Phase 3: "Knowledge Graph"

**Focus**: Strengthen the knowledge management differentiator

6. **Local Graph View** - Page-centered exploration with depth control
7. **Daily Notes** - Streamlined journaling with temporal linking

**Rationale**: Low effort, high impact. Graph view is already half-built. Differentiates from simpler note apps.

### Phase 4: "Sharing & Capture"

**Focus**: Expand reach

8. **Public Sharing Links** - Share pages without requiring auth
9. **Web Clipper** - Capture content from the web

**Rationale**: Lower priority but expected features. Can be done in parallel.

### Future Vision

10. **Cross-Server Federation** - Share between self-hosted instances

**Rationale**: Transformative but very high effort. Table for later when user base grows.

---

## 7. Quick Wins (Implement Immediately)

These small enhancements require minimal effort:

| Enhancement                                               | Effort    | Impact     |
| --------------------------------------------------------- | --------- | ---------- |
| Add local graph depth slider to existing connection graph | 2-4 hours | Medium     |
| Add "Today's Note" button in sidebar                      | 1-2 hours | Low-Medium |
| Show overdue count badge in sidebar                       | 1 hour    | Low        |
| Version diff view (side-by-side comparison)               | 4-6 hours | Medium     |
| Template usage analytics (most popular templates)         | 2-3 hours | Low        |

---

## 8. Technical Considerations

### Infrastructure Ready

- Push notification system exists and is privacy-compliant
- Aggregation queries are feasible on current data model
- Angular signals architecture supports reactive updates

### Requires New Infrastructure

- **Recurring todos**: Scheduled job for recurrence processing
- **Web clipper**: Browser extension build/publish pipeline
- **Public sharing**: Public route with token-based auth bypass

### Performance Considerations

- Unified todo view may need pagination for heavy users (100+ todos)
- Cross-notebook tag aggregation should use database indexes
- Dashboard queries should be cached (1-5 min TTL)

---

## 9. Success Metrics

| Feature                   | Primary Metric                   | Target                 |
| ------------------------- | -------------------------------- | ---------------------- |
| Knowledge-Grounded AI     | Questions asked per user/week    | >5 after first use     |
| Task Management Suite     | Task completion rate             | +20%                   |
| Dashboard                 | Sessions starting from dashboard | >60%                   |
| Portable Components       | Blocks created per user          | >3/month               |
| Voice-to-Structured Notes | Recordings structured            | >80% of transcriptions |
| Local Graph               | Graph click-through rate         | 2x current             |

---

## Appendix: Feature-to-Dependency Map

```
                    ┌─────────────────────────────────┐
                    │   UNIQUE DIFFERENTIATORS        │
                    └─────────────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
Knowledge-Grounded AI    Portable Components    Voice-to-Structured
        │                          │                          │
        ▼                          ▼                          ▼
   Search Index              Y.js Sync                  WhisperKit
   AI Writing               TipTap Editor              Local LLM (MLX)
   Bi-directional Links

                    ┌─────────────────────────────────┐
                    │   PRODUCTIVITY FEATURES         │
                    └─────────────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
Task Management Suite        Dashboard              Local Graph View
        │                          │                          │
        ▼                          ▼                          ▼
  Enhanced Todos             Page Repo              Connection Graph
  Notifications              Todo Stats             (already exists)
  Scheduled Jobs
```

---

## TL;DR - What's New and What's Unique

### Competitive Gaps (What OneNote/Loop/Notion Have)

- ❌ **Loop Components** - Synced blocks across apps
- ❌ **Copilot Notebooks** - AI grounded in all your notes
- ❌ **Audio Overview** - Generate audio summaries
- ❌ **Databases with Views** - Tables, boards, calendars

### Just Maple's Unique Advantages

- ✅ **Self-hosted + Real-time Collab** - Only platform with both
- ✅ **On-device AI** - WhisperKit transcription, can add local LLM
- ✅ **Passwordless Auth** - Passkeys + magic links
- ✅ **MCP Server** - Claude integration

### Top 3 Features to Build

1. **Knowledge-Grounded AI** - Ask questions across all notes, on-server (privacy-first)
2. **Portable Components** - Maple Blocks, self-hosted alternative to Loop
3. **Task Management Suite** - Complete the todo feature (reminders, unified view, recurrence)

---

_Analysis based on documentation in `/docs` as of February 2026._

_Sources: [Microsoft Loop](https://www.microsoft.com/en-us/microsoft-loop), [OneNote Copilot](https://support.microsoft.com/en-us/office/welcome-to-copilot-in-onenote-34b30802-02ae-4676-a88c-82f8d5e586dd), [Notion](https://www.notion.so), [Obsidian](https://obsidian.md), [LogSeq](https://logseq.com/), [Anytype](https://anytype.io/)_
