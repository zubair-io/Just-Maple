import sharp from 'sharp';

export interface ProcessedImage {
    /** Full resolution image buffer with metadata stripped */
    full: Buffer;
    /** 128x128 thumbnail buffer */
    thumbnail: Buffer;
    /** Image format (jpeg, png, webp, etc.) */
    format: string;
}

/**
 * Process a profile picture:
 * - Strip all metadata (EXIF, IPTC, XMP, etc.)
 * - Create a full-resolution version without metadata
 * - Create a 128x128 thumbnail (center-cropped and scaled)
 *
 * @param imageBuffer - Original image buffer
 * @returns Processed full image and thumbnail buffers
 */
export async function processProfilePicture(imageBuffer: Buffer): Promise<ProcessedImage> {
    // Get image metadata to determine format
    const metadata = await sharp(imageBuffer).metadata();

    // Determine output format - convert to jpeg for smaller file size
    // unless it's a PNG with transparency
    const hasAlpha = metadata.channels === 4;
    const format = hasAlpha ? 'png' : 'jpeg';

    // Process full-resolution image: strip metadata only
    const fullImage = sharp(imageBuffer)
        .rotate() // Auto-rotate based on EXIF orientation before stripping
        .withMetadata({ orientation: undefined }); // Remove all metadata

    let fullBuffer: Buffer;
    if (format === 'jpeg') {
        fullBuffer = await fullImage.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    } else {
        fullBuffer = await fullImage.png({ compressionLevel: 9 }).toBuffer();
    }

    // Create 128x128 thumbnail: resize and center-crop
    const thumbnailImage = sharp(imageBuffer)
        .rotate() // Auto-rotate based on EXIF orientation
        .resize(128, 128, {
            fit: 'cover', // Cover the dimensions (will crop)
            position: 'centre', // Center the crop
        })
        .withMetadata({ orientation: undefined }); // Remove all metadata

    let thumbnailBuffer: Buffer;
    if (format === 'jpeg') {
        thumbnailBuffer = await thumbnailImage.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    } else {
        thumbnailBuffer = await thumbnailImage.png({ compressionLevel: 9 }).toBuffer();
    }

    return {
        full: fullBuffer,
        thumbnail: thumbnailBuffer,
        format,
    };
}

/**
 * Download an image from a URL and process it
 * Used for fetching and processing Gravatar images
 *
 * @param url - Image URL to download
 * @returns Processed image buffers or null if download fails
 */
export async function downloadAndProcessImage(url: string): Promise<ProcessedImage | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        return processProfilePicture(buffer);
    } catch (error) {
        console.error('[ImageProcessing] Failed to download and process image:', error);
        return null;
    }
}
