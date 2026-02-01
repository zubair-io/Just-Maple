# Just Maple: Product Analysis & Next Feature Recommendations

_Analysis Date: February 2026_

---

## Executive Summary

Just Maple is a self-hosted, privacy-first note-taking and collaboration platform with strong differentiation in offline-first architecture, passwordless authentication, and AI integration. The v0.9 release delivered five major features (AI Writing, Templates, Bi-directional Linking, Memo Versioning, Full-text Search, MCP Server), establishing a solid foundation for knowledge management.

This analysis identifies the next set of high-impact features based on gaps in current functionality, natural extensions of existing capabilities, and alignment with the product's self-hosted, privacy-first positioning.

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

## 2. Identified Opportunities

### 2.1 Features Partially Implemented or Hinted At

| Feature                           | Current State                            | Gap                                                                                       |
| --------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Connection Graph - Local View** | Notebook-wide graph exists               | Missing page-centered "local graph" with depth control (documented as future enhancement) |
| **Daily Notes**                   | Mentioned in bi-directional linking plan | No dedicated daily note workflow with auto-linking                                        |
| **Tag Filtering**                 | Tags exist on pages                      | No cross-notebook tag browsing or sidebar tag filter                                      |
| **Todo Reminders**                | Todos have due dates                     | No push notification reminders for upcoming/overdue tasks                                 |
| **Recurring Todos**               | Listed in roadmap (#15)                  | No implementation                                                                         |

### 2.2 Natural Extensions of Existing Capabilities

| Extension                           | Builds On                   | Why It Fits                                                     |
| ----------------------------------- | --------------------------- | --------------------------------------------------------------- |
| **Smart Template Suggestions**      | Templates + AI Writing      | AI suggests templates based on first few words typed            |
| **AI-Powered Backlink Suggestions** | Bi-directional linking + AI | Surface pages that should be linked but aren't                  |
| **Contextual Bot Triggers**         | Bots + Enhanced Todos       | Auto-invoke bots when todos are created (e.g., estimate effort) |
| **Graph-Based Navigation**          | Connection Graph            | Click through from local graph, breadcrumb trails               |
| **Version Comparison Diff**         | Memo Versioning             | Side-by-side diff view between any two versions                 |

### 2.3 Gaps Between Stated Goals and Current Functionality

| Stated Goal                            | Current Gap                                        |
| -------------------------------------- | -------------------------------------------------- |
| "Never miss a deadline" (Todos)        | No reminder notifications for due dates            |
| "Track tasks across notebooks" (Todos) | No unified cross-notebook todo view                |
| "Public sharing links" (Roadmap #14)   | All sharing requires authentication                |
| "Dashboard/Home View" (Roadmap #9)     | No personalized home with recents, todos, activity |
| "Web Clipper" (Roadmap #8)             | No browser extension for saving content            |
| "Calendar Integration" (Roadmap #10)   | No sync with Google/Apple Calendar                 |

---

## 3. Proposed Next Features

### Feature 1: Todo Reminders & Notifications

**Problem**: Users set due dates on todos but receive no notification when deadlines approach or pass. The promise of "never miss a deadline" is unfulfilled.

**Solution**: Push notification system for todo due dates with configurable reminder timing.

**Key Capabilities**:

- Reminder timing options: At time, 15min/1hr/1day before
- Daily digest of upcoming todos
- Overdue notifications with escalation
- Per-todo snooze functionality
- APNs/FCM integration for native apps

**Why Now**:

- Enhanced todos with due dates already exist
- Push notification infrastructure already built (privacy-first design)
- Direct user request pattern (todos without reminders are incomplete)

**Dependencies**: Enhanced Todo system, Push notification service

**Complexity**: **Medium** - Requires scheduled job for reminder triggering, notification preference UI, timezone handling

---

### Feature 2: Dashboard/Home View

**Problem**: Users lack a unified entry point that surfaces relevant content. Current flow requires navigating to specific notebooks.

**Solution**: Personalized home dashboard with recent activity, upcoming todos, and quick actions.

**Key Capabilities**:

- Recent pages (last 10 across all notebooks)
- Upcoming todos (next 7 days with priority)
- Activity timeline (edits, messages, collaborator updates)
- Quick create buttons (new memo, whiteboard, from template)
- Pinned/favorite pages section
- Today's schedule if calendar integrated

**Why Now**:

- Foundation data exists (pages, todos, messages all tracked)
- Natural entry point for both web and mobile
- Reduces cognitive load for daily usage

**Dependencies**: Page repository, Todo stats aggregation, Activity tracking

**Complexity**: **Medium** - New page route, aggregation queries, responsive layout

---

### Feature 3: Unified Todo View

**Problem**: Todos are scattered across individual pages. Users can't see all tasks in one place for prioritization.

**Solution**: Cross-notebook todo aggregation view with filtering and bulk actions.

**Key Capabilities**:

- Filter by: notebook, priority, due date range, status (pending/completed)
- Sort by: due date, priority, created date, notebook
- Inline editing (toggle completion, change priority, reschedule)
- Bulk actions (mark complete, reschedule, move)
- Quick navigation to source page

**Why Now**:

- Todo stats already aggregated per notebook (`todoMeta`)
- Addresses a common complaint about task-based workflows
- Builds on existing todo infrastructure

**Dependencies**: Enhanced Todo system, Page repository

**Complexity**: **Low-Medium** - New page component, aggregation query, no new data model

---

### Feature 4: Daily Notes with Auto-Linking

**Problem**: Users interested in journaling or daily logging lack a streamlined daily note workflow with temporal navigation.

**Solution**: Dedicated daily note system with automatic creation, date-based navigation, and bi-directional linking between days.

**Key Capabilities**:

- "Today's Note" quick action in sidebar
- Auto-create today's note if it doesn't exist
- Date picker to navigate to any day
- Auto-link to yesterday/tomorrow
- Weekly/monthly rollup views
- Templates for daily notes (customizable)

**Why Now**:

- Bi-directional linking infrastructure is complete
- Templates system can provide daily note templates
- Popular pattern in competitors (Roam, Logseq, Obsidian)

**Dependencies**: Bi-directional Linking, Templates

**Complexity**: **Medium** - New route, date-based page lookup, auto-linking logic

---

### Feature 5: Smart Template Suggestions

**Problem**: Users must manually browse templates. New note creation doesn't guide users toward relevant templates.

**Solution**: AI-powered template suggestions based on initial content or notebook context.

**Key Capabilities**:

- Suggest template after first sentence typed
- Context-aware (notebook type, time of day, day of week)
- "Apply template" non-destructively merges with existing content
- Learn from user acceptance/rejection
- Quick-apply with keyboard shortcut

**Why Now**:

- Templates and AI Writing are both implemented
- Low friction path to template adoption
- Differentiator vs. static template galleries

**Dependencies**: Templates, AI Writing Assistant

**Complexity**: **Low** - API call on first paragraph, UI overlay, no new data model

---

### Feature 6: Local Graph View

**Problem**: The notebook-wide connection graph becomes cluttered with many pages. Users can't explore connections from a specific page.

**Solution**: Page-centered local graph with configurable depth and focus.

**Key Capabilities**:

- Show connections 1-3 hops from current page
- Depth slider control
- Highlight direct vs. indirect connections
- Click to navigate, shift+click to add to view
- Export/share graph as image

**Why Now**:

- Listed as future enhancement in existing connection graph docs
- Backend `getLocalGraph()` already designed (see bidirectional-linking-plan.md)
- Graph component already exists, needs parameter

**Dependencies**: Connection Graph, Bi-directional Linking

**Complexity**: **Low** - Backend endpoint designed, frontend depth control

---

### Feature 7: Cross-Notebook Tag View

**Problem**: Tags are page-level. Users can't see all content tagged with a specific topic across notebooks.

**Solution**: Tag browser with cross-notebook aggregation and tag management.

**Key Capabilities**:

- Tag cloud or list view with usage counts
- Click tag to see all pages (across notebooks) with that tag
- Tag rename (updates all references)
- Tag merge (combine duplicates)
- Tag colors/icons
- Tag pages (notes about the tag itself)

**Why Now**:

- Tags as first-class entities designed in bidirectional-linking-plan.md
- Page schema already supports tags
- Common pattern in knowledge management tools

**Dependencies**: Bi-directional Linking (tag infrastructure)

**Complexity**: **Medium** - Tag aggregation, rename propagation, new UI

---

### Feature 8: Public Sharing Links

**Problem**: Sharing requires recipients to have accounts. Users can't share individual pages publicly for read-only viewing.

**Solution**: Generate shareable public URLs for individual pages with optional access controls.

**Key Capabilities**:

- Generate unique share URL for any page
- Access options: anyone with link, password-protected, expiring link
- Analytics (view count, last viewed)
- Revoke access instantly
- Respect page updates (live content, not snapshot)

**Why Now**:

- Listed in product roadmap (#14)
- Common request for knowledge sharing use cases
- Builds on existing auth infrastructure

**Dependencies**: Auth system (new public route), Page repository

**Complexity**: **Medium** - New public route, share token generation, access tracking

---

### Feature 9: Recurring Todos

**Problem**: Tasks that repeat on schedule (weekly reviews, monthly reports) must be manually recreated.

**Solution**: Recurring task patterns with automatic creation on completion.

**Key Capabilities**:

- Recurrence patterns: daily, weekly, monthly, custom
- On completion: create next occurrence
- Skip/postpone recurrence
- Show upcoming occurrences in todo view
- Streak tracking for habit-building

**Why Now**:

- Listed in product roadmap (#15)
- Natural extension of enhanced todos
- Builds user engagement through habits

**Dependencies**: Enhanced Todo system

**Complexity**: **Medium** - Recurrence pattern storage, scheduled creation, streak calculation

---

### Feature 10: Web Clipper

**Problem**: Users find content on the web but have no way to quickly save it to Just Maple.

**Solution**: Browser extension that clips selected content or full pages directly to a notebook.

**Key Capabilities**:

- Chrome/Firefox extension
- Clip selection, full page, or simplified (reader mode)
- Quick notebook selector
- Add notes/tags before saving
- Preserve images and formatting

**Why Now**:

- Listed in product roadmap (#8)
- Captures content acquisition use case
- Relatively standalone project

**Dependencies**: Page creation API, Auth (extension login flow)

**Complexity**: **High** - Browser extension development, content sanitization, image handling

---

## 4. Prioritization Matrix

| #   | Feature                    | User Impact | Technical Effort | Strategic Fit | Priority Score |
| --- | -------------------------- | ----------- | ---------------- | ------------- | -------------- |
| 1   | Todo Reminders             | High        | Medium           | High          | **9/10**       |
| 2   | Dashboard/Home View        | High        | Medium           | High          | **9/10**       |
| 3   | Unified Todo View          | High        | Low-Medium       | High          | **8/10**       |
| 6   | Local Graph View           | Medium      | Low              | Medium        | **8/10**       |
| 4   | Daily Notes                | Medium      | Medium           | Medium        | **7/10**       |
| 5   | Smart Template Suggestions | Medium      | Low              | High          | **7/10**       |
| 7   | Cross-Notebook Tag View    | Medium      | Medium           | Medium        | **6/10**       |
| 9   | Recurring Todos            | Medium      | Medium           | Medium        | **6/10**       |
| 8   | Public Sharing Links       | Medium      | Medium           | Medium        | **6/10**       |
| 10  | Web Clipper                | Medium      | High             | Low           | **5/10**       |

---

## 5. Recommended Roadmap

### Phase 1: "Task Management Excellence" (Next Sprint)

**Focus**: Complete the todo feature set

1. **Todo Reminders & Notifications** - Fulfill the "never miss a deadline" promise
2. **Unified Todo View** - Central place for all tasks
3. **Recurring Todos** - Support for habits and recurring work

**Rationale**: Todos are already popular but incomplete. These three features make Just Maple competitive with dedicated task managers.

### Phase 2: "Daily Productivity Hub"

**Focus**: Make Just Maple the daily starting point

4. **Dashboard/Home View** - Unified entry point
5. **Daily Notes with Auto-Linking** - Journaling/logging workflow
6. **Smart Template Suggestions** - Reduce friction for new notes

**Rationale**: Daily engagement features increase stickiness and surface existing content.

### Phase 3: "Knowledge Graph Enhancement"

**Focus**: Strengthen the knowledge management differentiator

7. **Local Graph View** - Page-centered exploration
8. **Cross-Notebook Tag View** - Topic-based navigation
9. **AI-Powered Backlink Suggestions** - Smart linking assistance

**Rationale**: Builds on bi-directional linking investment, differentiates from simpler note apps.

### Phase 4: "Sharing & Capture"

**Focus**: Expand reach and content acquisition

10. **Public Sharing Links** - Outbound content sharing
11. **Web Clipper** - Inbound content capture

**Rationale**: These are more standalone and less core to daily workflow.

---

## 6. Quick Wins (Can Implement Immediately)

These small enhancements require minimal effort:

| Enhancement                                               | Effort    | Impact     |
| --------------------------------------------------------- | --------- | ---------- |
| Add local graph depth slider to existing connection graph | 2-4 hours | Medium     |
| Add "Today's Note" button in sidebar                      | 1-2 hours | Low-Medium |
| Show overdue count badge in sidebar                       | 1 hour    | Low        |
| Version diff view (side-by-side comparison)               | 4-6 hours | Medium     |
| Template usage analytics (most popular templates)         | 2-3 hours | Low        |

---

## 7. Technical Considerations

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

## 8. Success Metrics

| Feature           | Primary Metric                             | Target                       |
| ----------------- | ------------------------------------------ | ---------------------------- |
| Todo Reminders    | % of todos with reminders set              | >30% of todos with due dates |
| Dashboard         | Daily active users starting from dashboard | >60% of sessions             |
| Unified Todo View | Task completion rate increase              | +15%                         |
| Daily Notes       | % of users creating daily notes            | >20% weekly active users     |
| Local Graph       | Graph feature engagement                   | 2x click-through rate        |
| Recurring Todos   | % of todos set to recurring                | >10%                         |
| Public Sharing    | Links generated per month                  | Growing 20% MoM              |

---

## Appendix: Feature-to-Dependency Map

```
Todo Reminders ──► Enhanced Todos ◄── Recurring Todos
                         │
                         ▼
Dashboard ─────────► Unified Todo View
    │
    ├──► Recent Pages
    │
    └──► Activity Timeline

Daily Notes ───► Bi-directional Linking ◄── Local Graph View
                         │
                         ▼
         Cross-Notebook Tag View ◄── Tags on Pages

Smart Templates ──► Templates + AI Writing

Public Sharing ──► Auth System (bypass for public routes)

Web Clipper ──► Page Creation API + Browser Extension
```

---

_This analysis is based on documentation in `/docs` as of February 2026._
