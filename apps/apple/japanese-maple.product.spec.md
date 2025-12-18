# Living Documents: A Reactive Document System

## Project Specification v0.1

---

## Executive Summary

**Living Documents** is a new paradigm for note-taking and document creation that bridges the gap between static documents and node-based automation tools like n8n. Unlike traditional documents that capture a snapshot in time, Living Documents are reactive, context-aware, and can respond to events, user input, and external data sources while maintaining the linear, readable flow of a document.

The core insight is that documents should be smart containers that understand their purpose based on context (title, structure, parent documents) and contain embedded widgets that can capture data, react to events, trigger automations, and update their content dynamically.

---

## Problem Statement

### Current Landscape Gaps

| Tool                  | Strength                         | Limitation                                            |
| --------------------- | -------------------------------- | ----------------------------------------------------- |
| **Notion/Coda**       | Databases, automations, formulas | Automations feel bolted-on; widgets are static embeds |
| **n8n/Zapier**        | Powerful node-based workflows    | No document context; separate from content            |
| **Observable/marimo** | Reactive notebooks with code     | Developer-focused; code-first paradigm                |
| **Tana**              | Supertags, live queries          | Outliner-focused; not document-centric                |

**The Gap**: No tool provides documents that are:

1. **Contextually intelligent** - understand what they are based on title/structure
2. **Reactively updated** - respond to events and data changes
3. **Widget-embeddable** - contain interactive components inline
4. **Linearly readable** - maintain document flow, not just node graphs

---

## Core Concepts

### 1. Document Context Intelligence

Documents infer their purpose from:

- **Title patterns**: "Interview: [Name]" → activates interview widgets
- **Parent documents**: Child of "Interviews" folder → inherits interview template
- **Explicit templates**: User-defined document types with preset widgets
- **Content analysis**: AI-assisted detection of document purpose

### 2. Reactive Widgets

Inline components that:

- **Capture data**: Audio recording, form inputs, selections
- **Display state**: Home Assistant entities, API data, live metrics
- **Trigger actions**: Button clicks, threshold crossings, time-based events
- **Transform content**: AI summarization, data aggregation, formatting

### 3. Widget-Document Binding

Widgets can:

- Read document context (title, sections, sibling content)
- Write to specific document locations
- Trigger document-level events
- Communicate with other widgets in the same document

### 4. Event-Driven Updates

Documents respond to:

- **User events**: Widget interactions, selections, form submissions
- **Time events**: Calendar triggers, scheduled refreshes
- **External events**: Webhooks, API changes, IoT state changes
- **Content events**: Section completion, threshold reached, pattern detected

---

## Use Case Examples

### Example 1: Interview Document

```
📄 Interview: Sarah Chen - Engineering Manager
├── 📌 Context: Interview (detected from title pattern)
├── 🎙️ [Audio Recording Widget]
│   └── Auto-transcribes → populates "Transcript" section
├── 📋 Questions Section
│   ├── Q1: "Tell me about your leadership style"
│   │   └── [Dropdown: ⬜ Bad | ⬜ Fair | ✅ Good | ⬜ Great]
│   ├── Q2: "Describe a conflict you resolved"
│   │   └── [Dropdown: ⬜ Bad | ⬜ Fair | ⬜ Good | ✅ Great]
│   └── ... more questions
├── 📝 AI Summary Section
│   └── [Auto-generated from transcript + scores]
│       → Triggers when: all questions scored OR recording ends
└── 📊 Overall Assessment
    └── [Calculated from question scores]
```

**Reactive Behaviors:**

- Dropdown selection → AI reads question + score + transcript → writes section summary
- All dropdowns filled → generates overall assessment
- Parent "Interviews" doc updates its aggregated view

### Example 2: Daily Interviews Hub

```
📁 Interviews (November 2024)
├── 📅 [Calendar Widget]
│   └── Each day with scheduled interview → creates child document from template
├── 📊 [Aggregation Widget]
│   └── Shows: Total interviews, avg scores, upcoming schedule
└── 📄 Child Documents (auto-created)
    ├── 2024-11-25: Interview: Sarah Chen
    ├── 2024-11-26: Interview: Mike Torres
    └── 2024-11-27: Interview: (scheduled, doc pre-created)
```

### Example 3: Home Dashboard Document

```
📄 Home Status
├── 🏠 [Home Assistant Widget]
│   └── Real-time state: lights, temperature, motion sensors
├── 📈 [Energy Chart Widget]
│   └── Live data from HA sensors, 24h rolling graph
├── 🚨 [Alert Section]
│   └── Auto-populates when: sensor exceeds threshold
│   └── "Living room motion detected at 3:42 AM"
└── 📋 [Automation Trigger Widget]
    └── Buttons: "Movie Mode", "Away Mode", "Goodnight"
```

### Example 4: Meeting Notes (Auto-Contextualized)

```
📄 Team Standup - 2024-11-28
├── 📌 Context: Meeting (detected from calendar integration)
├── 👥 [Attendees Widget]
│   └── Pulled from calendar event; editable
├── 🎙️ [Transcription Widget]
│   └── Auto-records when meeting starts
├── ✅ [Action Items Widget]
│   └── AI extracts action items from transcript
│   └── On checkbox → syncs to user's task manager
└── 📤 [Auto-Share Widget]
    └── When meeting ends → emails summary to attendees
```

