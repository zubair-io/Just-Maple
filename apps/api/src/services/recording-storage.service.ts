import { BlobServiceClient } from '@azure/storage-blob';
import { mkdir, writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';
import { config } from '../config';

// ============================================================================
// Local Storage Functions
// ============================================================================

/**
 * Get the local storage directory path for recordings
 */
function getLocalStorageDir(): string {
    return join(config.localStoragePath, 'recordings');
}

/**
 * Ensure the local storage directory exists
 */
async function ensureLocalStorageDir(): Promise<void> {
    const dir = getLocalStorageDir();
    await mkdir(dir, { recursive: true });
}

/**
 * Save a recording file to local storage
 */
async function saveLocalFile(filename: string, buffer: Buffer): Promise<string> {
    await ensureLocalStorageDir();
    const filePath = join(getLocalStorageDir(), filename);
    await writeFile(filePath, buffer);
    // Return URL path that will be served by the API
    return `/api/storage/recordings/${filename}`;
}

/**
 * Delete a file from local storage
 */
async function deleteLocalFile(urlPath: string): Promise<void> {
    try {
        // Extract filename from URL path (e.g., /api/storage/recordings/xxx.webm)
        const filename = urlPath.split('/').pop();
        if (!filename) return;

        const filePath = join(getLocalStorageDir(), filename);
        await unlink(filePath);
    } catch (error) {
        // Ignore errors if file doesn't exist
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error('[RecordingStorage] Failed to delete local file:', urlPath, error);
        }
    }
}

/**
 * Upload recording to local storage
 */
async function uploadRecordingLocal(
    recordingId: string,
    userId: string,
    buffer: Buffer,
    mimeType: string,
): Promise<string> {
    // Determine file extension based on mime type
    const extension = getExtensionFromMimeType(mimeType);
    const timestamp = Date.now();
    const filename = `${userId}-${recordingId}-${timestamp}.${extension}`;

    return saveLocalFile(filename, buffer);
}

/**
 * Read a recording file from local storage
 */
async function readLocalFile(urlPath: string): Promise<Buffer | null> {
    try {
        const filename = urlPath.split('/').pop();
        if (!filename) return null;

        const filePath = join(getLocalStorageDir(), filename);
        return await readFile(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error('[RecordingStorage] Failed to read local file:', urlPath, error);
        }
        return null;
    }
}

// ============================================================================
// Azure Blob Storage Functions
// ============================================================================

/**
 * Upload recording to Azure Blob Storage
 */
async function uploadRecordingAzure(
    recordingId: string,
    userId: string,
    buffer: Buffer,
    mimeType: string,
): Promise<string> {
    const extension = getExtensionFromMimeType(mimeType);
    const timestamp = Date.now();
    const blobName = `${userId}/${recordingId}-${timestamp}.${extension}`;

    // Create BlobServiceClient
    const blobServiceClient = BlobServiceClient.fromConnectionString(
        config.hornbeamConnectionString!,
    );

    // Get container client
    const containerClient = blobServiceClient.getContainerClient(config.recordingsContainer);

    // Ensure container exists (create if it doesn't)
    await containerClient.createIfNotExists({
        access: 'blob', // Public read access for blobs
    });

    // Get block blob client
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Upload the blob
    await blockBlobClient.upload(buffer, buffer.length, {
        blobHTTPHeaders: {
            blobContentType: mimeType,
            blobCacheControl: 'public, max-age=31536000', // Cache for 1 year
        },
    });

    return blockBlobClient.url;
}

/**
 * Delete a recording from Azure Blob Storage
 */
async function deleteRecordingAzure(blobUrl: string): Promise<void> {
    try {
        // Extract blob name from URL
        const url = new URL(blobUrl);
        const pathParts = url.pathname.split('/');
        // Path format: /recordings/userId/recordingId-timestamp.ext
        // We need everything after the container name
        const containerIndex = pathParts.findIndex((p) => p === config.recordingsContainer);
        if (containerIndex === -1) return;

        const blobName = pathParts.slice(containerIndex + 1).join('/');

        // Create BlobServiceClient
        const blobServiceClient = BlobServiceClient.fromConnectionString(
            config.hornbeamConnectionString!,
        );

        // Get container and blob client
        const containerClient = blobServiceClient.getContainerClient(config.recordingsContainer);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        // Delete the blob
        await blockBlobClient.deleteIfExists();
    } catch (error) {
        console.error('[RecordingStorage] Failed to delete Azure blob:', blobUrl, error);
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
        'audio/webm': 'webm',
        'audio/mp4': 'm4a',
        'audio/mpeg': 'mp3',
        'audio/ogg': 'ogg',
        'audio/wav': 'wav',
        'audio/x-m4a': 'm4a',
        'audio/aac': 'aac',
    };
    return mimeToExt[mimeType] || 'webm';
}

// ============================================================================
// Public API - Auto-selects storage backend
// ============================================================================

/**
 * Check if using Azure Blob Storage or local storage
 */
export function isUsingAzureStorage(): boolean {
    return !!config.hornbeamConnectionString;
}

/**
 * Upload a recording to storage
 * Uses Azure Blob Storage if configured, otherwise falls back to local storage
 *
 * @param recordingId - Unique recording ID
 * @param userId - User ID for organizing files
 * @param buffer - Audio file buffer
 * @param mimeType - Audio MIME type
 * @returns URL to the uploaded audio file
 */
export async function uploadRecording(
    recordingId: string,
    userId: string,
    buffer: Buffer,
    mimeType: string,
): Promise<string> {
    if (config.hornbeamConnectionString) {
        return uploadRecordingAzure(recordingId, userId, buffer, mimeType);
    }
    return uploadRecordingLocal(recordingId, userId, buffer, mimeType);
}

/**
 * Delete a recording from storage
 * Auto-detects storage backend based on URL format
 *
 * @param audioUrl - URL of the recording to delete
 */
export async function deleteRecording(audioUrl: string): Promise<void> {
    // Check if it's a local URL (starts with /api/storage/)
    const isLocalUrl = audioUrl.startsWith('/api/storage/');

    if (isLocalUrl) {
        return deleteLocalFile(audioUrl);
    }

    // Azure URL - need connection string
    if (!config.hornbeamConnectionString) {
        console.warn(
            '[RecordingStorage] Cannot delete Azure blob without connection string:',
            audioUrl,
        );
        return;
    }

    return deleteRecordingAzure(audioUrl);
}

/**
 * Get the local storage directory path (for use in routes)
 */
export function getRecordingStoragePath(): string {
    return getLocalStorageDir();
}

/**
 * Read a recording file (for streaming)
 * Only works with local storage - Azure URLs should be accessed directly
 *
 * @param audioUrl - URL of the recording
 * @returns Buffer or null if not found/not local
 */
export async function readRecordingFile(audioUrl: string): Promise<Buffer | null> {
    const isLocalUrl = audioUrl.startsWith('/api/storage/');
    if (!isLocalUrl) {
        return null; // Azure URLs should be accessed directly
    }
    return readLocalFile(audioUrl);
}
