import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  BotService,
  type EnrichedUserBot,
  type CustomBot,
  type CustomBotWithToken,
  type CustomBotSession,
} from '../../services/bot.service';
import { ProfileAvatarComponent } from '../../components/atoms/profile-avatar/profile-avatar.component';
import { SettingsHeaderComponent } from '../../components';
import type { BotTemplate, CreateCustomBotInput } from '@maple/shared';

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

  // User bots (template-based)
  readonly userBots = this.botService.userBots;
  readonly userBotsLoading = this.botService.userBotsLoading;

  // Custom bots (webhook-based)
  readonly customBots = this.botService.customBots;
  readonly customBotsLoading = this.botService.customBotsLoading;

  // Register bot dialog (template bots)
  readonly showRegisterDialog = signal(false);
  readonly selectedTemplate = signal<BotTemplate | null>(null);
  readonly customHandle = signal('');
  readonly apiKey = signal('');
  readonly isOAuthToken = signal(false);
  readonly registerError = signal<string | null>(null);
  readonly isRegistering = signal(false);

  // Edit bot dialog (template bots)
  readonly showEditDialog = signal(false);
  readonly editingBot = signal<EnrichedUserBot | null>(null);
  readonly editApiKey = signal('');
  readonly editIsOAuthToken = signal(false);
  readonly editEnabled = signal(true);
  readonly editError = signal<string | null>(null);
  readonly isUpdating = signal(false);

  // Create custom bot dialog
  readonly showCreateCustomBotDialog = signal(false);
  readonly newBotName = signal('');
  readonly newBotHandle = signal('');
  readonly newBotDescription = signal('');
  readonly newBotInvokeUrl = signal('');
  readonly newBotPermReadMessages = signal(true);
  readonly newBotPermWriteMessages = signal(true);
  readonly newBotJwtExpiration = signal(12);
  readonly createCustomBotError = signal<string | null>(null);
  readonly isCreatingCustomBot = signal(false);

  // Token display dialog (shown after creating custom bot)
  readonly showTokenDialog = signal(false);
  readonly createdBotToken = signal<string | null>(null);
  readonly createdBotSecret = signal<string | null>(null);
  readonly createdBotName = signal('');
  readonly tokenCopied = signal(false);
  readonly secretCopied = signal(false);

  // Edit custom bot dialog
  readonly showEditCustomBotDialog = signal(false);
  readonly editingCustomBot = signal<CustomBot | null>(null);
  readonly editCustomBotName = signal('');
  readonly editCustomBotDescription = signal('');
  readonly editCustomBotInvokeUrl = signal('');
  readonly editCustomBotPermReadMessages = signal(true);
  readonly editCustomBotPermWriteMessages = signal(true);
  readonly editCustomBotJwtExpiration = signal(12);
  readonly editCustomBotError = signal<string | null>(null);
  readonly isUpdatingCustomBot = signal(false);

  // Custom bot sessions dialog
  readonly showSessionsDialog = signal(false);
  readonly sessionsBot = signal<CustomBot | null>(null);
  readonly botSessions = signal<CustomBotSession[]>([]);
  readonly sessionsLoading = signal(false);

  // Regenerated token/secret display
  readonly showRegeneratedTokenDialog = signal(false);
  readonly regeneratedToken = signal<string | null>(null);
  readonly regeneratedTokenCopied = signal(false);

  readonly showRegeneratedSecretDialog = signal(false);
  readonly regeneratedSecret = signal<string | null>(null);
  readonly regeneratedSecretCopied = signal(false);

  ngOnInit(): void {
    this.botService.loadTemplates().subscribe();
    this.botService.loadUserBots().subscribe();
    this.botService.loadCustomBots().subscribe();
  }

  goBack(): void {
    this.router.navigate(['/settings']);
  }

  // ============================================
  // Template Bot Selection
  // ============================================

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

  // ============================================
  // Edit Template Bot
  // ============================================

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

    const oauthChanged = this.editIsOAuthToken() !== (bot.config?.isOAuthToken || false);

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

  // ============================================
  // Create Custom Bot
  // ============================================

  openCreateCustomBotDialog(): void {
    this.newBotName.set('');
    this.newBotHandle.set('');
    this.newBotDescription.set('');
    this.newBotInvokeUrl.set('');
    this.newBotPermReadMessages.set(true);
    this.newBotPermWriteMessages.set(true);
    this.newBotJwtExpiration.set(12);
    this.createCustomBotError.set(null);
    this.showCreateCustomBotDialog.set(true);
  }

  closeCreateCustomBotDialog(): void {
    this.showCreateCustomBotDialog.set(false);
    this.createCustomBotError.set(null);
  }

  createCustomBot(): void {
    const name = this.newBotName().trim();
    const handle = this.newBotHandle().trim().toLowerCase();
    const invokeUrl = this.newBotInvokeUrl().trim();

    if (!name) {
      this.createCustomBotError.set('Bot name is required');
      return;
    }
    if (!handle) {
      this.createCustomBotError.set('Bot handle is required');
      return;
    }
    if (!/^[a-z0-9_-]+$/.test(handle)) {
      this.createCustomBotError.set(
        'Handle can only contain lowercase letters, numbers, hyphens and underscores',
      );
      return;
    }
    if (!invokeUrl) {
      this.createCustomBotError.set('Invoke URL is required');
      return;
    }
    if (!this.isValidWebhookUrl(invokeUrl)) {
      this.createCustomBotError.set('Invoke URL must use HTTPS (or HTTP for localhost)');
      return;
    }

    this.isCreatingCustomBot.set(true);
    this.createCustomBotError.set(null);

    const data: CreateCustomBotInput = {
      name,
      handle,
      description: this.newBotDescription().trim() || undefined,
      invokeUrl,
      permissions: {
        messages: {
          read: this.newBotPermReadMessages(),
          write: this.newBotPermWriteMessages(),
        },
      },
      jwtExpirationHours: this.newBotJwtExpiration(),
    };

    this.botService.createCustomBot(data).subscribe({
      next: (bot) => {
        this.closeCreateCustomBotDialog();
        this.isCreatingCustomBot.set(false);

        // Show the provisioning token and webhook secret
        this.createdBotName.set(bot.displayName || bot.handle);
        this.createdBotToken.set(bot.provisioningToken || null);
        this.createdBotSecret.set(bot.webhookSecret || null);
        this.tokenCopied.set(false);
        this.secretCopied.set(false);
        this.showTokenDialog.set(true);
      },
      error: (err) => {
        this.createCustomBotError.set(err.message || 'Failed to create bot');
        this.isCreatingCustomBot.set(false);
      },
    });
  }

  // ============================================
  // Token Display Dialog
  // ============================================

  closeTokenDialog(): void {
    this.showTokenDialog.set(false);
    this.createdBotToken.set(null);
    this.createdBotSecret.set(null);
    this.createdBotName.set('');
    this.tokenCopied.set(false);
    this.secretCopied.set(false);
  }

  copyToken(): void {
    const token = this.createdBotToken();
    if (token) {
      navigator.clipboard.writeText(token);
      this.tokenCopied.set(true);
    }
  }

  copySecret(): void {
    const secret = this.createdBotSecret();
    if (secret) {
      navigator.clipboard.writeText(secret);
      this.secretCopied.set(true);
    }
  }

  // ============================================
  // Edit Custom Bot
  // ============================================

  editCustomBot(bot: CustomBot): void {
    this.editingCustomBot.set(bot);
    this.editCustomBotName.set(bot.displayName || '');
    this.editCustomBotDescription.set(bot.description || '');
    this.editCustomBotInvokeUrl.set(bot.invokeUrl);
    this.editCustomBotPermReadMessages.set(bot.permissions?.messages?.read ?? true);
    this.editCustomBotPermWriteMessages.set(bot.permissions?.messages?.write ?? true);
    this.editCustomBotJwtExpiration.set(bot.jwtExpirationHours || 12);
    this.editCustomBotError.set(null);
    this.showEditCustomBotDialog.set(true);
  }

  closeEditCustomBotDialog(): void {
    this.showEditCustomBotDialog.set(false);
    this.editingCustomBot.set(null);
    this.editCustomBotError.set(null);
  }

  saveCustomBot(): void {
    const bot = this.editingCustomBot();
    if (!bot) return;

    const invokeUrl = this.editCustomBotInvokeUrl().trim();
    if (!this.isValidWebhookUrl(invokeUrl)) {
      this.editCustomBotError.set('Invoke URL must use HTTPS (or HTTP for localhost)');
      return;
    }

    this.isUpdatingCustomBot.set(true);
    this.editCustomBotError.set(null);

    this.botService
      .updateCustomBot(bot._id, {
        name: this.editCustomBotName().trim() || undefined,
        description: this.editCustomBotDescription().trim() || undefined,
        invokeUrl,
        permissions: {
          messages: {
            read: this.editCustomBotPermReadMessages(),
            write: this.editCustomBotPermWriteMessages(),
          },
        },
        jwtExpirationHours: this.editCustomBotJwtExpiration(),
      })
      .subscribe({
        next: () => {
          this.closeEditCustomBotDialog();
          this.isUpdatingCustomBot.set(false);
        },
        error: (err) => {
          this.editCustomBotError.set(err.message || 'Failed to update bot');
          this.isUpdatingCustomBot.set(false);
        },
      });
  }

  // ============================================
  // Custom Bot Actions
  // ============================================

  toggleCustomBotStatus(bot: CustomBot): void {
    const newStatus = bot.status === 'active' ? 'disabled' : 'active';
    this.botService.updateCustomBotStatus(bot._id, newStatus).subscribe({
      error: (err) => {
        alert(err.message || 'Failed to update bot status');
      },
    });
  }

  deleteCustomBot(bot: CustomBot): void {
    if (!confirm(`Are you sure you want to delete @${bot.handle}? This action cannot be undone.`)) {
      return;
    }

    this.botService.deleteCustomBot(bot._id).subscribe({
      error: (err) => {
        alert(err.message || 'Failed to delete bot');
      },
    });
  }

  regenerateToken(bot: CustomBot): void {
    if (
      !confirm(
        'Are you sure you want to regenerate the provisioning token? The old token will be invalidated.',
      )
    ) {
      return;
    }

    this.botService.regenerateProvisioningToken(bot._id).subscribe({
      next: (token) => {
        this.regeneratedToken.set(token);
        this.regeneratedTokenCopied.set(false);
        this.showRegeneratedTokenDialog.set(true);
      },
      error: (err) => {
        alert(err.message || 'Failed to regenerate token');
      },
    });
  }

  closeRegeneratedTokenDialog(): void {
    this.showRegeneratedTokenDialog.set(false);
    this.regeneratedToken.set(null);
    this.regeneratedTokenCopied.set(false);
  }

  copyRegeneratedToken(): void {
    const token = this.regeneratedToken();
    if (token) {
      navigator.clipboard.writeText(token);
      this.regeneratedTokenCopied.set(true);
    }
  }

  regenerateSecret(bot: CustomBot): void {
    if (
      !confirm(
        'Are you sure you want to regenerate the webhook secret? Your bot will need to be updated with the new secret.',
      )
    ) {
      return;
    }

    this.botService.regenerateWebhookSecret(bot._id).subscribe({
      next: (secret) => {
        this.regeneratedSecret.set(secret);
        this.regeneratedSecretCopied.set(false);
        this.showRegeneratedSecretDialog.set(true);
      },
      error: (err) => {
        alert(err.message || 'Failed to regenerate webhook secret');
      },
    });
  }

  closeRegeneratedSecretDialog(): void {
    this.showRegeneratedSecretDialog.set(false);
    this.regeneratedSecret.set(null);
    this.regeneratedSecretCopied.set(false);
  }

  copyRegeneratedSecret(): void {
    const secret = this.regeneratedSecret();
    if (secret) {
      navigator.clipboard.writeText(secret);
      this.regeneratedSecretCopied.set(true);
    }
  }

  // ============================================
  // Sessions Management
  // ============================================

  viewSessions(bot: CustomBot): void {
    this.sessionsBot.set(bot);
    this.sessionsLoading.set(true);
    this.showSessionsDialog.set(true);

    this.botService.getCustomBotSessions(bot._id).subscribe({
      next: (sessions) => {
        this.botSessions.set(sessions);
        this.sessionsLoading.set(false);
      },
      error: () => {
        this.botSessions.set([]);
        this.sessionsLoading.set(false);
      },
    });
  }

  closeSessionsDialog(): void {
    this.showSessionsDialog.set(false);
    this.sessionsBot.set(null);
    this.botSessions.set([]);
  }

  revokeAllSessions(): void {
    const bot = this.sessionsBot();
    if (!bot) return;

    if (
      !confirm(
        'Are you sure you want to revoke all active sessions? The bot will need to re-authenticate.',
      )
    ) {
      return;
    }

    this.botService.revokeAllCustomBotSessions(bot._id).subscribe({
      next: () => {
        this.botSessions.set([]);
      },
      error: (err) => {
        alert(err.message || 'Failed to revoke sessions');
      },
    });
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString();
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'active':
        return 'status-active';
      case 'disabled':
        return 'status-disabled';
      case 'revoked':
        return 'status-revoked';
      default:
        return '';
    }
  }

  /**
   * Validate webhook URL - must be HTTPS, except HTTP is allowed for localhost
   */
  private isValidWebhookUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const isLocalhost =
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '::1';

      // Allow HTTP for localhost, require HTTPS otherwise
      if (isLocalhost) {
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      }
      return parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }
}
