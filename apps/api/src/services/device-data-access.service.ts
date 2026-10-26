import {
    describeDeviceFilter,
    deviceFilterIsEmpty,
    deviceItemMatchesFilter,
    type DeviceDataAccess,
    type DeviceDataFilter,
    type DeviceDataFilterOptions,
    type FilterPlace,
    type MacDataItem,
    type MacDataSource,
    type Notebook,
    type Page,
} from '@maple/shared';
import { findNotebookByIdUnsafe } from '../repositories/notebook.repo';
import { findDeviceDataPagesInNotebook } from '../repositories/page.repo';
import { findUserById } from '../repositories/user.repo';
import { collectorTimeZone } from '../repositories/collector.repo';
import { listPlaces } from '../repositories/profile.repo';
import { findDeviceItemFacets, type DeviceItemQuery } from '../repositories/device-item.repo';

/**
 * Who sees what on a device data page ("single-player lite").
 *
 * 1. A data page shows its creator's data. Only the creator manages it: rename, move,
 *    remove, and choose what it shares (its filter).
 * 2. Everyone who can open the notebook sees the page through its filter: the page view,
 *    its search, and bots in the notebook.
 * 3. A page without a filter (older pages, and new ones in notebooks nobody else can
 *    see) shows everything to its creator and nothing to anyone else.
 * 4. A new page in a shared notebook starts with an empty filter: nothing is shared
 *    until the creator picks.
 */

/** How one person reads one data page. */
export interface DataPageView {
    page: Page;
    source: MacDataSource;
    /** The creator: whose data the page shows. */
    ownerId: string;
    canManage: boolean;
    /** False when this person can't see anything on the page. */
    visible: boolean;
    filter?: DeviceDataFilter;
}

/** The notebook has members besides its owner, or is public. The owner is listed too. */
export function isSharedWithOthers(notebook: Pick<Notebook, 'sharing'> | null): boolean {
    return (
        !!notebook?.sharing?.isPublic ||
        !!notebook?.sharing?.sharedWith?.some((entry) => entry.accessLevel !== 'owner')
    );
}

/** A new data page in a shared notebook shares nothing until its creator picks. */
export async function defaultDeviceFilter(
    notebookId: string | undefined,
): Promise<DeviceDataFilter | undefined> {
    if (!notebookId) return undefined;
    const notebook = await findNotebookByIdUnsafe(notebookId).catch(() => null);
    return isSharedWithOthers(notebook) ? {} : undefined;
}

export function dataPageView(page: Page, viewerId: string): DataPageView | null {
    if (page.type !== 'devicedata' || !page.deviceSource) return null;
    const isOwner = page.userId === viewerId;
    return {
        page,
        source: page.deviceSource,
        ownerId: page.userId,
        canManage: isOwner,
        visible: isOwner || !!page.deviceFilter,
        ...(page.deviceFilter ? { filter: page.deviceFilter } : {}),
    };
}

/** What the filter needs to know about the creator: time zone, and places for Places pages. */
async function filterContextFor(view: DataPageView) {
    const timeZone = (await collectorTimeZone(view.ownerId).catch(() => undefined)) ?? 'UTC';
    const places: FilterPlace[] =
        view.source === 'location' && view.filter?.excludePlaceIds?.length
            ? (await listPlaces(view.ownerId).catch(() => [])).map((entity) => ({
                  id: entity.id,
                  name: entity.name,
                  lat: entity.place?.lat,
                  lon: entity.place?.lon,
                  radius: entity.place?.radius,
              }))
            : [];
    return { timeZone, places };
}

/** Checks one item against the page's filter. Null when nothing can pass. */
export async function itemMatcherFor(
    view: DataPageView,
): Promise<((item: MacDataItem) => boolean) | null> {
    if (!view.visible || deviceFilterIsEmpty(view.source, view.filter)) return null;
    if (!view.filter) return (item) => item.source === view.source;
    const filter = view.filter;
    const context = await filterContextFor(view);
    return (item) => item.source === view.source && deviceItemMatchesFilter(item, filter, context);
}

