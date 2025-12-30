import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BotService, type EnrichedUserBot } from '../../services/bot.service';
import { ProfileAvatarComponent } from '../../components/atoms/profile-avatar/profile-avatar.component';
import { SettingsHeaderComponent } from '../../components';
import type { BotTemplate } from '@maple/shared';

@Component({
  selector: 'app-bots',
  standalone: true,
  imports: [CommonModule, FormsModule, ProfileAvatarComponent, SettingsHeaderComponent],
  templateUrl: './bots.component.html',
  styleUrl: './bots.component.scss',
})
export class BotsComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly botService = inject(BotService);

  // Bot templates
  readonly templates = this.botService.templates;
  readonly templatesLoading = this.botService.templatesLoading;

  // User bots
  readonly userBots = this.botService.userBots;
  readonly userBotsLoading = this.botService.userBotsLoading;

  // Register bot dialog
  readonly showRegisterDialog = signal(false);
  readonly selectedTemplate = signal<BotTemplate | null>(null);
  readonly customHandle = signal('');
  readonly apiKey = signal('');
  readonly isOAuthToken = signal(false);
  readonly registerError = signal<string | null>(null);
  readonly isRegistering = signal(false);

  // Edit bot dialog
  readonly showEditDialog = signal(false);
  readonly editingBot = signal<EnrichedUserBot | null>(null);
  readonly editApiKey = signal('');
  readonly editIsOAuthToken = signal(false);
  readonly editEnabled = signal(true);
  readonly editError = signal<string | null>(null);
  readonly isUpdating = signal(false);

  ngOnInit(): void {
    this.botService.loadTemplates().subscribe();
    this.botService.loadUserBots().subscribe();
  }

  goBack(): void {
    this.router.navigate(['/settings']);
  }

  // Template selection
  selectTemplate(template: BotTemplate): void {
    this.selectedTemplate.set(template);
    this.customHandle.set(template.handle);
    this.apiKey.set('');
    this.isOAuthToken.set(false);
    this.registerError.set(null);
    this.showRegisterDialog.set(true);
  }

  closeRegisterDialog(): void {
    this.showRegisterDialog.set(false);
    this.selectedTemplate.set(null);
    this.customHandle.set('');
    this.apiKey.set('');
    this.isOAuthToken.set(false);
    this.registerError.set(null);
  }

  registerBot(): void {
    const template = this.selectedTemplate();
    if (!template) return;

    // Validate API key if required
    if (template.requiresConfig && !this.apiKey().trim()) {
      this.registerError.set('API key is required for this bot');
      return;
    }

    this.isRegistering.set(true);
    this.registerError.set(null);

    this.botService
      .registerBot({
        templateId: template._id,
        handle: this.customHandle().trim() || undefined,
        config: template.requiresConfig
          ? {
              apiKey: this.apiKey().trim(),
              isOAuthToken: this.isOAuthToken(),
            }
          : undefined,
      })
      .subscribe({
        next: () => {
          this.closeRegisterDialog();
          this.isRegistering.set(false);
        },
        error: (err) => {
          this.registerError.set(err.message || 'Failed to register bot');
          this.isRegistering.set(false);
        },
      });
  }

  // Edit bot
  editBot(bot: EnrichedUserBot): void {
    this.editingBot.set(bot);
    this.editApiKey.set('');
    this.editIsOAuthToken.set(bot.config?.isOAuthToken || false);
    this.editEnabled.set(bot.isEnabled);
    this.editError.set(null);
    this.showEditDialog.set(true);
  }

  closeEditDialog(): void {
    this.showEditDialog.set(false);
    this.editingBot.set(null);
    this.editApiKey.set('');
    this.editIsOAuthToken.set(false);
    this.editError.set(null);
  }

  saveBot(): void {
    const bot = this.editingBot();
    if (!bot) return;

    this.isUpdating.set(true);
    this.editError.set(null);

    const updateData: {
      isEnabled?: boolean;
      config?: { apiKey?: string; isOAuthToken?: boolean };
    } = {
      isEnabled: this.editEnabled(),
    };

    // Check if OAuth setting has changed
    const oauthChanged = this.editIsOAuthToken() !== (bot.config?.isOAuthToken || false);

    // Update config if API key is provided or OAuth setting changed
    if (this.editApiKey().trim() || oauthChanged) {
      updateData.config = {};

      if (this.editApiKey().trim()) {
        updateData.config.apiKey = this.editApiKey().trim();
      }

      if (oauthChanged) {
        updateData.config.isOAuthToken = this.editIsOAuthToken();
      }
    }

    this.botService.updateBot(bot._id, updateData).subscribe({
      next: () => {
        this.closeEditDialog();
        this.isUpdating.set(false);
      },
      error: (err) => {
        this.editError.set(err.message || 'Failed to update bot');
        this.isUpdating.set(false);
      },
    });
  }

  deleteBot(bot: EnrichedUserBot): void {
    if (!confirm(`Are you sure you want to delete @${bot.handle}?`)) {
      return;
    }

    this.botService.deleteBot(bot._id).subscribe({
      error: (err) => {
        alert(err.message || 'Failed to delete bot');
      },
    });
  }

  toggleBotEnabled(bot: EnrichedUserBot): void {
    this.botService.updateBot(bot._id, { isEnabled: !bot.isEnabled }).subscribe({
      error: (err) => {
        alert(err.message || 'Failed to update bot');
      },
    });
  }

  isBotRegistered(template: BotTemplate): boolean {
    return this.userBots().some((b) => b.templateId === template._id);
  }
}
