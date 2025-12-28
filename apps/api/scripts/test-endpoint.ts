#!/usr/bin/env bun

import { MongoClient } from 'mongodb';
import { sign } from 'jsonwebtoken';
import type { JWTPayload } from '@maple/shared';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://192.168.0.244:27017/justmaple';
const JWT_SECRET = process.env.JWT_SECRET || 'local-dev-secret-key';
const API_URL = 'http://localhost:7071';

async function testEndpoint() {
    const client = new MongoClient(MONGO_URI);

    try {
        await client.connect();
        const db = client.db();

        // Get first user
        const user = await db.collection('users').findOne({});
        if (!user) {
            console.log('❌ No users found in database');
            return;
        }

        console.log(`✅ Testing with user: ${user.email} (${user._id})`);

        // Generate JWT token
        const payload: JWTPayload = {
            sub: user._id.toString(),
            email: user.email,
            iat: Math.floor(Date.now() / 1000),
        };

        const token = sign(payload, JWT_SECRET, { expiresIn: '7d' });
        console.log(`🔑 Generated JWT token`);

        // Make request to /api/user-bots
        console.log('\n📡 Making request to /api/user-bots...\n');

        const response = await fetch(`${API_URL}/api/user-bots`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        console.log(`Status: ${response.status} ${response.statusText}`);

        const data = await response.json();
        console.log('\n📦 Response:');
        console.log(JSON.stringify(data, null, 2));

        if (data.userBots) {
            console.log(`\n✅ Found ${data.userBots.length} user bots`);
            data.userBots.forEach((bot: any) => {
                console.log(`  - @${bot.handle} (${bot.templateName || 'Unknown template'})`);
                console.log(`    Enabled: ${bot.isEnabled}`);
                console.log(`    Has API Key: ${bot.config?.apiKey === '***REDACTED***'}`);
            });
        }
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await client.close();
    }
}

testEndpoint();
