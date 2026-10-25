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
    endCurrentFacts,
    findFact,
    findMe,
    listEntities,
    listFacts,
    listRelations,
    normalizeKey,
    saveFact,
    updateFact,
} from '../repositories/profile.repo';
import {
    findContactsByName,
    findDeviceItems,
    findMyContactCard,
} from '../repositories/device-item.repo';
import { findUserById } from '../repositories/user.repo';
import { collectorTimeZone } from '../repositories/collector.repo';
import { formatInZone, toEpochSeconds } from '../utils/time-zone';

/**
 * About me: what bots know about the user and their people.
 *
 * 1. It's created the first time the user turns on a proactive bot, seeded from their
 *    own contact card (name, address, birthday, related names) and recurring calendar
 *    events.
 * 2. Bots read a short summary in every prompt, look up more with `recall_about_me`,
 *    and save what they learn with `remember_about_me`. Sensitive facts wait for approval.
 * 3. Visits from the iPhone keep "where you are now" current.
 */

const RECENTLY_LEARNED_DAYS = 14;
const SUMMARY_MAX_FACTS = 25;
/** An open visit counts as "where you are" for this long without a departure. */
const CURRENT_PLACE_HOURS = 12;

// MARK: - Reading

/** Current facts that haven't expired, plus every lasting fact. */
export function isLive(fact: ProfileFact, now = Date.now()): boolean {
    if (fact.status !== 'active') return false;
    return !fact.validUntil || Date.parse(fact.validUntil) > now;
}

export async function getAboutMe(userId: string, now = Date.now()): Promise<AboutMe> {
    const [me, entities, relations, facts] = await Promise.all([
        findMe(userId),
        listEntities(userId),
        listRelations(userId),
        listFacts(userId),
    ]);
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

/**
 * The short version every bot prompt gets: who the user is, their people, what's true
 * right now, and the main lasting facts. Null when there's no profile yet.
 */
export async function aboutMeSummary(
    userId: string,
    timeZone: string,
    now = Date.now(),
): Promise<string | null> {
    const profile = await getAboutMe(userId, now);
    if (!profile.me) return null;
    const names = new Map(profile.entities.map((entity) => [entity.id, entity.name]));
    const name = (id: string) =>
        id === profile.me!.id ? 'the user' : (names.get(id) ?? 'someone');

    const people = profile.relations
        .filter((relation) => relation.from === profile.me!.id)
        .map(
            (relation) => `${names.get(relation.to) ?? '?'} (${relation.type.replace(/_/g, ' ')})`,
        );
    const others = profile.relations
        .filter((relation) => relation.from !== profile.me!.id)
        .map(
            (relation) =>
                `${name(relation.from)} ${relation.type.replace(/_/g, ' ')} ${name(relation.to)}`,
        );
    const current = profile.facts.filter((fact) => fact.kind === 'current');
    const lasting = profile.facts.filter((fact) => fact.kind === 'lasting');
    const line = (fact: ProfileFact) =>
        `- [${fact.id}] ${name(fact.about)}: ${fact.key.replace(/_/g, ' ')} = ${fact.value}` +
        (fact.validUntil ? ` (until ${formatInZone(new Date(fact.validUntil), timeZone)})` : '') +
        // Things bots picked up are less certain than what the user said.
        (fact.source.type === 'bot' ? ' (learned by a bot)' : '');

    return [
        `## About the user (from their About me profile)`,
        `Name: ${profile.me.name}`,
        people.length ? `Their people: ${people.join(', ')}` : '',
        others.length ? `Also: ${others.join('; ')}` : '',
        current.length
            ? `Right now:\n${current.slice(0, 10).map(line).join('\n')}`
            : 'Right now: nothing noted.',
        lasting.length
            ? `Lasting facts:\n${lasting.slice(0, SUMMARY_MAX_FACTS).map(line).join('\n')}`
            : '',
        'Use this to make judgment calls (who people are, where the user is, routines). Look up more with recall_about_me.',
        'When you learn something new and lasting about the user or their people, or their current situation changes (traveling, sick, at a new place), save it with remember_about_me. Mark health, money, legal and relationship-trouble facts as sensitive.',
    ]
        .filter(Boolean)
        .join('\n');
}

/** Facts and people matching a question, for the recall tool. */
export async function recallAboutMe(
    userId: string,
    query: string,
    now = Date.now(),
): Promise<string> {
    const profile = await getAboutMe(userId, now);
    if (!profile.me) return 'There is no About me profile yet.';
    const terms = query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length > 1);
    const names = new Map(profile.entities.map((entity) => [entity.id, entity]));
    const matches = (text: string) =>
        terms.length === 0 || terms.some((t) => text.toLowerCase().includes(t));
    const entities = profile.entities.filter((e) => matches([e.name, ...e.aliases].join(' ')));
    const facts = profile.facts.filter((fact) =>
        matches(`${names.get(fact.about)?.name ?? ''} ${fact.key} ${fact.value}`),
    );
    return JSON.stringify({
        people: entities.slice(0, 20).map((e) => ({
            id: e.id,
            kind: e.kind,
            name: e.name,
            aliases: e.aliases,
            relations: profile.relations
                .filter((r) => r.from === e.id || r.to === e.id)
                .map((r) => `${names.get(r.from)?.name} ${r.type} ${names.get(r.to)?.name}`),
        })),
        facts: facts.slice(0, 30).map((fact) => ({
            id: fact.id,
            about: names.get(fact.about)?.name,
            key: fact.key,
            value: fact.value,
            kind: fact.kind,
            validUntil: fact.validUntil,
        })),
    });
}

