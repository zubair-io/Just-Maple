import { getLegos, fetchBricksetData, LegoThemes } from './lego.service';
import {
    createRegistry,
    findRegistryByProviderId,
    updateRegistry,
} from '../repositories/collectible-registry.repo';
import type { CollectibleRegistry } from '@maple/shared';
import { ObjectId } from 'mongodb';

interface LegoSet {
    set: string;
    title: string;
    year: string;
    theme: string;
    parts: string;
    image: string;
}

interface ProseMirrorDoc {
    type: 'doc';
    content: any[];
}

/**
 * Create tags from LEGO set metadata (theme, year, set number)
 */
export async function createLegoTags(itemId: string) {
    const legos = await getLegos();
    const lego = legos.find((l) => l.set === itemId);

    if (!lego) {
        return {
            tags: [],
            lego: {},
            title: '',
        };
    }

    const themes: { type: 'system'; value: string }[] = [];
    const legoTheme = LegoThemes.find((theme) => theme.id === +lego.theme);

    if (legoTheme) {
        themes.push({
            type: 'system',
            value: legoTheme.name,
        });

        if (legoTheme.parent_id) {
            const parentTheme = LegoThemes.find((theme) => theme.id === legoTheme.parent_id);
            if (parentTheme) {
                themes.unshift({
                    type: 'system',
                    value: parentTheme.name,
                });
            }
        }
    }

    const tags = [
        {
            type: 'system',
            value: itemId.split('-')[0].trim(),
        },
        ...themes,
        {
            type: 'system',
            value: lego.year,
        },
    ];

    return {
        tags,
        lego,
        title: lego.title,
    };
}

/**
 * Create a CollectibleRegistry data object for a LEGO set
 */
export async function createLegoCollectableRegistryData(itemId: string) {
    console.log(`[Collectible Registry Service] Creating data for LEGO set: ${itemId}`);

    const { tags, lego, title } = await createLegoTags(itemId);

    if (!title) {
        throw new Error(`LEGO set ${itemId} not found in dataset`);
    }

    console.log(`[Collectible Registry Service] Tags created, title: ${title}`);

    const { upc, ean, description } = await fetchBricksetData(itemId);
    console.log(
        `[Collectible Registry Service] Brickset data fetched - UPC: ${upc}, EAN: ${ean}, hasDescription: ${!!description}`,
    );

    return {
        upc: upc || '',
        ean: ean || '',
        title,
        description: description || { type: 'doc', content: [] },
        images: [`https://lego.justmaple.app/${itemId}.jpg`],
        providerId: itemId,
        provider: 'lego' as const,
        tags,
        providerData: {
            lego,
        },
    };
}

/**
 * Get or create a CollectibleRegistry entry for a LEGO set
 */
