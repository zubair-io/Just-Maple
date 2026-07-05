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
    // Memo editing: page ID for the daily summary document
    summaryPageId: process.env.SUMMARY_PAGE_ID || '',
    // Cron hour for daily summary (0-23, default 7 = 7:00 AM)
    summaryCronHour: parseInt(process.env.SUMMARY_CRON_HOUR || '7'),
    // Anomaly detection
    alertsPageId: process.env.ALERTS_PAGE_ID || '',
    alertsChatPageId: process.env.ALERTS_CHAT_PAGE_ID || '',
    anomalyIntervalMin: parseInt(process.env.ANOMALY_INTERVAL_MIN || '10'),
};

// Validate required environment variables up front so misconfiguration fails
// fast with a clear message instead of surfacing as confusing runtime errors.
function requireEnv(name: string, value: string): void {
    if (!value) {
        throw new Error(
            `Missing required environment variable ${name}. Set it in your .env file or shell environment.`,
        );
    }
}

requireEnv('HA_ACCESS_TOKEN', config.haAccessToken);
requireEnv('ANTHROPIC_API_KEY', config.anthropicApiKey);

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

/**
 * Send a new message (not a reply) to a chat page.
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
                body: JSON.stringify({ content, content_type: 'text' }),
            },
        );

        if (!response.ok) {
            const error = await response.json();
            console.error('Failed to send message:', error);
            return false;
        }

        const data = await response.json();
        console.log(`Message sent: ${data.message_id} on page ${data.page_id}`);
        return true;
    } catch (error) {
        console.error('Send message error:', error);
        return false;
    }
}

// ---- Memo API ----

/**
 * Read a memo document's content as ProseMirror JSON.
 */
async function readMemo(pageId: string): Promise<{ title: string; document: unknown } | null> {
    try {
        const response = await authenticatedFetch(
            `${config.apiUrl}/api/bots/pages/${pageId}/document`,
            { method: 'GET', headers: { 'Content-Type': 'application/json' } },
        );

        if (!response.ok) {
            const error = await response.json();
            console.error('Failed to read memo:', error);
            return null;
        }

        return (await response.json()) as { title: string; document: unknown };
    } catch (error) {
        console.error('Read memo error:', error);
        return null;
    }
}

/**
 * Replace an entire memo document with new markdown content.
 */
async function writeMemo(pageId: string, markdown: string, title?: string): Promise<boolean> {
    try {
        const body: Record<string, string> = {
            content: markdown,
            content_type: 'markdown',
        };
        if (title) body.title = title;

        const response = await authenticatedFetch(
            `${config.apiUrl}/api/bots/pages/${pageId}/document`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            },
        );

        if (!response.ok) {
            const error = await response.json();
            console.error('Failed to write memo:', error);
            return false;
        }

        const data = await response.json();
        console.log(`Memo updated: ${data.page_id}`);
        return true;
    } catch (error) {
        console.error('Write memo error:', error);
        return false;
    }
}

// Expose helpers for AIHandler and anomaly detection
export { readMemo, writeMemo, sendMessage, authenticatedFetch, config };

// ---- Daily Summary ----

let dailySummaryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Build a markdown summary of all tracked HA entity states.
 */
