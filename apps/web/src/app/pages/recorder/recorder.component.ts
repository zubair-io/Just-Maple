import { A11yModule } from '@angular/cdk/a11y';
import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AppHeaderComponent } from '../../components/organisms/app-header/app-header.component';
import { RecorderWorkspaceService } from '../../services/recorder-workspace.service';
import type { RecorderPrompt, RecorderRequest, RecorderSettings } from '../../types/recorder.types';

@Component({
  selector: 'app-recorder',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AppHeaderComponent, A11yModule],
  templateUrl: './recorder.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './recorder.component.scss',
})
export class RecorderComponent implements OnInit, OnDestroy {
  readonly recorder = inject(RecorderWorkspaceService);
  readonly state = this.recorder.state;
  readonly search = signal('');
  readonly tag = signal('');
  readonly tab = signal<'transcript' | 'notes' | 'summary' | 'prompts' | 'timeline'>('transcript');
  readonly settingsOpen = signal(false);
  readonly promptEditorOpen = signal(false);
  readonly actionPending = signal(false);
  readonly selecting = signal(false);
  readonly deleteConfirm = signal<string | null>(null);
  readonly image = signal<string | null>(null);
  readonly editing = signal<{
    field: 'title' | 'summary' | 'notes' | 'userNotes' | 'tags' | 'speaker' | 'segment';
    value: string;
    recordingId?: string;
    speakerId?: string;
    segmentIndex?: number;
  } | null>(null);
  readonly records = computed(() => {
    const query = this.search().toLowerCase();
    return (this.state()?.recordings ?? []).filter(
      (r) =>
        (!query || `${r.title} ${r.tags.join(' ')}`.toLowerCase().includes(query)) &&
        (!this.tag() || r.tags.includes(this.tag())),
    );
  });
  readonly tags = computed(() =>
    [...new Set(this.state()?.recordings.flatMap((r) => r.tags) ?? [])].sort(),
  );
  readonly locked = computed(() => this.actionPending() || !!this.state()?.busy);
  includeSystemAudio = false;
  liveNotes = '';
  private liveNotesDirty = false;
  private liveNotesTimer?: ReturnType<typeof setTimeout>;
  transcriptSearch = '';
  question = '';
  context = '';
  promptId = '';
  promptName = '';
  promptBody = '';
  editValue = '';
  draftSettings: RecorderSettings | null = null;
  claudeKey = '';
  openAIKey = '';
  saveClaudeKey = false;
  saveOpenAIKey = false;

  constructor() {
    effect(() => {
      const notes = this.state()?.assist?.notes;
      if (!this.liveNotesDirty && notes !== undefined) this.liveNotes = notes;
    });
  }
  ngOnInit(): void {
    this.recorder.open();
  }
  ngOnDestroy(): void {
    clearTimeout(this.liveNotesTimer);
    if (this.liveNotesDirty && this.state()?.isRecording && this.state()?.systemAudioSupported) {
      void this.recorder.command({ operation: 'liveNotes', value: this.liveNotes }).catch(() => {});
    }
    this.recorder.close();
  }
  @HostListener('document:keydown.escape')
  closeDialog(): void {
    this.image.set(null);
    this.editing.set(null);
    this.promptEditorOpen.set(false);
    this.settingsOpen.set(false);
    this.claudeKey = '';
    this.openAIKey = '';
  }
  updateLiveNotes(value: string): void {
    this.liveNotes = value;
    this.liveNotesDirty = true;
    clearTimeout(this.liveNotesTimer);
    this.liveNotesTimer = setTimeout(() => {
      void this.recorder.command({ operation: 'liveNotes', value }).catch(() => {});
    }, 400);
  }
  async stop(): Promise<void> {
    clearTimeout(this.liveNotesTimer);
    if (this.state()?.systemAudioSupported) {
      await this.act({ operation: 'liveNotes', value: this.liveNotes });
    }
    await this.act({ operation: 'stop' });
    if (!this.recorder.error()) {
      this.liveNotes = '';
      this.liveNotesDirty = false;
    }
  }

