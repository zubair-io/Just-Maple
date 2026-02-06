/**
 * Example Custom Bot Server for Just Maple
 *
 * This bot:
 * 1. Logs in using a bot token to get a JWT
 * 2. Responds "Hello!" to any message it receives via webhook
 *
 * Usage:
 *   1. Create a custom bot in Just Maple and get the bot token
 *   2. Set the environment variables (see .env.example)
 *   3. Run: bun run index.ts
 */

import { Elysia } from 'elysia';
import { createHmac } from 'crypto';

// Configuration from environment
const config = {
    // Your Just Maple API URL
    apiUrl: process.env.API_URL || 'http://localhost:3000',

    // The bot token you received when creating the bot
    botToken: process.env.BOT_TOKEN || '',

    // The webhook secret for verifying signatures
    webhookSecret: process.env.WEBHOOK_SECRET || '',

    // Port for this bot server
    port: parseInt(process.env.PORT || '3001'),
};

// State
let jwtToken: string | null = null;
let jwtExpiresAt: Date | null = null;
let botId: string | null = null;
let botName: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let isRefreshing = false;

/**
 * Login to Just Maple API using bot token and get a JWT
 * This is the only auth call — used for both initial login and refresh.
 */
async function login(): Promise<boolean> {
    if (!config.botToken) {
        console.error('No bot token configured. Set BOT_TOKEN env var.');
        return false;
    }

    try {
        console.log('Logging in to Just Maple API...');

        const response = await fetch(`${config.apiUrl}/api/bots/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                token: config.botToken,
            }),
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
    }
}

/**
 * Check if the token is expired or about to expire
 */
function isTokenExpired(): boolean {
    if (!jwtExpiresAt) return true;
    // Consider expired if within 30 seconds of expiry
    return jwtExpiresAt.getTime() - Date.now() < 30 * 1000;
}

/**
 * Schedule token refresh 5 minutes before expiration
 */
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

/**
 * Verify webhook signature
 */
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

/**
 * Send a message to a page
 */
async function sendMessage(pageId: string, content: string): Promise<boolean> {
    if (!jwtToken) {
        console.error('Not logged in');
        return false;
    }

    try {
        const response = await authenticatedFetch(
            `${config.apiUrl}/api/bots/pages/${pageId}/messages`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content,
                    content_type: 'text',
                }),
            },
        );

        if (!response.ok) {
            const error = await response.json();
            console.error('Failed to send message:', error);
            return false;
        }

        const data = await response.json();
        console.log(`Message sent: ${data.message_id}`);
        return true;
    } catch (error) {
        console.error('Send message error:', error);
        return false;
    }
}

/**
 * Reply to a message in a thread
 */
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
                body: JSON.stringify({
                    content,
                    content_type: 'text',
                }),
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

// Create the webhook server
const app = new Elysia()
    // Health check
    .get('/health', () => ({
        status: 'ok',
        logged_in: !!jwtToken,
        bot_name: botName,
    }))

    // Webhook endpoint - Just Maple calls this when the bot is mentioned
    .post('/webhook', async ({ body, headers, set }) => {
        console.log('Received webhook');
        const rawBody = JSON.stringify(body);
        const signature = headers['x-maple-signature'] as string;

        // Verify signature
        if (!verifyWebhookSignature(rawBody, signature)) {
            console.error('Invalid webhook signature');
            set.status = 401;
            return { error: 'Invalid signature' };
        }

        const event = body as WebhookEvent;
        console.log(`Received webhook: ${event.event_type}`);
        console.log('Payload:', JSON.stringify(event, null, 2));

        // Handle the event
        switch (event.event_type) {
            case 'thread_mention':
                await handleThreadMention(event);
                break;

            default:
                console.log(`Unknown event type: ${event.event_type}`);
        }

        // Return accepted status (required by Just Maple)
        return { status: 'accepted' };
    })

    .listen(config.port);

// Webhook event types - matches Just Maple's webhook payload
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

/**
 * Handle thread mention - respond with "Hello!"
 */
async function handleThreadMention(event: WebhookEvent): Promise<void> {
    const { parent_message_id, messages } = event;

    // Get the last message (the one that mentioned the bot)
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
        console.log('No messages in webhook payload');
        return;
    }

    const authorName = lastMessage.author.name;
    console.log(`Mentioned by ${authorName} in message ${lastMessage.id}`);
    console.log(`Message content: ${lastMessage.content}`);

    // Reply in the thread (use parent_message_id to reply to the thread)
    await replyToMessage(parent_message_id, `Hello, ${authorName}! 👋`);
}

// Startup
console.log('Starting Hello Bot...');
console.log(`Webhook server listening on port ${config.port}`);

// Login on startup
(async () => {
    const loggedIn = await login();

    if (loggedIn) {
        console.log('Bot is ready!');
        console.log(`Webhook URL: http://localhost:${config.port}/webhook`);
    } else {
        console.error('Failed to login. Check your BOT_TOKEN.');
    }
})();
