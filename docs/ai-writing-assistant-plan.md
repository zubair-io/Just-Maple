# AI Writing Assistant - Implementation Plan

## Executive Summary

This document outlines the implementation plan for the AI Writing Assistant feature in Just Maple. The feature will integrate AI-powered writing assistance directly into the TipTap editor, helping users write, edit, summarize, and improve their content.

**Key Insight**: Significant infrastructure already exists - the slash command system, AI Bot Widget, AI Edit Service, and Claude API integration are all in place. This plan focuses on extending these foundations rather than building from scratch.

---

## Current State Analysis

### What Already Exists

| Component       | Location                                    | Status                               |
| --------------- | ------------------------------------------- | ------------------------------------ |
| Slash Commands  | `apps/web/.../extensions/slash-commands.ts` | 14 commands including basic Claude   |
| AI Bot Widget   | `apps/web/.../molecules/ai-bot-widget/`     | Functional but basic                 |
| AI Edit Service | `apps/api/src/services/ai-edit.service.ts`  | Path-based document editing          |
| Claude API      | Bot Executor Service                        | claude-sonnet-4-20250514 integration |
| WebSocket       | `/ws/realtime`                              | Real-time communication              |

### What Needs to Be Built

1. **New AI Commands**: Continue, improve, simplify, expand, shorten, summarize, grammar, translate, custom
2. **Streaming Responses**: SSE for real-time AI output
3. **Selection-Based Actions**: Toolbar/context menu for selected text
4. **AI Preview Panel**: Accept/reject workflow
5. **Usage Tracking**: Rate limiting and analytics
6. **Improved UX**: Better loading states, error handling, keyboard shortcuts

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Frontend (Angular)                          │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────────────┐   │
│  │ Slash Cmds   │  │ Selection     │  │ AI Preview Panel       │   │
│  │ Extension    │  │ Toolbar       │  │ (Accept/Reject)        │   │
│  └──────┬───────┘  └───────┬───────┘  └────────────┬───────────┘   │
│         │                  │                        │               │
│         └──────────────────┼────────────────────────┘               │
│                            ▼                                         │
│              ┌─────────────────────────┐                            │
│              │   AIWritingService      │                            │
│              │   (Angular Service)     │                            │
│              └───────────┬─────────────┘                            │
│                          │ SSE Stream                               │
└──────────────────────────┼──────────────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────────────┐
│                          ▼           Backend (Elysia)               │
│              ┌─────────────────────────┐                            │
│              │   /api/ai/generate      │ ◄── SSE Endpoint           │
│              │   /api/ai/usage         │                            │
│              └───────────┬─────────────┘                            │
│                          │                                          │
│              ┌───────────┴─────────────┐                            │
│              │   AIWritingService      │                            │
│              │   - Prompt templates    │                            │
│              │   - Context building    │                            │
│              │   - Rate limiting       │                            │
│              └───────────┬─────────────┘                            │
│                          │                                          │
│              ┌───────────┴─────────────┐                            │
│              │   Claude API            │                            │
│              │   (Streaming)           │                            │
│              └─────────────────────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. User triggers AI action (slash command, selection, or keyboard shortcut)
2. Frontend collects context (selection, surrounding text, document)
3. Request sent to `/api/ai/generate` with SSE connection
4. Backend streams response tokens in real-time
5. Frontend displays in preview panel
6. User accepts/rejects → document updated or discarded

---

## Implementation Phases

### Phase 1: Backend API & Streaming (3-4 days)

**Goal**: Create the core AI generation endpoint with streaming support.

#### Tasks

1. **Create AI Writing Service** (`apps/api/src/services/ai-writing.service.ts`)
    - Prompt templates for each action type
    - Context window management (truncate to ~2000 tokens)
    - Response formatting

2. **Add SSE Endpoint** (`apps/api/src/routes/ai.ts`)

    ```typescript
    // POST /api/ai/generate - Returns SSE stream
    interface AIGenerateRequest {
        type:
            | 'continue'
            | 'improve'
            | 'simplify'
            | 'expand'
            | 'shorten'
            | 'summarize'
            | 'grammar'
            | 'translate'
            | 'custom';
        selection?: string; // Selected text
        context: string; // Surrounding content
        instruction?: string; // For custom prompts
        targetLanguage?: string; // For translate
    }
    ```

3. **Implement Prompt Templates**
    - Continue: "Continue writing from where the text ends..."
    - Improve: "Improve the clarity and readability of..."
    - Simplify: "Simplify this text while keeping the meaning..."
    - Expand: "Expand on this idea with more detail..."
    - Shorten: "Make this more concise..."
    - Summarize: "Summarize the key points..."
    - Grammar: "Fix grammar and spelling errors in..."
    - Translate: "Translate to {language}..."
    - Custom: User's instruction

4. **Add Usage Tracking**
    - Create `ai_usage` collection
    - Track tokens per user per day
    - Implement rate limiting (e.g., 50 requests/day free tier)

#### Files to Create/Modify

