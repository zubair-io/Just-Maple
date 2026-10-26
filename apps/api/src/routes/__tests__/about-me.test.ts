import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createAuthToken,
    createNotebookFixture,
    createUserFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable, testDb } from '../../__tests__/setup';
import { ObjectId } from 'mongodb';
import type { AboutMe, MacDataItem } from '@maple/shared';

vi.mock('../../services/bot-executor.service', () => ({ botExecutor: { invoke: vi.fn() } }));
vi.mock('../../services/proactive-bot.service', () => ({
    handleDeviceDataChanges: vi.fn().mockResolvedValue(undefined),
    maybeAutoReply: vi.fn(),
}));

import {
    aboutMeSummary,
    loadNotebookAboutMe,
    recallAboutMe,
    rememberAboutMe,
    updateAboutMe,
} from '../../services/about-me.service';
import { getMacDataToolContext } from '../../services/mac-data-tools.service';

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

type Call = (path: string, method?: string, body?: unknown) => Promise<any>;

async function caller(userId: string): Promise<Call> {
    const token = await createAuthToken(userId);
    const app = createTestApp();
    return (path, method = 'GET', body) =>
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
}

describe.runIf(mongoAvailable)('About me', () => {
    let userId: string;
    let notebookId: string;
    let call: Call;
    const source = { type: 'bot' as const, botId: 'b1', botName: 'Maple' };

    /** The user's About me in the notebook, as the page loads it. */
    const load = async (as: Call = call) =>
        ((await as(`/api/about-me?notebookId=${notebookId}`)) as { aboutMe: AboutMe }).aboutMe;
    const about = () => loadNotebookAboutMe(notebookId, userId).then((a) => a!);

    /** Adds the About me page and waits for the background seed. */
    async function addAboutMePage(as: Call = call) {
        const { page } = await as('/api/pages', 'POST', {
            type: 'aboutme',
            title: 'About me',
            notebookId,
        });
        for (
            let i = 0;
            i < 50 && !(await load(as)).facts.some((f) => f.key.startsWith('routine'));
            i++
        )
            await new Promise((resolve) => setTimeout(resolve, 20));
        return page;
    }

    beforeEach(async () => {
        const user = await createUserFixture({ displayName: 'Zubair' });
        userId = user._id.toString();
        call = await caller(userId);
        notebookId = (await createNotebookFixture({ createdBy: userId }))._id.toString();

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

    it("is added with + once per notebook, and starts from the creator's card and routines", async () => {
        expect((await call(`/api/about-me?notebookId=${notebookId}`)).error).toBe('Not found');
        const page = await addAboutMePage();
        expect(page.type).toBe('aboutme');
        const again = await call('/api/pages', 'POST', { type: 'aboutme', notebookId });
        expect(again.error).toBe('Already exists');

        const aboutMe = await load();
        expect(aboutMe.me?.name).toBe('Zubair Lawrence');
        const names = new Map(aboutMe.entities.map((e) => [e.id, e.name]));
        expect(
            aboutMe.relations
                .map((r) => `${names.get(r.from)} ${r.type} ${names.get(r.to)}`)
                .sort(),
        ).toEqual(['Zubair Lawrence child Emma', 'Zubair Lawrence spouse Julia']);
        expect(aboutMe.relations[0]!.source?.type).toBe('contacts');
        const facts = aboutMe.facts.map((f) => `${names.get(f.about)}: ${f.key} = ${f.value}`);
        expect(facts).toContain('Zubair Lawrence: home_address = 12 Maple St, Springfield');
        expect(facts).toContain('Emma: birthday = 2015-06-01');
        expect(facts.find((f) => f.includes('routine_soccer_practice'))).toContain(
            'Soccer practice on Tuesdays at 16:00',
        );
    });

    it('belongs to one notebook, and ignores records from before notebooks', async () => {
        await addAboutMePage();
        const other = (await createNotebookFixture({ createdBy: userId }))._id.toString();
        await testDb!.collection('profile_facts').insertOne({
            _id: 'old-fact' as never,
            id: 'old-fact',
            userId,
            about: 'x',
            key: 'old',
            value: 'From before',
            kind: 'lasting',
            source: { type: 'you' },
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        expect((await load()).facts.some((f) => f.key === 'old')).toBe(false);
        expect(await loadNotebookAboutMe(other, userId)).toMatchObject({ people: [] });
        // No About me page in the other notebook: bots there don't get About me at all.
        const bot = { id: 'b1', name: 'Maple', ownerId: userId };
        expect(await getMacDataToolContext(userId, other, bot)).toBeNull();
        const ctx = await getMacDataToolContext(userId, notebookId, bot);
        expect(ctx?.aboutMe?.summary).toContain('### Zubair Lawrence (the user you are helping)');
    });

    it('learns, replaces, expires, keeps sensitive facts until approved, and undoes', async () => {
        await addAboutMePage();
        const remember = async (input: Parameters<typeof rememberAboutMe>[2]) =>
            rememberAboutMe(await about(), userId, input, source);
        await remember({
            about: 'me',
            key: 'travel',
            value: 'In Austin',
            kind: 'current',
            until: new Date(now + 86400e3).toISOString(),
        });
        await remember({
            about: 'me',
            key: 'travel',
            value: 'In Denver until Friday',
            kind: 'current',
            until: new Date(now + 3 * 86400e3).toISOString(),
        });
        await remember({
            about: 'Coach Dan',
            relation: "Emma's soccer coach",
            key: 'phone',
            value: '555-0100',
            kind: 'lasting',
        });
        expect(
            await remember({
                about: 'me',
                key: 'condition',
                value: 'Knee surgery recovery',
                kind: 'lasting',
                sensitive: true,
            }),
        ).toContain('approve');

        let aboutMe = await load();
        const travel = aboutMe.facts.filter((f) => f.key === 'travel');
        expect(travel.map((f) => f.value)).toEqual(['In Denver until Friday']); // Austin replaced
        expect(aboutMe.entities.map((e) => e.name)).toContain('Coach Dan');
        expect(aboutMe.pending.map((f) => f.value)).toEqual(['Knee surgery recovery']);
        expect(aboutMe.facts.some((f) => f.key === 'condition')).toBe(false);

        // Approve the sensitive one; undoing the newer trip brings back the one it replaced.
        const patch = (id: string, body: unknown) =>
            call(`/api/about-me/facts/${id}?notebookId=${notebookId}`, 'PATCH', body);
        await patch(aboutMe.pending[0]!.id, { status: 'active' });
        await patch(travel[0]!.id, { status: 'removed' });
        aboutMe = await load();
        expect(aboutMe.facts.some((f) => f.key === 'condition')).toBe(true);
        expect(aboutMe.facts.filter((f) => f.key === 'travel').map((f) => f.value)).toEqual([
            'In Austin',
        ]);

        // Editing and removing a relation.
        const coach = aboutMe.relations.find((r) => r.type.includes('coach'))!;
        await call(`/api/about-me/relations/${coach.id}?notebookId=${notebookId}`, 'PATCH', {
            type: 'coach',
        });
        expect((await load()).relations.find((r) => r.id === coach.id)?.type).toBe('coach');

        const summary = aboutMeSummary(await about(), userId, 'America/New_York');
        expect(summary).toContain('Julia (spouse)');
        expect(summary).toContain('Mark health, money');
        expect(recallAboutMe(await about(), 'coach')).toContain('555-0100');
    });

    it("lets bots change only what bots learned, and reads dates in the user's zone", async () => {
        await addAboutMePage();
        const address = (await load()).facts.find((f) => f.key === 'home_address')!;
        // A fact from the user's contact card: the bot can only suggest a change.
        expect(
            await updateAboutMe(
                await about(),
                { factId: address.id, value: '1 Phish Way' },
                source,
            ),
        ).toContain('approve');
        expect(
            await updateAboutMe(await about(), { factId: address.id, remove: true }, source),
        ).toContain('Only the person');
        let profile = await load();
        expect(profile.facts.find((f) => f.key === 'home_address')?.value).toBe(
            '12 Maple St, Springfield',
        );
        expect(profile.pending.map((f) => f.value)).toContain('1 Phish Way');

        // "Until 2099-10-30" means the end of that day in New York, not UTC midnight.
        await rememberAboutMe(
            await about(),
            userId,
            { about: 'me', key: 'travel', value: 'Away', kind: 'current', until: '2099-10-30' },
            source,
            'America/New_York',
        );
        profile = await load();
        expect(profile.facts.find((f) => f.key === 'travel')?.validUntil).toBe(
            '2099-10-31T03:59:59.000Z',
        );
    });

    it('in a shared notebook: one About me per member, bots see all, no sensitive facts', async () => {
        const julia = await createUserFixture({ displayName: 'Julia' });
        const juliaId = julia._id.toString();
        const asJulia = await caller(juliaId);
        await testDb!.collection('notebooks').updateOne({ _id: new ObjectId(notebookId) }, {
            $push: { 'sharing.sharedWith': { userId: juliaId, accessLevel: 'write' } },
        } as never);
        await addAboutMePage();
        expect((await load(asJulia)).me).toBeNull(); // Julia has none until something is learned

        const shared = await about();
        expect(shared.shared).toBe(true);
        expect(
            await rememberAboutMe(
                shared,
                userId,
                { about: 'me', key: 'condition', value: 'Flu', kind: 'current', sensitive: true },
                source,
            ),
        ).toContain('Not saved');
        // A save while reading someone else's text still waits for approval, as before.
        await rememberAboutMe(
            shared,
            userId,
            { about: 'me', key: 'gym', value: 'Mornings', kind: 'lasting', pending: true },
            source,
        );
        // About Julia, a member: it goes in her About me.
        expect(
            await rememberAboutMe(
                shared,
                userId,
                { about: 'Julia', key: 'workplace', value: 'The library', kind: 'lasting' },
                source,
            ),
        ).toContain("Julia's About me");
        await rememberAboutMe(
            await about(),
            userId,
            {
                about: 'Max',
                whose: 'Julia',
                relation: 'brother',
                key: 'city',
                value: 'Portland',
                kind: 'lasting',
            },
            source,
        );

        const mine = await load();
        expect(mine.pending.map((f) => f.value)).toEqual(['Mornings']);
        expect(mine.facts.some((f) => f.value === 'The library')).toBe(false);
        const hers = await load(asJulia);
        expect(hers.me?.name).toBe('Julia');
        expect(hers.facts.map((f) => f.value).sort()).toEqual(['Portland', 'The library']);
        expect(hers.entities.map((e) => e.name)).toContain('Max');

        const all = await about();
        const summary = aboutMeSummary(all, userId, 'America/New_York', 'Home');
        expect(summary).toContain('### Zubair Lawrence (the user you are helping)');
        expect(summary).toContain('### Julia (another member of this notebook)');
        expect(summary).toContain('workplace = The library');
        expect(summary).toContain('never save health');
        expect(JSON.parse(recallAboutMe(all, 'portland')).facts[0]).toMatchObject({
            whose: 'Julia',
            about: 'Max',
        });
        // The bot's own context in a shared notebook leaves out where the user is.
        const ctx = await getMacDataToolContext(userId, notebookId, {
            id: 'b1',
            name: 'Maple',
            ownerId: userId,
        });
        expect(ctx?.aboutMe?.notebook.shared).toBe(true);
        expect(ctx?.aboutMe?.summary).not.toContain('Where they are now');
        // Julia can't reach Zubair's facts.
        const zubairFact = mine.facts[0]!;
        expect(
            (
                await asJulia(
                    `/api/about-me/facts/${zubairFact.id}?notebookId=${notebookId}`,
                    'PATCH',
                    { status: 'removed' },
                )
            ).error,
        ).toBe('Not found');
    });

    it('reads where the user is now live from their latest visit', async () => {
        await addAboutMePage();
        await call('/api/collectors', 'POST', {
            deviceId: 'phone-device-1',
            platform: 'ios',
            name: 'iPhone',
            sources: ['location'],
            timeZone: 'America/New_York',
        });
        await call('/api/about-me/places', 'POST', { name: 'Home', lat: 40.7128, lon: -74.006 });
        const visit = item('location:visit:1', 'location', {
            title: '12 Maple St',
            occurredAt: nowSec - 300,
            extra: { lat: 40.71281, lon: -74.00601 },
        });
        await call('/api/device-data/items', 'POST', {
            deviceId: 'phone-device-1',
            removals: [],
            upserts: [visit],
        });
        const bot = { id: 'b1', name: 'Maple', ownerId: userId };
        let ctx = await getMacDataToolContext(userId, notebookId, bot);
        expect(ctx?.aboutMe?.summary).toContain('Where they are now (from their iPhone): Home');
        expect((await load()).facts.some((f) => f.key === 'location')).toBe(false);

        await call('/api/device-data/items', 'POST', {
            deviceId: 'phone-device-1',
            removals: [],
            upserts: [{ ...visit, revision: '2', endAt: nowSec }],
        });
        ctx = await getMacDataToolContext(userId, notebookId, bot);
        expect(ctx?.aboutMe?.summary).not.toContain('Where they are now');
    });
});
