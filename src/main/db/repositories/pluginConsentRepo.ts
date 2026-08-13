import type { SqliteDatabase } from '../client';

/**
 * What a person has decided about one exact spawn identity.
 *
 * The table keys by `consentKey` (see `spawnConsentKey` in shared/mcp.ts), not
 * by server id: consenting to "github/server" should not silently cover a bundle
 * update that changes the command it runs. This is the "deny + remember" half
 * of first-spawn consent — a denied row persists until someone clears it from
 * the plugin detail page, so "no" stays "no" rather than becoming a prompt that
 * asks again next turn.
 */
export type PluginSpawnConsent = {
  consentKey: string;
  decision: 'granted' | 'denied';
  serverId: string;
  grantedAt: string;
};

type PluginSpawnConsentRow = {
  consent_key: string;
  decision: 'granted' | 'denied';
  server_id: string;
  granted_at: string;
};

function mapRow(row: PluginSpawnConsentRow): PluginSpawnConsent {
  return {
    consentKey: row.consent_key,
    decision: row.decision,
    serverId: row.server_id,
    grantedAt: row.granted_at
  };
}

export class PluginConsentRepo {
  constructor(private readonly db: SqliteDatabase) {}

  /** What the current consent for a spawn identity is, or null if never asked. */
  get(consentKey: string): PluginSpawnConsent | null {
    const row = this.db
      .prepare(
        `SELECT consent_key, decision, server_id, granted_at
         FROM spawn_consents
         WHERE consent_key = @consentKey`
      )
      .get({ consentKey }) as PluginSpawnConsentRow | undefined;

    return row ? mapRow(row) : null;
  }

  /** Records a person's yes. Overwrites a prior denial, because they changed it. */
  grant(input: { consentKey: string; serverId: string; grantedAt?: string }): PluginSpawnConsent {
    const grantedAt = input.grantedAt ?? new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO spawn_consents (consent_key, decision, server_id, granted_at)
         VALUES (@consentKey, 'granted', @serverId, @grantedAt)
         ON CONFLICT(consent_key) DO UPDATE SET
           decision = 'granted',
           granted_at = @grantedAt`
      )
      .run({
        consentKey: input.consentKey,
        serverId: input.serverId,
        grantedAt
      });

    return {
      consentKey: input.consentKey,
      decision: 'granted',
      serverId: input.serverId,
      grantedAt
    };
  }

  /** Records a person's no. Overwrites a prior grant. */
  deny(input: { consentKey: string; serverId: string; grantedAt?: string }): PluginSpawnConsent {
    const grantedAt = input.grantedAt ?? new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO spawn_consents (consent_key, decision, server_id, granted_at)
         VALUES (@consentKey, 'denied', @serverId, @grantedAt)
         ON CONFLICT(consent_key) DO UPDATE SET
           decision = 'denied',
           granted_at = @grantedAt`
      )
      .run({
        consentKey: input.consentKey,
        serverId: input.serverId,
        grantedAt
      });

    return {
      consentKey: input.consentKey,
      decision: 'denied',
      serverId: input.serverId,
      grantedAt
    };
  }

  /** Clears the record so the next spawn asks again. */
  clear(consentKey: string): void {
    this.db.prepare(`DELETE FROM spawn_consents WHERE consent_key = @consentKey`).run({
      consentKey
    });
  }

  /** Every consent a person has given for this server, newest first. */
  listForServer(serverId: string): PluginSpawnConsent[] {
    const rows = this.db
      .prepare(
        `SELECT consent_key, decision, server_id, granted_at
         FROM spawn_consents
         WHERE server_id = @serverId
         ORDER BY granted_at DESC`
      )
      .all({ serverId }) as PluginSpawnConsentRow[];

    return rows.map(mapRow);
  }
}
