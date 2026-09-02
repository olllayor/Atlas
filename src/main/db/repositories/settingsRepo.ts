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
import {
  COMPACTION_THRESHOLD_DEFAULT,
  normalizeCompactionThresholdPercent,
  clampCompactionThresholdPercent,
} from '../../../shared/contextCompaction';
import type { ReasoningEffort, ToolPermissionMode } from '../../../shared/chatParameters';
import type { VisualMode } from '../../../shared/visualIntent';
import { DEFAULT_VISUAL_MODE, isVisualMode } from '../../../shared/visualIntent';
import type { ExecutionTarget, WorkspaceMode } from '../../../shared/workspaceModes';
import { DEFAULT_EXECUTION_TARGET, DEFAULT_WORKSPACE_MODE, isExecutionTarget, isWorkspaceMode } from '../../../shared/workspaceModes';
import type { OpenCodeSettings, ParseOpenCodeSettingsResult } from '../../../shared/opencodeSettings.js';
import { parseOpenCodeSettings } from '../../../shared/opencodeSettings.js';
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
import { CloudSandboxSecretStore } from '../../secrets/cloudSandboxSecretStore';

type ProviderCredentialRow = {
  provider_id: ProviderId;
  has_secret: number;
  status: CredentialStatus;
  validated_at: string | null;
};

type CloudSandboxSecretStoreLike = {
  read(): Promise<string | null>;
  write(value: string | null): Promise<void>;
};

export type SettingsRepoOptions = {
  cloudSandboxSecretStore?: CloudSandboxSecretStoreLike;
};

export class SettingsRepo {
  /**
   * In-memory snapshot of the Cloud Sandbox bearer token. Keychain is the
   * source of truth; this cache exists so the synchronous turn-setup path
   * (`resolveConversationWorkspace`) can read it without an await. Refreshed
   * on every write and primed at startup.
   */
  private cloudSandboxSecretCache: string | null = null;
  private readonly cloudSandboxSecretStore: CloudSandboxSecretStoreLike;

  constructor(
    private readonly db: SqliteDatabase,
    options: SettingsRepoOptions = {}
  ) {
    // Injected in tests; production wiring passes nothing and gets the keytar-backed store.
    this.cloudSandboxSecretStore = options.cloudSandboxSecretStore ?? CloudSandboxSecretStore;
  }

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

