import type { BotUIResponse, PageContent } from './schemas';

export type AssistanceStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
export interface AssistanceConversation {
    id: string;
    pageId: string;
    notebookId: string;
    botId: string;
    botName: string;
    draft?: string;
    draftVersion?: number;
    createdAt: string;
}
export interface AssistanceMessage {
    id: string;
    conversationId: string;
    role: 'user' | 'assistant';
    content: PageContent;
    createdAt: string;
    taskId?: string;
    botUI?: BotUIResponse;
    botResponseSource?: string;
    model?: string;
    sourceTitle?: string;
    sourceRevision?: string;
    selection?: string;
}
export interface AssistanceTask {
    id: string;
    conversationId: string;
    pageId: string;
    notebookId: string;
    botName: string;
    question: string;
    status: AssistanceStatus;
    progress: string;
    createdAt: string;
    updatedAt: string;
    error?: string;
    actionIds?: string[];
    savedPageId?: string;
}
export interface AssistanceHistory {
    conversation: AssistanceConversation;
    messages: AssistanceMessage[];
    tasks: AssistanceTask[];
    hasMore: boolean;
}

export type TodaySection = 'needs-you' | 'working' | 'review' | 'recent';
export interface TodayFeed {
    followUps: import('./schemas').FollowUp[];
    actions: import('./schemas').BotAction[];
    tasks: AssistanceTask[];
    nextFollowUp?: string;
    nextAction?: string;
    nextTask?: string;
}
