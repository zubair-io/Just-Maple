import { MongoClient } from 'mongodb';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://192.168.0.244:27017/justmaple';
const client = new MongoClient(MONGODB_URI);
await client.connect();
await client
    .db()
    .collection('users')
    .updateMany({}, { $unset: { profilePictureUrl: '', displayName: '' } });
console.log('✅ Reset all profiles');
await client.close();
