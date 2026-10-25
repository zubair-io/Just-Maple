import { TestBed } from '@angular/core/testing';
import { BotUIComponent } from './bot-ui.component';
import type { BotUIResponse } from '@maple/shared';

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
});
