import { randomUUID } from 'crypto';
import { getDb } from '../db/client';
import type {
    ProfileEntity,
    ProfileEntityKind,
    ProfileFact,
    ProfileFactSource,
    ProfileRelation,
} from '@maple/shared';

// "About me" storage: entities, relations and facts, each a small document. An About me
// belongs to one person in one notebook (like a Mail or iMessage page, it's added to a
// notebook), so every lookup is by user and notebook; filtering and sorting happen in
// code (Cosmos DB). Records saved before About me moved into notebooks have no
// notebookId and are never read. Named places are the exception: they belong to the
// account (the iPhone reads them), stored without a notebookId.

/** Whose About me, and in which notebook. */
export interface ProfileScope {
    userId: string;
    notebookId: string;
}

type Stored<T> = T & { _id: string; userId: string; notebookId?: string };

const own = (scope: ProfileScope) => ({ userId: scope.userId, notebookId: scope.notebookId });
/** The account's named places. */
const accountPlaces = (userId: string) => ({
    userId,
    kind: 'place' as const,
    notebookId: { $exists: false },
});

const entities = () => getDb().collection<Stored<ProfileEntity>>('profile_entities');
const relations = () => getDb().collection<Stored<ProfileRelation>>('profile_relations');
const facts = () => getDb().collection<Stored<ProfileFact>>('profile_facts');

function strip<T>(doc: Stored<T>): T {
    const { _id, userId, notebookId, ...rest } = doc;
    void _id;
    void userId;
    void notebookId;
    return rest as unknown as T;
}

// MARK: - Entities

export async function listEntities(scope: ProfileScope): Promise<ProfileEntity[]> {
    return (await entities().find(own(scope)).toArray()).map(strip);
}

export async function findMe(scope: ProfileScope): Promise<ProfileEntity | null> {
    const doc = await entities().findOne({ ...own(scope), isMe: true });
    return doc ? strip(doc) : null;
}

export async function createEntity(
    scope: ProfileScope,
    input: {
        kind: ProfileEntityKind;
        name: string;
        aliases?: string[];
        isMe?: boolean;
        contactId?: string;
    },
): Promise<ProfileEntity> {
    const now = new Date().toISOString();
    const entity: ProfileEntity = {
        // One "me" per About me: a fixed id makes a second, racing seed fail instead of duplicating.
        id: input.isMe ? `me-${scope.userId}-${scope.notebookId}` : randomUUID(),
        kind: input.kind,
        name: input.name.trim(),
        aliases: [...new Set((input.aliases ?? []).map((a) => a.trim()).filter(Boolean))],
        ...(input.isMe ? { isMe: true } : {}),
        ...(input.contactId ? { contactId: input.contactId } : {}),
        createdAt: now,
        updatedAt: now,
    };
    await entities().insertOne({ ...entity, _id: entity.id, ...own(scope) });
    return entity;
}

/** The account's named places (Home, Work…) with their coordinates. */
export async function listPlaces(userId: string): Promise<ProfileEntity[]> {
    return (await entities().find(accountPlaces(userId)).toArray())
        .map(strip)
        .filter((entity) => !!entity.place);
}

/** Creates a named place, or moves the one with the same name. */
export async function savePlace(
    userId: string,
    name: string,
    place: NonNullable<ProfileEntity['place']>,
): Promise<ProfileEntity> {
    const now = new Date().toISOString();
    const existing = (await entities().find(accountPlaces(userId)).toArray())
        .map(strip)
        .find((entity) => entity.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) {
        await entities().updateOne(
            { _id: existing.id, userId },
            { $set: { place, updatedAt: now } },
        );
        return { ...existing, place };
    }
    const entity: ProfileEntity = {
        id: randomUUID(),
        kind: 'place',
        name: name.trim(),
        aliases: [],
        place,
        createdAt: now,
        updatedAt: now,
    };
    await entities().insertOne({ ...entity, _id: entity.id, userId });
    return entity;
}

export async function updateEntity(
    scope: ProfileScope,
    id: string,
    changes: Partial<Pick<ProfileEntity, 'name' | 'aliases' | 'kind' | 'contactId'>>,
): Promise<ProfileEntity | null> {
    await entities().updateOne(
        { _id: id, ...own(scope) },
        { $set: { ...changes, updatedAt: new Date().toISOString() } },
    );
    const doc = await entities().findOne({ _id: id, ...own(scope) });
    return doc ? strip(doc) : null;
}

/** Removes a person or thing with its relations; its facts are marked removed, not deleted. */
export async function deleteEntity(scope: ProfileScope, id: string): Promise<boolean> {
    const result = await entities().deleteOne({ _id: id, ...own(scope), isMe: { $ne: true } });
    if (!result.deletedCount) return false;
    await relations().deleteMany({ ...own(scope), $or: [{ from: id }, { to: id }] });
    await facts().updateMany(
        { ...own(scope), about: id, status: { $in: ['active', 'pending'] } },
        { $set: { status: 'removed', updatedAt: new Date().toISOString() } },
    );
    return true;
}

// MARK: - Relations

export async function listRelations(scope: ProfileScope): Promise<ProfileRelation[]> {
    return (await relations().find(own(scope)).toArray()).map(strip);
}

