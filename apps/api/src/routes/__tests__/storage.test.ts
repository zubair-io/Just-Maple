import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../../config';
import { storageRoutes } from '../storage';
import { assertLocalStorageReady, publicAssetPath } from '../../services/local-storage.service';
import { uploadRecording } from '../../services/recording-storage.service';

describe('local media storage', () => {
    let folder: string;
    const original = {
        localStoragePath: config.localStoragePath,
        localStorageRequired: config.localStorageRequired,
        instanceId: config.instanceId,
        hornbeamConnectionString: config.hornbeamConnectionString,
    };
    beforeEach(async () => {
        folder = await mkdtemp(join(tmpdir(), 'maple-media-'));
        Object.assign(config, {
            localStoragePath: folder,
            localStorageRequired: true,
            instanceId: 'test-instance',
            hornbeamConnectionString: undefined,
        });
        await writeFile(join(folder, '.just-maple-instance'), 'test-instance\n');
    });
    afterEach(async () => {
        Object.assign(config, original);
        await rm(folder, { recursive: true, force: true });
    });

    it('writes recordings to the selected filesystem and serves their bytes', async () => {
        const url = await uploadRecording('clip', 'owner', Buffer.from('audio bytes'), 'audio/mp4');
        const response = await storageRoutes.handle(new Request('http://localhost' + url));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('audio/mp4');
        expect(await response.text()).toBe('audio bytes');
    });
    it('fails before creating files if the required mount marker is absent or belongs to another instance', async () => {
        await writeFile(join(folder, '.just-maple-instance'), 'wrong');
        await expect(
            uploadRecording('clip', 'owner', Buffer.from('audio'), 'audio/mp4'),
        ).rejects.toThrow('unavailable');
        await rm(join(folder, '.just-maple-instance'));
        await expect(assertLocalStorageReady()).rejects.toThrow('unavailable');
        await expect(readFile(join(folder, 'recordings', 'clip'))).rejects.toThrow();
    });
    it('serves nested public app assets with the correct content type', async () => {
        await mkdir(join(folder, 'assets', 'icons'), { recursive: true });
        await writeFile(join(folder, 'assets', 'icons', 'leaf.svg'), '<svg/>');
        const response = await storageRoutes.handle(
            new Request('http://localhost/api/storage/assets/icons/leaf.svg'),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/svg+xml');
        expect(await response.text()).toBe('<svg/>');
    });
    it('rejects traversal and symlinks outside the public asset directory', async () => {
        expect(() => publicAssetPath('../private')).toThrow();
        expect(() => publicAssetPath('icons/..\\private')).toThrow();
        await mkdir(join(folder, 'assets'));
        await writeFile(join(folder, 'private'), 'must stay private');
        await symlink(join(folder, 'private'), join(folder, 'assets', 'outside'));
        const response = await storageRoutes.handle(
            new Request('http://localhost/api/storage/assets/outside'),
        );
        expect(response.status).toBe(400);
        expect(await response.text()).not.toContain('must stay private');
    });
    it('returns a storage error rather than serving assets from an unmounted directory', async () => {
        await rm(join(folder, '.just-maple-instance'));
        const response = await storageRoutes.handle(
            new Request('http://localhost/api/storage/assets/logo.svg'),
        );
        expect(response.status).toBe(503);
    });
});