  /**
   * Where each installed plugin came from.
   *
   * Stored beside the plugins rather than inside them: a bundle must not be
   * able to describe its own provenance, and this is what the update check
   * re-fetches from and what a scoped revocation is matched against.
   */
  getPluginOrigins<T>(): Record<string, T> {
    const value = this.getJsonSetting<unknown>('plugins.origins', {});
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, T>)
      : {};
  }

  setPluginOrigins<T>(value: Record<string, T>) {
    this.setJsonSetting('plugins.origins', value);
  }

  /**
   * The last revocations Atlas read from its marketplaces.
   *
   * Cached rather than fetched on demand for two reasons: the plugin scan runs
   * on the turn-setup path and must never reach the network, and a revocation
   * has to survive being offline. A blocklist that only applies when a remote
   * is reachable is one an attacker can defeat by unplugging a cable.
   */
  getPluginBlocklist<T>(fallback: T): T {
    return this.getJsonSetting<T>('plugins.blocklist', fallback);
  }

  setPluginBlocklist<T>(value: T) {
    this.setJsonSetting('plugins.blocklist', value);
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
   * Whether the plugin system is switched on at all.
   *
   * A beta feature, and default-off: the flag is read live by every plugin
   * entry point — the MCP server source, the skills service, the IPC surface —
   * so turning it off is the feature forgetting itself exists: no scans, no
   * servers, no prompt sections, no UI. Turning it on needs no restart either;
   * the next read finds an empty plugins directory exactly as fresh as one
   * that was never populated.
   */
  getPluginsBetaEnabled(): boolean {
    return Boolean(this.getJsonSetting('plugins.betaEnabled', false));
  }

  setPluginsBetaEnabled(value: boolean) {
    this.setJsonSetting('plugins.betaEnabled', value);
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

  getCompactionThresholdPercent(): number {
    const value = this.getJsonSetting<unknown>('chat.compactionThresholdPercent', COMPACTION_THRESHOLD_DEFAULT);
    return normalizeCompactionThresholdPercent(value);
  }

  setCompactionThresholdPercent(value: number) {
    const normalized = clampCompactionThresholdPercent(value);
    this.setJsonSetting('chat.compactionThresholdPercent', normalized);
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

  /** Execution target new conversations start in. */
  getExecutionTarget(): ExecutionTarget {
    const value = this.getJsonSetting<ExecutionTarget>('chat.executionTarget', DEFAULT_EXECUTION_TARGET);
    return isExecutionTarget(value) ? value : DEFAULT_EXECUTION_TARGET;
  }

  setExecutionTarget(value: ExecutionTarget) {
    this.setJsonSetting('chat.executionTarget', value);
  }

  getCloudSandboxEnabled(): boolean {
    return Boolean(this.getJsonSetting<boolean>('beta.cloudSandbox', false));
  }

  setCloudSandboxEnabled(value: boolean) {
    this.setJsonSetting('beta.cloudSandbox', Boolean(value));
  }

  getCloudSandboxWorkerUrl(): string | null {
    const value = this.getJsonSetting<string | null>('chat.cloudSandboxWorkerUrl', null);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  setCloudSandboxWorkerUrl(value: string | null) {
    this.setJsonSetting('chat.cloudSandboxWorkerUrl', value ? value.trim() : null);
  }

  /**
   * Synchronous read of the Cloud Sandbox bearer token from the in-memory
   * cache. Returns `null` until `primeCloudSandboxSecret()` runs at startup or
   * `setCloudSandboxWorkerSecret()` is called. Callers that can tolerate an
   * await (the settings IPC) should use `loadCloudSandboxWorkerSecret()`
   * instead so a cold cache doesn't show as "missing".
   */
  getCloudSandboxWorkerSecret(): string | null {
    return this.cloudSandboxSecretCache;
  }

  /**
   * Live keychain read. Prefer this over the cached getter anywhere the caller
   * can await, because a cold cache reads as "no secret configured".
   */
  async loadCloudSandboxWorkerSecret(): Promise<string | null> {
    const value = await this.cloudSandboxSecretStore.read();
    this.cloudSandboxSecretCache = value;
    return value;
  }

  /**
   * Awaiting callers' read-through: serve from the warm cache when we have it,
   * otherwise hit the keychain and memoize. Use anywhere the caller can await —
   * a cold cache otherwise reads as "no secret configured" and breaks flows that
   * run before `primeCloudSandboxSecret()`.
   */
  async readCloudSandboxWorkerSecret(): Promise<string | null> {
    if (this.cloudSandboxSecretCache !== null) {
      return this.cloudSandboxSecretCache;
    }
    return this.loadCloudSandboxWorkerSecret();
  }

  /**
   * Same as `readCloudSandboxWorkerSecret`, but throws rather than returning
   * null. Keep the cache-aware awaitable pair together so next reader sees the
   * difference is contract (null vs throw), not mechanism.
   */
  async requireCloudSandboxWorkerSecret(): Promise<string> {
    const value = await this.readCloudSandboxWorkerSecret();
    if (!value) {
      throw new Error('Cloud Sandbox bearer token is not configured');
    }
    return value;
  }

  /**
   * Persists the secret to the OS keychain and updates the in-memory cache.
   * Also clears any legacy plaintext row from `app_settings` so an upgrade
   * doesn't leave the old copy behind.
   */
  async setCloudSandboxWorkerSecret(value: string | null): Promise<void> {
    const trimmed = value?.trim() || null;
    await this.cloudSandboxSecretStore.write(trimmed);
    this.cloudSandboxSecretCache = trimmed;
    this.db
      .prepare('DELETE FROM app_settings WHERE key = @key')
      .run({ key: 'chat.cloudSandboxWorkerSecret' });
  }

  /** Whether a secret is configured, without ever exposing the token itself. */
  hasCloudSandboxWorkerSecret(): boolean {
    return this.cloudSandboxSecretCache !== null;
  }

  /**
   * One-shot migration for installs that saved the bearer token to
   * `app_settings` before the keytar store existed. Runs at startup; later
   * `setCloudSandboxWorkerSecret()` calls also clear it, but a user who never
   * re-saves after upgrading would otherwise keep the plaintext copy forever.
   * Idempotent — safe to run on every launch.
   */
  purgeLegacyCloudSandboxWorkerSecret(): void {
    this.db
      .prepare('DELETE FROM app_settings WHERE key = @key')
      .run({ key: 'chat.cloudSandboxWorkerSecret' });
  }

  /**
   * Loads the keychain value into memory. Call once at startup.
   *
   * Also performs the one-time upgrade: if a plaintext copy is still sitting
   * in `app_settings.chat.cloudSandboxWorkerSecret` from before keychain
   * storage, move it to the keychain and delete the row so the old copy
   * can't be lifted later by anything that only reads the database.
   *
   * Keychain always wins over the legacy row when both are present — the
   * newer write is authoritative.
   */
  async primeCloudSandboxSecret(): Promise<void> {
    const legacyRow = this.db
      .prepare<{ key: string }, { value: string }>(
        'SELECT value FROM app_settings WHERE key = @key'
      )
      .get({ key: 'chat.cloudSandboxWorkerSecret' });

    let legacyValue: string | null = null;
    if (legacyRow) {
      try {
        const parsed = JSON.parse(legacyRow.value) as unknown;
        legacyValue = typeof parsed === 'string' && parsed.trim() ? parsed.trim() : null;
      } catch {
        legacyValue = null;
      }
      // Always purge the plaintext row, even if we don't adopt the value —
      // the upgrade's whole point is that userData stops being a credential
      // store.
      this.db
        .prepare('DELETE FROM app_settings WHERE key = @key')
        .run({ key: 'chat.cloudSandboxWorkerSecret' });
    }

    const existing = await this.cloudSandboxSecretStore.read();
    if (existing) {
      this.cloudSandboxSecretCache = existing;
      return;
    }

    if (legacyValue) {
      await CloudSandboxSecretStore.write(legacyValue);
      this.cloudSandboxSecretCache = legacyValue;
      return;
    }

    this.cloudSandboxSecretCache = null;
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
   * OpenCode integration settings (deep-integration plan T0). Persisted as a
   * JSON blob under `providers.opencode`; the server password intentionally
   * lives in the keychain, never here.
   */
  getOpenCodeSettings(): ParseOpenCodeSettingsResult {
    return parseOpenCodeSettings(this.getJsonSetting<unknown>('providers.opencode', null));
  }

  setOpenCodeSettings(settings: OpenCodeSettings) {
    this.setJsonSetting('providers.opencode', settings);
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
