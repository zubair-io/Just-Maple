import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { RecorderComponent } from '../recorder.component';
import { RecorderWorkspaceService } from '../../../services/recorder-workspace.service';
import { recorderFixture } from './recorder.fixture';

describe('RecorderComponent', () => {
  beforeAll(() => {
    TestBed.resetTestEnvironment();
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });
  const workspace = {
    state: signal(recorderFixture()),
    error: signal<string | null>(null),
    connected: true,
    open: vi.fn(),
    close: vi.fn(),
    command: vi.fn(async () => ({})),
    select: vi.fn(async () => {}),
  };
  beforeEach(async () => {
    workspace.state.set(recorderFixture());
    workspace.error.set(null);
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [RecorderComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: RecorderWorkspaceService, useValue: workspace },
      ],
    }).compileComponents();
  });
  afterEach(() => TestBed.resetTestingModule());
  it('renders the library and timed transcript inside the web UI', () => {
    const fixture = TestBed.createComponent(RecorderComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Product planning');
    expect(fixture.nativeElement.textContent).toContain('Alex');
    expect(fixture.nativeElement.textContent).toContain('Let’s put recording');
    expect(workspace.open).toHaveBeenCalled();
    fixture.destroy();
    expect(workspace.close).toHaveBeenCalled();
  });
  it('searches the library without changing native data', () => {
    const fixture = TestBed.createComponent(RecorderComponent);
    fixture.componentInstance.search.set('missing');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.recording-row').length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('No matches');
    expect(workspace.command).not.toHaveBeenCalled();
  });
  it('saves speaker names and transcript edits using stable recording fields', async () => {
    const fixture = TestBed.createComponent(RecorderComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.startEdit('speaker', 'Alex', 'speaker1');
    component.editValue = 'Jordan';
    await component.saveEdit();
    expect(workspace.command).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'edit',
        field: 'speaker',
        speakerId: 'speaker1',
        value: 'Jordan',
      }),
    );
    component.startEdit('segment', 'old', undefined, 1);
    component.editValue = 'Corrected text';
    await component.saveEdit();
    expect(workspace.command).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'segment', segmentIndex: 1, value: 'Corrected text' }),
    );
  });
  it('leaves saved keys unchanged unless explicitly updating them', async () => {
    const fixture = TestBed.createComponent(RecorderComponent);
    fixture.detectChanges();
    fixture.componentInstance.openSettings();
    await fixture.componentInstance.saveSettings();
    const payload = workspace.command.mock.calls.at(-1)?.[0] as any;
    expect(payload.settings).not.toHaveProperty('claudeKey');
    expect(payload.settings).not.toHaveProperty('openAIKey');
  });
  it('keeps an open edit bound to its recording if selection changes in the background', async () => {
    const fixture = TestBed.createComponent(RecorderComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.startEdit('title', 'Product planning');
    const next = recorderFixture();
    next.selected!.id = 'NEW';
    workspace.state.set(next);
    component.editValue = 'Original recording renamed';
    await component.saveEdit();
    expect(workspace.command).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'edit',
        recordingId: 'ABC',
        value: 'Original recording renamed',
      }),
    );
  });
  it('requires a second click to delete a recording', () => {
    const fixture = TestBed.createComponent(RecorderComponent);
    fixture.detectChanges();
    const button = [...fixture.nativeElement.querySelectorAll('button')].find(
      (element: any) => element.textContent.trim() === 'Delete',
    ) as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('This cannot be undone');
    expect(workspace.command).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'delete' }),
    );
  });
});
