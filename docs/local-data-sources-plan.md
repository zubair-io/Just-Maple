# Local Data Sources & Proactive Bots — Plan

Status: draft, 2026-10-23. Branch `feature/notebook-local-ai-search-11629a`.

## Summary

Your Mac reads iMessage, Mail and Calendar into a private database that never leaves it. A notebook can show that data as local-only table pages. A bot in a messages page can search it, from any device, and one bot per messages page can be set to **proactive**, so it posts when something worth knowing arrives.

1. **Collect.** The Mac app reads Messages, Mail and Calendar directly from disk (the last 30 days at first), and keeps reading as new items arrive.
2. **Store and index.** Everything goes into a native SQLite database on the Mac, split into searchable chunks with Apple's on-device embedding model. No network is used for this step.
3. **Show.** In the Mac app, **+ New → iMessage / Email / Calendar** creates a local page with a live table. These pages exist only on the Mac and create no cloud record.
4. **Ask.** When you @mention the bot in a messages page (phone, web or Mac), the server runs whatever model that bot is set to use. Each time the bot needs data, the server asks your Mac over the live connection, and the Mac returns only the matching snippets.
5. **Proactive.** The Mac collects new or changed items into a batch every few minutes and sends that batch up. The proactive bot reads it with its own model and your instructions, and either posts a message or stays quiet.
6. **Show, not just tell.** Replies can include OpenUI blocks (cards, tables, follow-up buttons, small forms) when that reads better than text, for example a week of games as a table, or "Want help with any of these?" as buttons.

If the Mac is asleep or offline, nothing updates and nothing proactive fires. Questions get a reply saying the Mac can't be reached.

## Decisions so far

| Topic                 | Decision                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Local storage         | Native SQLite on the Mac. Not IndexedDB.                                                                                                        |
| What goes to cloud    | Bot messages and replies live in the cloud, as today. The raw database never leaves the Mac.                                                    |
| Model                 | Whatever model the bot is configured with (provider and model per bot). No model is hard-coded. Calls cost money, so proactive work is batched. |
| Rich replies          | Bots can answer with OpenUI blocks when useful.                                                                                                 |
| Devices               | One Mac holds the data. Phones and the web ask that Mac.                                                                                        |
| Sources (v1)          | iMessage, Mail (via the Mail app's local store), Calendar (via Apple's calendar framework).                                                     |
| Initial import        | Last 30 days.                                                                                                                                   |
| Per-notebook filters  | Out of scope. Every notebook sees all of the data.                                                                                              |
| Proactive triggers    | New or changed data, and @mentions. Scheduled briefs come in the next version.                                                                  |
| Bot memory            | Corrections ("he's not doing that anymore") are added to the proactive instructions, where you can see and edit them.                           |
| Quiet hours / caps    | Not needed.                                                                                                                                     |
| Source links on phone | Allowed to show as "open on your Mac". No fallback quote needed.                                                                                |
| Local pages           | Visible only on the Mac. No cloud record.                                                                                                       |
| Distribution          | Shipped outside the App Store, so the app is not sandboxed and can read Messages and Mail.                                                      |
| Write actions         | None. The app never sends, replies, archives or deletes anything.                                                                               |

## Components

### A. Local database (Mac, native)

This is a new Swift module in `apps/apple/JapaneseMaple`. Its database file lives in Application Support.

- **`items`**: one row per message, email or event. Columns: `id`, `source` (imessage, mail, calendar), `external_id`, `revision`, `occurred_at`, `title`/subject, `from`, `participants`, `body`, `url_hint`, `json`.
- **`chunks`**: embedding vectors for each item. This reuses Jev's approach (`SemanticIndex.swift`): Apple's built-in English sentence embeddings, overlapping 200-word windows, and normalized vectors with cosine scoring.
- **`change_log`**: items added, changed or removed since the last proactive batch.
- **`checkpoints`**: where each reader left off.
- **`pages`**: the registry of local pages (`id`, `notebookId`, `source`, `title`, `createdAt`).

Search is hybrid: embedding similarity plus plain keyword matching, with filters for source and date range. Keyword matching matters for names, order numbers and places, where embeddings are weak.

