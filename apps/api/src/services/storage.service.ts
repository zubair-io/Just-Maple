import { BlobServiceClient } from '@azure/storage-blob';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { config } from '../config';
import { processProfilePicture, downloadAndProcessImage } from './image-processing.service';

export interface ProfilePictureUrls {
    /** Full resolution image URL (metadata stripped) */
    fullUrl: string;
    /** 128x128 thumbnail URL */
    thumbnailUrl: string;
}

// ============================================================================
// Local Storage Functions
// ============================================================================

/**
 * Get the local storage directory path for profile pictures
 */
function getLocalStorageDir(): string {
    return join(config.localStoragePath, 'profile-pictures');
}

/**
 * Ensure the local storage directory exists
 */
async function ensureLocalStorageDir(): Promise<void> {
    const dir = getLocalStorageDir();
    await mkdir(dir, { recursive: true });
}

/**
 * Save a file to local storage
 */
async function saveLocalFile(filename: string, buffer: Buffer): Promise<string> {
    await ensureLocalStorageDir();
    const filePath = join(getLocalStorageDir(), filename);
    await writeFile(filePath, buffer);
    // Return URL path that will be served by the API
    return `/api/storage/profile-pictures/${filename}`;
}

/**
 * Delete a file from local storage
 */
async function deleteLocalFile(urlPath: string): Promise<void> {
    try {
        // Extract filename from URL path (e.g., /api/storage/profile-pictures/xxx.jpg)
        const filename = urlPath.split('/').pop();
        if (!filename) return;

        const filePath = join(getLocalStorageDir(), filename);
        await unlink(filePath);
    } catch (error) {
        // Ignore errors if file doesn't exist
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error('[Storage] Failed to delete local file:', urlPath, error);
        }
    }
}

/**
 * Upload profile picture to local storage
 */
async function uploadProfilePictureLocal(
    userId: string,
    fileBuffer: Buffer,
): Promise<ProfilePictureUrls> {
    // Process the image: strip metadata and create thumbnail
    const processed = await processProfilePicture(fileBuffer);
    const extension = processed.format === 'png' ? 'png' : 'jpg';

    // Generate unique filenames
    const timestamp = Date.now();
    const fullFilename = `${userId}-${timestamp}.${extension}`;
    const thumbnailFilename = `${userId}-${timestamp}-thumb.${extension}`;

    // Save both images
    const [fullUrl, thumbnailUrl] = await Promise.all([
        saveLocalFile(fullFilename, processed.full),
        saveLocalFile(thumbnailFilename, processed.thumbnail),
    ]);

    return { fullUrl, thumbnailUrl };
}

/**
 * Download, process, and upload image to local storage
 */
async function downloadProcessAndUploadLocal(
    userId: string,
    imageUrl: string,
): Promise<ProfilePictureUrls | null> {
    // Download and process the image
    const processed = await downloadAndProcessImage(imageUrl);
    if (!processed) {
        return null;
    }

    const extension = processed.format === 'png' ? 'png' : 'jpg';

    // Generate unique filenames
    const timestamp = Date.now();
    const fullFilename = `${userId}-${timestamp}.${extension}`;
    const thumbnailFilename = `${userId}-${timestamp}-thumb.${extension}`;

    // Save both images
    const [fullUrl, thumbnailUrl] = await Promise.all([
        saveLocalFile(fullFilename, processed.full),
        saveLocalFile(thumbnailFilename, processed.thumbnail),
    ]);

    return { fullUrl, thumbnailUrl };
}

/**
 * Delete profile pictures from local storage
 */
async function deleteProfilePicturesLocal(fullUrl: string, thumbnailUrl?: string): Promise<void> {
    const deletePromises = [deleteLocalFile(fullUrl)];
    if (thumbnailUrl) {
        deletePromises.push(deleteLocalFile(thumbnailUrl));
    }
    await Promise.all(deletePromises);
}

// ============================================================================
// Azure Blob Storage Functions
// ============================================================================

/**
 * Upload a single blob to Azure storage
 */
async function uploadBlobAzure(
    containerClient: ReturnType<BlobServiceClient['getContainerClient']>,
    blobName: string,
    buffer: Buffer,
    mimeType: string,
): Promise<string> {
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.upload(buffer, buffer.length, {
        blobHTTPHeaders: {
            blobContentType: mimeType,
            blobCacheControl: 'public, max-age=31536000', // Cache for 1 year
        },
    });

    return blockBlobClient.url;
}

/**
 * Upload profile picture to Azure Blob Storage
 */
async function uploadProfilePictureAzure(
    userId: string,
    fileBuffer: Buffer,
): Promise<ProfilePictureUrls> {
    // Process the image: strip metadata and create thumbnail
    const processed = await processProfilePicture(fileBuffer);
    const mimeType = processed.format === 'png' ? 'image/png' : 'image/jpeg';
    const extension = processed.format === 'png' ? 'png' : 'jpg';

    // Create BlobServiceClient
    const blobServiceClient = BlobServiceClient.fromConnectionString(
        config.hornbeamConnectionString!,
    );

    // Get container client
    const containerClient = blobServiceClient.getContainerClient(config.profilePictureContainer);

    // Ensure container exists (create if it doesn't)
    await containerClient.createIfNotExists({
        access: 'blob', // Public read access for blobs
    });

    // Generate unique blob names
    const timestamp = Date.now();
    const fullBlobName = `${userId}-${timestamp}.${extension}`;
    const thumbnailBlobName = `${userId}-${timestamp}-thumb.${extension}`;

    // Upload both images in parallel
    const [fullUrl, thumbnailUrl] = await Promise.all([
        uploadBlobAzure(containerClient, fullBlobName, processed.full, mimeType),
        uploadBlobAzure(containerClient, thumbnailBlobName, processed.thumbnail, mimeType),
    ]);

    return { fullUrl, thumbnailUrl };
}