---

## Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────┐
│                    Living Documents                      │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   Editor    │  │  Widget     │  │   Event     │     │
│  │   Layer     │  │  Runtime    │  │   Bus       │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │             │
│         └────────────────┼────────────────┘             │
│                          │                              │
│  ┌───────────────────────┴───────────────────────┐     │
│  │              Document State Store              │     │
│  │   (CRDT-based for real-time sync & offline)   │     │
│  └───────────────────────────────────────────────┘     │
│                          │                              │
│  ┌───────────────────────┴───────────────────────┐     │
│  │           Integration Layer                    │     │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │     │
│  │  │Home    │ │Calendar│ │  AI    │ │ Custom │ │     │
│  │  │Assist  │ │  API   │ │ Models │ │  APIs  │ │     │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ │     │
│  └───────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

### Widget Architecture

```typescript
interface Widget {
    // Identity
    id: string;
    type: WidgetType;

    // Context Access
    documentContext: DocumentContext; // title, sections, parent doc
    siblingWidgets: Widget[]; // other widgets in doc

    // State
    state: WidgetState; // widget-specific state
    outputs: Record<string, any>; // exposed to other widgets/doc

    // Lifecycle
    onMount(): void;
    onContextChange(ctx: DocumentContext): void;
    onEvent(event: DocumentEvent): void;
    onUnmount(): void;

    // Actions
    emitEvent(event: WidgetEvent): void;
    writeToDocument(location: DocLocation, content: Content): void;
    triggerExternalAction(action: ExternalAction): void;
}
```

### Document Context Model

```typescript
interface DocumentContext {
    // Identity
    id: string;
    title: string;
    inferredType: DocumentType; // "interview", "meeting", "dashboard", etc.

    // Hierarchy
    parent?: DocumentContext;
    children: DocumentContext[];

    // Content
    sections: Section[];
    widgets: WidgetInstance[];

    // Metadata
    createdAt: Date;
    modifiedAt: Date;
    tags: string[];

    // Templates
    template?: DocumentTemplate;

    // Event Subscriptions
    subscriptions: EventSubscription[];
}
```

### Event System

```typescript
interface DocumentEvent {
    type: EventType;
    source: 'widget' | 'document' | 'external' | 'user' | 'time';
    payload: any;
    timestamp: Date;
}

type EventType =
    // Widget Events
    | 'widget:value_changed'
    | 'widget:action_triggered'
    | 'widget:data_received'
    // Document Events
    | 'document:section_completed'
    | 'document:context_changed'
    | 'document:child_created'
    // External Events
    | 'external:webhook_received'
    | 'external:api_data_changed'
    | 'external:iot_state_changed'
    // Time Events
    | 'time:scheduled'
    | 'time:interval';
```

---

## Core Widget Types

### Data Capture Widgets

| Widget              | Description                   | Outputs                                  |
| ------------------- | ----------------------------- | ---------------------------------------- |
| **Audio Recorder**  | Records and transcribes audio | `transcript: string`, `duration: number` |
| **Form Input**      | Text, number, date inputs     | `value: any`                             |
| **Dropdown/Select** | Single or multi-select        | `selected: string[]`                     |
| **Rating**          | Star rating, scales           | `rating: number`                         |
| **Signature**       | Digital signature capture     | `signature: ImageData`                   |
| **File Upload**     | Attach files                  | `files: File[]`                          |

### Display Widgets

| Widget               | Description                 | Inputs                 |
| -------------------- | --------------------------- | ---------------------- |
| **Live Data**        | Show real-time API/IoT data | `source: DataSource`   |
| **Chart/Graph**      | Visualize data over time    | `data: TimeSeriesData` |
| **Status Indicator** | Show on/off, health status  | `entity: Entity`       |
| **Embed**            | iFrame external content     | `url: string`          |
| **AI Summary**       | Generated text from context | `context: string[]`    |

### Action Widgets

| Widget        | Description          | Triggers               |
| ------------- | -------------------- | ---------------------- |
| **Button**    | Trigger actions      | `onClick: Action[]`    |
| **Toggle**    | On/off state changes | `onToggle: Action[]`   |
| **Timer**     | Countdown/interval   | `onComplete: Action[]` |
| **Threshold** | Value-based triggers | `onCross: Action[]`    |

### Structural Widgets

| Widget                | Description               | Behavior                |
| --------------------- | ------------------------- | ----------------------- |
| **Calendar**          | Date-based child creation | Creates docs for events |
| **Template Picker**   | Choose doc template       | Applies template        |
| **Section Generator** | AI-creates sections       | Based on context        |
| **Aggregator**        | Roll up child data        | Sums, averages, lists   |

---

## Integration Points

### Home Assistant

- Widget: `[HomeAssistant: entity_id="sensor.living_room_temp"]`
- Events: Subscribe to state changes
- Actions: Call services

### Calendar (Google/Outlook)

