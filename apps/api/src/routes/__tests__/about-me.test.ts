import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import { createAuthToken, createUserFixture } from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';
import type { AboutMe, MacDataItem } from '@maple/shared';

vi.mock('../../services/bot-executor.service', () => ({ botExecutor: { invoke: vi.fn() } }));
vi.mock('../../services/proactive-bot.service', () => ({
    handleDeviceDataChanges: vi.fn().mockResolvedValue(undefined),
    maybeAutoReply: vi.fn(),
}));

import {
    aboutMeSummary,
    noteLocationVisits,
    recallAboutMe,
    rememberAboutMe,
    updateAboutMe,
} from '../../services/about-me.service';

const now = Date.now();
const nowSec = Math.floor(now / 1000);

function item(id: string, source: MacDataItem['source'], extra: Partial<MacDataItem> = {}) {
    return {
        id,
        source,
        revision: '1',
        occurredAt: nowSec - 600,
        participants: [],
        body: '',
        ...extra,
    } satisfies MacDataItem;
}

describe.runIf(mongoAvailable)('About me', () => {
    let userId: string;
    let call: (path: string, method?: string, body?: unknown) => Promise<any>;

    beforeEach(async () => {
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

        // The Mac uploaded the user's card, their daughter's card and a weekly practice.
        await call('/api/collectors', 'POST', {
            deviceId: 'mac-device-1',
            platform: 'macos',
            name: 'MacBook',
            sources: ['contacts', 'calendar'],
            timeZone: 'America/New_York',
        });
        const week = 7 * 24 * 3600;
        const tuesday4pm = Date.UTC(2026, 9, 20, 20, 0, 0) / 1000; // Tue 4:00 pm New York
        await call('/api/device-data/items', 'POST', {
            deviceId: 'mac-device-1',
            removals: [],
            upserts: [
                item('contacts:me', 'contacts', {
                    title: 'Zubair Lawrence',
                    extra: {
                        isMe: true,
                        birthday: '1985-04-02',
                        addresses: [{ label: 'home', value: '12 Maple St, Springfield' }],
                        relations: [
                            { label: '_$!<Spouse>!$_', name: 'Julia' },
                            { label: '_$!<Child>!$_', name: 'Emma' },
                        ],
                    },
                }),
                item('contacts:emma', 'contacts', {
                    title: 'Emma',
                    extra: { birthday: '2015-06-01' },
                }),
                ...[0, 1, 2].map((n) =>
                    item(`calendar:practice-${n}`, 'calendar', {
                        title: 'Soccer practice',
                        location: 'Riverside Park',
                        occurredAt: tuesday4pm - n * week,
                        endAt: tuesday4pm - n * week + 3600,
                    }),
                ),
            ],
        });
    });

    it("starts from the user's card, the people on it and weekly routines", async () => {
        const { aboutMe } = (await call('/api/about-me', 'POST')) as { aboutMe: AboutMe };
        expect(aboutMe.me?.name).toBe('Zubair Lawrence');
        const names = new Map(aboutMe.entities.map((e) => [e.id, e.name]));
        expect(
            aboutMe.relations
                .map((r) => `${names.get(r.from)} ${r.type} ${names.get(r.to)}`)
                .sort(),
        ).toEqual(['Zubair Lawrence child Emma', 'Zubair Lawrence spouse Julia']);
        const facts = aboutMe.facts.map((f) => `${names.get(f.about)}: ${f.key} = ${f.value}`);
        expect(facts).toContain('Zubair Lawrence: home_address = 12 Maple St, Springfield');
        expect(facts).toContain('Emma: birthday = 2015-06-01');
        expect(facts.find((f) => f.includes('routine_soccer_practice'))).toContain(
            'Soccer practice on Tuesdays at 16:00',
        );
        // Starting it again doesn't duplicate anything.
        const again = (await call('/api/about-me', 'POST')) as { aboutMe: AboutMe };
        expect(again.aboutMe.entities).toHaveLength(aboutMe.entities.length);
    });

    it('learns, replaces, expires, and keeps sensitive facts until approved', async () => {
        await call('/api/about-me', 'POST');
        const source = { type: 'bot' as const, botId: 'b1', botName: 'Maple' };
        await rememberAboutMe(
            userId,
            {
                about: 'me',
                key: 'travel',
                value: 'In Austin',
                kind: 'current',
                until: new Date(now + 86400e3).toISOString(),
            },
            source,
        );
        await rememberAboutMe(
            userId,
            {
                about: 'me',
                key: 'travel',
                value: 'In Denver until Friday',
                kind: 'current',
                until: new Date(now + 3 * 86400e3).toISOString(),
            },
            source,
        );
        await rememberAboutMe(
            userId,
            {
                about: 'Coach Dan',
                relation: "Emma's soccer coach",
                key: 'phone',
                value: '555-0100',
                kind: 'lasting',
            },
            source,
        );
        expect(
            await rememberAboutMe(
                userId,
                {
                    about: 'me',
                    key: 'condition',
                    value: 'Knee surgery recovery',
                    kind: 'lasting',
                    sensitive: true,
                },
                source,
            ),
        ).toContain('approves');

        let { aboutMe } = (await call('/api/about-me')) as { aboutMe: AboutMe };
        const travel = aboutMe.facts.filter((f) => f.key === 'travel');
        expect(travel.map((f) => f.value)).toEqual(['In Denver until Friday']); // Austin replaced
        expect(aboutMe.entities.map((e) => e.name)).toContain('Coach Dan');
        expect(aboutMe.recentlyLearned.map((f) => f.value)).toEqual(
            expect.arrayContaining(['In Denver until Friday', '555-0100']),
        );
        expect(aboutMe.pending.map((f) => f.value)).toEqual(['Knee surgery recovery']);
        expect(aboutMe.facts.some((f) => f.key === 'condition')).toBe(false);

        // Approve the sensitive one; undo the trip.
        await call(`/api/about-me/facts/${aboutMe.pending[0]!.id}`, 'PATCH', { status: 'active' });
        await call(`/api/about-me/facts/${travel[0]!.id}`, 'PATCH', { status: 'removed' });
        ({ aboutMe } = (await call('/api/about-me')) as { aboutMe: AboutMe });
        expect(aboutMe.facts.some((f) => f.key === 'condition')).toBe(true);
        expect(aboutMe.facts.some((f) => f.key === 'travel')).toBe(false);

        const summary = await aboutMeSummary(userId, 'America/New_York');
        expect(summary).toContain('Their people: ');
        expect(summary).toContain('Julia (spouse)');
        expect(await recallAboutMe(userId, 'coach')).toContain('555-0100');
    });

    it("lets bots change only what bots learned, and reads dates in the user's zone", async () => {
        const { aboutMe } = (await call('/api/about-me', 'POST')) as { aboutMe: AboutMe };
        const address = aboutMe.facts.find((f) => f.key === 'home_address')!;
        const source = { type: 'bot' as const, botId: 'b1' };
        // A fact from the user's contact card: the bot can only suggest a change.
        expect(
            await updateAboutMe(userId, { factId: address.id, value: '1 Phish Way' }, source),
        ).toContain('approves');
        expect(await updateAboutMe(userId, { factId: address.id, remove: true }, source)).toContain(
            'Only the user',
        );
        let profile = ((await call('/api/about-me')) as { aboutMe: AboutMe }).aboutMe;
        expect(profile.facts.find((f) => f.key === 'home_address')?.value).toBe(
            '12 Maple St, Springfield',
        );
        expect(profile.pending.map((f) => f.value)).toContain('1 Phish Way');

        // "Until 2026-10-30" means the end of that day in New York, not UTC midnight.
        await rememberAboutMe(
            userId,
            {
                about: 'me',
                key: 'travel',
                value: 'In Denver',
                kind: 'current',
                until: '2099-10-30',
            },
            source,
            'America/New_York',
        );
        profile = ((await call('/api/about-me')) as { aboutMe: AboutMe }).aboutMe;
        expect(profile.facts.find((f) => f.key === 'travel')?.validUntil).toBe(
            '2099-10-31T03:59:59.000Z',
        );
    });

    it('keeps where you are now from iPhone visits', async () => {
        await call('/api/about-me', 'POST');
        const arrived = item('location:visit:1', 'location', {
            title: 'Home',
            location: '12 Maple St',
            occurredAt: nowSec - 300,
        });
        await noteLocationVisits(userId, [arrived], now);
        let { aboutMe } = (await call('/api/about-me')) as { aboutMe: AboutMe };
        expect(aboutMe.facts.find((f) => f.key === 'location')?.value).toBe('Home');
        expect(await aboutMeSummary(userId, 'America/New_York')).toContain('location = Home');

        await noteLocationVisits(
            userId,
            [{ ...arrived, revision: '2', endAt: nowSec }],
            now + 1000,
        );
        ({ aboutMe } = (await call('/api/about-me')) as { aboutMe: AboutMe });
        // validUntil is now, so it's no longer live a moment later.
        const later = aboutMe.facts.find((f) => f.key === 'location');
        expect(!later || Date.parse(later.validUntil!) <= Date.now()).toBe(true);
    });

    it('lets the user add people and facts, and delete everything', async () => {
        const { entity } = await call('/api/about-me/entities', 'POST', {
            kind: 'pet',
            name: 'Biscuit',
            relationToMe: 'dog',
        });
        const { fact } = await call('/api/about-me/facts', 'POST', {
            about: entity.id,
            key: 'vet',
            value: 'Dr. Patel',
            kind: 'lasting',
        });
        expect(fact.source).toEqual({ type: 'you' });
        expect(
            (
                await call('/api/about-me/facts', 'POST', {
                    about: 'nope',
                    key: 'k',
                    value: 'v',
                    kind: 'lasting',
                })
            ).error,
        ).toBe('Unknown person');
        await call('/api/about-me', 'DELETE');
        const { aboutMe } = (await call('/api/about-me')) as { aboutMe: AboutMe };
        expect(aboutMe.me).toBeNull();
        expect(aboutMe.entities).toEqual([]);
    });
});
