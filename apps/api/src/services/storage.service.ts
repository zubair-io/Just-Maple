import { BlobServiceClient } from '@azure/storage-blob';
import { config } from '../config';

/**
 * Upload a profile picture to Azure Blob Storage
 * @param userId - User ID to use as filename prefix
 * @param fileBuffer - Image file buffer
 * @param mimeType - Image MIME type (e.g., 'image/jpeg', 'image/png')
 * @returns Public URL of the uploaded image
 */
export async function uploadProfilePicture(
    userId: string,
    fileBuffer: Buffer,
    mimeType: string,
): Promise<string> {
    if (!config.hornbeamConnectionString) {
        throw new Error('Hornbeam connection string not configured');
    }

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

    // Generate unique blob name: userId-timestamp.ext
    const extension = mimeType.split('/')[1] || 'jpg';
    const blobName = `${userId}-${Date.now()}.${extension}`;

    // Get blob client
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Upload the image
    await blockBlobClient.upload(fileBuffer, fileBuffer.length, {
        blobHTTPHeaders: {
            blobContentType: mimeType,
            blobCacheControl: 'public, max-age=31536000', // Cache for 1 year
        },
    });

    // Return the public URL
    return blockBlobClient.url;
}

/**
 * Delete a profile picture from Azure Blob Storage
 * @param blobUrl - Full URL of the blob to delete
 */
export async function deleteProfilePicture(blobUrl: string): Promise<void> {
    if (!config.hornbeamConnectionString) {
        throw new Error('Hornbeam connection string not configured');
    }

    try {
        // Extract blob name from URL
        const url = new URL(blobUrl);
        const pathParts = url.pathname.split('/');
        const blobName = pathParts[pathParts.length - 1];

        // Create BlobServiceClient
        const blobServiceClient = BlobServiceClient.fromConnectionString(
            config.hornbeamConnectionString,
        );

        // Get container and blob client
        const containerClient = blobServiceClient.getContainerClient(
            config.profilePictureContainer,
        );
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        // Delete the blob
        await blockBlobClient.deleteIfExists();
    } catch (error) {
        console.error('[Storage] Failed to delete profile picture:', error);
        // Don't throw - deletion is best-effort
    }
}

/**
 * Upload a note image to Azure Blob Storage
 * @param noteId - Note ID to organize images
 * @param userId - User ID for tracking
 * @param fileBuffer - Image file buffer
 * @param mimeType - Image MIME type (e.g., 'image/jpeg', 'image/png')
 * @returns Public URL of the uploaded image using custom domain
 */
export async function uploadNoteImage(
    noteId: string,
    userId: string,
    fileBuffer: Buffer,
    mimeType: string,
): Promise<string> {
    if (!config.hornbeamConnectionString) {
        throw new Error('Hornbeam connection string not configured');
    }

    // Create BlobServiceClient
    const blobServiceClient = BlobServiceClient.fromConnectionString(
        config.hornbeamConnectionString,
    );

    // Get media container client
    const containerClient = blobServiceClient.getContainerClient('media');

    // Ensure container exists (create if it doesn't)
    await containerClient.createIfNotExists({
        access: 'blob', // Public read access for blobs
    });

    // Generate blob path: notes/noteId/userId-timestamp.ext
    const extension = mimeType.split('/')[1] || 'jpg';
    const blobName = `notes/${noteId}/${userId}-${Date.now()}.${extension}`;

    // Get blob client
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Upload the image
    await blockBlobClient.upload(fileBuffer, fileBuffer.length, {
        blobHTTPHeaders: {
            blobContentType: mimeType,
            blobCacheControl: 'public, max-age=31536000', // Cache for 1 year
        },
    });

    // Return public URL using custom domain
    return `https://hornbeam.justmaple.app/media/${blobName}`;
}
