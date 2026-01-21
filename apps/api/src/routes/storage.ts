import { Elysia } from 'elysia';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { getProfilePictureStoragePath } from '../services/storage.service';
import { getRecordingStoragePath } from '../services/recording-storage.service';

/**
 * Storage routes for serving locally stored files
 * Only used when Azure Blob Storage is not configured
 */
export const storageRoutes = new Elysia({ prefix: '/api/storage' })
    .get('/profile-pictures/:filename', async ({ params, set }) => {
        const { filename } = params;

        // Validate filename to prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            set.status = 400;
            return { error: 'Invalid filename' };
        }

        const storagePath = getProfilePictureStoragePath();
        const filePath = join(storagePath, filename);

        try {
            const fileBuffer = await readFile(filePath);

            // Determine content type from extension
            const ext = filename.split('.').pop()?.toLowerCase();
            let contentType = 'application/octet-stream';
            if (ext === 'jpg' || ext === 'jpeg') {
                contentType = 'image/jpeg';
            } else if (ext === 'png') {
                contentType = 'image/png';
            } else if (ext === 'gif') {
                contentType = 'image/gif';
            } else if (ext === 'webp') {
                contentType = 'image/webp';
            }

            set.headers['Content-Type'] = contentType;
            set.headers['Cache-Control'] = 'public, max-age=31536000'; // Cache for 1 year

            return fileBuffer;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                set.status = 404;
                return { error: 'File not found' };
            }
            console.error('[Storage] Failed to read file:', filePath, error);
            set.status = 500;
            return { error: 'Failed to read file' };
        }
    })
    .get('/recordings/:filename', async ({ params, set }) => {
        const { filename } = params;

        // Validate filename to prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            set.status = 400;
            return { error: 'Invalid filename' };
        }

        const storagePath = getRecordingStoragePath();
        const filePath = join(storagePath, filename);

        try {
            const fileBuffer = await readFile(filePath);

            // Determine content type from extension
            const ext = filename.split('.').pop()?.toLowerCase();
            let contentType = 'application/octet-stream';
            if (ext === 'webm') {
                contentType = 'audio/webm';
            } else if (ext === 'm4a') {
                contentType = 'audio/mp4';
            } else if (ext === 'mp3') {
                contentType = 'audio/mpeg';
            } else if (ext === 'ogg') {
                contentType = 'audio/ogg';
            } else if (ext === 'wav') {
                contentType = 'audio/wav';
            } else if (ext === 'aac') {
                contentType = 'audio/aac';
            }

            set.headers['Content-Type'] = contentType;
            set.headers['Cache-Control'] = 'public, max-age=31536000'; // Cache for 1 year

            return fileBuffer;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                set.status = 404;
                return { error: 'File not found' };
            }
            console.error('[Storage] Failed to read recording file:', filePath, error);
            set.status = 500;
            return { error: 'Failed to read file' };
        }
    });
