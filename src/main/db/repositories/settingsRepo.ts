import {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  CONTRAST_DEFAULT,
  CONTRAST_MAX,
  CONTRAST_MIN,
  DEFAULT_BORDER_RADIUS,
  DEFAULT_SETTINGS_APPEARANCE,
  UI_FONT_SIZE_DEFAULT,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
  isReduceMotionMode,
  normalizeThemeColor,
} from '../../../shared/contracts';
import type { ReasoningEffort, ToolPermissionMode } from '../../../shared/chatParameters';
import type { VisualMode } from '../../../shared/visualIntent';
import { DEFAULT_VISUAL_MODE, isVisualMode } from '../../../shared/visualIntent';
import type { WorkspaceMode } from '../../../shared/workspaceModes';
import { DEFAULT_WORKSPACE_MODE, isWorkspaceMode } from '../../../shared/workspaceModes';
import {
  DEFAULT_REASONING_EFFORT,
  DEFAULT_TOOL_PERMISSION_MODE,
  isReasoningEffort,
  isToolPermissionMode
} from '../../../shared/chatParameters';
import type { BorderRadiusMode, CredentialStatus, DesignTheme, FontFamilyOverride, ProviderCredentialSummary, ProviderId, ReduceMotionMode, ThemeColorOverride, ThemeMode } from '../../../shared/contracts';
import { isDesignTheme } from '../../../shared/contracts';
import type { KeybindingRule } from '../../../shared/keybindings';
import { decodeKeybindingRules, parseKeybindingRules } from '../../../shared/keybindings';
import type { SqliteDatabase } from '../client';

type ProviderCredentialRow = {
  provider_id: ProviderId;
  has_secret: number;
  status: CredentialStatus;
  validated_at: string | null;
};

export class SettingsRepo {
  constructor(private readonly db: SqliteDatabase) {}

