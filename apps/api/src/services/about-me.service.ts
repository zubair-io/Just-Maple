import type {
    AboutMe,
    MacDataItem,
    ProfileEntity,
    ProfileFact,
    ProfileFactSource,
} from '@maple/shared';
import {
    addRelation,
    createEntity,
    findFactInNotebook,
    findMe,
    listPlaces,
    listEntities,
    listFacts,
    listRelations,
    normalizeKey,
    profileOwnerIds,
    saveFact,
    updateFact,
    type ProfileScope,
} from '../repositories/profile.repo';
import {
    findContactsByName,
    findDeviceItems,
    findMyContactCard,
} from '../repositories/device-item.repo';
import { findUserById } from '../repositories/user.repo';
import { collectorTimeZone } from '../repositories/collector.repo';
import { findNotebookByIdUnsafe } from '../repositories/notebook.repo';
import { isNotebookShared, notebookMemberIds } from '../utils/notebook-sharing';
import { formatInZone, toEpochSeconds } from '../utils/time-zone';

/**
 * About me: what bots know about each member of a notebook and their people.
 *
 * 1. It lives on a notebook's About me page (one per notebook). Each member has their
 *    own; the page shows each person only theirs. Adding the page seeds the creator's
 *    from their own contact card (name, address, birthday, related names) and recurring
 *    calendar events.
 * 2. Bots in that notebook read a short summary of every member's in each prompt, look
 *    up more with `recall_about_me`, and save what they learn with `remember_about_me`.
 *    In a notebook nobody else can see, sensitive facts wait for approval; in a shared
 *    one they're never saved.
 * 3. "Where you are now" isn't stored: it's read live from the user's latest visit.
 */

const RECENTLY_LEARNED_DAYS = 14;
const SUMMARY_MAX_FACTS = 25;
/** An open visit counts as "where you are" for this long without a departure. */
const CURRENT_PLACE_HOURS = 12;

const SENSITIVE_IN_SHARED =
    'Not saved: this notebook is shared with other people, so sensitive things (health, money, legal matters, relationship trouble) are never kept in its About me.';
const WHEREABOUTS_IN_SHARED =
    "Not saved: this notebook is shared with other people, so where someone is or is traveling isn't kept in its About me.";

/**
 * Words that mark a fact as health, money, legal or relationship trouble. A backstop for
 * shared notebooks when the model doesn't flag a fact as sensitive; it errs on refusing.
 */
const SENSITIVE_WORDS = new RegExp(
    '\\b(' +
        [
            // health
            'sick|ill|illness|flu|covid|fever|cancer|tumou?r|diagnos\\w*|surgery|hospital\\w*',
            'doctor|therap\\w*|medicat\\w*|medicine|prescription\\w*|pregnan\\w*|miscarriage',
            'injur\\w*|allerg\\w*|disease|disorder|symptoms?|diabet\\w*|depress\\w*|anxiety',
            'mental|rehab|addict\\w*|health|medical',
            // money
            'salary|income|debts?|loans?|mortgage|bank account|credit card|bankrupt\\w*|owes?',
            'paycheck|taxes|ssn',
            // legal
            'lawsuit|lawyer|attorney|court date|court case|arrest\\w*|custody|sued|legal|police',
            // relationship trouble
            'divorc\\w*|separated|separation|break ?up|broke up|affair|cheat\\w*|counseling',
        ].join('|') +
        ')\\b',
    'i',
);

/** Words that say where someone is right now, for current facts. */
const WHEREABOUTS_WORDS =
    /\b(location|whereabouts|travel\w*|trip|vacation|holiday|staying|visiting|out of town|abroad|at home|currently (in|at))\b/i;

