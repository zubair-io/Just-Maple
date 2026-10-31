import { BlobServiceClient } from '@azure/storage-blob';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { config } from '../config';
import { assertLocalStorageReady } from './local-storage.service';
import sharp from 'sharp';

// Container name for memo images
const MEMO_IMAGES_CONTAINER = 'memo-images';

// Size configurations
const IMAGE_SIZES = {
    small: { width: 200 },
    medium: { width: 400 },
    large: { width: 800 },
    cover: { width: 1200, height: 300 },
} as const;

export type ImageSizeKey = keyof typeof IMAGE_SIZES;

export interface ProcessedMemoImage {
    /** Original image buffer with metadata stripped */
    original: Buffer;
    /** Small version (200px width) */
    small: Buffer;
    /** Medium version (400px width) */
    medium: Buffer;
    /** Large version (800px width) */
    large: Buffer;
    /** Cover version (1200x300 cropped) */
    cover: Buffer;
    /** Image format (jpeg, png, webp) */
    format: string;
    /** Original width */
    width: number;
    /** Original height */
    height: number;
}

export interface MemoImageUrls {
    original: string;
    small: string;
    medium: string;
    large: string;
    cover: string;
}

export interface MemoImageUploadResult {
    urls: MemoImageUrls;
    width: number;
    height: number;
}

// ============================================================================
// Image Processing
// ============================================================================

/**
 * Strip all metadata from an image buffer
 */
async function stripMetadata(
    imageBuffer: Buffer,
    format: 'jpeg' | 'png' | 'webp',
): Promise<Buffer> {
    let pipeline = sharp(imageBuffer).rotate(); // Auto-rotate based on EXIF orientation

    // Use withMetadata with empty object to strip all metadata
    pipeline = pipeline.withMetadata({});

    if (format === 'jpeg') {
        return pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    } else if (format === 'png') {
        return pipeline.png({ compressionLevel: 9 }).toBuffer();
    } else {
        return pipeline.webp({ quality: 85 }).toBuffer();
    }
}

/**
 * Resize an image by width, maintaining aspect ratio
 */
async function resizeByWidth(
    imageBuffer: Buffer,
    width: number,
    format: 'jpeg' | 'png' | 'webp',
): Promise<Buffer> {
    let pipeline = sharp(imageBuffer)
        .rotate() // Auto-rotate based on EXIF
        .withMetadata({}) // Strip all metadata
        .resize({
            width,
            withoutEnlargement: true, // Don't upscale if image is smaller
        });

    if (format === 'jpeg') {
        return pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    } else if (format === 'png') {
        return pipeline.png({ compressionLevel: 9 }).toBuffer();
    } else {
        return pipeline.webp({ quality: 85 }).toBuffer();
    }
}

/**
 * Create a cover image (1200x300, cropped to fit)
 */
async function createCoverImage(
    imageBuffer: Buffer,
    format: 'jpeg' | 'png' | 'webp',
): Promise<Buffer> {
    let pipeline = sharp(imageBuffer)
        .rotate() // Auto-rotate based on EXIF
        .withMetadata({}) // Strip all metadata
        .resize({
            width: IMAGE_SIZES.cover.width,
            height: IMAGE_SIZES.cover.height,
            fit: 'cover',
            position: 'center',
        });

    if (format === 'jpeg') {
        return pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    } else if (format === 'png') {
        return pipeline.png({ compressionLevel: 9 }).toBuffer();
    } else {
        return pipeline.webp({ quality: 85 }).toBuffer();
    }
}

/**
 * Process a memo image:
 * - Strip all metadata (EXIF, IPTC, XMP, etc.) from all versions
 * - Auto-rotate based on EXIF orientation
 * - Create sized versions: original, small (200px), medium (400px), large (800px), cover (1200x300)
 */
export async function processMemoImage(imageBuffer: Buffer): Promise<ProcessedMemoImage> {
    const metadata = await sharp(imageBuffer).metadata();

    // Determine output format - keep PNG for transparency, WebP for WebP, otherwise JPEG
    const hasAlpha = metadata.channels === 4;
    const isWebp = metadata.format === 'webp';
    const format: 'jpeg' | 'png' | 'webp' = hasAlpha ? 'png' : isWebp ? 'webp' : 'jpeg';

    // Process all versions in parallel
    const [original, small, medium, large, cover] = await Promise.all([
        stripMetadata(imageBuffer, format),
        resizeByWidth(imageBuffer, IMAGE_SIZES.small.width, format),
        resizeByWidth(imageBuffer, IMAGE_SIZES.medium.width, format),
        resizeByWidth(imageBuffer, IMAGE_SIZES.large.width, format),
        createCoverImage(imageBuffer, format),
    ]);

    // Get original dimensions (after rotation)
    const originalMetadata = await sharp(original).metadata();

    return {
        original,
        small,
        medium,
        large,
        cover,
        format,
        width: originalMetadata.width || 0,
        height: originalMetadata.height || 0,
    };
}

