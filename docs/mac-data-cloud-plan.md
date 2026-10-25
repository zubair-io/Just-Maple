# Device data in the cloud — plan

## In short

1. **Devices are collectors; the server answers.** Each device collects the data only it can see and uploads it:
    - **Mac:** iMessage, Mail, Calendar and Contacts.
    - **iPhone:** Location (places and visits) and Health (summaries).

    Devices build the search vectors themselves, for free, and upload them with each item. Bots search the server copy, so they work from any device **while that device is asleep**.

2. **What's kept: the last 30 days of everything.** That covers messages, mail and past events. Contacts and future calendar events are kept for as long as they exist. Older items are removed as they age out, and anything deleted on the Mac is deleted in the cloud too.
3. **The pages work everywhere.** Messages, Mail, Calendar and Contacts pages become normal notebook pages, so you can open them on your phone. In a shared notebook only you see your data; other members see that the page exists, nothing more.
4. **Custom AI bots run only on the server, over http or https.** The Mac hand-off for local servers is removed. The server can call any internet address it can reach. Your own machine and home-network addresses are refused, so Ollama needs a public or tunnel URL (for example Tailscale Funnel or a Cloudflare Tunnel).

## How it works

### Collectors

- A **collector** is a signed-in device that collects some sources. It registers with `POST /api/collectors`, sending `{ deviceId, platform, name, sources }`, and from then on uploads items for those sources. Settings → Devices lists each collector, what it collects, when it last uploaded, and whether it's online.
- **One collector per source.** If two devices could collect the same source, one is chosen and the other stays idle until you switch. For example, calendar could come from both the Mac and the iPhone through iCloud; collecting it twice would create duplicates.
- Every item records which device collected it. Removing a device from the list deletes what it uploaded.
- The upload API, storage, retention, search and bot tools below work the same for every collector and source. A new source is a new reader on a device, not a new pipeline.

### iPhone sources

- **Location: places and visits.**
    - Uses Apple's battery-friendly visit tracking (`CLVisit`) plus monitoring of the places you name (home, work, school, Riverside Park). There is no continuous GPS trail.
    - Each visit is an item: place name (or address), arrival time and departure time.
    - Arriving at or leaving a named place also updates your **current place** in About me (`location: home`) and triggers a proactive run. That's what makes "you're home and Emma's game is in 40 minutes, time to leave" possible.
    - Visits follow the same 30-day window. Named places are kept.
    - The app asks for "Always" location permission, explaining why. Without it, only places visited while the app is open are recorded.
- **Health: daily summaries, not raw samples.**
    - One item per day: steps, active minutes, workouts (type, time, length), sleep (bedtime, wake time, hours) and resting heart rate.
    - Workouts are also kept as their own items, so "did I work out this afternoon?" works.
    - Health data counts as **sensitive**. It's only uploaded for sources you switch on one by one. Bots can read it, but About me only learns from it with your approval (for example, "works out most afternoons").
    - Uses HealthKit with read-only permission for just those types.
- **Background uploads.** iOS limits background work, so uploads go through a background session after each visit or once a day for health. Anything missed is sent the next time the app opens.

### Upload (device → server)

The Mac's details are below. The iPhone uploads the same way, with its own staging store and cursor.

- The Mac keeps its local database as a **staging area and change log**. It already records every add, change and removal with an increasing number.
- After each read pass, the Mac sends the changes since its last confirmed number to `POST /api/mac-data/items`:
    - `{ upserts: [item…], removals: [id…], cursor }`, in batches of about 200
    - the server writes them, then confirms the cursor
    - an interrupted upload resumes from the last confirmed number
- **Vectors follow the text.** An item is uploaded as soon as it's read, so keyword search works right away. Its vectors, about 2 KB each as compact binary, follow once the Mac has embedded it.
- On first run, the full 30-day window is uploaded, along with all contacts and upcoming events. The upload shows progress on the Mac page.

### Storage (server)

- New collection **`mac_items`**, one document per item:
    - `userId`, `id` (`mail:…`, `imessage:…`), `source`, `revision`
    - `occurredAt`, `endAt`, `title`, `sender`, `participants`, `body`, plus the source-specific fields
    - `vectors` (base64 float32), `embeddedRevision`, `updatedAt`