Reusable from Jev: the checkpoint and batch-import pattern (`IMessageConnector.swift`), `SemanticIndex.swift`, and the EventKit usage in `AppleConnectors.swift`.

### B. Readers

| Source   | Where it reads                                                                 | How it notices changes                                               |
| -------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| iMessage | `~/Library/Messages/chat.db`, read-only                                        | Watches the database files for writes; polls every 60s as a fallback |
| Mail     | Mail's local index plus one message file per email, under `~/Library/Mail/V*/` | Watches the index for writes; polls every 60s as a fallback          |
| Calendar | Apple's calendar framework, covering every account on the Mac                  | The framework's own change notification                              |

- Messages and Mail both need **Full Disk Access**. The app detects when it's missing and opens the right System Settings pane, with an explanation.
- On recent macOS versions, iMessage text often sits in an encoded field rather than plain text, so the reader must decode it. It also handles edited and unsent messages as new revisions.
- Mail's file layout is undocumented. The reader detects the version folder and refuses, with a clear message, when it finds a layout it doesn't know. When a message moves or is deleted, it's removed from the index.
- Repeating calendar events are expanded across the indexed window.

### C. Local pages in the UI (Mac only)

- `new-page-button.component.ts` adds **New iMessage**, **New Email** and **New Calendar**, shown only when the native bridge reports macOS.
- Creating one calls the bridge, which writes to the `pages` table. **No server call is made.**
- The sidebar merges local pages into the notebook's page list on the Mac.
- A new route, `/:notebookId/mac/:id`, uses route guards to load one of three new page components: `imessage-view`, `mail-view` and `calendar-view`. Each one only shows a table.
- Tables page through results with bridge calls (`localData.query`). Native code pushes a "changed" event, and the open table refreshes.
- Source links in bot replies (for example `maple-local://item/<id>`) open the matching row on the Mac. Other devices show "open on your Mac".
- A notebook with no local pages exposes no local data to its bots. So adding a local page is how a notebook gets access to that source.

### D. Proactive setting on a messages page (cloud)

When you share a messages page with a bot, the page gains:

```ts
proactive?: {
    userBotId: string; // only one per messages page
    instructions: string; // user-written, plus remembered corrections
    enabled: boolean;
};
```

This needs a shared schema in `packages/shared/src/schemas/page.ts`, an API route to set and clear it, and a toggle with an instructions box in the share UI. Turning proactive on for a second bot replaces the first.

### E. Mac ↔ server relay

- The native Mac app opens its own realtime connection, using the token it already stores, and registers as the user's **local data host**. Because it's native, it doesn't depend on the web page being loaded.
- The server sends `localData.search { requestId, query, sources, from, to, limit }` and `localData.get { requestId, itemId }`. The Mac answers with `localData.result { requestId, items }`.
- The API runs on more than one instance, and they share state through Redis pub/sub. So a request may reach a different instance from the one holding the Mac's connection. Requests and replies therefore travel over Redis with a per-request id and a 10-second timeout. On timeout, the bot says it can't reach your Mac.
- Results are capped at around 20 snippets of about 500 characters each, so a reply never sends a large amount of data.

### F. Bot runs with local data

**Depends on the OpenUI branch.** Per-bot provider and model selection and OpenUI replies are built on `codex/openui-bot-model-settings` (commit `27f1b23f`), which is not on `main` yet. Phase 1 below is Mac-only and doesn't need it. Phases 2 and 3 should start from that branch, or after it merges.