// MARK: - Learning

export interface RememberInput {
    /** Who it's about: "me" or a name. */
    about: string;
    /** How they relate to the user, when it's someone new: "daughter", "dog", "coach". */
    relation?: string;
    key: string;
    value: string;
    kind: 'lasting' | 'current';
    /** For current facts: when it stops being true (ISO date or date-time). */
    until?: string;
    sensitive?: boolean;
}

/** Saves what a bot (or the user) learned. Returns a short note for the model. */
export async function rememberAboutMe(
    userId: string,
    input: RememberInput,
    source: ProfileFactSource,
    timeZone = 'UTC',
): Promise<string> {
    const me = await ensureProfile(userId);
    const entity = await resolveEntity(userId, me, input.about, input.relation);
    const validUntil = untilIso(input.until, timeZone);
    const fact = await saveFact(userId, {
        about: entity.id,
        key: input.key,
        value: input.value.slice(0, 1000),
        kind: input.kind,
        ...(validUntil ? { validUntil } : {}),
        source,
        sensitive: input.sensitive,
    });
    return fact.status === 'pending'
        ? 'Suggested; it will be saved once the user approves it in About me.'
        : `Saved (${fact.id}). The user can see and undo it in About me.`;
}

/**
 * Changes or ends a fact the model saw (by id). Bots may only change what bots learned;
 * a change to something the user entered or that came from their contacts is saved as
 * a suggestion for them to approve. Every change is a new fact, so it shows up in
 * Recently learned with undo and the old value stays in the history.
 */
export async function updateAboutMe(
    userId: string,
    input: { factId: string; value?: string; until?: string; remove?: boolean },
    source: ProfileFactSource,
    timeZone = 'UTC',
    pending = false,
): Promise<string> {
    const fact = await findFact(userId, input.factId);
    if (!fact || fact.status !== 'active') return 'No fact with that id.';
    const learned = fact.source.type === 'bot' || fact.source.type === 'location';
    if (input.remove) {
        if (!learned || pending)
            return 'Only the user can remove that. Tell them it may be wrong instead.';
        await updateFact(userId, fact.id, { status: 'removed' });
        return 'Removed.';
    }
    const validUntil = untilIso(input.until, timeZone) ?? fact.validUntil;
    const saved = await saveFact(userId, {
        about: fact.about,
        key: fact.key,
        value: (input.value ?? fact.value).slice(0, 1000),
        kind: fact.kind,
        ...(validUntil ? { validUntil } : {}),
        source,
        sensitive: pending || !learned || fact.sensitive,
    });
    return saved.status === 'pending'
        ? 'Suggested; it changes once the user approves it in About me.'
        : `Updated (${saved.id}).`;
}

/** An end date or time as the user meant it: bare dates end that day in their time zone. */
function untilIso(value: string | undefined, timeZone: string): string | undefined {
    const seconds = toEpochSeconds(value, timeZone, 'end');
    return seconds === undefined ? undefined : new Date(seconds * 1000).toISOString();
}