/** Why a fact can't be saved in a shared notebook, or null when it can. */
export function sharedRefusal(input: {
    key: string;
    value: string;
    kind: 'lasting' | 'current';
    sensitive?: boolean;
}): string | null {
    const text = `${input.key.replace(/_/g, ' ')} ${input.value}`;
    if (input.sensitive || SENSITIVE_WORDS.test(text)) return SENSITIVE_IN_SHARED;
    if (input.kind === 'current' && WHEREABOUTS_WORDS.test(text)) return WHEREABOUTS_IN_SHARED;
    return null;
}

// MARK: - Reading

/** Current facts that haven't expired, plus every lasting fact. */
export function isLive(fact: ProfileFact, now = Date.now()): boolean {
    if (fact.status !== 'active') return false;
    return !fact.validUntil || Date.parse(fact.validUntil) > now;
}

/**
 * One person's About me in one notebook. While the notebook is shared, sensitive facts
 * (and suggestions) saved while it was private are hidden; they come back if it becomes
 * private again.
 */
export async function getAboutMe(
    scope: ProfileScope,
    now = Date.now(),
    options: { shared?: boolean } = {},
): Promise<AboutMe> {
    const [me, entities, relations, stored] = await Promise.all([
        findMe(scope),
        listEntities(scope),
        listRelations(scope),
        listFacts(scope),
    ]);
    const facts = options.shared ? stored.filter((fact) => !fact.sensitive) : stored;
    const since = now - RECENTLY_LEARNED_DAYS * 24 * 60 * 60 * 1000;
    return {
        me,
        entities,
        relations,
        facts: facts.filter((fact) => isLive(fact, now)).sort(newestFirst),
        pending: facts.filter((fact) => fact.status === 'pending').sort(newestFirst),
        recentlyLearned: facts
            .filter(
                (fact) =>
                    fact.source.type === 'bot' &&
                    fact.status === 'active' &&
                    Date.parse(fact.createdAt) >= since,
            )
            .sort(newestFirst)
            .slice(0, 30),
    };
}

/** Every member's About me in a notebook, for bots. */
export interface NotebookAboutMe {
    notebookId: string;
    /** Someone besides the owner can read the notebook. */
    shared: boolean;
    /** Members with an About me here, the user the bot works for first. */
    people: Array<{ userId: string; profile: AboutMe & { me: ProfileEntity } }>;
    /** Everyone in the notebook, with or without an About me, by name. */
    members: Array<{ userId: string; name: string }>;
}

/**
 * Loads the About me of every current member of the notebook. In a shared notebook,
 * sensitive facts (saved while it was private) are left out: bots' replies there are
 * read by everyone.
 */
export async function loadNotebookAboutMe(
    notebookId: string,
    userId: string,
    now = Date.now(),
): Promise<NotebookAboutMe | null> {
    const notebook = await findNotebookByIdUnsafe(notebookId);
    if (!notebook) return null;
    const shared = isNotebookShared(notebook);
    const members = new Set(notebookMemberIds(notebook));
    const owners = (await profileOwnerIds(notebookId)).filter((id) => members.has(id));
    owners.sort((a, b) => (a === userId ? -1 : b === userId ? 1 : a.localeCompare(b)));
    const people: NotebookAboutMe['people'] = [];
    for (const owner of owners) {
        const profile = await getAboutMe({ userId: owner, notebookId }, now, { shared });
        if (!profile.me) continue;
        people.push({ userId: owner, profile: profile as AboutMe & { me: ProfileEntity } });
    }
    const named = new Map(people.map((person) => [person.userId, person.profile.me.name]));
    const others = [...members].filter((id) => !named.has(id)).slice(0, 20);
    for (const id of others) named.set(id, await displayNameOf(id));
    return {
        notebookId,
        shared,
        people,
        members: [...named].map(([memberId, name]) => ({ userId: memberId, name })),
    };
}

async function displayNameOf(userId: string): Promise<string> {
    const user = await findUserById(userId).catch(() => null);
    return user?.displayName || user?.email?.split('@')[0] || 'Me';
}

/**
 * The short version every bot prompt gets: for each member, who they are, their people,
 * what's true right now, and the main lasting facts. `currentPlace` is where the user
 * the bot works for is now, from their phone.
 */
