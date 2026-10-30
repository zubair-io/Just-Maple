import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PreferencesService } from '../../services/preferences.service';
import { ThemeService, ThemeId } from '../../services/theme.service';
import { DialogService } from '../../components/molecules/dialog/dialog.service';
import { DEFAULT_VOICE_IDS, TtsDevice } from '../../services/tts.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private readonly router = inject(Router);
  readonly preferences = inject(PreferencesService);
  readonly themeService = inject(ThemeService);
  private readonly dialogService = inject(DialogService);

  readonly voiceOptions = DEFAULT_VOICE_IDS;
  readonly deviceOptions: { value: TtsDevice; label: string; hint: string }[] = [
    { value: 'wasm', label: 'WASM (recommended)', hint: 'CPU inference. Clean audio everywhere.' },
    {
      value: 'webgpu',
      label: 'WebGPU (experimental)',
      hint: 'Faster, but currently produces distorted speech on many GPUs.',
    },
    {
      value: 'auto',
      label: 'Auto',
      hint: 'Currently maps to WASM until WebGPU quality is stable.',
    },
  ];

  goBack(): void {
    this.router.navigate(['/']);
  }

  setTheme(themeId: ThemeId): void {
    this.themeService.setTheme(themeId);
  }

  setVoice(voice: string): void {
    this.preferences.readerVoice.set(voice);
  }

  setDevice(device: TtsDevice): void {
    this.preferences.readerDevice.set(device);
  }

  setSpeed(value: number | string): void {
    const n = Number(value);
    if (Number.isFinite(n)) {
      this.preferences.readerSpeed.set(Math.max(0.5, Math.min(2, n)));
    }
  }

  voiceLabel(voiceId: string): string {
    const prefix = voiceId.slice(0, 2);
    const name = voiceId.slice(3).replace(/^./, (c) => c.toUpperCase());
    const accent = prefix.startsWith('b') ? 'British' : 'American';
    const gender = prefix.endsWith('f') ? 'F' : 'M';
    return `${name} (${accent} ${gender})`;
  }
}
