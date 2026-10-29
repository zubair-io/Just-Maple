import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createAuthToken,
    createNotebookFixture,
    createPageFixture,
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
        expect(again.page.id).toBe(page.id); // the same page, not a second one

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
                userId,
                { factId: address.id, value: '1 Phish Way' },
                source,
            ),
        ).toContain('approve');
        expect(
            await updateAboutMe(
                await about(),
                userId,
                { factId: address.id, remove: true },
                source,
            ),
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
        // A name in `about` is one of the user's own people, even when a member has it.
        expect(
            await rememberAboutMe(
                shared,
                userId,
                { about: 'Julia', key: 'workplace', value: 'The library', kind: 'lasting' },
                source,
            ),
        ).toContain('in their About me');
        // Only `whose` writes to another member's About me, and it waits for her approval.
        expect(
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
            ),
        ).toContain("approve it in Julia's About me");
        expect(
            await rememberAboutMe(
                await about(),
                userId,
                { about: 'me', whose: 'Nobody', key: 'k', value: 'v', kind: 'lasting' },
                source,
            ),
        ).toContain('nobody named Nobody');

        const mine = await load();
        expect(mine.pending.map((f) => f.value)).toEqual(['Mornings']);
        const names = new Map(mine.entities.map((e) => [e.id, e.name]));
        expect(mine.facts.find((f) => f.value === 'The library')?.about).toBe(
            [...names].find(([, name]) => name === 'Julia')![0],
        );
        let hers = await load(asJulia);
        expect(hers.me?.name).toBe('Julia');
        expect(hers.facts).toEqual([]);
        expect(hers.pending.map((f) => f.value)).toEqual(['Portland']);
        expect(hers.entities.map((e) => e.name)).toContain('Max');
        await asJulia(
            `/api/about-me/facts/${hers.pending[0]!.id}?notebookId=${notebookId}`,
            'PATCH',
            {
                status: 'active',
            },
        );
        hers = await load(asJulia);
        const portland = hers.facts.find((f) => f.value === 'Portland')!;

        // Zubair's bot can only suggest changes to Julia's facts, and never remove them.
        expect(
            await updateAboutMe(
                await about(),
                userId,
                { factId: portland.id, remove: true },
                source,
            ),
        ).toContain('Only the person');
        expect(
            await updateAboutMe(
                await about(),
                userId,
                { factId: portland.id, value: 'Seattle' },
                source,
            ),
        ).toContain('approve');
        hers = await load(asJulia);
        expect(hers.facts.find((f) => f.key === 'city')?.value).toBe('Portland');
        expect(hers.pending.map((f) => f.value)).toEqual(['Seattle']);

        const all = await about();
        const summary = aboutMeSummary(all, userId, 'America/New_York', 'Home');
        expect(summary).toContain('### Zubair Lawrence (the user you are helping)');
        expect(summary).toContain('### Julia (another member of this notebook)');
        expect(summary).toContain('city = Portland');
        expect(summary).toContain(
            'Mark health, money, legal and relationship-trouble facts as sensitive',
        );
        expect(summary).not.toMatch(/sick|traveling until/i);
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

    it('in a shared notebook, refuses health, money, legal and whereabouts facts by their words', async () => {
        await testDb!.collection('notebooks').updateOne({ _id: new ObjectId(notebookId) }, {
            $set: { 'sharing.isPublic': true },
        } as never);
        await addAboutMePage();
        const save = async (key: string, value: string, kind: 'lasting' | 'current' = 'lasting') =>
            rememberAboutMe(await about(), userId, { about: 'me', key, value, kind }, source);
        expect(await save('recovery', 'Recovering from knee surgery')).toContain('Not saved');
        expect(await save('salary', '90k')).toContain('Not saved');
        expect(await save('note', 'Meeting the divorce lawyer')).toContain('Not saved');
        expect(await save('status', 'Traveling to Chicago', 'current')).toContain(
            'where someone is',
        );
        expect(await save('location', 'At the office', 'current')).toContain('where someone is');
        // Ordinary facts, and plans that aren't whereabouts, still save.
        expect(await save('team', 'Tennis on the north court')).toContain('Saved');
        expect(await save('school_break', 'No school this week', 'current')).toContain('Saved');
        expect((await load()).facts.map((f) => f.key)).not.toContain('salary');
    });

    it('hides sensitive facts while a notebook is shared, and brings them back when private', async () => {
        await addAboutMePage();
        const remember = async (input: Parameters<typeof rememberAboutMe>[2]) =>
            rememberAboutMe(await about(), userId, input, source);
        const patch = (id: string, body: unknown) =>
            call(`/api/about-me/facts/${id}?notebookId=${notebookId}`, 'PATCH', body);
        // While private: one sensitive fact approved, one waiting, and an approved one a
        // bot later replaced with a non-sensitive value.
        await remember({
            about: 'me',
            key: 'allergy',
            value: 'Penicillin',
            kind: 'lasting',
            sensitive: true,
        });
        await remember({
            about: 'me',
            key: 'diet',
            value: 'Low salt',
            kind: 'lasting',
            sensitive: true,
        });
        await remember({
            about: 'me',
            key: 'gym',
            value: 'Knee rehab',
            kind: 'lasting',
            sensitive: true,
        });
        let aboutMe = await load();
        const allergy = aboutMe.pending.find((f) => f.key === 'allergy')!;
        const gym = aboutMe.pending.find((f) => f.key === 'gym')!;
        await patch(allergy.id, { status: 'active' });
        await patch(gym.id, { status: 'active' });
        await remember({ about: 'me', key: 'gym', value: 'Mornings', kind: 'lasting' });
        const mornings = (await load()).facts.find((f) => f.value === 'Mornings')!;

        // Julia joins: the notebook is shared now.
        const julia = await createUserFixture({ displayName: 'Julia' });
        await testDb!.collection('notebooks').updateOne({ _id: new ObjectId(notebookId) }, {
            $push: { 'sharing.sharedWith': { userId: julia._id.toString(), accessLevel: 'read' } },
        } as never);
        aboutMe = await load();
        expect(aboutMe.facts.some((f) => f.sensitive)).toBe(false);
        expect(aboutMe.pending).toEqual([]);
        expect(JSON.stringify((await about()).people)).not.toContain('Penicillin');
        // Can't be approved, restored or edited while shared.
        const diet = (await testDb!.collection('profile_facts').findOne({ key: 'diet', userId }))!;
        expect((await patch(String(diet._id), { status: 'active' })).error).toBe('Not allowed');
        expect((await patch(allergy.id, { value: 'None' })).error).toBe('Not allowed');
        // Undoing the bot's change doesn't bring the sensitive one back.
        await patch(mornings.id, { status: 'removed' });
        aboutMe = await load();
        expect(aboutMe.facts.some((f) => f.key === 'gym')).toBe(false);

        // Private again: they're all there, nothing was deleted.
        await testDb!.collection('notebooks').updateOne({ _id: new ObjectId(notebookId) }, {
            $pull: { 'sharing.sharedWith': { userId: julia._id.toString() } },
        } as never);
        aboutMe = await load();
        expect(aboutMe.facts.find((f) => f.key === 'allergy')?.value).toBe('Penicillin');
        expect(aboutMe.pending.map((f) => f.value)).toEqual(['Low salt']);
    });

    it('is only for members who can edit, and a notebook keeps exactly one', async () => {
        const reader = await createUserFixture({ displayName: 'Reader' });
        const asReader = await caller(reader._id.toString());
        await testDb!.collection('notebooks').updateOne({ _id: new ObjectId(notebookId) }, {
            $set: { 'sharing.isPublic': true },
            $push: { 'sharing.sharedWith': { userId: reader._id.toString(), accessLevel: 'read' } },
        } as never);
        const stranger = await caller((await createUserFixture())._id.toString());
        for (const as of [asReader, stranger]) {
            const reply = await as('/api/pages', 'POST', { type: 'aboutme', notebookId });
            expect(reply.error).toBe('Not allowed');
        }

        const page = await addAboutMePage();
        expect(page.id).toBe(`aboutme-${notebookId}`);
        expect((await asReader(`/api/about-me?notebookId=${notebookId}`)).error).toBe('Not found');
        // Adding it again returns the same page, also after it went to the trash.
        const again = await call('/api/pages', 'POST', { type: 'aboutme', notebookId });
        expect(again.page.id).toBe(page.id);
        await call(`/api/pages/${page.id}/trash`, 'POST');
        const restored = await call('/api/pages', 'POST', { type: 'aboutme', notebookId });
        expect(restored.page).toMatchObject({ id: page.id, isTrashed: false });
        expect(await testDb!.collection('pages').countDocuments({ type: 'aboutme' })).toBe(1);

        // An older copy can't come back from the trash beside it, and it can't move.
        const old = await createPageFixture({
            userId,
            notebookId,
            type: 'aboutme' as never,
            isTrashed: true,
        });
        expect((await call(`/api/pages/${old.id}/restore`, 'POST')).error).toBe('Not allowed');
        expect((await call(`/api/pages/${old.id}`, 'PATCH', { isTrashed: false })).error).toBe(
            'Not allowed',
        );
        const other = (await createNotebookFixture({ createdBy: userId }))._id.toString();
        expect((await call(`/api/pages/${page.id}`, 'PATCH', { notebookId: other })).error).toBe(
            'Not allowed',
        );
    });

    it('indexes About me lookups by notebook', async () => {
        const { createIndexes } =
            await vi.importActual<typeof import('../../db/client')>('../../db/client');
        // A database of its own, so the other tests' database keeps its indexes as they were.
        const { SqliteDatabase } = await import('../../db/sqlite/client');
        const storage = new SqliteDatabase(':memory:');
        await storage.ready;
        const db = storage.asRepositoryDatabase();
        try {
            await createIndexes(db);
            const keys = async (collection: string) =>
                (await db.collection(collection).indexes()).map((index) => index.key);
            expect(await keys('profile_entities')).toContainEqual({ notebookId: 1, isMe: 1 });
            expect(await keys('profile_facts')).toContainEqual({ notebookId: 1 });
            expect(await keys('profile_facts')).toContainEqual({ userId: 1, notebookId: 1 });
        } finally {
            await storage.close();
        }
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