export function aboutMeSummary(
    about: NotebookAboutMe,
    userId: string,
    timeZone: string,
    currentPlace: string | null = null,
): string {
    const sections = about.people.map(({ userId: owner, profile }) => {
        const me = profile.me;
        const isUser = owner === userId;
        const names = new Map(profile.entities.map((entity) => [entity.id, entity.name]));
        const name = (id: string) => (id === me.id ? me.name : (names.get(id) ?? 'someone'));
        const people = profile.relations
            .filter((relation) => relation.from === me.id)
            .map(
                (relation) =>
                    `${names.get(relation.to) ?? '?'} (${relation.type.replace(/_/g, ' ')})`,
            );
        const others = profile.relations
            .filter((relation) => relation.from !== me.id)
            .map(
                (relation) =>
                    `${name(relation.from)} ${relation.type.replace(/_/g, ' ')} ${name(relation.to)}`,
            );
        const current = profile.facts.filter((fact) => fact.kind === 'current');
        const lasting = profile.facts.filter((fact) => fact.kind === 'lasting');
        const line = (fact: ProfileFact) =>
            `- [${fact.id}] ${name(fact.about)}: ${fact.key.replace(/_/g, ' ')} = ${fact.value}` +
            (fact.validUntil
                ? ` (until ${formatInZone(new Date(fact.validUntil), timeZone)})`
                : '') +
            // Things bots picked up are less certain than what the person said.
            (fact.source.type === 'bot' ? ' (learned by a bot)' : '');
        return [
            `### ${me.name}${isUser ? ' (the user you are helping)' : ' (another member of this notebook)'}`,
            people.length ? `Their people: ${people.join(', ')}` : '',
            others.length ? `Also: ${others.join('; ')}` : '',
            isUser && currentPlace ? `Where they are now (from their iPhone): ${currentPlace}` : '',
            current.length ? `Right now:\n${current.slice(0, 10).map(line).join('\n')}` : '',
            lasting.length
                ? `Lasting facts:\n${lasting.slice(0, SUMMARY_MAX_FACTS).map(line).join('\n')}`
                : '',
            !current.length && !lasting.length && !people.length ? 'Nothing saved yet.' : '',
        ]
            .filter(Boolean)
            .join('\n');
    });
    if (!about.people.some((person) => person.userId === userId)) {
        const name = about.members.find((member) => member.userId === userId)?.name;
        sections.unshift(
            `### ${name ?? 'The user'} (the user you are helping)\n${currentPlace ? `Where they are now (from their iPhone): ${currentPlace}\n` : ''}Nothing saved yet.`,
        );
    }
    const without = about.members.filter(
        (member) =>
            member.userId !== userId && !about.people.some((p) => p.userId === member.userId),
    );
    if (without.length)
        sections.push(
            `Also in this notebook, with nothing saved yet: ${without.map((m) => m.name).join(', ')}`,
        );
    return [
        `## About the people in this notebook (from its About me page)`,
        "Each person's About me is listed under their name. Facts under one person are about them and their people, not about anyone else.",
        ...sections,
        'Use this to make judgment calls (who people are, where they are, routines). Look up more with recall_about_me.',
        about.shared
            ? 'When you learn something new and lasting about someone here or their people (a new school, team or job), save it with remember_about_me. Facts about another member go in their About me (set "whose"); they approve them there.'
            : 'When you learn something new and lasting about the user or their people (a new school, team or job), or their plans change (traveling until Friday), save it with remember_about_me.',
        'When the user answers a question you asked to fill in their About me, save the answer.',
        about.shared
            ? "Mark health, money, legal and relationship-trouble facts as sensitive. This notebook is shared with other people, so those are never saved here, and neither is where anyone is or is traveling: don't try."
            : 'Mark health, money, legal and relationship-trouble facts as sensitive: they wait for the user to approve them.',
    ].join('\n\n');
}