export async function getOrCreateLegoRegistry(providerId: string) {
    console.log(`[Collectible Registry Service] Checking for existing: lego/${providerId}`);

    const existing = await findRegistryByProviderId('lego', providerId);

    if (existing) {
        console.log(`[Collectible Registry Service] Found existing registry for ${providerId}`);
        return existing;
    }

    console.log(`[Collectible Registry Service] Creating new registry for lego/${providerId}`);

    const data = await createLegoCollectableRegistryData(providerId);

    return await createRegistry({
        _id: new ObjectId().toHexString(),
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
}

/**
 * Update an existing CollectibleRegistry entry with fresh data
 */
export async function updateLegoRegistry(providerId: string) {
    console.log(`[Collectible Registry Service] Updating registry for set ${providerId}`);

    const existing = await findRegistryByProviderId('lego', providerId);

    if (!existing) {
        console.log(`[Collectible Registry Service] No existing registry found, creating new one`);
        return await getOrCreateLegoRegistry(providerId);
    }

    // Fetch new data
    const newData = await createLegoCollectableRegistryData(providerId);

    // Update the existing document
    const updated = await updateRegistry(existing._id, {
        upc: newData.upc || existing.upc,
        ean: newData.ean || existing.ean,
        title: newData.title || existing.title,
        description: newData.description || existing.description,
        images: newData.images || existing.images,
        tags: newData.tags || existing.tags,
        providerData: newData.providerData || existing.providerData,
    });

    console.log(
        `[Collectible Registry Service] Successfully updated registry for set ${providerId}`,
    );
    return updated;
}

/**
 * Sync LEGO sets from the lego service to the collectible registry
 */
export interface SyncLegoSetsOptions {
    year?: string;
    fillMissing?: boolean;
    specificId?: string;
}

export async function syncLegoSets(options: SyncLegoSetsOptions = {}) {
    console.log('[Collectible Registry Service] Starting LEGO set sync...', options);

    // Fetch LEGO sets from the local API
    const allSets = await getLegos();

    let setsToProcess: LegoSet[];

    if (options.specificId) {
        // Sync specific set
        console.log(`[Collectible Registry Service] Syncing specific set: ${options.specificId}`);
        setsToProcess = allSets.filter((set) => set.set === options.specificId);

        if (setsToProcess.length === 0) {
            throw new Error(`Set ${options.specificId} not found`);
        }
    } else {
        // Filter by year and part count
        const year = options.year || new Date().getFullYear().toString();
        setsToProcess = allSets.filter((set) => set.year === year && parseInt(set.parts) > 1);

        console.log(
            `[Collectible Registry Service] Found ${setsToProcess.length} LEGO sets for year ${year} with >1 parts`,
        );
    }

    const syncedProviderIds: string[] = [];
    const errors: string[] = [];
    let skipped = 0;
    let rateLimited = false;

    // Determine which sets need syncing
    let setsToSync: LegoSet[];

    if (options.specificId) {
        // Always sync specific ID even if it exists
        setsToSync = setsToProcess;
    } else if (options.fillMissing) {
        // Find sets with missing or incomplete data
        console.log(
            '[Collectible Registry Service] Fill missing mode: finding sets with incomplete data...',
        );

        const setIds = setsToProcess.map((set) => set.set);
        const existingRegistries = await Promise.all(
            setIds.map((id) => findRegistryByProviderId('lego', id)),
        );

        const incompleteSets = existingRegistries
            .filter((reg) => {
                if (!reg) return false;

                // Check if UPC or EAN is missing, or description is empty
                const missingBarcode = !reg.upc && !reg.ean;
                const emptyDescription =
                    !reg.description ||
                    (typeof reg.description === 'object' &&
                        (!reg.description.content || reg.description.content.length === 0));

                return missingBarcode || emptyDescription;
            })
            .map((reg) => reg!.providerId);

        setsToSync = setsToProcess.filter((set) => incompleteSets.includes(set.set));

        console.log(
            `[Collectible Registry Service] Found ${setsToSync.length} sets with missing data to re-sync`,
        );

        const completeCount = existingRegistries.filter(
            (reg) => reg && !incompleteSets.includes(reg.providerId),
        ).length;
        skipped = completeCount;
    } else {
        // Normal mode: check which sets already exist
        const setIds = setsToProcess.map((set) => set.set);
        console.log(`[Collectible Registry Service] Checking ${setIds.length} sets in database...`);

        const existingRegistries = await Promise.all(
            setIds.map((id) => findRegistryByProviderId('lego', id)),
        );

        const existingProviderIds = new Set(
            existingRegistries.filter((reg) => reg !== null).map((reg) => reg!.providerId),
        );

        console.log(
            `[Collectible Registry Service] Found ${existingProviderIds.size} sets already in database`,
        );

        // Filter out sets that already exist
        setsToSync = setsToProcess.filter((set) => !existingProviderIds.has(set.set));
        skipped = existingProviderIds.size;
    }

    console.log(`[Collectible Registry Service] ${setsToSync.length} sets need to be synced`);

    // Sync each set
    for (const set of setsToSync) {
        try {
            console.log(
                `[Collectible Registry Service] Syncing LEGO set: ${set.set} - ${set.title}`,
            );

            if (options.fillMissing || options.specificId) {
                // Update existing registry
                await updateLegoRegistry(set.set);
            } else {
                // Create new registry entry
                await getOrCreateLegoRegistry(set.set);
            }

            syncedProviderIds.push(set.set);

            // Add 1.5s delay between requests to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, 1500));
        } catch (error: any) {
            // Check if this is a rate limit error
            if (error.statusCode === 429 || error.message?.includes('Rate limited')) {
                const rateLimitMsg = `Rate limited by BrightData at ${set.set}. Stopping sync.`;
                console.error(`[Collectible Registry Service] ${rateLimitMsg}`);
                errors.push(rateLimitMsg);
                rateLimited = true;
                break; // Stop the batch processing
            }

            const errorMsg = `${set.set}: ${error.message}`;
            console.error(`[Collectible Registry Service] ${errorMsg}`);
            errors.push(errorMsg);
        }
    }

    const completeMsg = rateLimited
        ? `Sync stopped due to rate limiting: ${syncedProviderIds.length} synced, ${skipped} skipped, ${errors.length} errors`
        : `Sync complete: ${syncedProviderIds.length} synced, ${skipped} skipped, ${errors.length} errors`;

    console.log(`[Collectible Registry Service] ${completeMsg}`);

    return {
        synced: syncedProviderIds.length,
        syncedProviderIds,
        skipped,
        errors,
        rateLimited,
    };
}
