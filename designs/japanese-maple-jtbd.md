# Japanese Maple: jobs to be done

Fourteen jobs, built from the product docs in the `japanese-maple` repo (no JTBD list existed before this one). Each job is written as a job story, followed by the pages it flows through in the new design: every step opens inside the same notebook, in first place in the row of open pages, and the page before it moves one place right. Screen `08 Jobs to be done` in `japanese-maple-mercury-ui.sketch` draws the same list.

Wording follows Maple: notebook, page, memo, chat, data page.

## Who the jobs belong to

- **Individuals** who want a private, offline-first place for notes, tasks and voice memos.
- **Small teams** who want a project's discussion and documents in one permissioned place.
- **Privacy-conscious people and self-hosters.**
- **A household person** using a Mac and an iPhone, with family logistics, mail and a calendar.
- **Collectors**, and people with structured data who want a view of it without writing code.

## Keep the work together

| #   | Job story                                                                                                                   | Flow of pages                      | Source                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------ |
| 1   | When my notes are in one app and the discussion is in another, I want both in one notebook, so the context is never lost.   | Memo → Chat → Thread               | `docs/PRODUCT_SUMMARY.md` (the problem it solves)            |
| 2   | When I start a project with others, I want to invite them with a role, so each person can do exactly what they should.      | Notebook overview → Sharing → Chat | `docs/feature-sharing.md`, `docs/feature-notebooks.md`       |
| 3   | When I write the same kind of page again, I want to start from a template, so my meeting notes and reviews stay consistent. | New page → Template → Memo         | `docs/feature-templates.md`, `docs/product-features-spec.md` |

## Capture and think

| #   | Job story                                                                                                                                          | Flow of pages                   | Source                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| 4   | When a meeting, interview or lecture starts, I want to record it without the audio leaving my device, so I get a transcript I can search and edit. | Memo → Recording → Memo → Todos | `docs/feature-recording.md`, `docs/feature-transcription.md`  |
| 5   | When words are not enough, I want to sketch beside the memo, so the drawing and the text stay together.                                            | Memo → Whiteboard → Memo        | `docs/feature-whiteboard.md`                                  |
| 6   | When I am stuck on a paragraph, I want AI to continue, improve or translate it, so I can accept or reject the result and keep going.               | Memo → AI writing → Memo        | `docs/product-features-spec.md`, `docs/feature-ai-writing.md` |

## Stay on top

| #   | Job story                                                                                                                                         | Flow of pages                    | Source                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| 7   | When my tasks are spread over many projects, I want one list across notebooks, so nothing overdue hides inside a memo.                            | Today → Todos → Memo             | `docs/feature-todos.md`, `docs/overview.md`                                           |
| 8   | When my phone already buzzed for every text and email, I want Maple to tell me only what I may have missed, so I can answer the one that matters. | Chat → Data page → Drafted reply | `CLAUDE.md` (Proactive Timing, Drafted replies)                                       |
| 9   | When I half remember something, I want to describe it, so I do not need to know which notebook holds it.                                          | Search → Memo → Graph            | `docs/feature-search.md`, `docs/feature-links.md`, `docs/feature-connection-graph.md` |

## Let bots help, keep the decision

| #   | Job story                                                                                                                | Flow of pages                          | Source                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------- |
| 10  | When I need a fact buried in my own messages, I want to ask a bot from any device, so I get the answer with its sources. | Chat → Answer with sources → Data page | `docs/local-data-sources-plan.md`, `docs/mac-data-cloud-plan.md` |
| 11  | When a bot spots something I should act on, I want it to propose and wait, so the decision stays mine and I can undo it. | Chat → Proposal → Activity             | `CLAUDE.md` (Add to calendar, Home Assistant, Bot action log)    |
| 12  | When a notebook needs my mail or calendar, I want to pick exactly what it shares, so others and bots see only that.      | Data page → Sharing → Chat             | `CLAUDE.md` (Data Page Sharing)                                  |

## Track structured things

| #   | Job story                                                                                                      | Flow of pages                            | Source                                             |
| --- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| 13  | When I buy, want or sell an item, I want to scan it, so my collection and its value stay up to date.           | Barcode scan → Collectible → Collection  | `docs/feature-collectibles.md`                     |
| 14  | When I have structured data, I want to describe the view I need, so I get a live dashboard instead of a table. | JSON → Canvas (ask) → Canvas (dashboard) | `docs/canvas-prd.md`, `docs/feature-json-pages.md` |

## What every job must respect

These are not jobs; they are the worries the docs return to most, and each flow has to hold under them.

- **It works with no connection.** Changes sync later (`docs/feature-offline.md`).
- **Audio stays on the device** during transcription.
- **Bots ask first.** The default is "Ask every time"; sending, unlocking and opening doors always ask. Maple never sends a message: the person presses send.
- **A data page shares nothing until its creator picks what to share.**
- **Notifications carry no content**, and sign-in uses passkeys.
- **Bots do not spam.** Missed-only posting, quiet hours, one message per pile.

## Steps that are not pages today

The flows above treat these as cards so each job reads end to end, but they are not page types in the product:

- **Today** spans notebooks; it is a view, not a page inside one.
- **Sharing** is a panel on a notebook or a data page.
- **Template**, **AI writing**, **Search** and **Barcode scan** are actions that open over a page.
- **Proposal**, **Drafted reply** and **Answer with sources** are cards a bot attaches to a chat message.

## Left out on purpose

Planned or unbuilt in the docs, so not presented as current jobs: recurring todos and reminders, page-level sharing, inline comments, export and importers, an Android app, the widget marketplace, leave-now reminders based on travel time, and the interview hub and auto-emailed summaries from the "Living Documents" vision spec.