/** Facts and people matching a question, across every member, for the recall tool. */
export function recallAboutMe(about: NotebookAboutMe, query: string): string {
    const terms = query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length > 1);
    const matches = (text: string) =>
        terms.length === 0 || terms.some((t) => text.toLowerCase().includes(t));
    const people: unknown[] = [];
    const facts: unknown[] = [];
    for (const { profile } of about.people) {
        const whose = profile.me.name;
        const names = new Map(profile.entities.map((entity) => [entity.id, entity]));
        for (const e of profile.entities) {
            if (!matches([whose, e.name, ...e.aliases].join(' '))) continue;
            people.push({
                id: e.id,
                whose,
                kind: e.kind,
                name: e.name,
                aliases: e.aliases,
                relations: profile.relations
                    .filter((r) => r.from === e.id || r.to === e.id)
                    .map((r) => `${names.get(r.from)?.name} ${r.type} ${names.get(r.to)?.name}`),
            });
        }
        for (const fact of profile.facts) {
            if (!matches(`${whose} ${names.get(fact.about)?.name ?? ''} ${fact.key} ${fact.value}`))
                continue;
            facts.push({
                id: fact.id,
                whose,
                about: names.get(fact.about)?.name,
                key: fact.key,
                value: fact.value,
                kind: fact.kind,
                validUntil: fact.validUntil,
            });
        }
    }
    if (about.people.length === 0) return 'Nobody has anything in About me yet.';
    return JSON.stringify({ people: people.slice(0, 20), facts: facts.slice(0, 30) });
}

// MARK: - Learning

export interface RememberInput {
    /** Who it's about: "me" or a name. */
    about: string;
    /** Whose About me it goes in, when that's another member of the notebook (their name). */
    whose?: string;
    /** How they relate to the person, when it's someone new: "daughter", "dog", "coach". */
    relation?: string;
    key: string;
    value: string;
    kind: 'lasting' | 'current';
    /** For current facts: when it stops being true (ISO date or date-time). */
    until?: string;
    /** Health, money, legal or relationship trouble. */
    sensitive?: boolean;
    /** Wait for the person's approval (e.g. it came from text someone else wrote). */
    pending?: boolean;
}

/** Saves what a bot learned. Returns a short note for the model. */
export async function rememberAboutMe(
    about: NotebookAboutMe,
    userId: string,
    input: RememberInput,
    source: ProfileFactSource,
    timeZone = 'UTC',
): Promise<string> {
    if (about.shared) {
        const refusal = sharedRefusal(input);
        if (refusal) return refusal;
    }
    // Another member's About me only when the bot says whose; a name in `about` is
    // always one of the user's own people.
    const member = input.whose
        ? about.members.find((m) => m.userId !== userId && isNamed(m.name, [], input.whose!))
        : undefined;
    if (input.whose && !member && !isNamed(nameOf(about, userId), [], input.whose))
        return `Not saved: nobody named ${input.whose} is in this notebook.`;
    const scope = { userId: member?.userId ?? userId, notebookId: about.notebookId };
    const me = await ensureProfile(scope);
    const subject = member && isNamed(me.name, me.aliases, input.about) ? 'me' : input.about;
    const entity = await resolveEntity(scope, me, subject, input.relation, source);
    const validUntil = untilIso(input.until, timeZone);
    const fact = await saveFact(scope, {
        about: entity.id,
        key: input.key,
        value: input.value.slice(0, 1000),
        kind: input.kind,
        ...(validUntil ? { validUntil } : {}),
        source,
        sensitive: input.sensitive,
        // Someone else's About me only changes once they approve it.
        pending: input.pending || !!member,
    });
    const whose = member ? `${member.name}'s` : 'their';
    return fact.status === 'pending'
        ? `Suggested; it will be saved once they approve it in ${whose} About me.`
        : `Saved (${fact.id}) in ${whose} About me, where they can see and undo it.`;
}

