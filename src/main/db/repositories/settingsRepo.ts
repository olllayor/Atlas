import {
  CODE_FONT_FAMILY_OPTIONS,
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  DEFAULT_SETTINGS_APPEARANCE,
  UI_FONT_FAMILY_OPTIONS,
  UI_FONT_SIZE_DEFAULT,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
} from '../../../shared/contracts';
import type { CodeFontFamily, CredentialStatus, ProviderCredentialSummary, ProviderId, ThemeMode, UiFontFamily } from '../../../shared/contracts';
import { PROVIDER_ORDER } from '../../../shared/providerMetadata';
import type { SqliteDatabase } from '../client';

const PROVIDERS: ProviderId[] = [...PROVIDER_ORDER];

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

  getShowFreeOnlyByDefault() {
    return Boolean(this.getJsonSetting('showFreeOnlyByDefault', true));
  }

  setShowFreeOnlyByDefault(value: boolean) {
    this.setJsonSetting('showFreeOnlyByDefault', value);
  }

  getThemeMode(): ThemeMode {
    const value = this.getJsonSetting<ThemeMode>('themeMode', DEFAULT_SETTINGS_APPEARANCE.themeMode);
    return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_SETTINGS_APPEARANCE.themeMode;
  }

  setThemeMode(value: ThemeMode) {
    this.setJsonSetting('themeMode', value);
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

  getUiFontFamily(): UiFontFamily {
    const value = this.getJsonSetting<UiFontFamily>('uiFontFamily', DEFAULT_SETTINGS_APPEARANCE.uiFontFamily);
    return UI_FONT_FAMILY_OPTIONS.includes(value) ? value : DEFAULT_SETTINGS_APPEARANCE.uiFontFamily;
  }

  setUiFontFamily(value: UiFontFamily) {
    this.setJsonSetting('uiFontFamily', UI_FONT_FAMILY_OPTIONS.includes(value) ? value : DEFAULT_SETTINGS_APPEARANCE.uiFontFamily);
  }

  getCodeFontFamily(): CodeFontFamily {
    const value = this.getJsonSetting<CodeFontFamily>('codeFontFamily', DEFAULT_SETTINGS_APPEARANCE.codeFontFamily);
    return CODE_FONT_FAMILY_OPTIONS.includes(value) ? value : DEFAULT_SETTINGS_APPEARANCE.codeFontFamily;
  }

  setCodeFontFamily(value: CodeFontFamily) {
    this.setJsonSetting(
      'codeFontFamily',
      CODE_FONT_FAMILY_OPTIONS.includes(value) ? value : DEFAULT_SETTINGS_APPEARANCE.codeFontFamily
    );
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

  getProviderCredentials() {
    return PROVIDERS.map((providerId) => this.getCredential(providerId));
  }
}
