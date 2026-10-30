import type { DeviceDataAccess } from './device-data-filter';
import type { MacDataItem } from './mac-data';

export interface MessageConversation {
    key: string;
    name: string;
    kind: 'person' | 'group' | 'conversation';
    platforms: string[];
    count: number;
    matches: number;
    latestAt: number;
    preview: string;
}

export interface MessageHistoryQuery {
    pageId?: string;
    search?: string;
    platform?: string;
    from?: number;
    to?: number;
    includeAutomated?: boolean;
    conversation?: string;
    offset?: number;
    limit?: number;
    around?: string;
    before?: string;
}

export interface MessageDirectory {
    conversations: MessageConversation[];
    platforms: string[];
    total: number;
    access?: DeviceDataAccess;
}

export interface MessageHistoryPage {
    items: MacDataItem[];
    total: number;
    offset: number;
}

export interface MessageArchivePreview {
    id: string;
    filename: string;
    total: number;
    undated: number;
    people: number;
    groups: number;
    platforms: { platform: string; count: number }[];
}

export interface MessageArchiveProgress extends MessageArchivePreview {
    status: 'ready' | 'queued' | 'importing' | 'paused' | 'complete' | 'failed';
    selectedPlatforms?: string[];
    timeZone?: string;
    dataset?: string;
    cursor: number;
    processed: number;
    stored: number;
    duplicates: number;
    error?: string;
}
