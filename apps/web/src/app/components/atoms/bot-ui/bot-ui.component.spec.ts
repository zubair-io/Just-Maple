import { TestBed } from '@angular/core/testing';
import { BotUIComponent } from './bot-ui.component';
import { signal } from '@angular/core';
import type { BotUIResponse } from '@maple/shared';
import { CalendarProposalService } from '../../../services/calendar-proposal.service';
import { BotActionService } from '../../../services/bot-action.service';

const savedResponse: BotUIResponse = {
  version: 1,
  format: 'openui',
  blocks: [
    { type: 'text', content: '<script>plain text</script>' },
    { type: 'card', title: 'Plan', content: 'Step one' },
    { type: 'table', headers: ['Option'], rows: [['Maple']] },
    { type: 'button', label: 'Compare', message: 'Compare options' },
    {
      type: 'form',
      title: 'Preferences',
      fields: [{ name: 'budget', label: 'Budget' }],
      submitLabel: 'Send',
    },
  ],
};

describe('saved OpenUI replies', () => {
  async function render() {
    await TestBed.configureTestingModule({ imports: [BotUIComponent] }).compileComponents();
    const fixture = TestBed.createComponent(BotUIComponent);
    fixture.componentRef.setInput('response', JSON.parse(JSON.stringify(savedResponse)));
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }
  it('renders reloaded cards, tables and text through the Angular renderer', async () => {
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('openui-renderer')).toBeTruthy();
    expect(host.querySelector('h3')?.textContent).toBe('Plan');
    expect(host.querySelector('td')?.textContent?.trim()).toBe('Maple');
    expect(host.textContent).toContain('<script>plain text</script>');
    expect(host.querySelector('script')).toBeNull();
    fixture.destroy();
  });
  it('dispatches button and form actions and honors the pending state', async () => {
    const fixture = await render();
    const messages: string[] = [];
    fixture.componentInstance.followUp.subscribe((value) => messages.push(value));
    const host: HTMLElement = fixture.nativeElement;
    host.querySelector<HTMLButtonElement>('button')!.click();
    await fixture.whenStable();
    expect(messages).toEqual(['Compare options']);
    const input = host.querySelector<HTMLInputElement>('input')!;
    input.value = '200';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(messages.at(-1)).toBe('Preferences\nBudget: 200');
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect([...host.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    host.querySelector<HTMLButtonElement>('button')!.click();
    expect(messages).toHaveLength(2);
    fixture.destroy();
  });
  it('falls back for corrupt or unsupported saved data', async () => {
    const fixture = await render();
    fixture.componentRef.setInput('response', { ...savedResponse, version: 99 });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role=status]')?.textContent).toContain(
      'respond as text',
    );
    fixture.destroy();
  });
  it('renders saved Add to calendar cards', async () => {
    const load = vi.fn();
    await TestBed.configureTestingModule({
      imports: [BotUIComponent],
      providers: [{ provide: CalendarProposalService, useValue: { proposals: signal({}), load } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(BotUIComponent);
    fixture.componentRef.setInput('response', {
      version: 1,
      format: 'openui',
      blocks: [
        {
          type: 'event_proposal',
          proposalId: '7d1e3a52-6c55-4a8e-9b1a-0d4f3c2b1a00',
          event: { title: 'Pizza party', start: 1793214000, end: 1793217600 },
        },
      ],
    } satisfies BotUIResponse);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('app-event-proposal-card h3')?.textContent).toBe('Pizza party');
    expect(load).toHaveBeenCalledWith('7d1e3a52-6c55-4a8e-9b1a-0d4f3c2b1a00');
    expect(host.querySelector('[role=status]')?.textContent ?? '').not.toContain('respond as text');
    fixture.destroy();
  });

  it('renders "Done · Undo" cards from the server, with the saved summary', async () => {
    const load = vi.fn();
    await TestBed.configureTestingModule({
      imports: [BotUIComponent],
      providers: [{ provide: BotActionService, useValue: { actions: signal({}), load } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(BotUIComponent);
    fixture.componentRef.setInput('response', {
      version: 1,
      format: 'openui',
      blocks: [
        {
          type: 'action_receipt',
          actionId: '7d1e3a52-6c55-4a8e-9b1a-0d4f3c2b1a00',
          summary: '“Pizza party” · Wed, Oct 28',
        },
      ],
    } satisfies BotUIResponse);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('app-action-receipt-card')?.textContent).toContain('Pizza party');
    expect(load).toHaveBeenCalledWith('7d1e3a52-6c55-4a8e-9b1a-0d4f3c2b1a00');
    fixture.destroy();
  });
  it('renders drafted replies from the saved id alone, loading the draft from the server', async () => {
    const load = vi.fn();
    await TestBed.configureTestingModule({
      imports: [BotUIComponent],
      providers: [{ provide: BotActionService, useValue: { actions: signal({}), load } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(BotUIComponent);
    fixture.componentRef.setInput('response', {
      version: 1,
      format: 'openui',
      blocks: [{ type: 'reply_draft', actionId: '5b0c6f1e-3d2a-4c1b-9e8f-7a6b5c4d3e2f' }],
    } satisfies BotUIResponse);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('app-reply-draft-card')?.textContent).toContain('Drafted a reply');
    expect(load).toHaveBeenCalledWith('5b0c6f1e-3d2a-4c1b-9e8f-7a6b5c4d3e2f');
    fixture.destroy();
  });
});