/**
 * Changes or ends a fact the model saw (by id), in any member's About me. Bots may only
 * change what bots learned; a change to something the person entered or that came from
 * their contacts is saved as a suggestion for them to approve. Every change is a new
 * fact, so the old value stays in the history and undo brings it back.
 */
export async function updateAboutMe(
    about: NotebookAboutMe,
    userId: string,
    input: { factId: string; value?: string; until?: string; remove?: boolean },
    source: ProfileFactSource,
    timeZone = 'UTC',
    pending = false,
): Promise<string> {
    const found = await findFactInNotebook(about.notebookId, input.factId);
    const visible = about.people.some(
        (person) =>
            person.userId === found?.userId &&
            person.profile.facts.some((fact) => fact.id === input.factId),
    );
    if (!found || !visible) return 'No fact with that id.';
    const { fact } = found;
    const scope = { userId: found.userId, notebookId: about.notebookId };
    const learned = fact.source.type === 'bot';
    const theirs = found.userId !== userId;
    if (input.remove) {
        if (!learned || pending || theirs)
            return 'Only the person can remove that. Tell them it may be wrong instead.';
        await updateFact(scope, fact.id, { status: 'removed' }, { shared: about.shared });
        return 'Removed.';
    }
    const validUntil = untilIso(input.until, timeZone) ?? fact.validUntil;
    if (about.shared) {
        const refusal = sharedRefusal({
            key: fact.key,
            value: input.value ?? fact.value,
            kind: fact.kind,
            sensitive: fact.sensitive,
        });
        if (refusal) return refusal;
    }
    const saved = await saveFact(scope, {
        about: fact.about,
        key: fact.key,
        value: (input.value ?? fact.value).slice(0, 1000),
        kind: fact.kind,
        ...(validUntil ? { validUntil } : {}),
        source,
        sensitive: fact.sensitive,
        // Their own About me changes only once they approve it.
        pending: pending || !learned || theirs,
    });
    return saved.status === 'pending'
        ? 'Suggested; it changes once they approve it in About me.'
        : `Updated (${saved.id}).`;
}

function nameOf(about: NotebookAboutMe, userId: string): string {
    return about.members.find((member) => member.userId === userId)?.name ?? '';
}

/** "Julia" names "Julia Lawrence" (full name, first name or an alias). */
function isNamed(fullName: string, aliases: string[], name: string): boolean {
    const lower = name.trim().toLowerCase();
    if (!lower) return false;
    return (
        fullName.toLowerCase() === lower ||
        fullName.split(/\s+/)[0]?.toLowerCase() === lower ||
        aliases.some((alias) => alias.toLowerCase() === lower)
    );
}

/** An end date or time as the person meant it: bare dates end that day in their time zone. */
function untilIso(value: string | undefined, timeZone: string): string | undefined {
    const seconds = toEpochSeconds(value, timeZone, 'end');
    return seconds === undefined ? undefined : new Date(seconds * 1000).toISOString();
}

async function resolveEntity(
    scope: ProfileScope,
    me: ProfileEntity,
    about: string,
    relation: string | undefined,
    source: ProfileFactSource,
): Promise<ProfileEntity> {
    const name = about.trim();
    if (!name || /^(me|myself|i|the user|user)$/i.test(name) || isNamed(me.name, me.aliases, name))
        return me;
    const lower = name.toLowerCase();
    const existing = (await listEntities(scope)).find(
        (entity) =>
            entity.name.toLowerCase() === lower ||
            entity.aliases.some((alias) => alias.toLowerCase() === lower),
    );
    if (existing) return existing;
    const kind = relation && /\b(dog|cat|pet|horse|bird|fish)\b/i.test(relation) ? 'pet' : 'person';
    const entity = await createEntity(scope, { kind, name });
    if (relation) await addRelation(scope, me.id, entity.id, normalizeKey(relation), source);
    return entity;
}

// MARK: - Creating an About me