  private clampNumber(value: unknown, min: number, max: number, fallback: number) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(value)));
  }

  private normalizeFontFamily(value: unknown): FontFamilyOverride {
    if (typeof value !== 'string') {
      return null;
    }

    const sanitized = value.replace(/[;\n\r{}]/g, ' ').trim().replace(/\s+/g, ' ');
    return sanitized.length > 0 ? sanitized : null;
  }

  private getJsonSetting<T>(key: string, fallback: T) {
    const row = this.db
      .prepare<{ key: string }, { value: string }>('SELECT value FROM app_settings WHERE key = @key')
      .get({ key });

    if (!row) {
      return fallback;
    }

    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  private setJsonSetting<T>(key: string, value: T) {
    this.db
      .prepare(
        `
          INSERT INTO app_settings (key, value)
          VALUES (@key, @value)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `
      )
      .run({
        key,
        value: JSON.stringify(value)
      });
  }

  /**
   * Plugin names the user switched off.
   *
   * Stored as the disabled set rather than the enabled one so a newly installed
   * plugin is on by default: a user who just chose to install something has
   * already said yes, and making them say it twice is friction with no safety
   * value.
   */
  getDisabledPlugins(): string[] {
    const value = this.getJsonSetting<unknown>('plugins.disabled', []);
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  }

  setPluginEnabled(name: string, enabled: boolean) {
    const disabled = new Set(this.getDisabledPlugins());

    if (enabled) {
      disabled.delete(name);
    } else {
      disabled.add(name);
    }

    this.setJsonSetting('plugins.disabled', [...disabled]);
  }

  /**
   * Marketplaces the user has added.
   *
   * Stored as opaque records rather than parsed here: the registry owns what a
   * source means, and this repository's job is only to survive a restart.
   */
  getMarketplaces<T>(): T[] {
    const value = this.getJsonSetting<unknown>('plugins.marketplaces', []);
    return Array.isArray(value) ? (value as T[]) : [];
  }

  setMarketplaces<T>(records: T[]) {
    this.setJsonSetting('plugins.marketplaces', records);
  }

  /**
   * Which plugins each conversation has activated.
   *
   * Persisted rather than held in memory: a user who loaded a skill, got its
   * tools, and restarted Atlas should not find them gone.
   */
  getPluginActivations<T>(): Record<string, T> {
    const value = this.getJsonSetting<unknown>('plugins.activations', {});
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, T>)
      : {};
  }

  setPluginActivations<T>(value: Record<string, T>) {
    this.setJsonSetting('plugins.activations', value);
  }

  /** Plugins whose tools should be available without loading a skill first. */
  getAlwaysOnPlugins(): string[] {
    const value = this.getJsonSetting<unknown>('plugins.alwaysOn', []);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  }

  setPluginAlwaysOn(name: string, alwaysOn: boolean) {
    const current = new Set(this.getAlwaysOnPlugins());

    if (alwaysOn) {
      current.add(name);
    } else {
      current.delete(name);
    }

    this.setJsonSetting('plugins.alwaysOn', [...current]);
  }

  getShowFreeOnlyByDefault() {
    return Boolean(this.getJsonSetting('showFreeOnlyByDefault', true));
  }

  setShowFreeOnlyByDefault(value: boolean) {
    this.setJsonSetting('showFreeOnlyByDefault', value);
  }

  /**
   * The model the user last picked, so a new conversation opens on it instead of
   * on whatever the catalog happens to sort first. Stored as an id only — it is
   * validated against the live catalog on read, since a model can disappear when
   * its provider is removed or disabled.
   */
  getLastModelId(): string | null {
    const value = this.getJsonSetting<string | null>('chat.lastModelId', null);
    return typeof value === 'string' && value.trim() ? value : null;
  }

  setLastModelId(value: string) {
    this.setJsonSetting('chat.lastModelId', value);
  }

  /**
   * When the assistant may answer with an inline visual.
   *
   * `auto` — the default — attaches the visual instructions only to turns that
   * asked for something drawn; see `resolveVisualGate`.
   */
  getVisualMode(): VisualMode {
    const value = this.getJsonSetting<unknown>('chat.visualMode', DEFAULT_VISUAL_MODE);
    return isVisualMode(value) ? value : DEFAULT_VISUAL_MODE;
  }

  setVisualMode(value: VisualMode) {
    this.setJsonSetting('chat.visualMode', value);
  }

  getReasoningEffort(): ReasoningEffort {
    const value = this.getJsonSetting<ReasoningEffort>('chat.reasoningEffort', DEFAULT_REASONING_EFFORT);
    return isReasoningEffort(value) ? value : DEFAULT_REASONING_EFFORT;
  }

  setReasoningEffort(value: ReasoningEffort) {
    this.setJsonSetting('chat.reasoningEffort', value);
  }

  getToolPermissionMode(): ToolPermissionMode {
    const value = this.getJsonSetting<ToolPermissionMode>(
      'chat.toolPermissionMode',
      DEFAULT_TOOL_PERMISSION_MODE
    );
    return isToolPermissionMode(value) ? value : DEFAULT_TOOL_PERMISSION_MODE;
  }

  setToolPermissionMode(value: ToolPermissionMode) {
    this.setJsonSetting('chat.toolPermissionMode', value);
  }

  /** Mode new conversations start in; each conversation then owns its own. */
  getWorkspaceMode(): WorkspaceMode {
    const value = this.getJsonSetting<WorkspaceMode>('chat.workspaceMode', DEFAULT_WORKSPACE_MODE);
    return isWorkspaceMode(value) ? value : DEFAULT_WORKSPACE_MODE;
  }

  setWorkspaceMode(value: WorkspaceMode) {
    this.setJsonSetting('chat.workspaceMode', value);
  }

  /**
   * Project new conversations attach to. Stored as an id, so a project the user
   * deleted resolves to nothing rather than to a stale path.
   */
  getLastProjectId(): string | null {
    const value = this.getJsonSetting<string | null>('chat.lastProjectId', null);
    return typeof value === 'string' && value.trim() ? value : null;
  }

  setLastProjectId(value: string | null) {
    this.setJsonSetting('chat.lastProjectId', value);
  }

  /**
   * The editor "Open in …" uses. Stored as a catalog id, so an editor the user
   * has since uninstalled falls back to whatever is installed rather than to a
   * path that no longer launches.
   */
  getPreferredIdeId(): string | null {
    const value = this.getJsonSetting<string | null>('workspace.preferredIde', null);
    return typeof value === 'string' && value.trim() ? value : null;
  }

  setPreferredIdeId(value: string | null) {
    this.setJsonSetting('workspace.preferredIde', value);
  }

  getThemeMode(): ThemeMode {
    const value = this.getJsonSetting<ThemeMode>('themeMode', DEFAULT_SETTINGS_APPEARANCE.themeMode);
    return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_SETTINGS_APPEARANCE.themeMode;
  }

  setThemeMode(value: ThemeMode) {
    this.setJsonSetting('themeMode', value);
  }

  getDesignTheme(): DesignTheme {
    const value = this.getJsonSetting<DesignTheme>('designTheme', DEFAULT_SETTINGS_APPEARANCE.designTheme);
    return isDesignTheme(value) ? value : DEFAULT_SETTINGS_APPEARANCE.designTheme;
  }

  setDesignTheme(value: DesignTheme) {
    this.setJsonSetting('designTheme', value);
  }

  getUiFontSize() {
    return this.clampNumber(
      this.getJsonSetting<number>('uiFontSize', UI_FONT_SIZE_DEFAULT),
      UI_FONT_SIZE_MIN,
      UI_FONT_SIZE_MAX,
      UI_FONT_SIZE_DEFAULT
    );
  }

  setUiFontSize(value: number) {
    this.setJsonSetting('uiFontSize', this.clampNumber(value, UI_FONT_SIZE_MIN, UI_FONT_SIZE_MAX, UI_FONT_SIZE_DEFAULT));
  }

  getCodeFontSize() {
    return this.clampNumber(
      this.getJsonSetting<number>('codeFontSize', CODE_FONT_SIZE_DEFAULT),
      CODE_FONT_SIZE_MIN,
      CODE_FONT_SIZE_MAX,
      CODE_FONT_SIZE_DEFAULT
    );
  }

  setCodeFontSize(value: number) {
    this.setJsonSetting(
      'codeFontSize',
      this.clampNumber(value, CODE_FONT_SIZE_MIN, CODE_FONT_SIZE_MAX, CODE_FONT_SIZE_DEFAULT)
    );
  }

  getUiFontFamily(): FontFamilyOverride {
    return this.normalizeFontFamily(this.getJsonSetting<FontFamilyOverride>('uiFontFamily', DEFAULT_SETTINGS_APPEARANCE.uiFontFamily));
  }

  setUiFontFamily(value: FontFamilyOverride) {
    this.setJsonSetting('uiFontFamily', this.normalizeFontFamily(value));
  }

  getCodeFontFamily(): FontFamilyOverride {
    return this.normalizeFontFamily(
      this.getJsonSetting<FontFamilyOverride>('codeFontFamily', DEFAULT_SETTINGS_APPEARANCE.codeFontFamily)
    );
  }

  setCodeFontFamily(value: FontFamilyOverride) {
    this.setJsonSetting('codeFontFamily', this.normalizeFontFamily(value));
  }

  getBorderRadius(): BorderRadiusMode {
    const value = this.getJsonSetting<string>('appearance.borderRadius', DEFAULT_BORDER_RADIUS);
    return value === 'theme-default' || value === 'none' ? value : DEFAULT_BORDER_RADIUS;
  }

  setBorderRadius(value: BorderRadiusMode) {
    this.setJsonSetting('appearance.borderRadius', value);
  }

  getThemeColor(key: 'accentColor' | 'backgroundColor' | 'foregroundColor'): ThemeColorOverride {
    return normalizeThemeColor(this.getJsonSetting<unknown>(`appearance.${key}`, null));
  }

  setThemeColor(key: 'accentColor' | 'backgroundColor' | 'foregroundColor', value: ThemeColorOverride) {
    this.setJsonSetting(`appearance.${key}`, normalizeThemeColor(value));
  }

  getContrast() {
    return this.clampNumber(
      this.getJsonSetting<number>('appearance.contrast', CONTRAST_DEFAULT),
      CONTRAST_MIN,
      CONTRAST_MAX,
      CONTRAST_DEFAULT
    );
  }

  setContrast(value: number) {
    this.setJsonSetting('appearance.contrast', this.clampNumber(value, CONTRAST_MIN, CONTRAST_MAX, CONTRAST_DEFAULT));
  }

  getTranslucentSidebar() {
    return Boolean(this.getJsonSetting('appearance.translucentSidebar', DEFAULT_SETTINGS_APPEARANCE.translucentSidebar));
  }

  setTranslucentSidebar(value: boolean) {
    this.setJsonSetting('appearance.translucentSidebar', value);
  }

  getReduceMotion(): ReduceMotionMode {
    const value = this.getJsonSetting<unknown>('appearance.reduceMotion', DEFAULT_SETTINGS_APPEARANCE.reduceMotion);
    return isReduceMotionMode(value) ? value : DEFAULT_SETTINGS_APPEARANCE.reduceMotion;
  }

  setReduceMotion(value: ReduceMotionMode) {
    this.setJsonSetting('appearance.reduceMotion', isReduceMotionMode(value) ? value : DEFAULT_SETTINGS_APPEARANCE.reduceMotion);
  }

  getPointerCursors() {
    return Boolean(this.getJsonSetting('appearance.pointerCursors', DEFAULT_SETTINGS_APPEARANCE.pointerCursors));
  }

  setPointerCursors(value: boolean) {
    this.setJsonSetting('appearance.pointerCursors', value);
  }

  getRawTranscript() {
    return Boolean(this.getJsonSetting('appearance.rawTranscript', DEFAULT_SETTINGS_APPEARANCE.rawTranscript));
  }

  setRawTranscript(value: boolean) {
    this.setJsonSetting('appearance.rawTranscript', value);
  }

  getKeybindings(): KeybindingRule[] {
    return decodeKeybindingRules(this.getJsonSetting<unknown>('keybindings', null));
  }

  setKeybindings(value: KeybindingRule[]) {
    this.setJsonSetting('keybindings', parseKeybindingRules(value));
  }

  syncSecretPresence(providerId: ProviderId, hasSecret: boolean) {
    const status: CredentialStatus = hasSecret ? 'unknown' : 'missing';

    this.db
      .prepare(
        `
          INSERT INTO provider_credentials (provider_id, has_secret, status, validated_at)
          VALUES (@providerId, @hasSecret, @status, NULL)
          ON CONFLICT(provider_id) DO UPDATE SET
            has_secret = excluded.has_secret,
            status = CASE
              WHEN excluded.has_secret = 0 THEN 'missing'
              ELSE provider_credentials.status
            END,
            validated_at = CASE
              WHEN excluded.has_secret = 0 THEN NULL
              ELSE provider_credentials.validated_at
            END
        `
      )
      .run({
        providerId,
        hasSecret: hasSecret ? 1 : 0,
        status
      });
  }

  updateCredentialStatus(
    providerId: ProviderId,
    patch: {
      hasSecret?: boolean;
      status?: CredentialStatus;
      validatedAt?: string | null;
    }
  ) {
    const current = this.getCredential(providerId);
    const hasSecret = patch.hasSecret ?? current.hasSecret;
    const status = patch.status ?? current.status;
    const validatedAt = patch.validatedAt ?? current.validatedAt;

    this.db
      .prepare(
        `
          INSERT INTO provider_credentials (provider_id, has_secret, status, validated_at)
          VALUES (@providerId, @hasSecret, @status, @validatedAt)
          ON CONFLICT(provider_id) DO UPDATE SET
            has_secret = excluded.has_secret,
            status = excluded.status,
            validated_at = excluded.validated_at
        `
      )
      .run({
        providerId,
        hasSecret: hasSecret ? 1 : 0,
        status,
        validatedAt
      });
  }

  getCredential(providerId: ProviderId): ProviderCredentialSummary {
    const row = this.db
      .prepare<{ providerId: ProviderId }, ProviderCredentialRow>(
        `
          SELECT provider_id, has_secret, status, validated_at
          FROM provider_credentials
          WHERE provider_id = @providerId
        `
      )
      .get({ providerId });

    if (!row) {
      return {
        providerId,
        hasSecret: false,
        status: 'missing',
        validatedAt: null
      };
    }

    return {
      providerId: row.provider_id,
      hasSecret: Boolean(row.has_secret),
      status: row.status,
      validatedAt: row.validated_at
    };
  }

  /**
   * There are no built-in providers, so the credential list is exactly the set
   * of providers the user configured.
   */
  getProviderCredentials(providerIds: ProviderId[] = []) {
    return providerIds.map((providerId) => this.getCredential(providerId));
  }

  deleteCredential(providerId: ProviderId) {
    this.db.prepare('DELETE FROM provider_credentials WHERE provider_id = @providerId').run({ providerId });
  }
}