// ============================================================================
// Local Storage Functions
// ============================================================================

function getLocalStorageDir(): string {
    return join(config.localStoragePath, 'memo-images');
}

async function ensureLocalStorageDir(): Promise<void> {
    await assertLocalStorageReady();
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
): Promise<MemoImageUploadResult> {
    // Process the image
    const processed = await processMemoImage(buffer);
    const extension =
        processed.format === 'png' ? 'png' : processed.format === 'webp' ? 'webp' : 'jpg';
    const baseFilename = `${userId}-${pageId}-${imageId}`;

    // Save all versions in parallel
    const [originalUrl, smallUrl, mediumUrl, largeUrl, coverUrl] = await Promise.all([
        saveLocalFile(`${baseFilename}-original.${extension}`, processed.original),
        saveLocalFile(`${baseFilename}-small.${extension}`, processed.small),
        saveLocalFile(`${baseFilename}-medium.${extension}`, processed.medium),
        saveLocalFile(`${baseFilename}-large.${extension}`, processed.large),
        saveLocalFile(`${baseFilename}-cover.${extension}`, processed.cover),
    ]);

    return {
        urls: {
            original: originalUrl,
            small: smallUrl,
            medium: mediumUrl,
            large: largeUrl,
            cover: coverUrl,
        },
        width: processed.width,
        height: processed.height,
    };
}

// ============================================================================
// Azure Blob Storage Functions
// ============================================================================

async function uploadBlobToAzure(
    containerClient: ReturnType<BlobServiceClient['getContainerClient']>,
    blobName: string,
    buffer: Buffer,
    contentType: string,
): Promise<string> {
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.upload(buffer, buffer.length, {
        blobHTTPHeaders: {
            blobContentType: contentType,
            blobCacheControl: 'public, max-age=31536000',
        },
    });

    return blockBlobClient.url;
}

async function uploadMemoImageAzure(
    imageId: string,
    userId: string,
    pageId: string,
    buffer: Buffer,
    mimeType: string,
): Promise<MemoImageUploadResult> {
    // Process the image
    const processed = await processMemoImage(buffer);
    const extension =
        processed.format === 'png' ? 'png' : processed.format === 'webp' ? 'webp' : 'jpg';
    const contentType =
        processed.format === 'png'
            ? 'image/png'
            : processed.format === 'webp'
              ? 'image/webp'
              : 'image/jpeg';
    const basePath = `${userId}/${pageId}/${imageId}`;

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

    // Upload all versions in parallel
    const [originalUrl, smallUrl, mediumUrl, largeUrl, coverUrl] = await Promise.all([
        uploadBlobToAzure(
            containerClient,
            `${basePath}-original.${extension}`,
            processed.original,
            contentType,
        ),
        uploadBlobToAzure(
            containerClient,
            `${basePath}-small.${extension}`,
            processed.small,
            contentType,
        ),
        uploadBlobToAzure(
            containerClient,
            `${basePath}-medium.${extension}`,
            processed.medium,
            contentType,
        ),
        uploadBlobToAzure(
            containerClient,
            `${basePath}-large.${extension}`,
            processed.large,
            contentType,
        ),
        uploadBlobToAzure(
            containerClient,
            `${basePath}-cover.${extension}`,
            processed.cover,
            contentType,
        ),
    ]);

    return {
        urls: {
            original: originalUrl,
            small: smallUrl,
            medium: mediumUrl,
            large: largeUrl,
            cover: coverUrl,
        },
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
 * Processes the image to strip metadata and create sized versions
 * Uses Azure Blob Storage if configured, otherwise falls back to local storage
 */
export async function uploadMemoImage(
    imageId: string,
    userId: string,
    pageId: string,
    buffer: Buffer,
    mimeType: string,
): Promise<MemoImageUploadResult> {
    if (config.hornbeamConnectionString) {
        return uploadMemoImageAzure(imageId, userId, pageId, buffer, mimeType);
    }
    return uploadMemoImageLocal(imageId, userId, pageId, buffer, mimeType);
}

/**
 * Delete a memo image from storage
 * This deletes a single URL - caller should delete all size variants
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
 * Delete all size variants of a memo image
 */
export async function deleteMemoImageAllSizes(urls: MemoImageUrls): Promise<void> {
    await Promise.all([
        deleteMemoImage(urls.original),
        deleteMemoImage(urls.small),
        deleteMemoImage(urls.medium),
        deleteMemoImage(urls.large),
        deleteMemoImage(urls.cover),
    ]);
}

/**
 * Get the local storage directory path (for use in routes)
 */
export function getMemoImageStoragePath(): string {
    return getLocalStorageDir();
}
