import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskActionsComponent, TaskActionRequest } from './task-actions.component';
import { DesktopTaskActionsComponent } from './desktop-task-actions.component';
import { WorldService } from './world.service';
import { emptyWorld } from './world.models';

function button(fixture: any, label: string): HTMLButtonElement {
  const found = [...fixture.nativeElement.querySelectorAll('button')].find((b: any) => b.textContent.trim() === label);
  expect(found, `Expected button ${label}`).toBeTruthy();
  return found as HTMLButtonElement;
}
function setup() {
  const fixture = TestBed.createComponent(TaskActionsComponent);
  fixture.componentRef.setInput('identity', 'task:fixture');
  fixture.componentRef.setInput('version', 4);
  const emitted: TaskActionRequest[] = [];
  fixture.componentInstance.submitAction.subscribe(request => emitted.push(request));
  fixture.detectChanges();
  return { fixture, c: fixture.componentInstance, emitted };
}

describe('shared daily task actions', () => {
  afterEach(() => { vi.restoreAllMocks(); TestBed.resetTestingModule(); });

  it('reuses the entire immutable request on retry but creates a new command for a new task version', () => {
    const { fixture, emitted } = setup();
    button(fixture, 'Done').click();
    button(fixture, 'Done').click();
    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toEqual(emitted[0]);
    expect(emitted[0].intent).toBe('done');
    expect(emitted[0].payload).toEqual({});
    fixture.componentRef.setInput('version', 5); fixture.detectChanges();
    button(fixture, 'Done').click();
    expect(emitted[2].requestID).not.toBe(emitted[0].requestID);
  });

  it('shows a deadline warning and emits only a resurfacing timestamp for Later', async () => {
    const { fixture, c, emitted } = setup();
    vi.spyOn(Date, 'now').mockReturnValue(new Date(2030, 0, 1, 9).getTime());
    fixture.componentRef.setInput('deadline', new Date(2030, 0, 1, 12).getTime() / 1000);
    button(fixture, 'Later').click(); c.when = '2030-01-02T09:00';
    fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('after the original deadline');
    button(fixture, 'Save for later').click();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].intent).toBe('later');
    expect(emitted[0].payload).toEqual({ resurfaceAt: new Date(c.when).toISOString() });
    expect(c.deadline()).toBe(new Date(2030, 0, 1, 12).getTime() / 1000);
  });

  it('allows the same immutable Later retry after its resurfacing time passes', () => {
    const { fixture, c, emitted } = setup();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(new Date(2030, 0, 1, 9).getTime());
    c.when = '2030-01-01T10:00'; c.send('later');
    expect(emitted).toHaveLength(1);
    clock.mockReturnValue(new Date(2030, 0, 1, 11).getTime());
    c.send('later');
    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toEqual(emitted[0]);
    fixture.componentRef.setInput('version', 5); fixture.detectChanges();
    c.send('later');
    expect(emitted).toHaveLength(2); // A new command cannot use a past choice.
  });

  it('requires a waiting actor, permits no review date, and rejects a past review date', async () => {
    const { fixture, c, emitted } = setup();
    button(fixture, 'Waiting').click(); c.waitingOn = '   '; fixture.detectChanges();
    await fixture.whenStable();
    expect(button(fixture, 'Save waiting status').disabled).toBe(true);
    c.send('waiting'); expect(emitted).toHaveLength(0);
    c.waitingOn = '界'.repeat(200); c.send('waiting'); expect(emitted).toHaveLength(0);
    c.waitingOn = '  Fixture contractor  '; fixture.detectChanges();
    expect(button(fixture, 'Save waiting status').disabled).toBe(false);
    button(fixture, 'Save waiting status').click();
    expect(emitted[0].payload).toEqual({ waitingOn: 'Fixture contractor' });
    c.when = '2000-01-01T10:00'; c.send('waiting');
    expect(emitted).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Maple adds a separate follow-up task');
  });

  it('does not offer Later for blocked Waiting work', () => {
    const { fixture, c, emitted } = setup();
    fixture.componentRef.setInput('waiting', true); fixture.detectChanges();
    expect([...fixture.nativeElement.querySelectorAll('button')].some((b: any) => b.textContent.trim() === 'Later')).toBe(false);
    c.when = '2099-01-01T10:00'; c.send('later');
    expect(emitted).toHaveLength(0);
    fixture.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    expect(c.mode()).toBeNull();
  });

  it('isolates shortcuts from typing controls including inherited editable content', () => {
    const { fixture, emitted } = setup();
    for (const markup of ['<input>', '<textarea></textarea>', '<select></select>', '<div contenteditable="true"><span>typing</span></div>', '<div contenteditable=""><span>typing</span></div>', '<div contenteditable="plaintext-only"><span>typing</span></div>', '<div role="textbox"><span>typing</span></div>']) {
      const host = document.createElement('div'); host.innerHTML = markup; fixture.nativeElement.appendChild(host);
      const target = host.querySelector('span') ?? host.firstElementChild!;
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }));
      host.remove();
    }
    expect(emitted).toHaveLength(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', repeat: true, bubbles: true }));
    expect(emitted).toHaveLength(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
    expect(emitted).toHaveLength(1); expect(emitted[0].intent).toBe('done');
  });

  it('passes the same request ID, entity version and Unix timestamps through the desktop adapter', async () => {
    const task: any = { id: 'fixture', title: 'Fixture task', status: 'open', version: 7, activityIDs: [], evidenceIDs: [], createdAt: 1, updatedAt: 1 };
    const data = signal({ ...emptyWorld, tasks: [task] });
    const act = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({ providers: [{ provide: WorldService, useValue: { data, bridge: { pending: signal(false), act } } }] });
    const fixture = TestBed.createComponent(DesktopTaskActionsComponent);
    fixture.componentRef.setInput('nodeID', 'task:fixture'); fixture.detectChanges();
    const child: TaskActionsComponent = fixture.debugElement.query(By.directive(TaskActionsComponent)).componentInstance;
    child.waitingOn = 'Fixture reviewer'; child.send('waiting');
    await fixture.whenStable();
    child.send('waiting'); await fixture.whenStable();
    expect(act).toHaveBeenCalledTimes(2);
    expect(act.mock.calls[1][0]).toEqual(act.mock.calls[0][0]);
    expect(act.mock.calls[0][0]).toMatchObject({ action: 'applyTaskAction', id: 'task:fixture', expectedVersion: 7, change: { kind: 'waiting', waitingOn: 'Fixture reviewer' } });
    expect(act.mock.calls[0][0].change.issuedAt).toBeGreaterThan(1_000_000_000);
    expect(act.mock.calls[0][0].change.issuedAt).toBeLessThan(10_000_000_000);
    expect(act.mock.calls[0][0].scope).toBeUndefined(); // Scope belongs to the native host.
  });
});
