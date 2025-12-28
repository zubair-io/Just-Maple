#!/usr/bin/env bun

import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://192.168.0.244:27017/justmaple';

async function testUserBots() {
    const client = new MongoClient(MONGO_URI);

    try {
        await client.connect();
        console.log('✅ Connected to MongoDB');

        const db = client.db();

        // Check users
        const users = await db
            .collection('users')
            .find({})
            .limit(5)
            .project({ email: 1, displayName: 1 })
            .toArray();
        console.log('\n📋 Users in database:', users.length);
        users.forEach((user) => {
            console.log(`  - ${user.email || 'No email'} (ID: ${user._id})`);
        });

        // Check user_bots
        const userBots = await db.collection('user_bots').find({}).toArray();
        console.log('\n🤖 User bots in database:', userBots.length);
        userBots.forEach((bot) => {
            console.log(`  - Handle: @${bot.handle}`);
            console.log(`    User ID: ${bot.userId}`);
            console.log(`    Template ID: ${bot.templateId}`);
            console.log(`    Enabled: ${bot.isEnabled}`);
            console.log(`    Has API Key: ${!!bot.config?.apiKey}`);
            console.log('');
        });

        // Check bot templates
        const templates = await db.collection('bot_templates').find({}).toArray();
        console.log('📝 Bot templates available:', templates.length);
        templates.forEach((t) => {
            console.log(`  - ${t.name} (handle: @${t.handle})`);
        });

        // If we have users, try to get a token and test the endpoint
        if (users.length > 0) {
            const testUser = users[0];
            console.log(`\n🔐 Testing with user: ${testUser.email} (${testUser._id})`);

            // Count bots for this user
            const userBotsCount = await db
                .collection('user_bots')
                .countDocuments({ userId: testUser._id });
            console.log(`   User has ${userBotsCount} bots registered`);

            // Try to make a request (we'd need to generate a JWT token, which is complex)
            // For now, just show the data we'd expect
            const userBotsForUser = await db
                .collection('user_bots')
                .find({ userId: testUser._id })
                .toArray();
            console.log(
                '\n   Expected response:',
                JSON.stringify(
                    userBotsForUser.map((b) => ({
                        _id: b._id.toString(),
                        handle: b.handle,
                        isEnabled: b.isEnabled,
                    })),
                    null,
                    2,
                ),
            );
        }
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await client.close();
    }
}

testUserBots();
