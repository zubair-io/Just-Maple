export interface CompanionHost { postMessage(body: unknown): Promise<unknown> }
export function companionHost(): CompanionHost | undefined {
  return (window as unknown as { webkit?: { messageHandlers?: { mapleCompanion?: CompanionHost } } }).webkit?.messageHandlers?.mapleCompanion;
}
export function isCompanion(): boolean {
  return (window as unknown as { mapleHost?: string }).mapleHost === 'iphone';
}
