import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createAuthToken,
    createNotebookFixture,
    createPageFixture,
    createUserFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable, testDb } from '../../__tests__/setup';
import type { MacDataItem } from '@maple/shared';

vi.mock('../../services/bot-executor.service', () => ({ botExecutor: { invoke: vi.fn() } }));
vi.mock('../../services/proactive-bot.service', () => ({
    handleDeviceDataChanges: vi.fn().mockResolvedValue(undefined),
    maybeAutoReply: vi.fn(),
    runDailyBrief: vi.fn().mockResolvedValue(true),
    sendLeaveReminder: vi.fn().mockResolvedValue(true),
    askAboutMeQuestion: vi.fn().mockResolvedValue(true),
}));

import {
    askAboutMeQuestion,
    runDailyBrief,
    sendLeaveReminder,
} from '../../services/proactive-bot.service';
import { tick } from '../../services/proactive-scheduler.service';
import { currentPlace } from '../../services/about-me.service';

describe.runIf(mongoAvailable)('scheduled proactive messages and named places', () => {
    let userId: string;
    let notebookId: string;
    let chatPageId: string;
    let call: (path: string, method?: string, body?: unknown) => Promise<any>;

    // The tests read the clock (upcoming events, uploads): pin it to the morning of the
    // test day so they pass at any real time.
    afterEach(() => {
        vi.useRealTimers();
    });

    beforeEach(async () => {
        vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-26T09:00:00-04:00') });
        vi.clearAllMocks();
        vi.mocked(runDailyBrief).mockResolvedValue(true);
        vi.mocked(sendLeaveReminder).mockResolvedValue(true);
        vi.mocked(askAboutMeQuestion).mockResolvedValue(true);
        const user = await createUserFixture();
        userId = user._id.toString();
        const token = await createAuthToken(userId);
        const app = createTestApp();
        call = (path, method = 'GET', body) =>
            app
                .handle(
                    new Request('http://localhost' + path, {
                        method,
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: 'Bearer ' + token,
                        },
                        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                    }),
                )
                .then((r) => r.json());
        await call('/api/collectors', 'POST', {
            deviceId: 'mac-device-1',
            platform: 'macos',
            name: 'MacBook',
            sources: ['calendar'],
            timeZone: 'America/New_York',
        });
        await call('/api/collectors', 'POST', {
            deviceId: 'phone-device-1',
            platform: 'ios',
            name: 'iPhone',
            sources: ['location'],
            timeZone: 'America/New_York',
        });
        const notebook = await createNotebookFixture({ createdBy: userId });
        notebookId = notebook._id.toString();
        const chat = await createPageFixture({ userId, notebookId, type: 'message' });
        chatPageId = chat.id;
        await testDb!.collection('pages').updateOne(
            { _id: chat._id },
            {
                $set: {
                    proactive: {
                        userBotId: new ObjectId().toString(),
                        instructions: '',
                        enabled: true,
                        ownerUserId: userId,
                        briefTime: '07:30',
                        updatedAt: new Date(),
                    },
                },
            },
        );
        const calendarPage = await createPageFixture({
            userId,
            notebookId,
            type: 'devicedata' as never,
        });
        await testDb!
            .collection('pages')
            .updateOne({ _id: calendarPage._id }, { $set: { deviceSource: 'calendar' } });
    });

    // 2026-10-26 is a Monday; New York is UTC-4 that day.
    const at = (localTime: string) => new Date(`2026-10-26T${localTime}:00-04:00`);

    it("sends one brief a day at the brief time in the user's time zone", async () => {
        await tick(at('07:20'));
        expect(runDailyBrief).not.toHaveBeenCalled();
        await tick(at('07:31'));
        await tick(at('07:32')); // a second tick, or a second server, doesn't resend
        expect(runDailyBrief).toHaveBeenCalledTimes(1);
        expect(vi.mocked(runDailyBrief).mock.calls[0]![0].id).toBe(chatPageId);
        await tick(new Date('2026-10-27T07:35:00-04:00'));
        expect(runDailyBrief).toHaveBeenCalledTimes(2); // the next day
    });

    // Lets the background "did it go out?" bookkeeping finish.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

    it('retries a brief that did not go out, a few minutes later', async () => {
        vi.mocked(runDailyBrief).mockResolvedValueOnce(false); // e.g. the bot couldn't run
        await tick(at('07:31'));
        await settle();
        await tick(at('07:33')); // too soon to retry
        expect(runDailyBrief).toHaveBeenCalledTimes(1);
        await tick(at('07:37'));
        await settle();
        expect(runDailyBrief).toHaveBeenCalledTimes(2);
        await tick(at('07:45')); // that one went out
        expect(runDailyBrief).toHaveBeenCalledTimes(2);
    });

    it('catches up a late-evening brief after midnight, for the day before', async () => {
        await testDb!
            .collection('pages')
            .updateOne({ id: chatPageId }, { $set: { 'proactive.briefTime': '23:30' } });
        await tick(new Date('2026-10-27T00:15:00-04:00'));
        await tick(new Date('2026-10-27T00:16:00-04:00'));
        expect(runDailyBrief).toHaveBeenCalledTimes(1);
        await tick(new Date('2026-10-27T23:31:00-04:00')); // that night's brief
        expect(runDailyBrief).toHaveBeenCalledTimes(2);
    });

    it("sends no brief when the user's time zone is unknown", async () => {
        await testDb!.collection('collectors').updateMany({ userId }, { $unset: { timeZone: '' } });
        await tick(new Date('2026-10-26T07:31:00Z'));
        await tick(at('07:31'));
        expect(runDailyBrief).not.toHaveBeenCalled();
    });

    async function addEvent(
        id: string,
        title: string,
        location: string,
        startsAt = '15:00',
        fields: Partial<MacDataItem> = {},
    ) {
        const start = at(startsAt).getTime() / 1000;
        await call('/api/device-data/items', 'POST', {
            deviceId: 'mac-device-1',
            removals: [],
            upserts: [
                {
                    id,
                    source: 'calendar',
                    revision: '1',
                    occurredAt: start,
                    title,
                    location,
                    participants: [],
                    body: '',
                    ...fields,
                } satisfies MacDataItem,
            ],
        });
        await call('/api/device-data/travel', 'POST', {
            deviceId: 'phone-device-1',
            estimates: [{ eventId: id, minutes: 25, computedAt: at('14:00').toISOString() }],
        });
    }

    /** The iPhone uploads a visit (open unless it has an end). */
    async function addVisit(visit: Partial<MacDataItem> & { id: string; occurredAt: number }) {
        await call('/api/device-data/items', 'POST', {
            deviceId: 'phone-device-1',
            removals: [],
            upserts: [
                {
                    source: 'location',
                    revision: '1',
                    participants: [],
                    body: '',
                    ...visit,
                } satisfies MacDataItem,
            ],
        });
    }

    it('reminds about an event even when its title mentions where the user is', async () => {
        await call('/api/about-me/places', 'POST', { name: 'Home', lat: 40.7128, lon: -74.006 });
        await addVisit({
            id: 'location:visit:home',
            occurredAt: at('13:00').getTime() / 1000,
            title: '12 Maple St',
            extra: { lat: 40.7128, lon: -74.006 },
        });
        await addEvent('calendar:homecoming', 'Homecoming game', 'Central High, Springfield');
        await addEvent('calendar:party', 'Party', 'Home');
        await tick(at('14:21'));
        expect(vi.mocked(sendLeaveReminder).mock.calls.map((c) => c[2].title)).toEqual([
            'Homecoming game',
        ]);
    });

    it("sends leave reminders to the user's private chat, not a shared one", async () => {
        const shared = await createNotebookFixture({ createdBy: userId });
        await testDb!.collection('notebooks').updateOne(
            { _id: shared._id },
            {
                $set: {
                    'sharing.sharedWith': [
                        { userId, accessLevel: 'owner' },
                        { userId: 'someone-else', accessLevel: 'read' },
                    ],
                },
            },
        );
        const sharedChat = await createPageFixture({
            userId,
            notebookId: shared._id.toString(),
            type: 'message',
        });
        // Older than the private chat, so it would win on order alone.
        await testDb!.collection('pages').updateOne(
            { _id: sharedChat._id },
            {
                $set: {
                    createdAt: new Date('2020-01-01T00:00:00Z'),
                    proactive: {
                        userBotId: new ObjectId().toString(),
                        instructions: '',
                        enabled: true,
                        ownerUserId: userId,
                        updatedAt: new Date(),
                    },
                },
            },
        );
        const calendar = await createPageFixture({
            userId,
            notebookId: shared._id.toString(),
            type: 'devicedata' as never,
        });
        await testDb!
            .collection('pages')
            .updateOne({ _id: calendar._id }, { $set: { deviceSource: 'calendar' } });
        await addEvent('calendar:dentist', 'Dentist', '1 Main St');
        await tick(at('14:21'));
        expect(sendLeaveReminder).toHaveBeenCalledTimes(1);
        expect(vi.mocked(sendLeaveReminder).mock.calls[0]![0].id).toBe(chatPageId);
    });

    const setCalendarFilter = (deviceFilter: unknown) =>
        testDb!
            .collection('pages')
            .updateOne(
                { notebookId: new ObjectId(notebookId), type: 'devicedata' },
                { $set: { deviceFilter } },
            );
    const shareNotebook = (members: Array<{ userId: string; accessLevel: string }>) =>
        testDb!
            .collection('notebooks')
            .updateOne(
                { _id: new ObjectId(notebookId) },
                { $set: { 'sharing.sharedWith': members } },
            );
    const remindedTitles = () => vi.mocked(sendLeaveReminder).mock.calls.map((c) => c[2].title);

    it("reminds only about events the notebook's calendar page shares", async () => {
        await setCalendarFilter({ calendars: [{ name: 'Family' }] });
        await addEvent('calendar:dentist', 'Dentist', '1 Main St', '15:00', { calendar: 'Work' });
        await addEvent('calendar:practice', 'Practice', '2 Field Rd', '15:00', {
            calendar: 'Family',
        });
        await tick(at('14:21'));
        expect(remindedTitles()).toEqual(['Practice']);
    });

    it('in a shared notebook, reminds only from a filtered page, and only about what it shares', async () => {
        await shareNotebook([
            { userId, accessLevel: 'owner' },
            { userId: new ObjectId().toString(), accessLevel: 'write' },
        ]);
        await addEvent('calendar:dentist', 'Dentist', '1 Main St', '15:00', { calendar: 'Work' });
        await addEvent('calendar:practice', 'Practice', '2 Field Rd', '15:00', {
            calendar: 'Family',
        });
        // No filter: the page shares nothing with bots in a shared notebook.
        await tick(at('14:21'));
        expect(sendLeaveReminder).not.toHaveBeenCalled();
        await setCalendarFilter({ calendars: [{ name: 'Family' }] });
        await tick(at('14:22'));
        expect(remindedTitles()).toEqual(['Practice']);
    });

    it('sends no reminders into a notebook the user has left', async () => {
        await shareNotebook([{ userId: new ObjectId().toString(), accessLevel: 'owner' }]);
        await addEvent('calendar:dentist', 'Dentist', '1 Main St');
        await tick(at('14:21'));
        expect(sendLeaveReminder).not.toHaveBeenCalled();
    });

    it('ignores travel times with a bad or future time', async () => {
        await addEvent('calendar:dentist', 'Dentist', '1 Main St');
        const future = await call('/api/device-data/travel', 'POST', {
            deviceId: 'phone-device-1',
            estimates: [
                { eventId: 'calendar:dentist', minutes: 25, computedAt: at('18:00').toISOString() },
            ],
        });
        expect(future.error).toBeUndefined();
        await tick(at('14:21'));
        expect(sendLeaveReminder).not.toHaveBeenCalled();
        const bad = await call('/api/device-data/travel', 'POST', {
            deviceId: 'phone-device-1',
            estimates: [{ eventId: 'calendar:dentist', minutes: 25, computedAt: 'soon' }],
        });
        expect(bad.saved).toBeUndefined();
    });

    it("says when to leave, using the iPhone's travel time, once per event", async () => {
        const start = at('15:00').getTime() / 1000;
        await call('/api/device-data/items', 'POST', {
            deviceId: 'mac-device-1',
            removals: [],
            upserts: [
                {
                    id: 'calendar:game',
                    source: 'calendar',
                    revision: '1',
                    occurredAt: start,
                    endAt: start + 5400,
                    title: "Emma's soccer game",
                    location: 'Riverside Park, Springfield',
                    participants: [],
                    body: '',
                } satisfies MacDataItem,
            ],
        });
        // The phone asks for upcoming events with a location…
        const upcoming = await call('/api/device-data/upcoming?hours=48');
        expect(upcoming.events.map((e: { id: string }) => e.id)).toContain('calendar:game');
        // …and reports 25 minutes of driving from Home.
        await call('/api/device-data/travel', 'POST', {
            deviceId: 'phone-device-1',
            estimates: [
                {
                    eventId: 'calendar:game',
                    minutes: 25,
                    origin: 'Home',
                    computedAt: at('14:00').toISOString(),
                },
            ],
        });
        // Leave by 14:25 (25 min + 10 min buffer); a heads-up from 14:20.
        await tick(at('14:10'));
        expect(sendLeaveReminder).not.toHaveBeenCalled();
        await tick(at('14:21'));
        await tick(at('14:22'));
        expect(sendLeaveReminder).toHaveBeenCalledTimes(1);
        expect(vi.mocked(sendLeaveReminder).mock.calls[0]![2]).toMatchObject({
            title: "Emma's soccer game",
            location: 'Riverside Park, Springfield',
            leaveBy: '2026-10-26T14:25:00-04:00',
            note: 'about 25 min drive from Home',
        });
    });

    it('stays quiet when the travel time is stale', async () => {
        const start = at('15:00').getTime() / 1000;
        await call('/api/device-data/items', 'POST', {
            deviceId: 'mac-device-1',
            removals: [],
            upserts: [
                {
                    id: 'calendar:dentist',
                    source: 'calendar',
                    revision: '1',
                    occurredAt: start,
                    title: 'Dentist',
                    location: '1 Main St',
                    participants: [],
                    body: '',
                } satisfies MacDataItem,
            ],
        });
        await call('/api/device-data/travel', 'POST', {
            deviceId: 'phone-device-1',
            estimates: [
                { eventId: 'calendar:dentist', minutes: 20, computedAt: at('09:00').toISOString() },
            ],
        });
        await tick(at('14:30'));
        expect(sendLeaveReminder).not.toHaveBeenCalled();
    });

    it("names visits after the user's named places, on the account", async () => {
        const { place } = await call('/api/about-me/places', 'POST', {
            name: 'Home',
            lat: 40.7128,
            lon: -74.006,
            radius: 150,
        });
        expect(place).toMatchObject({ kind: 'place', name: 'Home' });
        // Naming it again moves it rather than adding a second Home.
        await call('/api/about-me/places', 'POST', { name: 'home', lat: 40.7129, lon: -74.006 });
        expect((await call('/api/about-me/places')).places).toHaveLength(1);

        await addVisit({
            id: 'location:visit:1',
            occurredAt: Math.floor(Date.now() / 1000) - 60,
            title: '12 Maple St',
            extra: { lat: 40.71295, lon: -74.00605 },
        });
        expect(await currentPlace(userId)).toBe('Home');
        // Places aren't About me facts, and stay on the account.
        expect(await testDb!.collection('profile_facts').countDocuments({ userId })).toBe(0);
        const stored = await testDb!.collection('profile_entities').findOne({ userId });
        expect(stored?.notebookId).toBeUndefined();
    });

    describe('About me questions', () => {
        beforeEach(async () => {
            await createPageFixture({ userId, notebookId, type: 'aboutme' as never });
        });

        it('asks at most once a day, in the early evening', async () => {
            await tick(at('12:00'));
            expect(askAboutMeQuestion).not.toHaveBeenCalled();
            await tick(at('17:31'));
            await tick(at('18:15'));
            expect(askAboutMeQuestion).toHaveBeenCalledTimes(1);
            expect(vi.mocked(askAboutMeQuestion).mock.calls[0]![0].id).toBe(chatPageId);
            await tick(new Date('2026-10-27T17:40:00-04:00'));
            expect(askAboutMeQuestion).toHaveBeenCalledTimes(2);
        });

        it('never asks in a shared notebook or one without About me', async () => {
            await testDb!.collection('notebooks').updateOne({ _id: new ObjectId(notebookId) }, {
                $push: { 'sharing.sharedWith': { userId: 'someone', accessLevel: 'read' } },
            } as never);
            await tick(at('17:31'));
            expect(askAboutMeQuestion).not.toHaveBeenCalled();
            await testDb!
                .collection('pages')
                .deleteMany({ type: 'aboutme', userId: new ObjectId(userId) });
            await testDb!.collection('notebooks').updateOne({ _id: new ObjectId(notebookId) }, {
                $pull: { 'sharing.sharedWith': { userId: 'someone' } },
            } as never);
            await tick(at('17:32'));
            expect(askAboutMeQuestion).not.toHaveBeenCalled();
        });
    });
});