/**
 * Returns the person's "me" in this notebook, creating it the first time. With `seed`
 * (when they add the About me page), it's filled from their own contacts and calendar.
 */
export async function ensureProfile(
    scope: ProfileScope,
    options: { seed?: boolean } = {},
): Promise<ProfileEntity> {
    const existing = await findMe(scope);
    if (existing) return existing;
    if (options.seed)
        return seedProfile(scope, Date.now(), (await collectorTimeZone(scope.userId)) ?? 'UTC');
    try {
        return await createEntity(scope, {
            kind: 'person',
            name: await displayNameOf(scope.userId),
            isMe: true,
        });
    } catch (error) {
        // Created by another request at the same moment.
        const existing = await findMe(scope);
        if (existing) return existing;
        throw error;
    }
}

/**
 * Builds the first version from the person's own contact card and calendar:
 * name, home address, birthday, the people on their card, and weekly routines.
 */
export async function seedProfile(
    scope: ProfileScope,
    now = Date.now(),
    timeZone = 'UTC',
): Promise<ProfileEntity> {
    const { userId } = scope;
    const card = await findMyContactCard(userId);
    const contacts = card
        ? await findContactsByName(
              userId,
              relationsOf(card).map((related) => related.name),
          )
        : [];
    const user = await findUserById(userId).catch(() => null);
    let me: ProfileEntity;
    try {
        me = await createEntity(scope, {
            kind: 'person',
            name: card?.title || user?.displayName || user?.email?.split('@')[0] || 'Me',
            isMe: true,
            ...(card ? { contactId: card.id } : {}),
        });
    } catch (error) {
        // Another request seeded it at the same moment; use theirs.
        const existing = await findMe(scope);
        if (existing) return existing;
        throw error;
    }
    const fromContacts: ProfileFactSource = { type: 'contacts', ...(card ? { ref: card.id } : {}) };

    if (card) {
        const address = firstAddress(card);
        if (address)
            await saveFact(scope, {
                about: me.id,
                key: 'home_address',
                value: address,
                kind: 'lasting',
                source: fromContacts,
            });
        if (typeof card.extra?.birthday === 'string')
            await saveFact(scope, {
                about: me.id,
                key: 'birthday',
                value: card.extra.birthday,
                kind: 'lasting',
                source: fromContacts,
            });
        for (const related of relationsOf(card)) {
            const contact = contacts.find(
                (c) => c.title?.toLowerCase() === related.name.toLowerCase(),
            );
            const kind = /\b(dog|cat|pet)\b/i.test(related.label) ? 'pet' : 'person';
            const person = await createEntity(scope, {
                kind,
                name: related.name,
                ...(contact ? { contactId: contact.id } : {}),
            });
            await addRelation(scope, me.id, person.id, related.label, {
                type: 'contacts',
                ...(contact ? { ref: contact.id } : card ? { ref: card.id } : {}),
            });
            if (contact && typeof contact.extra?.birthday === 'string')
                await saveFact(scope, {
                    about: person.id,
                    key: 'birthday',
                    value: contact.extra.birthday,
                    kind: 'lasting',
                    source: { type: 'contacts', ref: contact.id },
                });
        }
    }

    for (const routine of await weeklyRoutines(userId, now, timeZone)) {
        await saveFact(scope, {
            about: me.id,
            key: `routine_${routine.title}`,
            value: routine.description,
            kind: 'lasting',
            source: { type: 'calendar', ref: routine.ref },
        });
    }
    return me;
}

function firstAddress(card: MacDataItem): string | undefined {
    const addresses = card.extra?.addresses;
    if (!Array.isArray(addresses)) return undefined;
    const home = addresses.find((a) => /home/i.test(JSON.stringify(a))) ?? addresses[0];
    if (typeof home === 'string') return home;
    if (home && typeof home === 'object') {
        const value =
            (home as Record<string, unknown>).value ?? (home as Record<string, unknown>).address;
        if (typeof value === 'string') return value;
        return Object.values(home as Record<string, unknown>)
            .filter(
                (part): part is string =>
                    typeof part === 'string' && !/home|work|other/i.test(part),
            )
            .join(', ');
    }
    return undefined;
}

