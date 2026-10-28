import { Subscription } from 'rxjs';
import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  BotService,
  type EnrichedUserBot,
  type CustomBot,
  type CustomBotWithToken,
} from '../../services/bot.service';
import { Clipboard } from '@angular/cdk/clipboard';
import { ProfileAvatarComponent } from '../../components/atoms/profile-avatar/profile-avatar.component';
import { SettingsHeaderComponent, DialogService } from '../../components';
import { BotAutonomyComponent } from '../../components/organisms/bot-autonomy/bot-autonomy.component';
import { ActionLogComponent } from '../../components/organisms/action-log/action-log.component';
import {
  type BotModelOption,
  type BotTemplate,
  type CreateCustomBotInput,
  type UpdateUserBotInput,
} from '@maple/shared';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-bots',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ProfileAvatarComponent,
    SettingsHeaderComponent,
    BotAutonomyComponent,
    ActionLogComponent,
  ],
  templateUrl: './bots.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './bots.component.scss',
})
export class BotsComponent implements OnInit, OnDestroy {
  private readonly clipboard = inject(Clipboard);
  private readonly router = inject(Router);
  private readonly botService = inject(BotService);
  private readonly dialogService = inject(DialogService);

  // Bot templates
  readonly templates = this.botService.templates;
  readonly templatesLoading = this.botService.templatesLoading;

  // User bots (template-based)
  readonly userBots = this.botService.userBots;
  readonly userBotsLoading = this.botService.userBotsLoading;

  // Custom bots (webhook-based)
  readonly customBots = this.botService.customBots;
  readonly customBotsLoading = this.botService.customBotsLoading;

  // Unified bot list
  readonly allBots = computed(() => {
    const templateBots = this.userBots().map((bot) => ({
      ...bot,
      botType: 'template' as const,
    }));
    const custom = this.customBots().map((bot) => ({
      ...bot,
      botType: 'custom' as const,
    }));
    return [...templateBots, ...custom];
  });
  readonly botsLoading = computed(() => this.userBotsLoading() || this.customBotsLoading());

  // Register bot dialog (template bots)
  readonly showRegisterDialog = signal(false);
  readonly selectedTemplate = signal<BotTemplate | null>(null);
  readonly customHandle = signal('');
  readonly displayName = signal('');
  readonly baseUrl = signal('');
  readonly apiKey = signal('');
  readonly model = signal('');
  readonly responseMode = signal<'auto' | 'text'>('auto');
  readonly editModel = signal('');
  readonly editResponseMode = signal<'auto' | 'text'>('auto');
  /** Web search is off by default; the owner turns it on per bot. */
  readonly editWebSearch = signal(false);
  readonly editWebSearchProactive = signal(false);
  readonly webSearchAvailable = this.botService.webSearchAvailable;

  readonly registerModels = signal<BotModelOption[]>([]);
  readonly editModels = signal<BotModelOption[]>([]);
  readonly registerModelsLoading = signal(false);
  readonly editModelsLoading = signal(false);
  readonly registerModelsError = signal<string | null>(null);
  readonly editModelsError = signal<string | null>(null);
  private registerModelsRequest?: Subscription;
  private editModelsRequest?: Subscription;

  /** The template for any OpenAI-compatible server; added from the AI Providers "New" button. */
  readonly customProviderTemplate = computed(() =>
    this.templates().find((t) => this.providerOf(t._id) === 'openai-compatible'),
  );
  /** Every other template, shown as cards. */
  readonly providerTemplates = computed(() =>
    this.templates().filter((t) => t._id !== this.customProviderTemplate()?._id),
  );