| File                                          | Action             |
| --------------------------------------------- | ------------------ |
| `apps/api/src/routes/ai.ts`                   | Create             |
| `apps/api/src/services/ai-writing.service.ts` | Create             |
| `packages/shared/src/schemas/ai.ts`           | Create             |
| `apps/api/src/index.ts`                       | Modify (add route) |

---

### Phase 2: Frontend AI Service & Preview Panel (3-4 days)

**Goal**: Create Angular service for AI requests and preview UI component.

#### Tasks

1. **Create AI Writing Service** (`apps/web/src/app/services/ai-writing.service.ts`)

    ```typescript
    @Injectable({ providedIn: 'root' })
    export class AIWritingService {
        generate(request: AIRequest): Observable<string> {
            // SSE connection with incremental text
        }

        getUsage(): Observable<AIUsage> {
            // Current usage stats
        }
    }
    ```

2. **Create AI Preview Panel Component**
    - Floating panel positioned near cursor/selection
    - Shows streaming text with loading indicator
    - Accept (insert) / Reject (discard) buttons
    - Keyboard shortcuts: Enter to accept, Escape to reject
    - Copy button for generated text

3. **Create AI Command Menu Component**
    - Extended context menu for selection-based actions
    - Shows available AI actions
    - Keyboard navigable

#### UI Design

```
┌─────────────────────────────────────────┐
│ ✨ AI Writing Assistant                 │
├─────────────────────────────────────────┤
│                                         │
│  [Streaming AI response appears here    │
│   with a subtle typing animation...]    │
│                                         │
│  █ ← Cursor indicator while streaming   │
│                                         │
├─────────────────────────────────────────┤
│  ✓ Accept (Enter)    ✗ Reject (Esc)    │
└─────────────────────────────────────────┘
```

#### Files to Create/Modify

| File                                                      | Action |
| --------------------------------------------------------- | ------ |
| `apps/web/src/app/services/ai-writing.service.ts`         | Create |
| `apps/web/src/app/components/molecules/ai-preview-panel/` | Create |
| `apps/web/src/app/components/molecules/ai-command-menu/`  | Create |

---

### Phase 3: Editor Integration (2-3 days)

**Goal**: Wire up AI features into the TipTap editor.

#### Tasks

1. **Extend Slash Commands**
    - Add AI submenu with all action types
    - `/ai` or `/ai:continue`, `/ai:improve`, etc.
    - Show command descriptions

2. **Add Selection Toolbar Button**
    - When text is selected, show AI button in toolbar
    - Click opens AI command menu
    - Keyboard shortcut: Cmd/Ctrl+J

3. **Keyboard Shortcuts**
   | Shortcut | Action |
   |----------|--------|
   | Cmd/Ctrl+J | Open AI menu (with selection) |
   | Cmd/Ctrl+Shift+C | Continue writing |
   | Cmd/Ctrl+Shift+I | Improve selection |

4. **Handle Document Updates**
    - On accept: Insert/replace text in editor
    - Preserve formatting where applicable
    - Add to undo stack

#### Files to Modify

| File                                        | Action |
| ------------------------------------------- | ------ |
| `apps/web/.../extensions/slash-commands.ts` | Modify |
| `apps/web/.../notebook-editor.component.ts` | Modify |
| `apps/web/.../editor-toolbar.component.ts`  | Modify |

---

### Phase 4: Polish & Edge Cases (2 days)

**Goal**: Handle edge cases, improve UX, and ensure reliability.

#### Tasks

1. **Error Handling**
    - Network failures: Retry with exponential backoff
    - Rate limit exceeded: Show friendly message with reset time
    - API errors: Log and show generic error

2. **Loading States**
    - Skeleton text animation while waiting
    - Cancel button during generation
    - Progress indicator for long operations

3. **Context Optimization**
    - Smart truncation of context window
    - Preserve headings and structure hints
    - Include document title for context

4. **Accessibility**
    - Screen reader announcements
    - Focus management
    - Keyboard-only operation

5. **Testing**
    - Unit tests for AI service
    - Integration tests for SSE streaming
    - E2E tests for user flows

---

## Technical Specifications

### API Contract

#### POST /api/ai/generate

**Request:**

```typescript
interface AIGenerateRequest {
    type:
        | 'continue'
        | 'improve'
        | 'simplify'
        | 'expand'
        | 'shorten'
        | 'summarize'
        | 'grammar'
        | 'translate'
        | 'custom';
    selection?: string;
    context: string;
    instruction?: string;
    targetLanguage?: string;
    pageId?: string; // For analytics
}
```

**Response (SSE):**

```
event: token
data: {"text": "word "}

event: token
data: {"text": "by "}

event: token
data: {"text": "word"}

event: done
data: {"tokensUsed": 150, "finishReason": "stop"}

event: error
data: {"error": "Rate limit exceeded", "resetAt": "2024-01-15T12:00:00Z"}
```

#### GET /api/ai/usage

**Response:**

```typescript
interface AIUsageResponse {
    daily: {
        requests: number;
        tokens: number;
        limit: number;
    };
    monthly: {
        requests: number;
        tokens: number;
    };
    resetAt: string; // ISO date
}
```

### Database Schema

