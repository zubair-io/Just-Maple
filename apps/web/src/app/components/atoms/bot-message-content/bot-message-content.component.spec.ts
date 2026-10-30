import { TestBed } from '@angular/core/testing';
import { BotMessageContentComponent } from './bot-message-content.component';
import { DeviceDataService } from '../../../services/device-data.service';
import { markdownToProseMirror } from '@maple/shared/bot-response';

const program =
  'Response([note, ci, src1, src2, src3])note = Text("A forwarded email has a deadline.")ci = Text("Two workflows failed.")src1 = Source("Forwarded email", "mail:123")src2 = Source("Web workflow", "mail:124")src3 = Source("Android workflow", "mail:125")';

describe('bot messages rendered from saved source', () => {
  it('renders legacy vbnet code as paragraphs and clickable sources', async () => {
    const openItem = vi.fn();
    await TestBed.configureTestingModule({
      imports: [BotMessageContentComponent],
      providers: [{ provide: DeviceDataService, useValue: { openItem } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(BotMessageContentComponent);
    fixture.componentRef.setInput('message', {
      senderType: 'bot',
      content: markdownToProseMirror('```vbnet\n' + program + '\n```'),
    });
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelectorAll('.bot-ui p')).toHaveLength(2);
    expect(host.querySelectorAll('.maple-source')).toHaveLength(3);
    expect(host.querySelector('app-content-renderer')).toBeNull();
    expect(host.textContent).not.toContain('Response(');
    host.querySelectorAll<HTMLButtonElement>('.maple-source')[2]!.click();
    expect(openItem).toHaveBeenCalledWith('mail:125');
    fixture.destroy();
  });
  it('reparses updated source, escapes text, and waits for a follow-up click', async () => {
    await TestBed.configureTestingModule({
      imports: [BotMessageContentComponent],
      providers: [{ provide: DeviceDataService, useValue: { openItem: vi.fn() } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(BotMessageContentComponent);
    const followUp = vi.fn();
    fixture.componentInstance.followUp.subscribe(followUp);
    const message = {
      senderType: 'bot',
      content: markdownToProseMirror('Old fallback'),
      botResponseSource: 'Response([Text("Old reply")])',
    };
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('message', {
      ...message,
      botResponseSource:
        'Response([Text("<script>plain text</script>"), Button("More", "Show more")])',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('<script>plain text</script>');
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).not.toContain('Old reply');
    expect(followUp).not.toHaveBeenCalled();
    host.querySelector<HTMLButtonElement>('button')!.click();
    await fixture.whenStable();
    expect(followUp).toHaveBeenCalledWith('Show more');
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
    fixture.destroy();
  });
});