  private providerOf(templateId?: string): string | null {
    const action = this.templates()
      .find((t) => t._id === templateId)
      ?.definition.actions.find((a) => a.type === 'llm');
    return action ? String(action.config['provider'] || 'anthropic') : null;
  }
  supportsModelSelection(templateId?: string): boolean {
    return ['anthropic', 'openai', 'openai-compatible'].includes(this.providerOf(templateId) ?? '');
  }
  /** AI bots that call tools can search the web (not Inception, which has no tools). */
  supportsWebSearch(templateId?: string): boolean {
    return this.supportsModelSelection(templateId);
  }
  /** Custom-server bots take a server URL and a typed model name. */
  usesCustomServer(templateId?: string): boolean {
    return this.providerOf(templateId) === 'openai-compatible';
  }
  /** AI bots can be added again with another handle, key or model. */
  canAddAgain(template: BotTemplate): boolean {
    return this.providerOf(template._id) !== null;
  }
  ngOnDestroy(): void {
    this.registerModelsRequest?.unsubscribe();
    this.editModelsRequest?.unsubscribe();
  }
  /** Plain http sends the API key unencrypted; the dialog warns about it. */
  isInsecureUrl(url: string): boolean {
    return url.trim().toLowerCase().startsWith('http://');
  }
  changeBaseUrl(mode: 'register' | 'edit', value: string): void {
    (mode === 'edit' ? this.editBaseUrl : this.baseUrl).set(value);
    this.resetModels(mode);
  }
  changeApiKey(mode: 'register' | 'edit', value: string): void {
    (mode === 'edit' ? this.editApiKey : this.apiKey).set(value);
    this.resetModels(mode);
  }
  private resetModels(mode: 'register' | 'edit'): void {
    (mode === 'edit' ? this.editModelsRequest : this.registerModelsRequest)?.unsubscribe();
    (mode === 'edit' ? this.editModels : this.registerModels).set([]);
    (mode === 'edit' ? this.editModelsLoading : this.registerModelsLoading).set(false);
    (mode === 'edit' ? this.editModelsError : this.registerModelsError).set(null);
  }
  loadRegisterModels(): void {
    this.loadModels('register');
  }
  loadEditModels(): void {
    this.loadModels('edit');
  }
  private loadModels(mode: 'register' | 'edit'): void {
    const editing = mode === 'edit';
    const bot = this.editingBot();
    const templateId = editing ? bot?.templateId : this.selectedTemplate()?._id;
    if (!this.supportsModelSelection(templateId)) return;
    const baseUrl = (editing ? this.editBaseUrl() : this.baseUrl()).trim();
    if (this.usesCustomServer(templateId) && !baseUrl) return;
    const options = editing ? this.editModels : this.registerModels;
    const loading = editing ? this.editModelsLoading : this.registerModelsLoading;
    const error = editing ? this.editModelsError : this.registerModelsError;
    (editing ? this.editModelsRequest : this.registerModelsRequest)?.unsubscribe();
    loading.set(true);
    error.set(null);
    const request = this.botService
      .loadModels({
        ...(editing ? { userBotId: bot!._id } : { templateId }),
        apiKey: (editing ? this.editApiKey() : this.apiKey()).trim() || undefined,
        // Only send a changed URL; the server uses the saved one otherwise.
        ...(this.usesCustomServer(templateId) &&
        (!editing || baseUrl !== (bot?.config?.baseUrl ?? ''))
          ? { baseUrl }
          : {}),
      })
      .subscribe({
        next: (models) => {
          options.set(models);
          loading.set(false);
          if (
            !editing &&
            !this.usesCustomServer(templateId) &&
            !models.some((option) => option.id === this.model())
          )
            this.model.set('');
          if (!models.length)
            error.set('No compatible reply models were returned for this account.');
        },
        error: (err) => {
          loading.set(false);
          error.set(err.message);
        },
      });
    if (editing) this.editModelsRequest = request;
    else this.registerModelsRequest = request;
  }
  hasModel(options: BotModelOption[], id: string): boolean {
    return options.some((option) => option.id === id);
  }
  readonly registerError = signal<string | null>(null);
  readonly isRegistering = signal(false);

  // Edit bot dialog (template bots)
  readonly showEditDialog = signal(false);
  readonly editingBot = signal<EnrichedUserBot | null>(null);
  readonly editApiKey = signal('');
  readonly editDisplayName = signal('');
  readonly editBaseUrl = signal('');
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
  readonly newBotPermReadMemos = signal(false);
  readonly newBotPermWriteMemos = signal(false);
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
  readonly editCustomBotPermReadMemos = signal(false);
  readonly editCustomBotPermWriteMemos = signal(false);
  readonly editCustomBotJwtExpiration = signal(12);
  readonly editCustomBotError = signal<string | null>(null);
  readonly isUpdatingCustomBot = signal(false);

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
    this.model.set(
      String(template.definition.actions.find((a) => a.type === 'llm')?.config['model'] || ''),
    );
    this.responseMode.set('auto');
    this.customHandle.set(
      this.freeHandle(this.usesCustomServer(template._id) ? 'ai' : template.handle),
    );
    this.displayName.set('');
    this.baseUrl.set('');
    this.apiKey.set('');