```typescript
// ai_usage collection
interface AIUsage {
    userId: string;
    date: string; // YYYY-MM-DD
    requests: number;
    tokensInput: number;
    tokensOutput: number;
    createdAt: Date;
    updatedAt: Date;
}

// Index: { userId: 1, date: 1 } unique
```

### Prompt Templates

```typescript
const PROMPTS = {
    continue: `Continue writing naturally from where this text ends.
Match the tone and style. Output only the continuation, no explanations.

Context:
{context}

Continue from here:
{selection}`,

    improve: `Improve the clarity and readability of the following text.
Fix awkward phrasing, improve word choice, and enhance flow.
Keep the same meaning and length. Output only the improved text.

Text to improve:
{selection}`,

    simplify: `Simplify this text to make it easier to understand.
Use simpler words and shorter sentences. Keep the core meaning.
Output only the simplified text.

Text to simplify:
{selection}`,

    expand: `Expand on this text with more detail, examples, or explanation.
Maintain the same tone and style. Output only the expanded text.

Text to expand:
{selection}`,

    shorten: `Make this text more concise while keeping the key information.
Remove redundancy and unnecessary words. Output only the shortened text.

Text to shorten:
{selection}`,

    summarize: `Summarize the key points of this text in 2-3 sentences.
Focus on the main ideas. Output only the summary.

Text to summarize:
{context}`,

    grammar: `Fix all grammar, spelling, and punctuation errors in this text.
Do not change the meaning or style. Output only the corrected text.

Text to fix:
{selection}`,

    translate: `Translate this text to {targetLanguage}.
Maintain the tone and meaning. Output only the translation.

Text to translate:
{selection}`,

    custom: `{instruction}

Context:
{context}

Selected text (if any):
{selection}`,
};
```

---

## Risk Assessment

| Risk                        | Impact | Mitigation                                                 |
| --------------------------- | ------ | ---------------------------------------------------------- |
| API rate limits from Claude | High   | Implement user-level rate limiting, queue requests         |
| High token costs            | Medium | Limit context window, track usage, consider tiered pricing |
| Slow response times         | Medium | Use streaming, show progress, allow cancellation           |
| Inconsistent AI output      | Medium | Good prompts, temperature settings, validation             |
| SSE connection issues       | Low    | Reconnection logic, fallback to polling                    |

---

## Success Metrics

| Metric                    | Target                             |
| ------------------------- | ---------------------------------- |
| AI feature adoption       | 30% of active users within 30 days |
| Average requests per user | 5+ per week                        |
| Accept rate               | >60% of generated content accepted |
| Response latency (TTFB)   | <500ms                             |
| User satisfaction         | 4+ star rating                     |

---

## Estimated Timeline

| Phase                          | Duration       | Dependencies |
| ------------------------------ | -------------- | ------------ |
| Phase 1: Backend API           | 3-4 days       | None         |
| Phase 2: Frontend Service & UI | 3-4 days       | Phase 1      |
| Phase 3: Editor Integration    | 2-3 days       | Phase 2      |
| Phase 4: Polish                | 2 days         | Phase 3      |
| **Total**                      | **10-13 days** |              |

---

## Implementation Checklist

### Phase 1: Backend

- [ ] Create `ai.ts` route file
- [ ] Implement SSE streaming endpoint
- [ ] Create `ai-writing.service.ts`
- [ ] Define prompt templates
- [ ] Add TypeBox schemas in shared package
- [ ] Implement usage tracking collection
- [ ] Add rate limiting middleware
- [ ] Write unit tests

### Phase 2: Frontend Service & UI

- [ ] Create `ai-writing.service.ts` Angular service
- [ ] Implement SSE client with EventSource
- [ ] Create AI preview panel component
- [ ] Add accept/reject functionality
- [ ] Create AI command menu component
- [ ] Add loading/error states
- [ ] Style components with Tailwind

### Phase 3: Editor Integration

- [ ] Extend slash commands with AI submenu
- [ ] Add selection toolbar AI button
- [ ] Implement keyboard shortcuts
- [ ] Wire up document insertion
- [ ] Handle undo/redo integration
- [ ] Test with Y.js collaboration

### Phase 4: Polish

- [ ] Add error handling & retry logic
- [ ] Implement cancellation
- [ ] Add accessibility features
- [ ] Write integration tests
- [ ] Write E2E tests
- [ ] Performance optimization
- [ ] Documentation

---

## File Structure (New Files)

```
apps/
├── api/
│   └── src/
│       ├── routes/
│       │   └── ai.ts                    # New: AI endpoints
│       └── services/
│           └── ai-writing.service.ts    # New: AI logic
├── web/
│   └── src/
│       └── app/
│           ├── services/
│           │   └── ai-writing.service.ts  # New: Angular service
│           └── components/
│               └── molecules/
│                   ├── ai-preview-panel/  # New: Preview UI
│                   └── ai-command-menu/   # New: Command menu
packages/
└── shared/
    └── src/
        └── schemas/
            └── ai.ts                    # New: Shared types
```

---

## Next Steps

1. Review this plan with team
2. Set up Claude API key in environment
3. Begin Phase 1 implementation
4. Create UI mockups for Phase 2 components
