import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';

export interface PasskeyDocument {
    _id: ObjectId;
    userId: string;
    credentialId: string; // base64url encoded
    publicKey: string; // base64url encoded
    counter: number;
    transports?: AuthenticatorTransportFuture[];
    deviceType: string;
    backedUp: boolean;
    createdAt: Date;
}

export interface PasskeyCredential {
    id: string;
    visibleId: string; // First 8 chars for display
    userId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports?: AuthenticatorTransportFuture[];
    deviceType: string;
    backedUp: boolean;
    createdAt: Date;
}

function getCollection(): Collection<PasskeyDocument> {
    return getDb().collection<PasskeyDocument>('passkeys');
}

function toPasskeyCredential(doc: PasskeyDocument): PasskeyCredential {
    return {
        id: doc._id.toString(),
        visibleId: doc.credentialId.slice(0, 8),
        userId: doc.userId,
        credentialId: doc.credentialId,
        publicKey: doc.publicKey,
        counter: doc.counter,
        transports: doc.transports,
        deviceType: doc.deviceType,
        backedUp: doc.backedUp,
        createdAt: doc.createdAt,
    };
}

export async function createPasskey(data: {
    userId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports?: AuthenticatorTransportFuture[];
    deviceType: string;
    backedUp: boolean;
}): Promise<PasskeyCredential> {
    const doc: Omit<PasskeyDocument, '_id'> = {
        ...data,
        createdAt: new Date(),
    };

    const result = await getCollection().insertOne(doc as PasskeyDocument);

    return {
        id: result.insertedId.toString(),
        visibleId: data.credentialId.slice(0, 8),
        ...data,
        createdAt: doc.createdAt,
    };
}

export async function findPasskeyByCredentialId(
    credentialId: string,
): Promise<PasskeyCredential | null> {
    const doc = await getCollection().findOne({ credentialId });
    return doc ? toPasskeyCredential(doc) : null;
}

export async function findPasskeysByUserId(userId: string): Promise<PasskeyCredential[]> {
    const docs = await getCollection().find({ userId }).toArray();
    return docs.map(toPasskeyCredential);
}

export async function updatePasskeyCounter(credentialId: string, counter: number): Promise<void> {
    await getCollection().updateOne({ credentialId }, { $set: { counter } });
}

export async function deletePasskey(id: string, userId: string): Promise<boolean> {
    const result = await getCollection().deleteOne({
        _id: new ObjectId(id),
        userId,
    });
    return result.deletedCount > 0;
}

export async function getAllCredentialIdsForUser(userId: string): Promise<string[]> {
    const docs = await getCollection()
        .find({ userId }, { projection: { credentialId: 1 } })
        .toArray();
    return docs.map((d) => d.credentialId);
}