- The bot uses its own configured provider and model, as set up on that branch (Anthropic or OpenAI, with the model list loaded from the provider). The local-data path adds three tools in each provider's native tool-calling format: `search_local_data`, `get_local_item` and (for proactive runs) `remember_instruction`.
- It runs a short tool loop (a few rounds at most) and then produces the final answer.
- **It does not use the Claude Agent SDK path** (the `claude_code` preset with all permission checks bypassed). Fed with untrusted email text, a malicious email could make that path run tools on the server.
- The system prompt includes today's date and time zone, the page's proactive instructions, the recent bot messages in the page (so the bot doesn't repeat itself), and the OpenUI prompt from `bot-ui.service.ts` unless the bot is set to text-only replies.
- Replies go through the existing OpenUI parsing and are stored as the message's `botUI`, so phone, web and Mac render them the same way.

### F2. OpenUI in local-data replies

The branch's OpenUI library has `Text`, `Card`, `Table`, `Button` and `Form`. This feature uses them as follows:

- **`Table`**: schedules, lists of deliveries, "what's happening the week of Oct 19".
- **`Button`**: offers like "Want help with any of these?" or "Did you make this change?" ("Yes, that was me"). The click sends a follow-up message, and that runs the bot again.
- **`Card`**: one item with its details (an address, a pickup notice).
- **New `Source` component**: a label plus a local item id. On the Mac it opens the matching row in the iMessage, Email or Calendar page. Elsewhere it shows "open on your Mac". This is added to the library so the model doesn't have to put raw links in text.
- `Form` must never ask for passwords or keys, which the library already tells the model. Local-data bots don't need forms in v1.

### G. Proactive pipeline

1. The Mac adds new or changed items to `change_log`.
2. Every 5 minutes (a setting), it builds a batch, but only if something changed. A cheap local filter runs first: it drops your own sent messages, bulk or promotional mail (via unsubscribe headers and Mail's own categories), and events changed only by sync noise.
3. It sends the batch to `POST /api/local-data/changes`. Each entry is compact: source, sender, subject, a snippet of about 500 characters, time and item id.
4. For each notebook with local pages and a messages page with an enabled proactive bot, the server runs that bot once with the batch. The bot replies either with nothing to post or with a short message.
5. Bot messages use the existing message, push notification and badge paths.
6. When you reply to a proactive message with a correction, the bot may call `remember_instruction`, which appends a line to the page's instructions.

Cost controls: one model call per batch per proactive page, the local filter before any call, prompt caching on the system prompt and instructions, and a cap on batch size. Oversized batches are split, newest first.

## Edge cases and safety

- **The Mac is asleep, offline, or the app is quit:** no updates or proactive messages, and questions get a "can't reach your Mac" reply. Changes are batched on wake, but anything older than 24 hours is indexed without proactive alerts, so you don't get a flood.
- **Full Disk Access revoked:** that reader pauses and shows an error on its local page. Nothing already in the index is deleted.
- **Duplicate or overlapping reads:** items are de-duplicated by source, external id and revision, as Jev does.
- **Prompt injection:** email and message text is treated as data. The bot's only tools are read-only searches and `remember_instruction`, so a hostile email can at worst make the bot post something odd in your page.
- **Private text in the cloud:** only bot replies and transient batches pass through the server. Batches must never be persisted or logged. The executor currently logs freely, so the new path must not log item bodies.

## Gotchas and risks

- **Mail's local format is undocumented** and has changed between macOS versions. The Mail reader needs fixture tests and a version check.
- **iMessage's encoded text field** is also undocumented, and macOS updates can break the decoder.
- **The on-device embeddings are English-only.** Messages in other languages will search poorly, though keyword matching still finds exact names.
- **Calendar invites from a work account** only appear if that account is added to Calendar on the Mac.

## Phases

1. **Local data on the Mac:** the database, the three readers, Full Disk Access onboarding, the three local page types with live tables. No AI yet.
2. **Ask from anywhere:** the embedding index, the relay, and @mention bots answering from local data with their own model, OpenUI replies and `Source` links. Starts from the OpenUI branch.
3. **Proactive:** the proactive setting on messages pages, batching and filtering, proactive runs, and remembered corrections.
4. **Later:** scheduled briefs, per-notebook filters, more sources.

## Open questions

1. **Which bots get the local-data tools?** Recommended: built-in LLM bots only. Custom webhook bots run on someone else's server, so giving them your data would mean sending it out.
2. **Can a non-proactive bot @mentioned in the same page also search?** Recommended: yes. Proactive only controls who speaks unprompted.
3. **Do edits to notes in the notebook wake the proactive bot?** Assumed no for v1: only iMessage, Mail and Calendar changes do.
4. **What about bots on the Inception provider?** Its path on the OpenUI branch skips OpenUI. If it also can't call tools, those bots can't search local data. Recommended: hide the proactive toggle for providers without tool calling.
5. **Where should this work land?** Recommended: merge `codex/openui-bot-model-settings` into `main` first, then branch phases 2 and 3 from `main`.