/** Adds a relation unless the same one exists. */
export async function addRelation(
    scope: ProfileScope,
    from: string,
    to: string,
    type: string,
    source?: ProfileFactSource,
): Promise<ProfileRelation> {
    const existing = await relations().findOne({ ...own(scope), from, to, type });
    if (existing) return strip(existing);
    const relation: ProfileRelation = {
        id: randomUUID(),
        from,
        to,
        type,
        ...(source ? { source } : {}),
        createdAt: new Date().toISOString(),
    };
    await relations().insertOne({ ...relation, _id: relation.id, ...own(scope) });
    return relation;
}

export async function updateRelation(
    scope: ProfileScope,
    id: string,
    type: string,
): Promise<ProfileRelation | null> {
    await relations().updateOne({ _id: id, ...own(scope) }, { $set: { type } });
    const doc = await relations().findOne({ _id: id, ...own(scope) });
    return doc ? strip(doc) : null;
}

export async function deleteRelation(scope: ProfileScope, id: string): Promise<boolean> {
    return (await relations().deleteOne({ _id: id, ...own(scope) })).deletedCount > 0;
}

// MARK: - Facts

export async function listFacts(scope: ProfileScope): Promise<ProfileFact[]> {
    return (await facts().find(own(scope)).toArray()).map(strip);
}

export async function findFact(scope: ProfileScope, id: string): Promise<ProfileFact | null> {
    const doc = await facts().findOne({ _id: id, ...own(scope) });
    return doc ? strip(doc) : null;
}

/**
 * Saves a fact. An active fact with the same subject and key is marked replaced, so
 * "traveling to Denver" replaces "traveling to Austin" but both stay in the history.
 * Sensitive facts, and those marked `pending`, wait for the user's approval.
 */
export async function saveFact(
    scope: ProfileScope,
    input: {
        about: string;
        key: string;
        value: string;
        kind: ProfileFact['kind'];
        validUntil?: string;
        source: ProfileFactSource;
        sensitive?: boolean;
        /** Needs the user's approval even though it isn't sensitive. */
        pending?: boolean;
    },
): Promise<ProfileFact> {
    const now = new Date().toISOString();
    const key = normalizeKey(input.key);
    const status: ProfileFact['status'] = input.sensitive || input.pending ? 'pending' : 'active';
    const fact: ProfileFact = {
        id: randomUUID(),
        about: input.about,
        key,
        value: input.value.trim(),
        kind: input.kind,
        validFrom: now,
        ...(input.validUntil ? { validUntil: input.validUntil } : {}),
        source: input.source,
        ...(input.sensitive ? { sensitive: true } : {}),
        status,
        createdAt: now,
        updatedAt: now,
    };
    if (status === 'active') await replaceActive(scope, input.about, key, fact.id);
    await facts().insertOne({ ...fact, _id: fact.id, ...own(scope) });
    return fact;
}

export async function updateFact(
    scope: ProfileScope,
    id: string,
    changes: { value?: string; validUntil?: string | null; status?: 'active' | 'removed' },
    options: { shared?: boolean } = {},
): Promise<ProfileFact | null> {
    const fact = await findFact(scope, id);
    if (!fact) return null;
    const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    const unset: Record<string, ''> = {};
    if (changes.value !== undefined) set.value = changes.value.trim();
    if (changes.validUntil === null) unset.validUntil = '';
    else if (changes.validUntil !== undefined) set.validUntil = changes.validUntil;
    if (changes.status) {
        set.status = changes.status;
        // Approving a pending fact makes it the current answer for its key.
        if (changes.status === 'active' && fact.status !== 'active')
            await replaceActive(scope, fact.about, fact.key, id);
    }
    await facts().updateOne(
        { _id: id, ...own(scope) },
        { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    );
    // Removing (undoing) an active fact brings back the one it replaced, if any; in a
    // shared notebook, never a sensitive one.
    if (changes.status === 'removed' && fact.status === 'active') {
        await facts().updateOne(
            {
                ...own(scope),
                replacedBy: id,
                status: 'replaced',
                ...(options.shared ? { sensitive: { $ne: true } } : {}),
            },
            { $set: { status: 'active', updatedAt: new Date().toISOString() } },
        );
    }
    return findFact(scope, id);
}

async function replaceActive(scope: ProfileScope, about: string, key: string, by: string) {
    await facts().updateMany(
        { ...own(scope), about, key, status: 'active' },
        { $set: { status: 'replaced', replacedBy: by, updatedAt: new Date().toISOString() } },
    );
}

export function normalizeKey(key: string): string {
    return (
        key
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 80) || 'note'
    );
}

/** Who has an About me in a notebook: the users with a "me" there. */
export async function profileOwnerIds(notebookId: string): Promise<string[]> {
    const docs = await entities().find({ notebookId, isMe: true }).toArray();
    return [...new Set(docs.map((doc) => doc.userId))];
}

/** A fact in any of a notebook's About me's, with whose it is. */
export async function findFactInNotebook(
    notebookId: string,
    id: string,
): Promise<{ fact: ProfileFact; userId: string } | null> {
    const doc = await facts().findOne({ _id: id, notebookId });
    return doc ? { fact: strip(doc), userId: doc.userId } : null;
}