- Lookups are by `userId`, `source` and time, with sorting done in code, following the Cosmos DB rules in CLAUDE.md.
- **Retention job** (hourly): removes items older than 30 days, except contacts and events that haven't ended. The Mac applies the same rule locally, so it doesn't re-upload them.
- **"Remove my Mac data from the cloud"** button: deletes everything, and the Mac stops uploading until you turn it back on.
- Azure encrypts data at rest. App-level encryption with a per-user key is possible later; it isn't in this round.

### Search (server)

- Search moves from the Mac to the API. It's the same ranking as today, keyword matches plus meaning, done in code.
- Loading a user's items for each search would be slow and costly on Cosmos DB. So each API instance keeps a **per-user in-memory index** that refreshes when new uploads arrive, using Redis to tell the other instances. A typical month is about 3,000 items and 6 MB of vectors per user.
- **The query's own vector.** Item vectors come from Apple's on-device model, so the query has to be embedded the same way. Two options, decided during the build:
    1. If any of your collectors is online, Mac or iPhone, it embeds the query (quick). Both have the same Apple model.
    2. Otherwise, search falls back to keyword-only ranking. That still works well for names, places and dates.

    A hosted embedding model for both sides would remove this gap, at a small cost per item. It's noted as a later option.

### Bots and proactive

- `search_local_data` and `get_local_item` read `mac_items`, not the Mac. Their names and behavior stay the same.
- **Proactive runs are triggered by uploads.** When an upload adds or changes items, the server runs proactive bots for notebooks that cover those sources. The Mac no longer sends "changes" batches. Old backlog is still skipped (anything older than 24 hours isn't news).
- Notebook scoping stays the same: a notebook's bots see only the sources it has pages for, and only for that page's owner.

### Pages

- Messages, Mail, Calendar and Contacts pages become **cloud pages** with a type (`imessage`, `mail`, `calendar`, `contacts`) and an owner.
- The table views read `GET /api/mac-data/items?source=…&from=…&to=…` instead of the Mac bridge, so they work on the phone.
- Only the owner can open the data. Others in a shared notebook see "Julia's Messages — only Julia can see this".
- **Migration:** the first time the updated Mac app runs, it creates a cloud page for each of its local pages, with the same title and notebook, then removes the local record.

### Custom AI bots (server only)

- `http://` is allowed for internet hosts. The dialog warns that the key travels unencrypted, and suggests https or a tunnel.
- Localhost, private, link-local and `.local` addresses are refused, with a hint: "The server can't reach your own machine. Expose Ollama with a tunnel and use that URL."
- Removed:
    - the Mac `http` relay request and `macHttpSend`
    - `MacDataLocalHTTP` in the Mac app
    - the local-server branch in the executor and the model list

## What goes away

- The relay requests `info`, `search`, `get` and `http`, and the "changes" batches. The Mac's socket shrinks to presence ("this Mac is online, last upload at…") plus query embedding.
- `MacDataPageGuard` and the Mac-only page store.
- The "bots can't read your Mac while it sleeps" limitation.

## Effect on the Contacts and About me plan

- **Contacts** are uploaded like the other sources, and sender names are filled in on the server. The Contacts page works on the phone too.
- **About me** seeds from the cloud copy of your contacts and calendar, with no Mac needed. Everything else in that plan stays: people, lasting facts, current facts, Recently learned, sensitive approvals.

## Build order

1. **Server storage and upload API:** `mac_items`, the upload endpoint, retention, delete-all, and tests.
2. **Mac uploader:** upload changes after each pass, resume from the cursor, upload vectors after embedding, apply the same 30-day rule, show progress. Tests use a fake server.
3. **Server search and bot tools** on the cloud copy: the in-memory index, the query vector from the Mac when online, and keyword-only fallback otherwise.
4. **Proactive runs triggered by uploads**, replacing the Mac's "changes" batches.
5. **Cloud pages:** page types, owner-only access, table views from the API, and migration of the existing Mac pages.
6. **Custom bots server-only:** allow http for internet hosts, refuse local addresses, and remove the Mac http relay.
7. **Contacts** (new source, uploaded) and **About me** (from the other plan).
8. **Collectors registry:** the Devices list, one collector per source, removing a device.
9. **iPhone collectors:**
    - **Location:** visits and named places, your current place in About me, proactive runs on arrive and leave.
    - **Health:** daily summaries and workouts, with per-type permissions.
10. **Check against real data:** your Mac uploads 30 days, bots answer with the Mac asleep, the phone shows the pages, an arrival at home updates your current place, and deletes and aging out work.