- Widget: `[Calendar: source="google" range="today"]`
- Events: Meeting starts, ends, created
- Actions: Create events, update attendees

### AI Models

- Widget: `[AI: model="claude" prompt="Summarize above transcript"]`
- Triggers: Section complete, widget value change
- Context: Automatic document context injection

### Webhooks

- Widget: `[Webhook: endpoint="/api/interviews" method="POST"]`
- Events: Receive incoming webhooks
- Actions: Send data to external services

### Task Managers (Todoist, Things, etc.)

- Widget: `[Task: service="todoist"]`
- Events: Task completed externally
- Actions: Create tasks from document content

---

## Template System

### Template Definition

```yaml
name: 'Interview Template'
trigger:
    title_pattern: '^Interview:.*'
    parent_folder: 'Interviews'

sections:
    - name: 'Recording'
      widgets:
          - type: audio_recorder
            on_stop:
                - transcribe
                - write_to: 'Transcript'

    - name: 'Questions'
      repeating: true
      widgets:
          - type: text
            label: 'Question'
          - type: dropdown
            options: ['Bad', 'Fair', 'Good', 'Great']
            on_change:
                - ai_summarize:
                      context: ['this_section', 'Transcript']
                      write_to: 'this_section.summary'

    - name: 'Transcript'
      generated: true

    - name: 'Overall Summary'
      widgets:
          - type: ai_summary
            trigger: 'all_questions_answered'
            context: ['all_sections']
```

### Inheritance

Documents can:

- Inherit from parent document templates
- Override specific sections/widgets
- Add additional widgets while keeping base template

---

## Technical Considerations

### State Management

- **CRDT-based**: Use Yjs or Automerge for conflict-free real-time sync
- **Local-first**: Full offline support with sync when connected
- **Event sourcing**: All changes as events for time-travel/undo

### Editor Framework

- Built on **BlockSuite** or **ProseMirror** for rich text editing
- Widgets as custom block types within the editor
- Markdown import/export with widget serialization

### Widget Runtime

- Sandboxed JavaScript execution for custom widgets
- React/Web Components for widget rendering
- PostMessage-based communication for security

### Data Storage

- Document content: SQLite/IndexedDB (local), PostgreSQL (server)
- Widget state: Embedded in document or separate widget store
- Media: S3-compatible blob storage

---

## MVP Scope

### Phase 1: Core Document + Basic Widgets

1. Block-based document editor
2. Inline widget embedding
3. Basic widgets: Text input, Dropdown, Button
4. Document context awareness (title parsing)
5. Simple event: widget change → write to document

### Phase 2: AI Integration

1. AI Summary widget
2. Audio recording + transcription
3. Context-aware AI prompts
4. Section generation

### Phase 3: External Integrations

1. Home Assistant widget
2. Calendar integration
3. Webhook support
4. Task manager sync

### Phase 4: Templates & Hierarchy

1. Template definition system
2. Parent-child document relationships
3. Aggregation widgets
4. Auto-creation from calendar

---

## Competitive Differentiation

| Feature                 | Living Documents | Notion         | Coda        | Observable    | Tana         |
| ----------------------- | ---------------- | -------------- | ----------- | ------------- | ------------ |
| Reactive widgets        | ✅ Native        | ❌ Embeds only | 🟡 Limited  | ✅ Code-based | 🟡 Supertags |
| Document context        | ✅ Smart         | ❌ Manual      | 🟡 Formulas | ❌ Code       | 🟡 Templates |
| Linear document flow    | ✅               | ✅             | ✅          | ❌ Cells      | ❌ Outliner  |
| No-code automations     | ✅               | 🟡 Buttons     | ✅          | ❌            | 🟡           |
| IoT integration         | ✅ Native        | ❌             | ❌          | ❌            | ❌           |
| Real-time external data | ✅               | ❌             | 🟡 Packs    | ✅            | ❌           |
| Local-first             | ✅               | ❌             | ❌          | ❌            | ❌           |

---

## Open Questions

1. **Widget SDK**: How open should the widget creation be? Full SDK vs. curated library?
2. **Sync conflicts**: How to handle conflicting widget state in real-time collaboration?
3. **Security**: How to sandbox widgets that access external APIs?
4. **Mobile**: Native widgets vs. web-based on mobile?
5. **Export**: How to export documents with widgets to static formats?

---

## Inspiration & Prior Art

- **Bret Victor's Reactive Documents & Tangle.js**: The original vision of documents as environments to think in
- **Observable/marimo**: Reactive notebooks with reactive cells
- **Coda Automations**: Event-driven document updates
- **Tana Supertags**: Context-aware structured data
- **Home Assistant Dashboards**: Real-time IoT widget cards
- **Notion Databases**: Structured data within documents
- **AFFiNE BlockSuite**: Block-based editing with database views

---

## Next Steps

1. Build proof-of-concept with:
    - ProseMirror/BlockNote editor
    - 3 basic widgets (dropdown, text, AI summary)
    - Title-based context detection
    - Simple event → document write flow

2. Validate interview use case end-to-end

3. Design widget SDK and contribution model

4. Explore Home Assistant integration patterns

---

_This is a living document. It will react and update as the project evolves._