/** Related names on a card, with Apple's built-in labels ("_$!<Spouse>!$_") cleaned up. */
export function relationsOf(card: MacDataItem): Array<{ label: string; name: string }> {
    const raw = card.extra?.relations;
    if (!Array.isArray(raw)) return [];
    return raw
        .map((entry) => entry as Record<string, unknown>)
        .filter((entry) => typeof entry.name === 'string' && (entry.name as string).trim())
        .map((entry) => ({
            label:
                normalizeKey(String(entry.label ?? 'related').replace(/^_\$!<|>!\$_$/g, '')) ||
                'related',
            name: (entry.name as string).trim(),
        }))
        .slice(0, 30);
}

/** Calendar events that repeat at the same weekday and time at least three times. */
export async function weeklyRoutines(
    userId: string,
    now = Date.now(),
    timeZone = 'UTC',
): Promise<Array<{ title: string; description: string; ref: string }>> {
    // Weekday and clock time where the user lives, not in UTC.
    const local = (seconds: number) => {
        const iso = formatInZone(new Date(seconds * 1000), timeZone);
        return {
            day: new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay(),
            time: iso.slice(11, 16),
        };
    };
    const from = now / 1000 - 35 * 24 * 60 * 60;
    const events = (await findDeviceItems(userId, { sources: ['calendar'], from, limit: 500 }))
        .items;
    const groups = new Map<string, MacDataItem[]>();
    for (const event of events) {
        if (!event.title || event.allDay) continue;
        const start = local(event.occurredAt);
        const slot = `${normalizeKey(event.title)}|${start.day}|${start.time}`;
        groups.set(slot, [...(groups.get(slot) ?? []), event]);
    }
    const days = [
        'Sundays',
        'Mondays',
        'Tuesdays',
        'Wednesdays',
        'Thursdays',
        'Fridays',
        'Saturdays',
    ];
    return [...groups.values()]
        .filter((group) => group.length >= 3)
        .slice(0, 10)
        .map((group) => {
            const first = group[0]!;
            const start = local(first.occurredAt);
            return {
                title: normalizeKey(first.title!),
                description: `${first.title} on ${days[start.day]} at ${start.time} (${group.length} times in the last month)${first.location ? ` at ${first.location}` : ''}`,
                ref: first.id,
            };
        });
}

// MARK: - Current place

/**
 * Where the user is now, read live from their iPhone's latest visit: an open visit
 * (arrived, not left) from the last few hours, by its named place ("Home") if it's
 * inside one. Null when they're between places or the phone hasn't said.
 */
export async function currentPlace(userId: string, now = Date.now()): Promise<string | null> {
    const { items } = await findDeviceItems(userId, { sources: ['location'], limit: 1 });
    const visit = items[0];
    if (!visit || visit.endAt != null) return null;
    if (now / 1000 - visit.occurredAt > CURRENT_PLACE_HOURS * 3600) return null;
    return (await namedPlaceAt(userId, visit)) ?? (visit.title || visit.location || null);
}

/** The user's named place a visit falls inside, if any. */
export async function namedPlaceAt(userId: string, visit: MacDataItem): Promise<string | null> {
    const lat = Number(visit.extra?.lat);
    const lon = Number(visit.extra?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    let best: { name: string; distance: number } | null = null;
    for (const entity of await listPlaces(userId)) {
        const distance = metersBetween(lat, lon, entity.place!.lat, entity.place!.lon);
        if (distance <= entity.place!.radius && (!best || distance < best.distance))
            best = { name: entity.name, distance };
    }
    return best?.name ?? null;
}

/** Great-circle distance in meters. */
export function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

function newestFirst(a: ProfileFact, b: ProfileFact): number {
    return b.updatedAt.localeCompare(a.updatedAt);
}
