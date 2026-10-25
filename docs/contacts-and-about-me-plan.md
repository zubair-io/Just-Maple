# Contacts and "About me" — plan

## In short

1. **Contacts** becomes a fourth Mac data source next to iMessage, Mail and Calendar. The Mac reads every card from the Contacts app into its local database. You can add a Contacts page from "+ New", bots can search it, and iMessage and Mail senders show real names instead of phone numbers and email addresses.
2. **About me** is a profile of you and your people that bots keep up to date. It is stored in the cloud with your account, so bots can use it from any device, even while the Mac is asleep. It has three layers:
    - **People and relationships**: you, Julia (spouse), Emma (daughter), Biscuit (dog), Coach Dan (Emma's soccer coach).
    - **Lasting facts**: your home address, that you have pets, that you like to work out in the afternoon.
    - **Current situation**: facts with an end date, like "traveling to Denver until Friday". They expire on their own.
3. **It starts when you turn on your first proactive bot.** It is seeded from your own contact card and the relationships on it, then grows as bots learn things. Learned facts are saved right away and shown in a "Recently learned" feed, where you can edit or undo them. Sensitive facts (health, money, and the like) are asked about first.
4. **Bots use it to make judgment calls.** Every bot reply and proactive run gets a short summary of who you are and what's happening now, plus tools to look up more and to save new facts. With location later on ("you're at home"), a proactive bot can say "leave now for Emma's 3:00 game".

## 1. Contacts (Mac data source)

**What's read.** Each Contacts card becomes one item:

- name, nickname, organization, job title
- phones, emails, postal addresses
- birthday and dates
- **related names** (spouse, child, parent, assistant…)
- social profiles
- whether it is your own "me" card

Photos and notes are left out. Notes can hold sensitive text and need extra permission.

**How it fits the existing pieces.**

- `MacDataSource.contacts` and a `ContactsReader` that follows the `CalendarReader` pattern: Apple's Contacts framework (`CNContactStore`), access asked for on first use, and a store-changed notification to re-read.
- Needs the `com.apple.security.personal-information.addressbook` entitlement and an `NSContactsUsageDescription` string ("Maple reads your contacts so bots know who people are").
- Items are embedded and searchable like the other sources. A "+ New → Contacts" page shows a table of cards.
- **Sender names.** The store keeps a phone/email → contact lookup. iMessage items and Mail senders get a display name from it when read, so bots see "Julia" instead of "+1 555…".
- Bot tools: `search_local_data` gains the `contacts` source, and `get_local_item` returns a full card.

**Privacy.** Raw contacts never leave the Mac except as search results for a bot, the same as messages. Only the people you're connected to (your spouse, kids and other family) are copied into About me, and only the fields bots need.

## 2. About me (cloud profile)

### Data model

Three collections, all scoped to one user:

| Collection          | Holds                                                        | Example                                                                                |
| ------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `profile_entities`  | People, pets, places and organizations, with you as the root | `{ kind: 'person', name: 'Emma', aliases: ['Em'], contactId? }`                        |
| `profile_relations` | Edges between entities                                       | `{ from: me, to: Emma, type: 'child' }`, `{ from: Emma, to: Hawks, type: 'plays_on' }` |
| `profile_facts`     | Facts about one entity                                       | `{ about: me, key: 'home_address', value: '…', kind: 'lasting' }`                      |

Each fact records:

- `kind`: `lasting` or `current`
- `validFrom` and `validUntil`: current facts expire; lasting ones don't
- `source`: `contacts`, `you`, `bot:<id>` or `calendar`, plus a link to the message or item it came from
- `confidence`
- `sensitive`
- `updatedAt`, plus `replacedBy` when a newer fact replaces it

Facts are never deleted silently. A replaced fact stays in the history, so "undo" and "why does it think that?" both work.

Cosmos DB notes: these are plain per-user documents queried by `userId`, with filtering and sorting done in code, as elsewhere.

### How it gets filled

1. **Seed**, the first time you turn on a proactive bot. The API asks the owner's Mac (new relay request `profileSeed`) for:
    - your "me" card: name, address, birthday
    - its related names, with each matching card
    - recurring calendar events, such as "Soccer practice, Tuesdays at 4"

    That's enough to create you, your family, your home and your routines.

2. **Learning while bots work.** A new bot tool, `remember_about_me(fact)`, joins `remember_instruction`. A bot calls it when it notices something worth keeping: "I'm in Denver until Friday" becomes a current fact that ends on Friday. A second tool, `update_about_me`, changes or ends an existing fact.
3. **Proactive runs.** When new Mac data arrives, the proactive prompt also asks: "Did anything here change what you know about the user or their people?" The answers go through the same tools.
4. **You.** The About me page lets you add, edit and remove facts and people directly.

### Review and safety

- New facts are saved immediately and appear in **Recently learned** on the About me page, each with **Undo** and **Edit**.
- Facts the model marks `sensitive` (health, money, legal, relationships in trouble) are **suggested, not saved**, until you approve them.
- Every fact keeps where it came from. A bot can explain why it believes something, and you can see which message it came from.
- Only the owner's bots read or write their About me. A bot shared into your notebook by someone else never sees it.

### How bots use it

- **Short summary in every prompt.** About 300 words: who you are, your people and how they relate, key lasting facts, and every current fact that hasn't expired. The newest and most relevant come first.
- **Lookup tool** `recall_about_me(query)` for anything not in the summary ("what's Emma's coach's name?").
- **Judgment.** The proactive prompt is told to combine the profile with what's new. For example: calendar says "Emma soccer 3:00 at Riverside Park", current location is home, and home to the park takes 25 minutes, so remind you at 2:25. Location and travel time arrive in a later phase.

### About me page

An "About me" item under Settings (not a notebook page):

- **You and your people:** a simple relationship view (you in the middle, family around you).
- **Facts:** grouped as Lasting and Right now, with expiry dates shown.
- **Recently learned:** a feed with Undo and Edit.
- **Waiting for approval:** the sensitive suggestions.

## 3. Location (later phase, designed for now)

- The phone app reports **places, not coordinates**: "home", "work", "Riverside Park", or "away". It does this only when the place changes, using iOS region monitoring.
- Each report is written as a current fact: `{ about: me, key: 'location', value: 'home', validUntil: next update }`.
- A place change also triggers a proactive run, so "you're home and the game is in 40 minutes" can be noticed.
- Travel time comes from Apple Maps on the device or a server-side directions API. That decision is deferred.

## Build order

Both parts are built together, in this order inside one branch:

1. **Shared types:** contact item, profile entity, relation and fact schemas in `@maple/shared`.
2. **Contacts on the Mac:** reader, entitlement, store, sender names, page, search. Tests use a fake contact store.
3. **About me API:** repositories, the seed relay request, the summary builder, and the three bot tools. The tools are wired into the Claude, OpenAI and chat-completions loops, and the summary is added to prompts. Tests cover expiry, replacement, sensitive suggestions and owner-only access.
4. **Trigger:** turning on the first proactive bot creates and seeds About me.
5. **About me page** on the web: facts, people, Recently learned, approvals.
6. **Check against real data:** seed from your Contacts, run a proactive pass, and confirm what was learned and that undo works.

## Open questions (later)

- Should family members be able to see or add to the profile (for example, Julia adding her own travel)? For now it's single-owner.
- How long to keep replaced facts. For now, forever, while they're small.
- Which travel-time source to use for location reminders.
