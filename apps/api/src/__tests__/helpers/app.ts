import { messageHistoryRoutes } from '../../routes/message-history';
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { authRoutes } from '../../routes/auth';
import { notebookRoutes } from '../../routes/notebooks';
import { pageRoutes } from '../../routes/pages';
import { messageRoutes } from '../../routes/messages';
import { botRoutes } from '../../routes/bots';
import { deviceDataRoutes } from '../../routes/device-data';
import { calendarProposalRoutes } from '../../routes/calendar-proposals';
import { homeRoutes } from '../../routes/home';
import { botActionRoutes } from '../../routes/bot-actions';
import { replyDraftRoutes } from '../../routes/reply-drafts';
import { macDataRoutes } from '../../routes/mac-data';
import { aboutMeRoutes } from '../../routes/about-me';
import { graphRoutes } from '../../routes/graph';
import { followUpRoutes } from '../../routes/follow-ups';
import { aiRoutes } from '../../routes/ai';
import { templateRoutes } from '../../routes/templates';
import { linkRoutes } from '../../routes/links';
import { jsonDocumentRoutes } from '../../routes/json-documents';
import { canvasRoutes } from '../../routes/canvases';
import { notificationRoutes } from '../../routes/notifications';

export function createTestApp() {
    return new Elysia()
        .use(
            cors({
                origin: ['http://localhost:4200'],
                credentials: true,
            }),
        )
        .use(authRoutes)
        .use(notebookRoutes)
        .use(pageRoutes)
        .use(messageRoutes)
        .use(notificationRoutes)
        .use(botRoutes)
        .use(deviceDataRoutes)
        .use(messageHistoryRoutes)
        .use(calendarProposalRoutes)
        .use(homeRoutes)
        .use(botActionRoutes)
        .use(replyDraftRoutes)
        .use(macDataRoutes)
        .use(aboutMeRoutes)
        .use(graphRoutes)
        .use(followUpRoutes)
        .use(aiRoutes)
        .use(templateRoutes)
        .use(linkRoutes)
        .use(jsonDocumentRoutes)
        .use(canvasRoutes)
        .get('/api/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }));
}

export type TestApp = ReturnType<typeof createTestApp>;
