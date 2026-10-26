import { randomUUID } from 'crypto';
import { getDb } from '../db/client';
import type {
    ProfileEntity,
    ProfileEntityKind,
    ProfileFact,
    ProfileFactSource,
    ProfileRelation,
} from '@maple/shared';

// "About me" storage: entities, relations and facts, each a small document scoped to
// one user. Lookups are by userId; filtering and sorting happen in code (Cosmos DB).

type Stored<T> = T & { _id: string; userId: string };

const entities = () => getDb().collection<Stored<ProfileEntity>>('profile_entities');
const relations = () => getDb().collection<Stored<ProfileRelation>>('profile_relations');
const facts = () => getDb().collection<Stored<ProfileFact>>('profile_facts');

function strip<T>(doc: Stored<T>): T {
    const { _id, userId, ...rest } = doc;
    void _id;
    void userId;
    return rest as unknown as T;
}

// MARK: - Entities

export async function listEntities(userId: string): Promise<ProfileEntity[]> {
    return (await entities().find({ userId }).toArray()).map(strip);
}

export async function findMe(userId: string): Promise<ProfileEntity | null> {
    const doc = await entities().findOne({ userId, isMe: true });
    return doc ? strip(doc) : null;
}

export async function createEntity(
    userId: string,
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
        // One "me" per user: a fixed id makes a second, racing seed fail instead of duplicating.
        id: input.isMe ? `me-${userId}` : randomUUID(),
        kind: input.kind,
        name: input.name.trim(),
        aliases: [...new Set((input.aliases ?? []).map((a) => a.trim()).filter(Boolean))],
        ...(input.isMe ? { isMe: true } : {}),
        ...(input.contactId ? { contactId: input.contactId } : {}),
        createdAt: now,
        updatedAt: now,
    };
    await entities().insertOne({ ...entity, _id: entity.id, userId });
    return entity;
}

/** Named places (Home, Work…) with their coordinates. */
export async function listPlaces(userId: string): Promise<ProfileEntity[]> {
    return (await entities().find({ userId, kind: 'place' }).toArray())
        .map(strip)
        .filter((entity) => !!entity.place);
}

/** Creates a named place, or moves the one with the same name. */
export async function savePlace(
    userId: string,
    name: string,
    place: NonNullable<ProfileEntity['place']>,
): Promise<ProfileEntity> {
    const existing = (await listEntities(userId)).find(
        (entity) =>
            entity.kind === 'place' && entity.name.toLowerCase() === name.trim().toLowerCase(),
    );
    if (existing) {
        await entities().updateOne(
            { _id: existing.id, userId },
            { $set: { place, updatedAt: new Date().toISOString() } },
        );
        return { ...existing, place };
    }
    const entity = await createEntity(userId, { kind: 'place', name });
    await entities().updateOne({ _id: entity.id, userId }, { $set: { place } });
    return { ...entity, place };
}

export async function updateEntity(
    userId: string,
    id: string,
    changes: Partial<Pick<ProfileEntity, 'name' | 'aliases' | 'kind' | 'contactId'>>,
): Promise<ProfileEntity | null> {
    await entities().updateOne(
        { _id: id, userId },
        { $set: { ...changes, updatedAt: new Date().toISOString() } },
    );
    const doc = await entities().findOne({ _id: id, userId });
    return doc ? strip(doc) : null;
}

/** Removes a person or thing with its relations; its facts are marked removed, not deleted. */
export async function deleteEntity(userId: string, id: string): Promise<boolean> {
    const result = await entities().deleteOne({ _id: id, userId, isMe: { $ne: true } });
    if (!result.deletedCount) return false;
    await relations().deleteMany({ userId, $or: [{ from: id }, { to: id }] });
    await facts().updateMany(
        { userId, about: id, status: { $in: ['active', 'pending'] } },
        { $set: { status: 'removed', updatedAt: new Date().toISOString() } },
    );
    return true;
}

// MARK: - Relations

export async function listRelations(userId: string): Promise<ProfileRelation[]> {
    return (await relations().find({ userId }).toArray()).map(strip);
}

/** Adds a relation unless the same one exists. */
export async function addRelation(
    userId: string,
    from: string,
    to: string,
    type: string,
): Promise<ProfileRelation> {
    const existing = await relations().findOne({ userId, from, to, type });
    if (existing) return strip(existing);
    const relation: ProfileRelation = {
        id: randomUUID(),
        from,
        to,
        type,
        createdAt: new Date().toISOString(),
    };
    await relations().insertOne({ ...relation, _id: relation.id, userId });
    return relation;
}

export async function deleteRelation(userId: string, id: string): Promise<boolean> {
    return (await relations().deleteOne({ _id: id, userId })).deletedCount > 0;
}

// MARK: - Facts

export async function listFacts(userId: string): Promise<ProfileFact[]> {
    return (await facts().find({ userId }).toArray()).map(strip);
}

export async function findFact(userId: string, id: string): Promise<ProfileFact | null> {
    const doc = await facts().findOne({ _id: id, userId });
    return doc ? strip(doc) : null;
}

/**
 * Saves a fact. An active fact with the same subject and key is marked replaced, so
 * "traveling to Denver" replaces "traveling to Austin" but both stay in the history.
 * Sensitive facts are saved as pending until the user approves them.
 */
export async function saveFact(
    userId: string,
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
    if (status === 'active') await replaceActive(userId, input.about, key, fact.id);
    await facts().insertOne({ ...fact, _id: fact.id, userId });
    return fact;
}

export async function updateFact(
    userId: string,
    id: string,
    changes: { value?: string; validUntil?: string | null; status?: 'active' | 'removed' },
): Promise<ProfileFact | null> {
    const fact = await findFact(userId, id);
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
            await replaceActive(userId, fact.about, fact.key, id);
    }
    await facts().updateOne(
        { _id: id, userId },
        { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    );
    return findFact(userId, id);
}

/** Ends a current fact now, e.g. leaving the place you were at. */
export async function endCurrentFacts(userId: string, about: string, key: string): Promise<void> {
    const now = new Date().toISOString();
    await facts().updateMany(
        { userId, about, key: normalizeKey(key), status: 'active', kind: 'current' },
        { $set: { validUntil: now, updatedAt: now } },
    );
}

async function replaceActive(userId: string, about: string, key: string, by: string) {
    await facts().updateMany(
        { userId, about, key, status: 'active' },
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

/** Removes everything About me holds for a user. */
export async function deleteProfile(userId: string): Promise<void> {
    await Promise.all([
        entities().deleteMany({ userId }),
        relations().deleteMany({ userId }),
        facts().deleteMany({ userId }),
    ]);
}
