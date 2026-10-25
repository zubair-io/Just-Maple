import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../redis.service', () => ({
    redisPubSub: {
        publishTo: vi.fn(),
        subscribeTo: vi.fn().mockResolvedValue(undefined),
        unsubscribeFrom: vi.fn().mockResolvedValue(undefined),
        setKey: vi.fn().mockResolvedValue(undefined),
        getKey: vi.fn().mockResolvedValue(null),
        deleteKey: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('../../repositories/mac-data-host.repo', () => ({
    upsertMacDataHost: vi.fn().mockResolvedValue(undefined),
}));

import { MacDataRelayService, MacDataUnavailableError } from '../mac-data-relay.service';
import { redisPubSub } from '../redis.service';
import { upsertMacDataHost } from '../../repositories/mac-data-host.repo';

const info = { timeZone: 'America/New_York', now: '', notebooks: [], pendingEmbeddings: 0 };

function fakeSocket() {
    const sent: any[] = [];
    return { sent, send: (data: string) => sent.push(JSON.parse(data)) };
}

describe('MacDataRelayService', () => {
    let relay: MacDataRelayService;
    beforeEach(() => {
        vi.clearAllMocks();
        relay = new MacDataRelayService();
    });

    it('registers a host and marks it online', async () => {
        const socket = fakeSocket();
        await relay.register('u1', socket, info);
        expect(upsertMacDataHost).toHaveBeenCalledWith('u1', info);
        expect(redisPubSub.setKey).toHaveBeenCalledWith('macdata:host:u1', expect.any(String), 90);
        expect(socket.sent).toEqual([]);
        expect(await relay.isOnline('u1')).toBe(true);
    });

    it('sends requests to the Mac and resolves with its answer', async () => {
        const socket = fakeSocket();
        await relay.register('u1', socket);
        const pending = relay.request('u1', 'embed', { text: 'ups' });
        await vi.waitFor(() => expect(socket.sent.length).toBe(1));
        const request = socket.sent[0].event;
        expect(request).toMatchObject({ type: 'request', op: 'embed', params: { text: 'ups' } });

        // Another user's Mac can't answer this request.
        relay.handleResult('u2', request.requestId, [9]);
        relay.handleResult('u1', request.requestId, [0.1, 0.2]);
        await expect(pending).resolves.toEqual([0.1, 0.2]);
    });

    it('rejects with the Mac’s error message', async () => {
        const socket = fakeSocket();
        await relay.register('u1', socket);
        const pending = relay.request('u1', 'embed', { text: 'x' });
        await vi.waitFor(() => expect(socket.sent.length).toBe(1));
        relay.handleResult('u1', socket.sent[0].event.requestId, undefined, 'No model');
        await expect(pending).rejects.toThrow('No model');
    });

    it('fails fast when the Mac is offline, and times out when it never answers', async () => {
        await expect(relay.request('u1', 'embed', {})).rejects.toBeInstanceOf(
            MacDataUnavailableError,
        );

        await relay.register('u1', fakeSocket());
        await expect(relay.request('u1', 'embed', {}, 20)).rejects.toThrow("didn't answer in time");
    });

    it('forwards through Redis when the Mac is on another instance', async () => {
        vi.mocked(redisPubSub.getKey).mockResolvedValueOnce('other-instance');
        const pending = relay.request('u1', 'embed', {}, 50);
        await vi.waitFor(() => expect(redisPubSub.publishTo).toHaveBeenCalled());
        const [channel, message] = vi.mocked(redisPubSub.publishTo).mock.calls[0]!;
        expect(channel).toBe('macdata:req:u1');
        expect(message).toMatchObject({ op: 'embed', replyTo: expect.any(String) });
        await expect(pending).rejects.toBeInstanceOf(MacDataUnavailableError);
    });

    it('forgets a host when its socket closes', async () => {
        const socket = fakeSocket();
        await relay.register('u1', socket);
        await relay.unregister('u1', fakeSocket()); // a different socket: ignored
        expect(await relay.isOnline('u1')).toBe(true);
        await relay.unregister('u1', socket);
        expect(await relay.isOnline('u1')).toBe(false);
        expect(redisPubSub.deleteKey).toHaveBeenCalledWith('macdata:host:u1');
    });
});
