import { ObjectId } from 'mongodb';
import { randomBytes } from 'crypto';
import { testDb } from '../setup';

export interface UserDoc {
    _id: ObjectId;
    email: string;
    displayName?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface MagicLinkDoc {
    _id: ObjectId;
    userId: string;
    email: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
}

export interface PasskeyDoc {
    _id: ObjectId;
    userId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports?: string[];
    deviceType: string;
    backedUp: boolean;
    createdAt: Date;
}

export interface CreateUserOptions {
    email?: string;
    displayName?: string;
}

let emailCounter = 0;

export async function createUserFixture(options: CreateUserOptions = {}): Promise<UserDoc> {
    const now = new Date();
    emailCounter++;
    // Use unique email to avoid conflicts between tests
    const uniqueEmail = `test-${Date.now()}-${emailCounter}-${randomBytes(4).toString('hex')}@example.com`;
    const doc: UserDoc = {
        _id: new ObjectId(),
        email: uniqueEmail.toLowerCase(),
        displayName: options.displayName,
        createdAt: now,
        updatedAt: now,
    };
    await testDb.collection('users').insertOne(doc);
    return doc;
}

export interface CreateMagicLinkOptions {
    userId?: string;
    email?: string;
    token?: string;
    expiresAt?: Date;
}

export async function createMagicLinkFixture(
    options: CreateMagicLinkOptions = {},
): Promise<MagicLinkDoc> {
    const now = new Date();
    const doc: MagicLinkDoc = {
        _id: new ObjectId(),
        userId: options.userId || new ObjectId().toString(),
        email: options.email || `test-${Date.now()}@example.com`,
        token: options.token || randomBytes(32).toString('hex'),
        expiresAt: options.expiresAt || new Date(Date.now() + 15 * 60 * 1000),
        createdAt: now,
    };
    await testDb.collection('magic_links').insertOne(doc);
    return doc;
}

export interface CreatePasskeyOptions {
    userId?: string;
    credentialId?: string;
    publicKey?: string;
    counter?: number;
    deviceType?: string;
    backedUp?: boolean;
}

export async function createPasskeyFixture(
    options: CreatePasskeyOptions = {},
): Promise<PasskeyDoc> {
    const doc: PasskeyDoc = {
        _id: new ObjectId(),
        userId: options.userId || new ObjectId().toString(),
        credentialId: options.credentialId || randomBytes(32).toString('base64url'),
        publicKey: options.publicKey || randomBytes(65).toString('base64url'),
        counter: options.counter || 0,
        deviceType: options.deviceType || 'singleDevice',
        backedUp: options.backedUp || false,
        createdAt: new Date(),
    };
    await testDb.collection('passkeys').insertOne(doc);
    return doc;
}

export function generateToken(): string {
    return randomBytes(32).toString('hex');
}
