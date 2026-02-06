/**
 * Home Assistant Bot Server for Just Maple
 *
 * This bot:
 * 1. Logs in using a bot token to get a JWT
 * 2. Connects to Home Assistant via WebSocket
 * 3. Uses Claude API to process natural language commands
 * 4. Controls HA entities and reports status via chat
 *
 * Usage:
 *   1. Create a custom bot in Just Maple and get the bot token
 *   2. Set the environment variables (see .env.example)
 *   3. Run: bun run index.ts
 */

import { Elysia } from 'elysia';
import { createHmac } from 'crypto';
import { HAClient } from './ha-client';
import { AIHandler } from './ai-handler';

// ---- Configuration ----

const config = {
    apiUrl: process.env.API_URL || 'http://localhost:3000',
    botToken: process.env.BOT_TOKEN || '',
    webhookSecret: process.env.WEBHOOK_SECRET || '',
    port: parseInt(process.env.PORT || '3002'),
    haUrl: process.env.HA_URL || 'http://homeassistant.local:8123',
    haAccessToken: process.env.HA_ACCESS_TOKEN || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
};

// ---- State ----

let jwtToken: string | null = null;
let jwtExpiresAt: Date | null = null;
let botId: string | null = null;
let botName: string | null = null;

let haClient: HAClient | null = null;
let aiHandler: AIHandler | null = null;

// ---- JWT Auth ----

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let isRefreshing = false;

/**
 * Login to Just Maple API using bot token and get a JWT.
 * This is the only auth call — used for both initial login and refresh.
 */
