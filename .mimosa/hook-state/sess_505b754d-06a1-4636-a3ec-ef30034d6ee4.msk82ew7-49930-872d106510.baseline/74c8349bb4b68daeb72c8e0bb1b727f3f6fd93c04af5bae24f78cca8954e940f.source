import { randomUUID } from 'node:crypto';

import type { PluginAuditRecord } from '../../../shared/pluginAudit';
import { buildAuditRecord } from '../../../shared/pluginAudit';
import { logger } from '../../observability/logger';

/**
 * What plugins did, kept where it can be answered for.
 *
 * Held apart from the runtime-envelope table on purpose. That table is read on
 * the transcript replay path, and audit payloads — bounded, but bounded at
 * kilobytes rather than bytes — would make every conversation load pay for
 * records nobody is looking at. A separate capped store keeps the replay path
 * the size it was.
 *
 * **Durable when a store is supplied, in-memory otherwise.** Production wires
 * a `PluginAuditRepo` backed by SQLite, so a record written before a restart
 * is still there after one. Tests, and any headless caller that has no
 * database, get a bounded in-memory ring instead — same interface, same
 * dedup behaviour, so nothing about the call sites has to know which mode it
 * is in.
 *
 * **Observational, structurally.** This class has no way to affect a call: it
 * is handed values after the decision that produced them, returns nothing a
 * caller branches on, and swallows its own failures. An audit that could throw
 * would be an audit that can fail a tool call, which is the one thing a log
 * must never do.
 */

/** Enough to cover a long session; the oldest fall off. Only used without a durable store. */
const MAX_RECORDS = 2_000;

export type AuditInput = Omit<PluginAuditRecord, 'id' | 'at' | 'payload' | 'truncation'> & {
  payload?: unknown;
  knownSecrets?: readonly string[];
  /**
   * Names the logical event so a duplicate write lands once.
   *
   * Required, not inferred: a turn can legitimately be resumed (the same
   * plugin mention re-announced), a call retried, or a decision re-recorded
   * after a crash mid-write — and only the caller who knows what event this
   * is can say whether two calls describe the same thing or two different
   * ones. Recommended shape: `<type-prefix>:<the id that makes it unique>`,
   * e.g. `mc:${toolCallId}:${outcome}` for a call, `ar:${approvalId}` for an
   * approval request.
   */
  idempotencyKey: string;
};

/** What `McpAuditLog` needs from durable storage. Satisfied by `PluginAuditRepo`. */
export type PluginAuditStore = {
  append: (record: PluginAuditRecord, idempotencyKey: string) => boolean;
  forRequest: (requestId: string) => PluginAuditRecord[];
  forConversation: (conversationId: string) => PluginAuditRecord[];
};

/** A record paired with the key it was deduplicated on, for the in-memory path. */
type StoredEntry = { record: PluginAuditRecord; idempotencyKey: string };

export class McpAuditLog {
  private readonly entries: StoredEntry[] = [];
  /** Dedup for the in-memory path, so it matches the durable path's semantics. */
  private readonly seenKeys = new Set<string>();

  constructor(private readonly store?: PluginAuditStore) {}

  /**
   * Records one event.
   *
   * Never throws. A payload that cannot be serialised, a clock that misbehaves,
   * a redactor meeting something pathological, a database that is briefly
   * locked — none of those are reasons for the tool call that triggered them
   * to fail.
   */
  record(input: AuditInput): void {
    try {
      const record = buildAuditRecord({
        ...input,
        id: randomUUID(),
        at: new Date().toISOString()
      });

      const inserted = this.store
        ? this.store.append(record, input.idempotencyKey)
        : this.insertInMemory(record, input.idempotencyKey);

      if (!inserted) {
        // Not an error: this is the dedup working as designed. Nothing is
        // logged, because a suppressed duplicate is the expected shape of a
        // resumed turn and logging every one would be noise on the common path.
        return;
      }

      if (record.truncation) {
        // Worth a log line of its own: a truncated audit record is a hint that
        // some tool is returning far more than an audit can hold, which is
        // usually worth knowing independently of the record itself.
        logger.info('plugins.audit_truncated', {
          type: record.type,
          tool: record.tool,
          originalBytes: record.truncation.originalBytes,
          storedBytes: record.truncation.storedBytes
        });
      }
    } catch (error) {
      logger.warn('plugins.audit_failed', {
        type: input.type,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private insertInMemory(record: PluginAuditRecord, idempotencyKey: string): boolean {
    if (this.seenKeys.has(idempotencyKey)) {
      return false;
    }

    this.seenKeys.add(idempotencyKey);
    this.entries.push({ record, idempotencyKey });

    while (this.entries.length > MAX_RECORDS) {
      const dropped = this.entries.shift();

      // The key has to leave with the record it was paired with, or a ring
      // that wrapped around once would refuse every legitimately-repeated key
      // for the rest of the session — the in-memory path is a bounded window,
      // not a permanent log, and the dedup set must be bounded the same way.
      if (dropped) {
        this.seenKeys.delete(dropped.idempotencyKey);
      }
    }

    return true;
  }

  /** Everything recorded for one turn, oldest first. The `requestId` join. */
  forRequest(requestId: string): PluginAuditRecord[] {
    return this.store
      ? this.store.forRequest(requestId)
      : this.entries.filter((entry) => entry.record.requestId === requestId).map((entry) => entry.record);
  }

  /** Everything recorded for one conversation, oldest first. */
  forConversation(conversationId: string): PluginAuditRecord[] {
    return this.store
      ? this.store.forConversation(conversationId)
      : this.entries
          .filter((entry) => entry.record.conversationId === conversationId)
          .map((entry) => entry.record);
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries.length = 0;
    this.seenKeys.clear();
  }
}