    this.registerError.set(null);
    this.registerModels.set([]);
    this.registerModelsError.set(null);
    this.showRegisterDialog.set(true);
  }

  /** Opens the dialog for a new OpenAI-compatible provider. */
  newProvider(): void {
    const template = this.customProviderTemplate();
    if (template) this.selectTemplate(template);
  }

  /** "claude", then "claude2", "claude3"… so the same template can be added again. */
  private freeHandle(base: string): string {
    const taken = new Set(this.allBots().map((bot) => bot.handle.toLowerCase()));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
  }

  closeRegisterDialog(): void {
    this.registerModelsRequest?.unsubscribe();
    this.registerModelsLoading.set(false);
    this.showRegisterDialog.set(false);
    this.selectedTemplate.set(null);
    this.customHandle.set('');
    this.apiKey.set('');

    this.registerError.set(null);
  }

  registerBot(): void {
    const template = this.selectedTemplate();
    if (!template) return;

    // Custom servers can be open endpoints, so their key is optional.
    if (template.requiresConfig && !this.apiKey().trim() && !this.usesCustomServer(template._id)) {
      this.registerError.set('API key is required for this bot');
      return;
    }

    if (this.usesCustomServer(template._id) && !this.baseUrl().trim()) {
      this.registerError.set('Enter the server URL');
      return;
    }
    if (this.supportsModelSelection(template._id) && !this.model().trim()) {
      this.registerError.set('Select a model for this bot');
      return;
    }
    this.isRegistering.set(true);
    this.registerError.set(null);

    this.botService
      .registerBot({
        templateId: template._id,
        handle: this.customHandle().trim() || undefined,
        displayName: this.displayName().trim() || undefined,
        config: template.requiresConfig
          ? {
              apiKey: this.apiKey().trim(),
              ...(this.usesCustomServer(template._id) ? { baseUrl: this.baseUrl().trim() } : {}),
              model: this.model().trim() || undefined,
              responseMode: this.responseMode(),
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
    this.editModel.set(
      bot.config?.model ||
        String(
          this.templates()
            .find((t) => t._id === bot.templateId)
            ?.definition.actions.find((a) => a.type === 'llm')?.config['model'] || '',
        ),
    );
    this.editResponseMode.set(bot.config?.responseMode || 'auto');
    this.editWebSearch.set(bot.config?.webSearch === true);
    this.editWebSearchProactive.set(bot.config?.webSearchProactive === true);
    this.editApiKey.set('');
    this.editDisplayName.set(bot.displayName ?? '');
    this.editBaseUrl.set(bot.config?.baseUrl ?? '');
    this.editEnabled.set(bot.isEnabled);
    this.editError.set(null);
    this.editModels.set([]);
    this.editModelsError.set(null);
    this.showEditDialog.set(true);
    this.loadEditModels();
  }

  closeEditDialog(): void {
    this.editModelsRequest?.unsubscribe();
    this.editModelsLoading.set(false);
    this.showEditDialog.set(false);
    this.editingBot.set(null);
    this.editApiKey.set('');
    this.editError.set(null);
  }

  saveBot(): void {
    const bot = this.editingBot();
    if (!bot) return;

    this.isUpdating.set(true);
    this.editError.set(null);

    const updateData: UpdateUserBotInput = {
      isEnabled: this.editEnabled(),
      displayName: this.editDisplayName().trim() || undefined,
    };

    updateData.config = {
      model: this.editModel().trim() || undefined,
      responseMode: this.editResponseMode(),
      ...(this.webSearchAvailable() && this.supportsWebSearch(bot.templateId)
        ? {
            webSearch: this.editWebSearch(),
            webSearchProactive: this.editWebSearch() && this.editWebSearchProactive(),
          }
        : {}),
      ...(this.editApiKey().trim() ? { apiKey: this.editApiKey().trim() } : {}),
      ...(this.usesCustomServer(bot.templateId) ? { baseUrl: this.editBaseUrl().trim() } : {}),
    };

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

  async deleteBot(bot: EnrichedUserBot): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Delete Bot',
      message: `Are you sure you want to delete @${bot.handle}?`,
      confirmLabel: 'Delete',
    });
    if (!confirmed) {
      return;
    }

    this.botService.deleteBot(bot._id).subscribe({
      error: (err) => {
        this.dialogService.alert({
          title: 'Error',
          message: err.message || 'Failed to delete bot',
        });
      },
    });
  }

  toggleBotEnabled(bot: EnrichedUserBot): void {
    this.botService.updateBot(bot._id, { isEnabled: !bot.isEnabled }).subscribe({
      error: (err) => {
        this.dialogService.alert({
          title: 'Error',
          message: err.message || 'Failed to update bot',
        });
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
      this.createCustomBotError.set(
        environment.production
          ? 'Invoke URL must use HTTPS'
          : 'Invoke URL must use HTTPS (or HTTP for localhost)',
      );
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
        memos: {
          read: this.newBotPermReadMemos(),
          write: this.newBotPermWriteMemos(),
        },
      },
      jwtExpirationHours: this.newBotJwtExpiration(),
    };

    this.botService.createCustomBot(data).subscribe({
      next: (bot) => {
        this.closeCreateCustomBotDialog();
        this.isCreatingCustomBot.set(false);

        // Show the bot token and webhook secret
        this.createdBotName.set(bot.displayName || bot.handle);
        this.createdBotToken.set(bot.botToken || null);
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
      this.clipboard.copy(token);
      this.tokenCopied.set(true);
    }
  }

  copySecret(): void {
    const secret = this.createdBotSecret();
    if (secret) {
      this.clipboard.copy(secret);
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
    this.editCustomBotPermReadMemos.set(bot.permissions?.memos?.read ?? false);
    this.editCustomBotPermWriteMemos.set(bot.permissions?.memos?.write ?? false);
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
      this.editCustomBotError.set(
        environment.production
          ? 'Invoke URL must use HTTPS'
          : 'Invoke URL must use HTTPS (or HTTP for localhost)',
      );
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
          memos: {
            read: this.editCustomBotPermReadMemos(),
            write: this.editCustomBotPermWriteMemos(),
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
        this.dialogService.alert({
          title: 'Error',
          message: err.message || 'Failed to update bot status',
        });
      },
    });
  }

  async deleteCustomBot(bot: CustomBot): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Delete Bot',
      message: `Are you sure you want to delete @${bot.handle}? This action cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!confirmed) {
      return;
    }

    this.botService.deleteCustomBot(bot._id).subscribe({
      error: (err) => {
        this.dialogService.alert({
          title: 'Error',
          message: err.message || 'Failed to delete bot',
        });
      },
    });
  }

  async regenerateToken(bot: CustomBot): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Regenerate Token',
      message:
        'Are you sure you want to regenerate the bot token? The old token will be invalidated.',
      confirmLabel: 'Regenerate',
    });
    if (!confirmed) {
      return;
    }

    this.botService.regenerateBotToken(bot._id).subscribe({
      next: (token) => {
        this.regeneratedToken.set(token);
        this.regeneratedTokenCopied.set(false);
        this.showRegeneratedTokenDialog.set(true);
      },
      error: (err) => {
        this.dialogService.alert({
          title: 'Error',
          message: err.message || 'Failed to regenerate token',
        });
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
      this.clipboard.copy(token);
      this.regeneratedTokenCopied.set(true);
    }
  }

  async regenerateSecret(bot: CustomBot): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Regenerate Webhook Secret',
      message:
        'Are you sure you want to regenerate the webhook secret? Your bot will need to be updated with the new secret.',
      confirmLabel: 'Regenerate',
    });
    if (!confirmed) {
      return;
    }

    this.botService.regenerateWebhookSecret(bot._id).subscribe({
      next: (secret) => {
        this.regeneratedSecret.set(secret);
        this.regeneratedSecretCopied.set(false);
        this.showRegeneratedSecretDialog.set(true);
      },
      error: (err) => {
        this.dialogService.alert({
          title: 'Error',
          message: err.message || 'Failed to regenerate webhook secret',
        });
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
      this.clipboard.copy(secret);
      this.regeneratedSecretCopied.set(true);
    }
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
   * Validate webhook URL - must be HTTPS, except HTTP is allowed for localhost in dev
   */
  private isValidWebhookUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const isLocalhost =
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '::1';

      // Only allow localhost in development
      if (isLocalhost) {
        return !environment.production;
      }
      return parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }
}