async function login(): Promise<boolean> {
    if (!config.botToken) {
        console.error('No bot token configured. Set BOT_TOKEN env var.');
        return false;
    }

    if (isRefreshing) return false;
    isRefreshing = true;

    try {
        console.log('Logging in to Just Maple API...');

        const response = await fetch(`${config.apiUrl}/api/bots/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: config.botToken }),
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('Login failed:', error);
            return false;
        }

        const data = await response.json();
        jwtToken = data.jwt;
        jwtExpiresAt = new Date(data.expires_at);
        botId = data.bot_id;
        botName = data.bot_name;

        console.log(`Logged in as ${botName} (${botId})`);
        console.log(`Token expires at: ${jwtExpiresAt.toISOString()}`);

        scheduleTokenRefresh();
        return true;
    } catch (error) {
        console.error('Login error:', error);
        return false;
    } finally {
        isRefreshing = false;
    }
}

function isTokenExpired(): boolean {
    if (!jwtExpiresAt) return true;
    // Consider expired if within 30 seconds of expiry
    return jwtExpiresAt.getTime() - Date.now() < 30 * 1000;
}

function scheduleTokenRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (!jwtExpiresAt) return;

    const refreshIn = jwtExpiresAt.getTime() - Date.now() - 5 * 60 * 1000;
    if (refreshIn > 0) {
        console.log(`Scheduling token refresh in ${Math.round(refreshIn / 1000 / 60)} minutes`);
        refreshTimer = setTimeout(() => {
            login();
        }, refreshIn);
    } else {
        // Already past the proactive refresh window — refresh now
        login();
    }
}

/**
 * Ensure we have a valid token, refreshing if needed.
 */
async function ensureAuth(): Promise<boolean> {
    if (!jwtToken) return false;
    if (!isTokenExpired()) return true;

    console.log('Token expired or expiring soon, logging in again...');
    return login();
}

/**
 * Make an authenticated API request. Retries once with a fresh token on 401.
 */
async function authenticatedFetch(url: string, init: RequestInit): Promise<Response> {
    // Refresh proactively if token is expired
    await ensureAuth();

    if (!jwtToken) throw new Error('Not logged in');

    const doFetch = () =>
        fetch(url, {
            ...init,
            headers: {
                ...init.headers,
                Authorization: `Bearer ${jwtToken}`,
            },
        });

    const response = await doFetch();

    // On 401, login again and retry once
    if (response.status === 401) {
        console.log('Got 401, logging in again and retrying...');
        const loggedIn = await login();
        if (!loggedIn) throw new Error('Re-login failed');
        return doFetch();
    }

    return response;
}

// ---- Webhook Verification ----

function verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!config.webhookSecret) {
        console.warn('No webhook secret configured, skipping signature verification');
        return true;
    }

    const expectedSignature = createHmac('sha256', config.webhookSecret)
        .update(payload)
        .digest('hex');

    return `sha256=${expectedSignature}` === signature;
}

// ---- Message Sending ----

async function replyToMessage(parentMessageId: string, content: string): Promise<boolean> {
    if (!jwtToken) {
        console.error('Not logged in');
        return false;
    }

    try {
        const response = await authenticatedFetch(
            `${config.apiUrl}/api/bots/threads/${parentMessageId}/reply`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, content_type: 'text' }),
            },
        );

        if (!response.ok) {
            const error = await response.json();
            console.error('Failed to reply:', error);
            return false;
        }

        const data = await response.json();
        console.log(`Reply sent: ${data.message_id} in thread ${data.thread_id}`);
        return true;
    } catch (error) {
        console.error('Reply error:', error);
        return false;
    }
}

// ---- Webhook Types ----

interface WebhookMessage {
    id: string;
    author: {
        id: string;
        name: string;
        type: 'user' | 'bot';
    };
    content: string;
    content_json: unknown;
    created_at: string;
}

interface WebhookEvent {
    event_type: 'thread_mention';
    thread_id: string | null;
    parent_message_id: string;
    page_id: string;
    messages: WebhookMessage[];
    context: {
        notebook_id: string;
        page_id: string;
    };
    timestamp: string;
}

// ---- Event Handler ----

async function handleThreadMention(event: WebhookEvent): Promise<void> {
    const { parent_message_id, messages } = event;

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
        console.log('No messages in webhook payload');
        return;
    }

    console.log(`Mentioned by ${lastMessage.author.name}: ${lastMessage.content}`);

    if (!aiHandler) {
        await replyToMessage(
            parent_message_id,
            'Home Assistant is not connected. Please check the bot configuration.',
        );
        return;
    }

    try {
        const response = await aiHandler.processMessage(messages);
        await replyToMessage(parent_message_id, response);
    } catch (error) {
        console.error('AI processing error:', error);
        await replyToMessage(
            parent_message_id,
            'Sorry, I encountered an error processing your request.',
        );
    }
}

// ---- Home Assistant Setup ----

async function connectToHA(): Promise<boolean> {
    if (!config.haUrl || !config.haAccessToken) {
        console.error('Home Assistant URL or access token not configured.');
        return false;
    }

    try {
        haClient = new HAClient(config.haUrl, config.haAccessToken);
        await haClient.connect();
        await haClient.initialize();

        const entities = haClient.getExposedEntities();
        console.log(`Home Assistant connected with ${entities.length} exposed entities`);

        // Log entity summary by domain
        const domains = new Map<string, number>();
        for (const entity of entities) {
            const domain = entity.entity_id.split('.')[0];
            domains.set(domain, (domains.get(domain) || 0) + 1);
        }
        for (const [domain, count] of domains) {
            console.log(`  ${domain}: ${count} entities`);
        }

        return true;
    } catch (error) {
        console.error('Failed to connect to Home Assistant:', error);
        return false;
    }
}

// ---- Server ----

const app = new Elysia()
    .get('/health', () => ({
        status: 'ok',
        logged_in: !!jwtToken,
        bot_name: botName,
        ha_connected: haClient?.connected ?? false,
        exposed_entities: haClient?.getExposedEntities().length ?? 0,
    }))

    .post('/webhook', async ({ body, headers, set }) => {
        const rawBody = JSON.stringify(body);
        const signature = headers['x-maple-signature'] as string;

        if (!verifyWebhookSignature(rawBody, signature)) {
            console.error('Invalid webhook signature');
            set.status = 401;
            return { error: 'Invalid signature' };
        }

        const event = body as WebhookEvent;
        console.log(`Received webhook: ${event.event_type}`);

        switch (event.event_type) {
            case 'thread_mention':
                await handleThreadMention(event);
                break;
            default:
                console.log(`Unknown event type: ${event.event_type}`);
        }

        return { status: 'accepted' };
    })

    .listen(config.port);

// ---- Startup ----

console.log('Starting Home Assistant Bot...');
console.log(`Webhook server listening on port ${config.port}`);

(async () => {
    // Step 1: Login with bot token
    const loggedIn = await login();
    if (!loggedIn) {
        console.error('Failed to login. Check your BOT_TOKEN.');
        return;
    }

    // Step 2: Connect to Home Assistant
    const haConnected = await connectToHA();
    if (!haConnected) {
        console.error('Failed to connect to Home Assistant. Bot will respond with error messages.');
    }

    // Step 3: Initialize AI handler
    if (haClient && botId && config.anthropicApiKey) {
        aiHandler = new AIHandler(config.anthropicApiKey, haClient, botId);
        console.log('AI handler initialized');
    } else if (!config.anthropicApiKey) {
        console.error('ANTHROPIC_API_KEY not set. AI handler not initialized.');
    }

    console.log('Bot is ready!');
    console.log(`Webhook URL: http://localhost:${config.port}/webhook`);
})();
