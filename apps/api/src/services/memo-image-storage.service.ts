import { BlobServiceClient } from '@azure/storage-blob';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { config } from '../config';
import sharp from 'sharp';

// Container name for memo images
const MEMO_IMAGES_CONTAINER = 'memo-images';

export interface ProcessedMemoImage {
    /** Full resolution image buffer with metadata stripped */
    full: Buffer;
    /** Image format (jpeg, png, webp) */
    format: string;
    /** Original width */
    width: number;
    /** Original height */
    height: number;
}

// ============================================================================
// Image Processing
// ============================================================================

/**
 * Process a memo image:
 * - Strip all metadata (EXIF, IPTC, XMP, etc.)
 * - Auto-rotate based on EXIF orientation
 * - Resize if larger than 2000px on any dimension
 * - Optimize for web
 */
export async function processMemoImage(imageBuffer: Buffer): Promise<ProcessedMemoImage> {
    const metadata = await sharp(imageBuffer).metadata();

    // Determine output format - keep PNG for transparency, otherwise JPEG
    const hasAlpha = metadata.channels === 4;
    const format = hasAlpha ? 'png' : 'jpeg';

    // Calculate resize dimensions (max 2000px on any side)
    const maxDimension = 2000;
    let resizeOptions: sharp.ResizeOptions | undefined;
    if (metadata.width && metadata.height) {
        if (metadata.width > maxDimension || metadata.height > maxDimension) {
            resizeOptions = {
                width: maxDimension,
                height: maxDimension,
                fit: 'inside',
                withoutEnlargement: true,
            };
        }
    }

    // Process image
    let pipeline = sharp(imageBuffer)
        .rotate() // Auto-rotate based on EXIF orientation
        .withMetadata({ orientation: undefined }); // Remove all metadata

    if (resizeOptions) {
        pipeline = pipeline.resize(resizeOptions);
    }

    let fullBuffer: Buffer;
    if (format === 'jpeg') {
        fullBuffer = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    } else {
        fullBuffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    }

    // Get final dimensions
    const finalMetadata = await sharp(fullBuffer).metadata();

    return {
        full: fullBuffer,
        format,
        width: finalMetadata.width || 0,
        height: finalMetadata.height || 0,
    };
}

// ============================================================================
// Local Storage Functions
// ============================================================================

function getLocalStorageDir(): string {
    return join(config.localStoragePath, 'memo-images');
}

async function ensureLocalStorageDir(): Promise<void> {
    const dir = getLocalStorageDir();
    await mkdir(dir, { recursive: true });
}

async function saveLocalFile(filename: string, buffer: Buffer): Promise<string> {
    await ensureLocalStorageDir();
    const filePath = join(getLocalStorageDir(), filename);
    await writeFile(filePath, buffer);
    return `/api/storage/memo-images/${filename}`;
}

async function deleteLocalFile(urlPath: string): Promise<void> {
    try {
        const filename = urlPath.split('/').pop();
        if (!filename) return;

        const filePath = join(getLocalStorageDir(), filename);
        await unlink(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error('[MemoImageStorage] Failed to delete local file:', urlPath, error);
        }
    }
}

async function uploadMemoImageLocal(
    imageId: string,
    userId: string,
    pageId: string,
    buffer: Buffer,
    mimeType: string,
): Promise<{ url: string; width: number; height: number }> {
    // Process the image
    const processed = await processMemoImage(buffer);
    const extension = processed.format === 'png' ? 'png' : 'jpg';
    const timestamp = Date.now();
    const filename = `${userId}-${pageId}-${imageId}-${timestamp}.${extension}`;

    const url = await saveLocalFile(filename, processed.full);

    return {
        url,
        width: processed.width,
        height: processed.height,
    };
}

// ============================================================================
// Azure Blob Storage Functions
// ============================================================================

async function uploadMemoImageAzure(
    imageId: string,
    userId: string,
    pageId: string,
    buffer: Buffer,
    mimeType: string,
): Promise<{ url: string; width: number; height: number }> {
    // Process the image
    const processed = await processMemoImage(buffer);
    const extension = processed.format === 'png' ? 'png' : 'jpg';
    const contentType = processed.format === 'png' ? 'image/png' : 'image/jpeg';
    const timestamp = Date.now();
    const blobName = `${userId}/${pageId}/${imageId}-${timestamp}.${extension}`;

    // Create BlobServiceClient
    const blobServiceClient = BlobServiceClient.fromConnectionString(
        config.hornbeamConnectionString!,
    );

    // Get container client
    const containerClient = blobServiceClient.getContainerClient(MEMO_IMAGES_CONTAINER);

    // Ensure container exists
    await containerClient.createIfNotExists({
        access: 'blob',
    });

    // Get block blob client
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Upload the blob
    await blockBlobClient.upload(processed.full, processed.full.length, {
        blobHTTPHeaders: {
            blobContentType: contentType,
            blobCacheControl: 'public, max-age=31536000',
        },
    });

    return {
        url: blockBlobClient.url,
        width: processed.width,
        height: processed.height,
    };
}

async function deleteMemoImageAzure(blobUrl: string): Promise<void> {
    try {
        const url = new URL(blobUrl);
        const pathParts = url.pathname.split('/');
        const containerIndex = pathParts.findIndex((p) => p === MEMO_IMAGES_CONTAINER);
        if (containerIndex === -1) return;

        const blobName = pathParts.slice(containerIndex + 1).join('/');

        const blobServiceClient = BlobServiceClient.fromConnectionString(
            config.hornbeamConnectionString!,
        );

        const containerClient = blobServiceClient.getContainerClient(MEMO_IMAGES_CONTAINER);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        await blockBlobClient.deleteIfExists();
    } catch (error) {
        console.error('[MemoImageStorage] Failed to delete Azure blob:', blobUrl, error);
    }
}

// ============================================================================
// Public API
// ============================================================================

export function isUsingAzureStorage(): boolean {
    return !!config.hornbeamConnectionString;
}

/**
 * Upload a memo image to storage
 * Processes the image to strip metadata and optimize for web
 * Uses Azure Blob Storage if configured, otherwise falls back to local storage
 */
export async function uploadMemoImage(
    imageId: string,
    userId: string,
    pageId: string,
    buffer: Buffer,
    mimeType: string,
): Promise<{ url: string; width: number; height: number }> {
    if (config.hornbeamConnectionString) {
        return uploadMemoImageAzure(imageId, userId, pageId, buffer, mimeType);
    }
    return uploadMemoImageLocal(imageId, userId, pageId, buffer, mimeType);
}

/**
 * Delete a memo image from storage
 */
export async function deleteMemoImage(imageUrl: string): Promise<void> {
    const isLocalUrl = imageUrl.startsWith('/api/storage/');

    if (isLocalUrl) {
        return deleteLocalFile(imageUrl);
    }

    if (!config.hornbeamConnectionString) {
        console.warn(
            '[MemoImageStorage] Cannot delete Azure blob without connection string:',
            imageUrl,
        );
        return;
    }

    return deleteMemoImageAzure(imageUrl);
}

/**
 * Get the local storage directory path (for use in routes)
 */
export function getMemoImageStoragePath(): string {
    return getLocalStorageDir();
}