async function resolveEntity(
    userId: string,
    me: ProfileEntity,
    about: string,
    relation?: string,
): Promise<ProfileEntity> {
    const name = about.trim();
    if (!name || /^(me|myself|i|the user|user)$/i.test(name)) return me;
    const lower = name.toLowerCase();
    const existing = (await listEntities(userId)).find(
        (entity) =>
            entity.name.toLowerCase() === lower ||
            entity.aliases.some((alias) => alias.toLowerCase() === lower),
    );
    if (existing) return existing;
    const kind = relation && /\b(dog|cat|pet|horse|bird|fish)\b/i.test(relation) ? 'pet' : 'person';
    const entity = await createEntity(userId, { kind, name });
    if (relation) await addRelation(userId, me.id, entity.id, normalizeKey(relation));
    return entity;
}

// MARK: - Creating the profile

/** Returns "me", creating and seeding the profile the first time. */
export async function ensureProfile(userId: string): Promise<ProfileEntity> {
    return (
        (await findMe(userId)) ??
        seedProfile(userId, Date.now(), (await collectorTimeZone(userId)) ?? 'UTC')
    );
}

/**
 * Builds the first version from the user's own contact card and calendar:
 * name, home address, birthday, the people on their card, and weekly routines.
 */
export async function seedProfile(
    userId: string,
    now = Date.now(),
    timeZone = 'UTC',
): Promise<ProfileEntity> {
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
        me = await createEntity(userId, {
            kind: 'person',
            name: card?.title || user?.displayName || user?.email?.split('@')[0] || 'Me',
            isMe: true,
            ...(card ? { contactId: card.id } : {}),
        });
    } catch (error) {
        // Another request seeded it at the same moment; use theirs.
        const existing = await findMe(userId);
        if (existing) return existing;
        throw error;
    }
    const fromContacts: ProfileFactSource = { type: 'contacts', ...(card ? { ref: card.id } : {}) };

    if (card) {
        const address = firstAddress(card);
        if (address)
            await saveFact(userId, {
                about: me.id,
                key: 'home_address',
                value: address,
                kind: 'lasting',
                source: fromContacts,
            });
        if (typeof card.extra?.birthday === 'string')
            await saveFact(userId, {
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
            const person = await createEntity(userId, {
                kind,
                name: related.name,
                ...(contact ? { contactId: contact.id } : {}),
            });
            await addRelation(userId, me.id, person.id, related.label);
            if (contact && typeof contact.extra?.birthday === 'string')
                await saveFact(userId, {
                    about: person.id,
                    key: 'birthday',
                    value: contact.extra.birthday,
                    kind: 'lasting',
                    source: { type: 'contacts', ref: contact.id },
                });
        }
    }

    for (const routine of await weeklyRoutines(userId, now, timeZone)) {
        await saveFact(userId, {
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
 * Keeps "where you are" current from iPhone visits: an open visit (arrived, not left)
 * becomes the current place; leaving it ends that fact.
 */
export async function noteLocationVisits(
    userId: string,
    visits: MacDataItem[],
    now = Date.now(),
): Promise<void> {
    const recent = visits
        .filter((item) => item.source === 'location')
        .sort((a, b) => b.occurredAt - a.occurredAt)[0];
    if (!recent) return;
    const me = await findMe(userId);
    if (!me) return; // No profile yet: it starts with the first proactive bot.
    const place = recent.title || recent.location;
    if (!place) return;
    const current = (await listFacts(userId)).find(
        (fact) => fact.about === me.id && fact.key === 'location' && isLive(fact, now),
    );
    if (recent.endAt !== undefined) {
        if (current?.value === place) await endCurrentFacts(userId, me.id, 'location');
        return;
    }
    if (now / 1000 - recent.occurredAt > CURRENT_PLACE_HOURS * 3600) return;
    if (current?.value === place) return;
    await saveFact(userId, {
        about: me.id,
        key: 'location',
        value: place,
        kind: 'current',
        validUntil: new Date(now + CURRENT_PLACE_HOURS * 3600 * 1000).toISOString(),
        source: { type: 'location', ref: recent.id },
    });
}

function newestFirst(a: ProfileFact, b: ProfileFact): number {
    return b.updatedAt.localeCompare(a.updatedAt);
}