function buildEntitySummaryMarkdown(): string {
    if (!haClient) return '> Home Assistant not connected.\n';

    const entities = haClient.getExposedEntities();
    if (entities.length === 0) return '> No entities tracked.\n';

    const now = new Date();
    const lines: string[] = [
        `# Home Assistant Summary`,
        ``,
        `**Generated:** ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`,
        `**Entities tracked:** ${entities.length}`,
        ``,
    ];

    // Group by domain
    const byDomain = new Map<string, typeof entities>();
    for (const entity of entities) {
        const domain = entity.entity_id.split('.')[0];
        if (!byDomain.has(domain)) byDomain.set(domain, []);
        byDomain.get(domain)!.push(entity);
    }

    // Sort domains alphabetically
    const sortedDomains = Array.from(byDomain.keys()).sort();

    for (const domain of sortedDomains) {
        const domainEntities = byDomain.get(domain)!;
        const label = domain.charAt(0).toUpperCase() + domain.slice(1);
        lines.push(`## ${label}`);
        lines.push('');

        for (const entity of domainEntities) {
            const name = (entity.attributes.friendly_name as string) || entity.entity_id;
            const state = entity.state;
            const changed = new Date(entity.last_changed).toLocaleTimeString();
            lines.push(`- **${name}**: ${state} *(last changed ${changed})*`);
        }

        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Write the daily summary to the configured memo page.
 */
async function updateDailySummary(): Promise<void> {
    if (!config.summaryPageId) {
        console.log('[DailySummary] No SUMMARY_PAGE_ID configured, skipping.');
        return;
    }

    console.log('[DailySummary] Generating daily summary...');
    const markdown = buildEntitySummaryMarkdown();
    const today = new Date().toLocaleDateString();
    const success = await writeMemo(config.summaryPageId, markdown, `HA Summary — ${today}`);

    if (success) {
        console.log('[DailySummary] Summary written successfully.');
    } else {
        console.error('[DailySummary] Failed to write summary.');
    }
}

/**
 * Schedule the next daily summary run.
 * Runs once at the configured hour each day.
 */
function scheduleDailySummary(): void {
    const now = new Date();
    const target = new Date(now);
    target.setHours(config.summaryCronHour, 0, 0, 0);

    // If we've already passed the target time today, schedule for tomorrow
    if (now >= target) {
        target.setDate(target.getDate() + 1);
    }

    const delay = target.getTime() - now.getTime();
    console.log(
        `[DailySummary] Next run at ${target.toLocaleString()} (in ${Math.round(delay / 60000)} min)`,
    );

    dailySummaryTimer = setTimeout(async () => {
        await updateDailySummary();
        // Re-schedule for the next day
        scheduleDailySummary();
    }, delay);
}

// ---- State Change History & Anomaly Detection ----

import Anthropic from '@anthropic-ai/sdk';
import type { EntityState } from './ha-client';

interface StateChangeRecord {
    entity_id: string;
    old_state: string;
    new_state: string;
    old_attributes: Record<string, unknown>;
    new_attributes: Record<string, unknown>;
    timestamp: string;
    friendly_name: string;
}

/** Rolling buffer of state change events — keeps the last 24 hours max. */
const stateHistory: StateChangeRecord[] = [];
const MAX_HISTORY_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Called by HAClient.onStateChanged — records every state transition.
 */
function recordStateChange(entityId: string, newState: EntityState): void {
    const oldEntity = haClient?.getEntityState(entityId);
    stateHistory.push({
        entity_id: entityId,
        old_state: oldEntity?.state ?? 'unknown',
        new_state: newState.state,
        old_attributes: oldEntity?.attributes ?? {},
        new_attributes: newState.attributes,
        timestamp: new Date().toISOString(),
        friendly_name: (newState.attributes.friendly_name as string) || entityId,
    });

    // Prune entries older than 24h
    const cutoff = Date.now() - MAX_HISTORY_AGE_MS;
    while (stateHistory.length > 0 && new Date(stateHistory[0].timestamp).getTime() < cutoff) {
        stateHistory.shift();
    }
}

/** Return state changes that happened since a given ISO timestamp. */
function getChangesSince(since: string): StateChangeRecord[] {
    const sinceMs = new Date(since).getTime();
    return stateHistory.filter((r) => new Date(r.timestamp).getTime() >= sinceMs);
}

// ---- Anomaly Detection ----

let anomalyTimer: ReturnType<typeof setInterval> | null = null;
let lastAnomalyRun: string = new Date().toISOString();
let anomalyClient: Anthropic | null = null;

interface AnomalyResult {
    event_id: string;
    classification: 'URGENT' | 'ATTENTION' | 'FYI' | 'ALL_CLEAR';
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
    correlations: string[];
    context_factors: string[];
    recommended_action: string;
}

const ANOMALY_DETECTION_PROMPT = `You are an intelligent Home Assistant anomaly detection system. Your job is to analyze sensor events in context and identify anomalies that require attention.

### Your Task
Analyze each event and classify it as:
- **URGENT**: Immediate safety threat or critical failure
- **ATTENTION**: Unusual pattern worth investigating now
- **FYI**: Minor anomaly for daily digest
- **ALL_CLEAR**: Normal operation

### Analysis Framework

**1. Safety First**
- Is this a safety-critical device (smoke, CO, water, security)?
- Does the state indicate immediate danger?
- Are there cascading risks?

**2. Context Analysis**
- Is this normal for current time of day/week?
- Does this match occupancy patterns?
- Is this typical for the season/weather?
- How does this compare to historical behavior?

**3. Correlation Detection**
- Are multiple related events happening together?
- Do related sensors show consistent patterns?
- Is this part of a larger sequence?

**4. Statistical Deviation**
- How far outside normal range is this?
- Is frequency unusual?
- Is timing unexpected?

### Output Format
Respond ONLY with a JSON array. No markdown, no code fences. Each element:
{
  "event_id": "entity.id",
  "classification": "URGENT|ATTENTION|FYI|ALL_CLEAR",
  "confidence": "high|medium|low",
  "reasoning": "Brief explanation",
  "correlations": ["related events or patterns"],
  "context_factors": ["key contextual elements"],
  "recommended_action": "What should be done, if anything"
}

### Key Principles
1. Safety over convenience — err on the side of caution for safety devices
2. Context matters — same event can be normal or anomalous based on context
3. Minimize noise — don't alert on routine, explainable events
4. Explain reasoning — always justify classifications`;

/**
 * Run the anomaly detection cycle.
 * Sends recent state changes + current snapshot to Claude.
 */
async function runAnomalyDetection(): Promise<void> {
    if (!anomalyClient || !haClient) return;

    const since = lastAnomalyRun;
    lastAnomalyRun = new Date().toISOString();

    const recentChanges = getChangesSince(since);
    if (recentChanges.length === 0) {
        console.log('[Anomaly] No state changes since last run, skipping.');
        return;
    }

    console.log(`[Anomaly] Analyzing ${recentChanges.length} state changes...`);

    // Build the current state snapshot
    const entities = haClient.getExposedEntities();
    const currentState: Record<string, { state: string; friendly_name: string }> = {};
    for (const e of entities) {
        currentState[e.entity_id] = {
            state: e.state,
            friendly_name: (e.attributes.friendly_name as string) || e.entity_id,
        };
    }

    const now = new Date();
    const timeContext = {
        time: now.toLocaleTimeString(),
        day: now.toLocaleDateString('en-US', { weekday: 'long' }),
        date: now.toLocaleDateString(),
        hour: now.getHours(),
    };

    const userMessage = JSON.stringify(
        {
            events: recentChanges,
            current_state: currentState,
            time_context: timeContext,
            historical_note: `Total state changes in the last 24h: ${stateHistory.length}`,
        },
        null,
        2,
    );

    try {
        const response = await anomalyClient.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 2048,
            system: ANOMALY_DETECTION_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
        });

        const text = response.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('');

        let results: AnomalyResult[];
        try {
            results = JSON.parse(text);
        } catch {
            console.error('[Anomaly] Failed to parse Claude response as JSON:', text.slice(0, 200));
            return;
        }

        if (!Array.isArray(results) || results.length === 0) {
            console.log('[Anomaly] No anomalies detected.');
            return;
        }

        const urgent = results.filter((r) => r.classification === 'URGENT');
        const attention = results.filter((r) => r.classification === 'ATTENTION');
        const fyi = results.filter((r) => r.classification === 'FYI');
        const highAlert = [...urgent, ...attention];

        console.log(
            `[Anomaly] Results: ${urgent.length} URGENT, ${attention.length} ATTENTION, ${fyi.length} FYI, ${results.length - highAlert.length - fyi.length} ALL_CLEAR`,
        );

        // Always update the alerts memo (if configured)
        if (config.alertsPageId) {
            await updateAlertsMemo(results, recentChanges);
        }

        // If high-alert items, also send a message to the chat page
        if (highAlert.length > 0 && config.alertsChatPageId) {
            const alertMessage = buildAlertChatMessage(highAlert);
            await sendMessage(config.alertsChatPageId, alertMessage);
            console.log(`[Anomaly] Sent ${highAlert.length} high-alert(s) to chat.`);
        }
    } catch (error) {
        console.error('[Anomaly] Detection failed:', error);
    }
}

