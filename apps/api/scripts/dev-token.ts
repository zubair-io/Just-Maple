import { MongoClient } from 'mongodb';
import { SignJWT } from 'jose';
import { config } from '../src/config';

const email = process.argv[2]?.trim().toLowerCase();
if (!config.isDev) {
    console.error('Development tokens are unavailable in production.');
    process.exit(1);
}
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Usage: bun run dev:token you@example.com');
    process.exit(1);
}

const client = new MongoClient(config.mongodbUri, { serverSelectionTimeoutMS: 5000 });
try {
    await client.connect();
    const user = await client
        .db()
        .collection('users')
        .findOne({ email }, { projection: { _id: 1 } });
    if (!user) {
        console.error('No existing account matches that email.');
        process.exitCode = 1;
    } else {
        const token = await new SignJWT({ sub: user._id.toString() })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(new TextEncoder().encode(config.jwtSecret));
        console.error(
            'Paste this token into Development sign-in on localhost. It expires in one hour.',
        );
        console.log(token);
    }
} catch {
    console.error('Could not create a development token. Check the API database configuration.');
    process.exitCode = 1;
} finally {
    await client.close();
}