/**
 * The page's filter as a database query: conditions for calendars, mailboxes and chats,
 * a check in code for Places. Null when nothing can pass.
 */
export async function itemQueryFor(
    view: DataPageView,
): Promise<Pick<DeviceItemQuery, 'conditions' | 'match'> | null> {
    if (!view.visible || deviceFilterIsEmpty(view.source, view.filter)) return null;
    const filter = view.filter;
    if (!filter || filter.includeAll) {
        return view.source === 'location' && filter ? { match: (await itemMatcherFor(view))! } : {};
    }
    if (view.source === 'calendar')
        return { conditions: { 'item.calendar': { $in: filter.calendars } } };
    if (view.source === 'mail')
        return { conditions: { 'item.mailbox': { $in: filter.mailboxes } } };
    if (view.source === 'imessage') return { conditions: { 'item.thread': { $in: filter.chats } } };
    return null;
}

export async function displayNameOf(userId: string): Promise<string> {
    const user = await findUserById(userId).catch(() => null);
    return user?.displayName?.trim() || user?.email?.split('@')[0] || 'Someone';
}

/** The access line the page view shows. */
export async function describeAccess(view: DataPageView): Promise<DeviceDataAccess> {
    const notebook = view.page.notebookId
        ? await findNotebookByIdUnsafe(view.page.notebookId).catch(() => null)
        : null;
    const placeNames =
        view.source === 'location' && view.filter?.excludePlaceIds?.length
            ? Object.fromEntries(
                  (await listPlaces(view.ownerId).catch(() => [])).map((e) => [e.id, e.name]),
              )
            : {};
    return {
        canManage: view.canManage,
        ownerName: await displayNameOf(view.ownerId),
        shared: isSharedWithOthers(notebook),
        ...(view.page.description ? { description: view.page.description } : {}),
        ...(view.filter
            ? { filterSummary: describeDeviceFilter(view.source, view.filter, placeNames) }
            : {}),
    };
}

/** Choices for the creator's filter panel, from their own data and named places. */
export async function filterOptionsFor(ownerId: string): Promise<DeviceDataFilterOptions> {
    const [facets, places] = await Promise.all([
        findDeviceItemFacets(ownerId),
        listPlaces(ownerId).catch(() => []),
    ]);
    return { ...facets, places: places.map((entity) => ({ id: entity.id, name: entity.name })) };
}

/** One page's slice of data, as a bot in the notebook reads it. */
export interface DataPageSlice {
    pageId: string;
    source: MacDataSource;
    ownerId: string;
    ownerName: string;
    title: string;
    description?: string;
    /** In words, when the page has a filter. */
    filterSummary?: string;
    match: (item: MacDataItem) => boolean;
}

/** Every data page in the notebook this person can see, with its filter, for bot tools. */
export async function dataPageSlicesFor(
    viewerId: string,
    notebookId: string,
): Promise<DataPageSlice[]> {
    const pages = await findDeviceDataPagesInNotebook(notebookId);
    const names = new Map<string, string>();
    const slices: DataPageSlice[] = [];
    for (const page of pages) {
        const view = dataPageView(page, viewerId);
        if (!view) continue;
        const match = await itemMatcherFor(view);
        if (!match) continue;
        if (!names.has(view.ownerId)) names.set(view.ownerId, await displayNameOf(view.ownerId));
        slices.push({
            pageId: page.id,
            source: view.source,
            ownerId: view.ownerId,
            ownerName: names.get(view.ownerId)!,
            title: page.title,
            ...(page.description ? { description: page.description } : {}),
            ...(view.filter
                ? { filterSummary: describeDeviceFilter(view.source, view.filter) }
                : {}),
            match,
        });
    }
    return slices;
}