/**
 * Build markdown for the alerts memo — includes all severity levels.
 */
async function updateAlertsMemo(
    results: AnomalyResult[],
    recentChanges: StateChangeRecord[],
): Promise<void> {
    // Read existing memo to prepend new entries
    let existingContent = '';
    const existing = await readMemo(config.alertsPageId);
    if (existing?.document) {
        // Extract text from ProseMirror JSON for appending
        existingContent = extractProseMirrorText(existing.document);
    }

    const now = new Date();
    const lines: string[] = [];

    // Header
    lines.push(`# Anomaly Alerts`);
    lines.push('');
    lines.push(`**Last scan:** ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`);
    lines.push(`**Changes analysed:** ${recentChanges.length}`);
    lines.push('');

    // Group by classification
    const urgent = results.filter((r) => r.classification === 'URGENT');
    const attention = results.filter((r) => r.classification === 'ATTENTION');
    const fyi = results.filter((r) => r.classification === 'FYI');

    if (urgent.length > 0) {
        lines.push(`## URGENT`);
        lines.push('');
        for (const r of urgent) {
            lines.push(`- **${r.event_id}** — ${r.reasoning}`);
            lines.push(`  - Action: ${r.recommended_action}`);
            if (r.correlations.length) lines.push(`  - Correlations: ${r.correlations.join(', ')}`);
        }
        lines.push('');
    }

    if (attention.length > 0) {
        lines.push(`## Attention`);
        lines.push('');
        for (const r of attention) {
            lines.push(`- **${r.event_id}** — ${r.reasoning}`);
            lines.push(`  - Action: ${r.recommended_action}`);
        }
        lines.push('');
    }

    if (fyi.length > 0) {
        lines.push(`## FYI`);
        lines.push('');
        for (const r of fyi) {
            lines.push(`- **${r.event_id}** — ${r.reasoning}`);
        }
        lines.push('');
    }

    // Append previous content as history
    if (existingContent.trim()) {
        lines.push('---');
        lines.push('');
        lines.push('## Previous Alerts');
        lines.push('');
        // Keep the previous content but strip the top-level heading to avoid duplicates
        const previous = existingContent.replace(/^# Anomaly Alerts\n*/m, '').trim();
        if (previous) {
            lines.push(previous);
        }
    }

    await writeMemo(config.alertsPageId, lines.join('\n'), `Anomaly Alerts`);
}

/**
 * Build a concise chat message for high-severity alerts.
 */
function buildAlertChatMessage(alerts: AnomalyResult[]): string {
    const lines: string[] = [];

    for (const alert of alerts) {
        const icon = alert.classification === 'URGENT' ? '🚨' : '⚠️';
        lines.push(`${icon} **${alert.classification}** — \`${alert.event_id}\``);
        lines.push(alert.reasoning);
        if (alert.recommended_action) {
            lines.push(`→ ${alert.recommended_action}`);
        }
        lines.push('');
    }

    return lines.join('\n').trim();
}

/**
 * Recursively extract plain text from a ProseMirror JSON document.
 */
function extractProseMirrorText(doc: unknown): string {
    if (!doc || typeof doc !== 'object') return '';

    const node = doc as Record<string, unknown>;
    if (node.type === 'text' && typeof node.text === 'string') {
        return node.text;
    }

    if (Array.isArray(node.content)) {
        return node.content.map(extractProseMirrorText).join('');
    }

    return '';
}

function startAnomalyDetection(): void {
    if (!config.alertsPageId && !config.alertsChatPageId) {
        console.log('[Anomaly] No ALERTS_PAGE_ID or ALERTS_CHAT_PAGE_ID configured, skipping.');
        return;
    }

    if (!config.anthropicApiKey) {
        console.log('[Anomaly] No ANTHROPIC_API_KEY set, skipping anomaly detection.');
        return;
    }

    anomalyClient = new Anthropic({ apiKey: config.anthropicApiKey });

    const intervalMs = config.anomalyIntervalMin * 60 * 1000;
    console.log(`[Anomaly] Starting anomaly detection every ${config.anomalyIntervalMin} minutes.`);

    anomalyTimer = setInterval(() => {
        runAnomalyDetection().catch((err) => console.error('[Anomaly] Cycle error:', err));
    }, intervalMs);
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

    // Step 3: Register state change listener for history tracking
    if (haClient) {
        haClient.onStateChanged(recordStateChange);
        console.log('State change history tracking enabled');
    }

    // Step 4: Initialize AI handler with memo editing capabilities
    if (haClient && botId && config.anthropicApiKey) {
        aiHandler = new AIHandler(config.anthropicApiKey, haClient, botId, {
            readMemo,
            writeMemo,
        });
        console.log('AI handler initialized');
    } else if (!config.anthropicApiKey) {
        console.error('ANTHROPIC_API_KEY not set. AI handler not initialized.');
    }

    // Step 5: Schedule daily summary if page ID is configured
    if (config.summaryPageId) {
        scheduleDailySummary();
        // Also run an initial summary on startup
        updateDailySummary().catch((err) =>
            console.error('[DailySummary] Initial run failed:', err),
        );
    } else {
        console.log('SUMMARY_PAGE_ID not set. Daily summary disabled.');
    }

    // Step 6: Start anomaly detection cycle
    if (haClient) {
        startAnomalyDetection();
    }

    console.log('Bot is ready!');
    console.log(`Webhook URL: http://localhost:${config.port}/webhook`);
})();
