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
// belongs to one of the user's notebooks (like a Mail or iMessage page, it's added to a
// notebook), so every lookup is by user and notebook; filtering and sorting happen in
// code (Cosmos DB).

/** Whose About me, and in which notebook. */
export interface ProfileScope {
    userId: string;
    notebookId: string;
}

type Stored<T> = T & { _id: string; userId: string; notebookId?: string };

const own = (scope: ProfileScope) => ({ userId: scope.userId, notebookId: scope.notebookId });

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

/** Named places (Home, Work…) with their coordinates. */
export async function listPlaces(scope: ProfileScope): Promise<ProfileEntity[]> {
    return (await entities().find({ ...own(scope), kind: 'place' }).toArray())
        .map(strip)
        .filter((entity) => !!entity.place);
}

/** Creates a named place, or moves the one with the same name. */
export async function savePlace(
    scope: ProfileScope,
    name: string,
    place: NonNullable<ProfileEntity['place']>,
): Promise<ProfileEntity> {
    const existing = (await listEntities(scope)).find(
        (entity) =>
            entity.kind === 'place' && entity.name.toLowerCase() === name.trim().toLowerCase(),
    );
    if (existing) {
        await entities().updateOne(
            { _id: existing.id, ...own(scope) },
            { $set: { place, updatedAt: new Date().toISOString() } },
        );
        return { ...existing, place };
    }
    const entity = await createEntity(scope, { kind: 'place', name });
    await entities().updateOne({ _id: entity.id, ...own(scope) }, { $set: { place } });
    return { ...entity, place };
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
export async function deleteEntity(
    scope: ProfileScope, id: string): Promise<boolean> {
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
): Promise<ProfileRelation> {
    const existing = await relations().findOne({ ...own(scope), from, to, type });
    if (existing) return strip(existing);
    const relation: ProfileRelation = {
        id: randomUUID(),
        from,
        to,
        type,
        createdAt: new Date().toISOString(),
    };
    await relations().insertOne({ ...relation, _id: relation.id, ...own(scope) });
    return relation;
}

export async function deleteRelation(
    scope: ProfileScope, id: string): Promise<boolean> {
    return (await relations().deleteOne({ _id: id, ...own(scope) })).deletedCount > 0;
}

// MARK: - Facts

export async function listFacts(scope: ProfileScope): Promise<ProfileFact[]> {
    return (await facts().find(own(scope)).toArray()).map(strip);
}

export async function findFact(
    scope: ProfileScope, id: string): Promise<ProfileFact | null> {
    const doc = await facts().findOne({ _id: id, ...own(scope) });
    return doc ? strip(doc) : null;
}

/**
 * Saves a fact. An active fact with the same subject and key is marked replaced, so
 * "traveling to Denver" replaces "traveling to Austin" but both stay in the history.
 * Sensitive facts are saved as pending until the user approves them.
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
    },
): Promise<ProfileFact> {
    const now = new Date().toISOString();
    const key = normalizeKey(input.key);
    const status: ProfileFact['status'] = input.sensitive ? 'pending' : 'active';
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
    return findFact(scope, id);
}

/** Ends a current fact now, e.g. leaving the place you were at. */
export async function endCurrentFacts(
    scope: ProfileScope, about: string, key: string): Promise<void> {
    const now = new Date().toISOString();
    await facts().updateMany(
        { ...own(scope), about, key: normalizeKey(key), status: 'active', kind: 'current' },
        { $set: { validUntil: now, updatedAt: now } },
    );
}

async function replaceActive(
    scope: ProfileScope, about: string, key: string, by: string) {
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

/** The notebooks where the user has an About me. */
export async function profileNotebookIds(userId: string): Promise<string[]> {
    const docs = await entities().find({ userId, isMe: true }).toArray();
    return [...new Set(docs.map((doc) => doc.notebookId).filter((id): id is string => !!id))];
}

/** Removes everything this About me holds. */
export async function deleteProfile(scope: ProfileScope): Promise<void> {
    await Promise.all([
        entities().deleteMany(own(scope)),
        relations().deleteMany(own(scope)),
        facts().deleteMany(own(scope)),
    ]);
}
