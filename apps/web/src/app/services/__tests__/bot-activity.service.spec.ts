import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { ChatEvent } from '@maple/shared';
import { BotActivityService } from '../bot-activity.service';
import { RealtimeService } from '../realtime.service';

describe('BotActivityService', () => {
  let events: Subject<ChatEvent>;
  let service: BotActivityService;

  const event = (action: ChatEvent['action'], data: Record<string, unknown>): ChatEvent => ({
    action,
    data,
    pageId: 'page',
    notebookId: 'n1',
    userId: 'u1',
    timestamp: new Date().toISOString(),
  });

  beforeEach(() => {
    vi.useFakeTimers();
    events = new Subject<ChatEvent>();
    TestBed.configureTestingModule({
      providers: [{ provide: RealtimeService, useValue: { events$: events.asObservable() } }],
    });
    service = TestBed.inject(BotActivityService);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('shows a bot replying in a thread until it finishes', () => {
    events.next(
      event('bot_invocation_started', { invocationId: 'i1', botName: 'Claude', sourceId: 'm1' }),
    );
    expect(service.inThreadBySource().get('m1')).toEqual(['Claude']);
    expect(service.topLevelByNotebook().get('n1')).toBeUndefined();

    events.next(event('bot_invocation_completed', { invocationId: 'i1' }));
    expect(service.inThreadBySource().get('m1')).toBeUndefined();
  });

  it('shows proactive replies in the chat itself, and clears them on failure', () => {
    events.next(
      event('bot_invocation_started', {
        invocationId: 'i2',
        botName: 'Maple',
        sourceId: 'm2',
        replyTopLevel: true,
      }),
    );
    expect(service.topLevelByNotebook().get('n1')).toEqual(['Maple']);
    events.next(event('bot_invocation_failed', { invocationId: 'i2' }));
    expect(service.topLevelByNotebook().get('n1')).toBeUndefined();
  });

  it('stops showing a reply that never reports back', () => {
    events.next(event('bot_invocation_started', { invocationId: 'i3', sourceId: 'm3' }));
    expect(service.inThreadBySource().get('m3')).toEqual(['Bot']);
    vi.advanceTimersByTime(3 * 60 * 1000);
    expect(service.inThreadBySource().get('m3')).toBeUndefined();
  });
});