  async act(command: Omit<RecorderRequest, 'requestId'>): Promise<void> {
    this.actionPending.set(true);
    try {
      const scoped = [
        'edit',
        'delete',
        'play',
        'seek',
        'rate',
        'process',
        'clean',
        'summarize',
        'runPrompt',
        'ask',
        'deleteResult',
      ];
      await this.recorder.command(
        scoped.includes(command.operation)
          ? { recordingId: this.state()?.selected?.id, ...command }
          : command,
      );
    } catch {
      /* The service exposes an accessible error in the template. */
    } finally {
      this.actionPending.set(false);
    }
  }
  async select(id: string): Promise<void> {
    this.editing.set(null);
    this.deleteConfirm.set(null);
    this.transcriptSearch = '';
    this.selecting.set(true);
    try {
      await this.recorder.select(id);
    } catch {
      /* visible service error */
    } finally {
      this.selecting.set(false);
    }
  }
  startEdit(
    field: NonNullable<RecorderRequest['field']>,
    value: string,
    speakerId?: string,
    segmentIndex?: number,
  ): void {
    this.editValue = value;
    this.editing.set({
      field,
      value,
      recordingId: this.state()?.selected?.id,
      speakerId,
      segmentIndex,
    });
  }
  async saveEdit(): Promise<void> {
    const edit = this.editing();
    if (!edit) return;
    await this.act({
      operation: 'edit',
      recordingId: edit.recordingId,
      field: edit.field,
      value: this.editValue,
      speakerId: edit.speakerId,
      segmentIndex: edit.segmentIndex,
      ...(edit.field === 'tags'
        ? {
            tags: this.editValue
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          }
        : {}),
    });
    if (!this.recorder.error()) this.editing.set(null);
  }
  speakerName(id: string): string {
    return this.state()?.selected?.speakers.find((s) => s.id === id)?.display_name ?? id;
  }
  time(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
  }
  async remove(): Promise<void> {
    await this.act({ operation: 'delete' });
    this.deleteConfirm.set(null);
  }
  async export(): Promise<void> {
    try {
      const response = await this.recorder.command({
        operation: 'export',
        recordingId: this.state()?.selected?.id,
      });
      if (response.exportHandled || !response.exported) return;
      const blob = new Blob([response.exported], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${
        this.state()
          ?.selected?.title.replace(/[^\p{L}\p{N} _-]/gu, '')
          .slice(0, 100) || 'recording'
      }.md`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* visible service error */
    }
  }
  async preview(file: string): Promise<void> {
    try {
      const response = await this.recorder.command({
        operation: 'screenshot',
        recordingId: this.state()?.selected?.id,
        value: file,
      });
      this.image.set(response.image ?? null);
    } catch {
      /* visible service error */
    }
  }
  openSettings(): void {
    const settings = this.state()?.settings;
    if (!settings) return;
    this.draftSettings = { ...settings, calendarIds: [...settings.calendarIds] };
    this.claudeKey = '';
    this.openAIKey = '';
    this.saveClaudeKey = false;
    this.saveOpenAIKey = false;
    this.settingsOpen.set(true);
  }
  async saveSettings(): Promise<void> {
    if (!this.draftSettings) return;
    await this.act({
      operation: 'settings',
      settings: {
        ...this.draftSettings,
        ...(this.saveClaudeKey ? { claudeKey: this.claudeKey } : {}),
        ...(this.saveOpenAIKey ? { openAIKey: this.openAIKey } : {}),
      },
    });
    this.claudeKey = '';
    this.openAIKey = '';
    if (!this.recorder.error()) this.settingsOpen.set(false);
  }
  calendar(id: string, checked: boolean): void {
    if (!this.draftSettings) return;
    this.draftSettings.calendarIds = checked
      ? [...this.draftSettings.calendarIds, id]
      : this.draftSettings.calendarIds.filter((value) => value !== id);
  }
  editPrompt(prompt?: RecorderPrompt): void {
    this.promptId = prompt?.id ?? '';
    this.promptName = prompt?.name ?? '';
    this.promptBody = prompt?.system_prompt ?? '';
    this.promptEditorOpen.set(true);
  }
  async savePrompt(): Promise<void> {
    await this.act({
      operation: 'savePrompt',
      promptId: this.promptId || undefined,
      name: this.promptName,
      body: this.promptBody,
    });
    if (!this.recorder.error()) this.promptEditorOpen.set(false);
  }
}
