import { BlobServiceClient } from '@azure/storage-blob';
import { config } from '../config';
import { processProfilePicture, downloadAndProcessImage } from './image-processing.service';

export interface ProfilePictureUrls {
    /** Full resolution image URL (metadata stripped) */
    fullUrl: string;
    /** 128x128 thumbnail URL */
    thumbnailUrl: string;
}

/**
 * Upload a single blob to Azure storage
 */
async function uploadBlob(
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
 * Upload a profile picture to Azure Blob Storage
 * Processes the image to strip metadata and create a 128x128 thumbnail
 *
 * @param userId - User ID to use as filename prefix
 * @param fileBuffer - Image file buffer
 * @returns URLs for both full and thumbnail images
 */
export async function uploadProfilePicture(
    userId: string,
    fileBuffer: Buffer,
): Promise<ProfilePictureUrls> {
    if (!config.hornbeamConnectionString) {
        throw new Error('Hornbeam connection string not configured');
    }

    // Process the image: strip metadata and create thumbnail
    const processed = await processProfilePicture(fileBuffer);
    const mimeType = processed.format === 'png' ? 'image/png' : 'image/jpeg';
    const extension = processed.format === 'png' ? 'png' : 'jpg';

    // Create BlobServiceClient
    const blobServiceClient = BlobServiceClient.fromConnectionString(
        config.hornbeamConnectionString,
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
        uploadBlob(containerClient, fullBlobName, processed.full, mimeType),
        uploadBlob(containerClient, thumbnailBlobName, processed.thumbnail, mimeType),
    ]);

    return { fullUrl, thumbnailUrl };
}

/**
 * Download an image from a URL, process it, and upload to storage
 * Used for processing Gravatar images
 *
 * @param userId - User ID to use as filename prefix
 * @param imageUrl - URL of the image to download and process
 * @returns URLs for both full and thumbnail images, or null if download fails
 */
export async function downloadProcessAndUploadImage(
    userId: string,
    imageUrl: string,
): Promise<ProfilePictureUrls | null> {
    if (!config.hornbeamConnectionString) {
        throw new Error('Hornbeam connection string not configured');
    }

    // Download and process the image
    const processed = await downloadAndProcessImage(imageUrl);
    if (!processed) {
        return null;
    }

    const mimeType = processed.format === 'png' ? 'image/png' : 'image/jpeg';
    const extension = processed.format === 'png' ? 'png' : 'jpg';

    // Create BlobServiceClient
    const blobServiceClient = BlobServiceClient.fromConnectionString(
        config.hornbeamConnectionString,
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
        uploadBlob(containerClient, fullBlobName, processed.full, mimeType),
        uploadBlob(containerClient, thumbnailBlobName, processed.thumbnail, mimeType),
    ]);

    return { fullUrl, thumbnailUrl };
}

/**
 * Delete a single blob from Azure storage
 */
async function deleteBlob(blobUrl: string): Promise<void> {
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
 * Delete profile picture(s) from Azure Blob Storage
 * Handles both full image and thumbnail URLs
 *
 * @param fullUrl - Full resolution image URL
 * @param thumbnailUrl - Optional thumbnail URL
 */
export async function deleteProfilePictures(fullUrl: string, thumbnailUrl?: string): Promise<void> {
    if (!config.hornbeamConnectionString) {
        throw new Error('Hornbeam connection string not configured');
    }

    // Delete both images in parallel (if thumbnail exists)
    const deletePromises = [deleteBlob(fullUrl)];
    if (thumbnailUrl) {
        deletePromises.push(deleteBlob(thumbnailUrl));
    }

    await Promise.all(deletePromises);
}

/**
 * @deprecated Use deleteProfilePictures instead
 * Delete a profile picture from Azure Blob Storage (legacy - single URL)
 * @param blobUrl - Full URL of the blob to delete
 */
export async function deleteProfilePicture(blobUrl: string): Promise<void> {
    if (!config.hornbeamConnectionString) {
        throw new Error('Hornbeam connection string not configured');
    }

    await deleteBlob(blobUrl);
}