/**
 * Download, process, and upload image to Azure Blob Storage
 */
async function downloadProcessAndUploadAzure(
    userId: string,
    imageUrl: string,
): Promise<ProfilePictureUrls | null> {
    // Download and process the image
    const processed = await downloadAndProcessImage(imageUrl);
    if (!processed) {
        return null;
    }

    const mimeType = processed.format === 'png' ? 'image/png' : 'image/jpeg';
    const extension = processed.format === 'png' ? 'png' : 'jpg';

    // Create BlobServiceClient
    const blobServiceClient = BlobServiceClient.fromConnectionString(
        config.hornbeamConnectionString!,
    );

    // Get container client
    const containerClient = blobServiceClient.getContainerClient(config.profilePictureContainer);

    // Ensure container exists (create if it doesn't)
    await containerClient.createIfNotExists({
        access: 'blob', // Public read access for blobs
    });

    // Generate unique blob names
    const timestamp = Date.now();
    const fullBlobName = `${userId}-${timestamp}.${extension}`;
    const thumbnailBlobName = `${userId}-${timestamp}-thumb.${extension}`;

    // Upload both images in parallel
    const [fullUrl, thumbnailUrl] = await Promise.all([
        uploadBlobAzure(containerClient, fullBlobName, processed.full, mimeType),
        uploadBlobAzure(containerClient, thumbnailBlobName, processed.thumbnail, mimeType),
    ]);

    return { fullUrl, thumbnailUrl };
}

/**
 * Delete a single blob from Azure storage
 */
async function deleteBlobAzure(blobUrl: string): Promise<void> {
    try {
        // Extract blob name from URL
        const url = new URL(blobUrl);
        const pathParts = url.pathname.split('/');
        const blobName = pathParts[pathParts.length - 1];

        // Create BlobServiceClient
        const blobServiceClient = BlobServiceClient.fromConnectionString(
            config.hornbeamConnectionString!,
        );

        // Get container and blob client
        const containerClient = blobServiceClient.getContainerClient(
            config.profilePictureContainer,
        );
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        // Delete the blob
        await blockBlobClient.deleteIfExists();
    } catch (error) {
        console.error('[Storage] Failed to delete blob:', blobUrl, error);
    }
}

/**
 * Delete profile pictures from Azure Blob Storage
 */
async function deleteProfilePicturesAzure(fullUrl: string, thumbnailUrl?: string): Promise<void> {
    const deletePromises = [deleteBlobAzure(fullUrl)];
    if (thumbnailUrl) {
        deletePromises.push(deleteBlobAzure(thumbnailUrl));
    }
    await Promise.all(deletePromises);
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
 * Upload a profile picture to storage
 * Processes the image to strip metadata and create a 128x128 thumbnail
 * Uses Azure Blob Storage if configured, otherwise falls back to local storage
 *
 * @param userId - User ID to use as filename prefix
 * @param fileBuffer - Image file buffer
 * @returns URLs for both full and thumbnail images
 */
export async function uploadProfilePicture(
    userId: string,
    fileBuffer: Buffer,
): Promise<ProfilePictureUrls> {
    if (config.hornbeamConnectionString) {
        return uploadProfilePictureAzure(userId, fileBuffer);
    }
    return uploadProfilePictureLocal(userId, fileBuffer);
}

/**
 * Download an image from a URL, process it, and upload to storage
 * Used for processing Gravatar images
 * Uses Azure Blob Storage if configured, otherwise falls back to local storage
 *
 * @param userId - User ID to use as filename prefix
 * @param imageUrl - URL of the image to download and process
 * @returns URLs for both full and thumbnail images, or null if download fails
 */
export async function downloadProcessAndUploadImage(
    userId: string,
    imageUrl: string,
): Promise<ProfilePictureUrls | null> {
    if (config.hornbeamConnectionString) {
        return downloadProcessAndUploadAzure(userId, imageUrl);
    }
    return downloadProcessAndUploadLocal(userId, imageUrl);
}

/**
 * Delete profile picture(s) from storage
 * Handles both full image and thumbnail URLs
 * Auto-detects storage backend based on URL format
 *
 * @param fullUrl - Full resolution image URL
 * @param thumbnailUrl - Optional thumbnail URL
 */
export async function deleteProfilePictures(fullUrl: string, thumbnailUrl?: string): Promise<void> {
    // Check if it's a local URL (starts with /api/storage/)
    const isLocalUrl = fullUrl.startsWith('/api/storage/');

    if (isLocalUrl) {
        return deleteProfilePicturesLocal(fullUrl, thumbnailUrl);
    }

    // Azure URL - need connection string
    if (!config.hornbeamConnectionString) {
        console.warn('[Storage] Cannot delete Azure blob without connection string:', fullUrl);
        return;
    }

    return deleteProfilePicturesAzure(fullUrl, thumbnailUrl);
}

/**
 * @deprecated Use deleteProfilePictures instead
 * Delete a profile picture from storage (legacy - single URL)
 * @param blobUrl - Full URL of the blob to delete
 */
export async function deleteProfilePicture(blobUrl: string): Promise<void> {
    return deleteProfilePictures(blobUrl);
}

/**
 * Get the local storage directory path (for use in routes)
 */
export function getProfilePictureStoragePath(): string {
    return getLocalStorageDir();
}
