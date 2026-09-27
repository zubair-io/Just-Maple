import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskDetailComponent } from './task-detail.component';
import { WorldService } from './world.service';
import { emptyWorld, newTask } from './world.models';

describe('waiting follow-up detail', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('explains the separate review and opens its accepted parent task', async () => {
    const parent = { ...newTask(), id: 'parent', title: 'Fixture original obligation', status: 'waiting' as const, waitingReason: 'Fixture other actor' };
    const review = { ...newTask(), id: 'review', title: 'Fixture follow-up', waitingFollowUp: { parentNodeID: 'source:original', triggerAt: 1, reason: 'review_due' } };
    const data = signal({ ...emptyWorld, tasks: [parent, review], suggestions: [{ id: 'original', reviewStatus: 'accepted', acceptedTaskID: parent.id, candidate: parent } as any] });
    const go = vi.fn(), params = convertToParamMap({ id: review.id });
    const world = { data, go, activity: () => undefined, dueLabel: () => 'No deadline', bridge: { pending: signal(false), act: vi.fn() } };
    TestBed.configureTestingModule({ providers: [
      { provide: WorldService, useValue: world },
      { provide: ActivatedRoute, useValue: { paramMap: of(params), snapshot: { paramMap: params, queryParamMap: convertToParamMap({}) } } }
    ] });
    const fixture = TestBed.createComponent(TaskDetailComponent);
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Completing it does not complete the original obligation');
    const link = [...fixture.nativeElement.querySelectorAll('button')].find((button: any) => button.textContent.includes('Open linked task')) as HTMLButtonElement;
    expect(link.textContent).toContain(parent.title); link.click();
    expect(go).toHaveBeenCalledWith('tasks/parent');
    expect(data().tasks[0].status).toBe('waiting');
  });
});
