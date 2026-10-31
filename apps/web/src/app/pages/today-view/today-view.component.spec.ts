import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FollowUp } from '@maple/shared';
import { TodayViewComponent } from './today-view.component';
import { signal } from '@angular/core';
import { PageService } from '../../services/page.service';
import { AssistanceService } from '../../services/assistance.service';
const empty = () => ({ actions: [], tasks: [], followUps: [] });
describe('Today navigation and recovery', () => {
  const api = { today: vi.fn(), bots: vi.fn(), prepare: vi.fn() };
  let fixture: ComponentFixture<TodayViewComponent>, component: TodayViewComponent;
  const params = new BehaviorSubject(convertToParamMap({ notebookId: 'notebook' }));
  beforeEach(async () => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.today.mockResolvedValue(empty());
    api.bots.mockResolvedValue([{ id: 'bot', name: 'Bot', handle: 'bot' }]);
    TestBed.configureTestingModule({
      imports: [TodayViewComponent],
      providers: [
        { provide: AssistanceService, useValue: api },
        { provide: PageService, useValue: { pages: signal([]) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { parent: { paramMap: params, snapshot: { paramMap: params.value } } },
        },
      ],
    });
    TestBed.overrideComponent(TodayViewComponent, { set: { template: '', imports: [] } });
    fixture = TestBed.createComponent(TodayViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });
  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });
  it('ignores the previous section arriving late', async () => {
    let resolve!: (feed: unknown) => void;
    api.today.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const old = component.load();
    component.select('working');
    fixture.detectChanges();
    await vi.waitFor(() => expect(api.today).toHaveBeenLastCalledWith('notebook', 'working', {}));
    resolve({ ...empty(), tasks: [{ id: 'old-section' }] });
    await old;
    expect(component.feed().tasks).toEqual([]);
  });
  it('pages one list without dropping the others or their cursors', async () => {
    component.feed.set({ ...empty(), nextFollowUp: 'follow-cursor', nextTask: 'task-cursor' });
    api.today.mockResolvedValue({ ...empty(), nextTask: 'next-task' });
    await component.load('notebook', 'working', 'tasks');
    expect(api.today).toHaveBeenLastCalledWith('notebook', 'working', {
      taskBefore: 'task-cursor',
    });
    expect(component.feed().nextFollowUp).toBe('follow-cursor');
    expect(component.feed().nextTask).toBe('next-task');
  });
  it('retries preparation with the same request id without opening it in another section', async () => {
    const follow = { id: 'follow-up' } as FollowUp;
    api.prepare.mockRejectedValueOnce(new Error('Disconnected'));
    await component.draft(follow);
    const first = api.prepare.mock.calls[0]?.[3];
    let resolve!: (value: unknown) => void;
    api.prepare.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const retry = component.draft(follow);
    expect(api.prepare.mock.calls[1]?.[3]).toBe(first);
    component.select('review');
    fixture.detectChanges();
    resolve({ conversation: { id: 'late-conversation' } });
    await retry;
    expect(component.openConversation()).toBeNull();
  });
});
