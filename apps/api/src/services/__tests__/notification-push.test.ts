import { describe, it, expect, beforeEach, vi } from 'vitest';

const config = vi.hoisted(() => ({
    paperbarkUrl: 'https://paperbark.example' as string | undefined,
    paperbarkApiKey: undefined as string | undefined,
    apnsKey: 'key' as string | undefined,
    apnsKeyPath: undefined as string | undefined,
    useDirectApns: false,
}));
vi.mock('../../config', () => ({ config }));

vi.mock('../../repositories/notification.repo', () => ({
    createNotification: vi.fn().mockResolvedValue({ _id: 'n1' }),
    findDeviceRegistrationsByUserId: vi.fn(),
    countUnreadNotifications: vi.fn().mockResolvedValue(3),
    deleteDeviceRegistrationByToken: vi.fn(),
    setDeviceRegistrationEnvironment: vi.fn(),
}));
vi.mock('../../repositories/unread.repo', () => ({ markAsReadByPageId: vi.fn() }));
vi.mock('../../repositories/page.repo', () => ({ findMessagesPageByNotebookId: vi.fn() }));
vi.mock('../apns.service', async (importOriginal) => ({
    ApnsPushError: (await importOriginal<typeof import('../apns.service')>()).ApnsPushError,
    sendApnsPush: vi.fn(),
}));

import * as repo from '../../repositories/notification.repo';
import { ApnsPushError, sendApnsPush } from '../apns.service';
import { describePushSetup, sendNotification } from '../notification.service';

const device = {
    _id: 'd1',
    userId: 'u1',
    serverUrl: 'https://justmaple.app',
    deviceToken: 'abcdef0123456789',
    platform: 'ios' as const,
    production: false,
    registeredAt: '',
    lastUsed: '',
};

function pushResultLog(log: ReturnType<typeof vi.spyOn>): string {
    return String(log.mock.calls.find((call) => String(call[0]).includes('Push results'))?.[0]);
}

describe('push sending', () => {
    let log: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(repo.findDeviceRegistrationsByUserId).mockResolvedValue([device]);
        log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        Object.assign(config, {
            paperbarkApiKey: undefined,
            apnsKey: 'key',
            useDirectApns: false,
        });
    });

    it('names the missing Paperbark key instead of reporting success', async () => {
        expect(describePushSetup()).toEqual({
            method: 'Paperbark',
            missing: ['PAPERBARK_API_KEY'],
        });

        await sendNotification('u1', 'reminder', {});

        expect(pushResultLog(log)).toContain('0 delivered to Paperbark, 1 failed');
        expect(pushResultLog(log)).toContain('missing PAPERBARK_API_KEY');
    });

    it('sends the badge count to Paperbark', async () => {
        config.paperbarkApiKey = 'secret';
        const fetchMock = vi.fn().mockResolvedValue(new Response('ok'));
        vi.stubGlobal('fetch', fetchMock);

        await sendNotification('u1', 'reminder', {});

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.notification.badge).toBe(3);
        expect(pushResultLog(log)).toContain('1 delivered to Paperbark, 0 failed');
        vi.unstubAllGlobals();
    });

    it('retries a token from the other APNs environment and remembers it', async () => {
        config.useDirectApns = true;
        vi.mocked(sendApnsPush)
            .mockRejectedValueOnce(new ApnsPushError('BadDeviceToken', 400))
            .mockResolvedValueOnce(undefined);

        await sendNotification('u1', 'reminder', {});

        expect(vi.mocked(sendApnsPush).mock.calls.map((call) => call[5])).toEqual([false, true]);
        expect(repo.setDeviceRegistrationEnvironment).toHaveBeenCalledWith('d1', true);
        expect(pushResultLog(log)).toContain('1 delivered to direct APNs');
    });

    it('forgets a device Apple says is no longer registered', async () => {
        config.useDirectApns = true;
        vi.mocked(sendApnsPush).mockRejectedValueOnce(new ApnsPushError('Unregistered', 410));

        await sendNotification('u1', 'reminder', {});

        expect(repo.deleteDeviceRegistrationByToken).toHaveBeenCalledWith(device.deviceToken);
        expect(pushResultLog(log)).toContain('1 failed (APNs push failed: Unregistered)');
    });

    it('forgets a device when the retry in the other environment says Unregistered', async () => {
        config.useDirectApns = true;
        vi.mocked(sendApnsPush)
            .mockRejectedValueOnce(new ApnsPushError('BadDeviceToken', 400))
            .mockRejectedValueOnce(new ApnsPushError('Unregistered', 410));

        await sendNotification('u1', 'reminder', {});

        expect(repo.deleteDeviceRegistrationByToken).toHaveBeenCalledWith(device.deviceToken);
        expect(repo.setDeviceRegistrationEnvironment).not.toHaveBeenCalled();
    });

    it('reports a missing APNs key', () => {
        config.useDirectApns = true;
        config.apnsKey = undefined;

        expect(describePushSetup()).toEqual({
            method: 'direct APNs',
            missing: ['APNS_KEY or APNS_KEY_PATH'],
        });
    });
});
