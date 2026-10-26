import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

// "About me": what bots know about a person and their people, kept up to date as new
// information arrives. Each member of a notebook has their own, on the notebook's About me
// page. Three layers:
// - entities (you, your family, pets, places, teams) and the relations between them;
// - lasting facts (your address, that you work out in the afternoon);
// - current facts that expire on their own (traveling until Friday).
// Facts are never deleted silently: a newer one replaces the old, which is kept.

export const ProfileEntityKindSchema = Type.Union([
    Type.Literal('person'),
    Type.Literal('pet'),
    Type.Literal('place'),
    Type.Literal('organization'),
    Type.Literal('thing'),
]);
export type ProfileEntityKind = Static<typeof ProfileEntityKindSchema>;

export const ProfilePlaceSchema = Type.Object({
    lat: Type.Number({ minimum: -90, maximum: 90 }),
    lon: Type.Number({ minimum: -180, maximum: 180 }),
    /** Meters; a visit within this distance counts as being there. */
    radius: Type.Number({ minimum: 50, maximum: 2000 }),
    address: Type.Optional(Type.String({ maxLength: 300 })),
});
export type ProfilePlace = Static<typeof ProfilePlaceSchema>;

export const ProfileEntitySchema = Type.Object({
    id: Type.String(),
    kind: ProfileEntityKindSchema,
    name: Type.String(),
    aliases: Type.Array(Type.String()),
    isMe: Type.Optional(Type.Boolean()),
    /** The contact card this person came from, e.g. "contacts:ABC". */
    contactId: Type.Optional(Type.String()),
    /** Named places (Home, Work, School): where they are, so visits and reminders use the name. */
    place: Type.Optional(ProfilePlaceSchema),
    createdAt: Type.String(),
    updatedAt: Type.String(),
});
export type ProfileEntity = Static<typeof ProfileEntitySchema>;

export const ProfileFactSourceSchema = Type.Object({
    type: Type.Union([
        Type.Literal('contacts'),
        Type.Literal('calendar'),
        Type.Literal('location'),
        Type.Literal('health'),
        Type.Literal('you'),
        Type.Literal('bot'),
    ]),
    botId: Type.Optional(Type.String()),
    botName: Type.Optional(Type.String()),
    /** The message or device item it was learned from. */
    ref: Type.Optional(Type.String()),
});
export type ProfileFactSource = Static<typeof ProfileFactSourceSchema>;

// "Emma is my daughter": { from: me, to: Emma, type: 'child' }
export const ProfileRelationSchema = Type.Object({
    id: Type.String(),
    from: Type.String(),
    to: Type.String(),
    type: Type.String(), // spouse, child, parent, sibling, pet, friend, coach, plays_on, works_at…
    source: Type.Optional(ProfileFactSourceSchema), // missing on older relations
    createdAt: Type.String(),
});
export type ProfileRelation = Static<typeof ProfileRelationSchema>;

export const ProfileFactSchema = Type.Object({
    id: Type.String(),
    about: Type.String(), // entity id
    key: Type.String(), // e.g. home_address, workout_time, travel
    value: Type.String(),
    kind: Type.Union([Type.Literal('lasting'), Type.Literal('current')]),
    validFrom: Type.Optional(Type.String()),
    validUntil: Type.Optional(Type.String()),
    source: ProfileFactSourceSchema,
    sensitive: Type.Optional(Type.Boolean()),
    // pending: a sensitive fact waiting for approval; replaced: superseded by a newer fact;
    // removed: undone or deleted by the user (kept for history)
    status: Type.Union([
        Type.Literal('active'),
        Type.Literal('pending'),
        Type.Literal('replaced'),
        Type.Literal('removed'),
    ]),
    replacedBy: Type.Optional(Type.String()),
    createdAt: Type.String(),
    updatedAt: Type.String(),
});
export type ProfileFact = Static<typeof ProfileFactSchema>;

export const AboutMeSchema = Type.Object({
    me: Type.Union([ProfileEntitySchema, Type.Null()]),
    entities: Type.Array(ProfileEntitySchema),
    relations: Type.Array(ProfileRelationSchema),
    /** Active facts, including current ones that haven't expired. */
    facts: Type.Array(ProfileFactSchema),
    /** Sensitive facts a bot suggested, waiting for the user's approval. */
    pending: Type.Array(ProfileFactSchema),
    /** What bots learned recently, newest first, with undo. */
    recentlyLearned: Type.Array(ProfileFactSchema),
});
export type AboutMe = Static<typeof AboutMeSchema>;

export const SaveProfileFactSchema = Type.Object({
    about: Type.String({ minLength: 1 }), // entity id
    key: Type.String({ minLength: 1, maxLength: 80 }),
    value: Type.String({ minLength: 1, maxLength: 1000 }),
    kind: Type.Union([Type.Literal('lasting'), Type.Literal('current')]),
    validUntil: Type.Optional(Type.String()),
});
export type SaveProfileFactInput = Static<typeof SaveProfileFactSchema>;

export const UpdateProfileFactSchema = Type.Object({
    value: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    validUntil: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    /** approve a pending fact, or undo/remove an active one */
    status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('removed')])),
});
export type UpdateProfileFactInput = Static<typeof UpdateProfileFactSchema>;

export const UpdateProfileRelationSchema = Type.Object({
    type: Type.String({ minLength: 1, maxLength: 40 }),
});
export type UpdateProfileRelationInput = Static<typeof UpdateProfileRelationSchema>;

export const SaveProfileEntitySchema = Type.Object({
    kind: ProfileEntityKindSchema,
    name: Type.String({ minLength: 1, maxLength: 120 }),
    aliases: Type.Optional(Type.Array(Type.String({ maxLength: 120 }), { maxItems: 10 })),
    /** Optional relation from you, e.g. "child" */
    relationToMe: Type.Optional(Type.String({ maxLength: 40 })),
});
export type SaveProfileEntityInput = Static<typeof SaveProfileEntitySchema>;

// Name a place from a visit, e.g. "Home" at the visit's coordinates.
export const SaveProfilePlaceSchema = Type.Object({
    name: Type.String({ minLength: 1, maxLength: 80 }),
    lat: Type.Number({ minimum: -90, maximum: 90 }),
    lon: Type.Number({ minimum: -180, maximum: 180 }),
    radius: Type.Optional(Type.Number({ minimum: 50, maximum: 2000 })),
    address: Type.Optional(Type.String({ maxLength: 300 })),
});
export type SaveProfilePlaceInput = Static<typeof SaveProfilePlaceSchema>;
