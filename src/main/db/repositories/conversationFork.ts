import { randomUUID } from 'node:crypto';

import { buildAttachmentUrl } from '../../attachments/AttachmentStore';
import type { SqliteDatabase } from '../client';

/**
 * Forking a conversation.
 *
 * A fork is a new conversation seeded with another one's history up to a chosen
 * message. The parent is never written to. A *side* conversation is the same
 * copy with a different lifetime: it hangs off its parent, is hidden from every
 * "your chats" surface, and dies with the chat it was a tangent from.
 *
 * What is copied and what is not is the whole design, so it is stated once here
 * rather than inferred from the SQL below:
 *
 *   conversations            new row; model/workspace/permission defaults are
 *                            inherited, filing (pin, archive) and live-run
 *                            state (status, last_error, started_at) are not.
 *   messages                 copied. This is the conversation.
 *   conversation_events      copied up to the cut. Not optional: `getLastSequence`
 *                            reads MAX(sequence) from this table alone, so a fork
 *                            with copied activities and an empty event log would
 *                            number its first new turn from 1 and interleave it
 *                            with history that is already numbered 1..N.
 *   conversation_activities  copied. The transcript's tool cells are read from
 *                            here by message id; without them a forked turn
 *                            renders from stale `parts_json` alone.
 *   conversation_turns       copied. Small, and referenced by turn_id from both
 *                            of the above.
 *   tool_executions          copied. The legacy render path, still the only one
 *                            for conversations written before the activity
 *                            projection existed.
 *   approval_requests        EMPTY. Live-run state. A copied `pending` row would
 *                            put an approval prompt in front of a tool call that
 *                            no runtime is waiting on and no answer can resolve.
 *   provider_sessions        EMPTY. Live-run state, and `request_id` is globally
 *                            UNIQUE — copying one would not duplicate the
 *                            parent's row, it would overwrite it.
 *   conversation_checkpoints EMPTY. A crash-recovery watermark for a turn in
 *                            flight. A fork is never in flight.
 *   file_changes             EMPTY. These describe edits already made to the
 *                            real working tree and carry the `before_content`
 *                            that reverts them. Copying them would hand the fork
 *                            a revert button for work it did not do, let the
 *                            same edit be reverted twice from two chats, and
 *                            double-count the same lines in the sidebar. A fork
 *                            copies a conversation, not a filesystem.
 *   terminal_history         EMPTY, for the same reason: a record of commands
 *                            that actually ran.
 *   messages_fts             maintained by trigger; forked messages are
 *                            searchable because inserting them says so.
 */

/** Every table this module copies rows out of, in FK-safe write order. */
export type ForkKind = 'fork' | 'side';

export type ForkConversationInput = {
  conversationId: string;
  /**
   * Inclusive cut, in the message ordering the transcript already uses
   * (`created_at`, then `id`). Absent forks the whole conversation.
   */
  throughMessageId?: string | null;
  kind?: ForkKind;
  /** Overrides the derived title. */
  title?: string;
};

export type ForkConversationResult = {
  conversationId: string;
  forkPointSequence: number | null;
  copiedMessageCount: number;
};

type ParentRow = {
  id: string;
  title: string;
  default_provider_id: string | null;
  default_model_id: string | null;
  workspace_mode: string | null;
  execution_target: string | null;
  worktree_root: string | null;
  project_id: string | null;
  tool_permission_mode: string | null;
};

type MessageCopyRow = {
  id: string;
  role: string;
  content: string;
  reasoning: string | null;
  parts_json: string | null;
  response_messages_json: string | null;
  status: string;
  provider_id: string | null;
  model_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  latency_ms: number | null;
  error_code: string | null;
  created_at: string;
};

type TurnCopyRow = {
  id: string;
  request_id: string;
  assistant_message_id: string;
  provider_id: string;
  model_id: string;
  status: string;
  started_sequence: number;
  completed_sequence: number | null;
  created_at: string;
  updated_at: string;
};

export type ForkAttachmentStore = {
  copyAttachment: (storageKey: string, targetConversationId: string) => string | null;
};

/**
 * The id rewriter.
 *
 * Copied rows need primary keys of their own, but every reference *between*
 * them has to keep pointing at its counterpart inside the fork — a
 * `tool_execution` at its message, an activity at its turn, a tool part in
 * `parts_json` at the tool execution it renders.
 *
 * One flat map, minted lazily, means the copy passes can run in any order: a
 * table that mentions an id before the table that owns it has been copied still
 * gets the same replacement, because the first mention is what creates it.
 */
class IdMap {
  private readonly map = new Map<string, string>();

  /** The replacement for `id`, minting one on first sight. */
  take(id: string): string;
  take(id: string | null): string | null;
  take(id: string | null): string | null {
    if (id == null) {
      return null;
    }

    const existing = this.map.get(id);
    if (existing) {
      return existing;
    }

    const next = randomUUID();
    this.map.set(id, next);
    return next;
  }

  /** Record a replacement that was derived rather than minted. */
  set(from: string, to: string) {
    this.map.set(from, to);
    return to;
  }

  lookup(value: string) {
    return this.map.get(value);
  }

  /**
   * Rewrite every id mentioned anywhere inside a stored JSON blob.
   *
   * Payload shapes vary by activity type and by provider, and `parts_json` and
   * `response_messages_json` both carry tool call ids in places this module has
   * no business knowing about. Substituting strings wherever they occur is
   * blunt, but it is the only pass that cannot miss one — and a missed tool call
   * id is a forked tool cell that never matches the activity meant to fill it.
   *
   * The keys are the parent's actual ids, so a "false positive" is a copied
   * message quoting an id that now belongs to a row in another conversation;
   * rewriting it is the more correct answer, not the less.
   */
  rewriteJson(json: string | null): string | null {
    if (!json) {
      return json;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      // Unparseable stored JSON is already broken; copying it verbatim keeps
      // the fork exactly as broken as the parent rather than losing the column.
      return json;
    }

    return JSON.stringify(this.rewriteValue(parsed));
  }

  private rewriteValue(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.map.get(value) ?? value;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.rewriteValue(entry));
    }

    if (value && typeof value === 'object') {
      const next: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        next[key] = this.rewriteValue(entry);
      }
      return next;
    }

    return value;
  }
}

/**
 * `conversation_activities.id` is derived, not random:
 * `tool:<toolCallId>` / `approval:<approvalId>` / `activity:<eventId>`
 * (see `getWorkLogEntryId`). Minting a fresh UUID for it would break that
 * invariant inside the fork, so the prefix is kept and only the id it wraps is
 * put through the map — which is the same replacement the events and tool rows
 * get, so the derivation still holds on the other side.
 */
function remapActivityId(ids: IdMap, activityId: string): string {
  const separator = activityId.indexOf(':');
  if (separator === -1) {
    return ids.take(activityId);
  }

  const prefix = activityId.slice(0, separator);
  const suffix = activityId.slice(separator + 1);
  return ids.set(activityId, `${prefix}:${ids.take(suffix)}`);
}

/**
 * Copy the file blobs a forked message mentions, and point the part at them.
 *
 * Runs after the generic id rewrite, on the parsed array, because a storage key
 * is not an id and must not be substituted — it has to be a genuinely new file.
 */
function adoptAttachments(
  parts: unknown,
  targetConversationId: string,
  attachmentStore: ForkAttachmentStore
): unknown {
  if (!Array.isArray(parts)) {
    return parts;
  }

  return parts.map((part) => {
    if (!part || typeof part !== 'object') {
      return part;
    }

    const record = part as Record<string, unknown>;
    if (record.type !== 'file' || typeof record.storageKey !== 'string' || !record.storageKey) {
      return part;
    }

    const copiedKey = attachmentStore.copyAttachment(record.storageKey, targetConversationId);
    if (!copiedKey) {
      // The blob is already gone. Leave the part as it is: the fork inherits the
      // parent's broken reference instead of the fork itself failing.
      return part;
    }

    return { ...record, storageKey: copiedKey, url: buildAttachmentUrl(copiedKey) };
  });
}

function deriveForkTitle(parentTitle: string, kind: ForkKind) {
  const suffix = kind === 'side' ? ' (side)' : ' (fork)';
  // 200 is the ceiling `rename` enforces; the marker is what identifies the row,
  // so the parent's title is what gives way when the two do not both fit.
  const room = 200 - suffix.length;
  const base = parentTitle.length > room ? parentTitle.slice(0, room) : parentTitle;
  return `${base}${suffix}`;
}

/**
 * Copy a conversation's history into a new conversation.
 *
 * The whole thing is one statement's worth of atomicity: a fork that committed
 * its messages and not its events would be a conversation whose next turn
 * renumbers itself into the middle of its own history.
 */
export function forkConversation(
  db: SqliteDatabase,
  attachmentStore: ForkAttachmentStore,
  input: ForkConversationInput
): ForkConversationResult {
  const kind: ForkKind = input.kind ?? 'fork';

  const run = db.transaction((): ForkConversationResult => {
    const parent = db
      .prepare<{ conversationId: string }, ParentRow>(
        `
          SELECT
            id,
            title,
            default_provider_id,
            default_model_id,
            workspace_mode,
            execution_target,
            worktree_root,
            project_id,
            tool_permission_mode
          FROM conversations
          WHERE id = @conversationId
        `
      )
      .get({ conversationId: input.conversationId });

    if (!parent) {
      throw new Error(`Conversation not found: ${input.conversationId}`);
    }

    // A side conversation of a side conversation would be a tangent whose
    // lifetime depends on another tangent — two cascades deep, and invisible
    // from both. Forking one into a real conversation is fine and is the
    // documented way to keep a tangent that turned out to matter.
    if (kind === 'side') {
      const parentIsSide = db
        .prepare<{ conversationId: string }, { side_of_conversation_id: string | null }>(
          'SELECT side_of_conversation_id FROM conversations WHERE id = @conversationId'
        )
        .get({ conversationId: input.conversationId })?.side_of_conversation_id;

      if (parentIsSide) {
        throw new Error('A side conversation cannot have a side conversation of its own.');
      }
    }

    // --- resolve the cut -----------------------------------------------------
    //
    // The cut is expressed as a message because that is what the user points at.
    // Ordering matches the transcript's own (`created_at`, then `id`), so
    // "through this message" means the same thing here as on screen.
    let cutCreatedAt: string | null = null;
    let cutMessageId: string | null = null;

    if (input.throughMessageId) {
      const cutRow = db
        .prepare<{ messageId: string; conversationId: string }, { id: string; created_at: string }>(
          `
            SELECT id, created_at
            FROM messages
            WHERE id = @messageId AND conversation_id = @conversationId
          `
        )
        .get({ messageId: input.throughMessageId, conversationId: parent.id });

      if (!cutRow) {
        throw new Error(`Message ${input.throughMessageId} is not part of conversation ${parent.id}.`);
      }

      cutCreatedAt = cutRow.created_at;
      cutMessageId = cutRow.id;
    }

    // A `streaming` message belongs to a turn that is still running. Forking one
    // would seed the new conversation with a bubble that can never finish,
    // because the runtime that would have finished it is attached to the parent.
    const messageRows = db
      .prepare<{ conversationId: string; cutCreatedAt: string | null; cutMessageId: string | null }, MessageCopyRow>(
        `
          SELECT
            id,
            role,
            content,
            reasoning,
            parts_json,
            response_messages_json,
            status,
            provider_id,
            model_id,
            input_tokens,
            output_tokens,
            reasoning_tokens,
            latency_ms,
            error_code,
            created_at
          FROM messages
          WHERE conversation_id = @conversationId
            AND status <> 'streaming'
            AND (
              @cutMessageId IS NULL
              OR created_at < @cutCreatedAt
              OR (created_at = @cutCreatedAt AND id <= @cutMessageId)
            )
          ORDER BY created_at ASC, id ASC
        `
      )
      .all({ conversationId: parent.id, cutCreatedAt, cutMessageId });

    const copiedMessageIds = new Set(messageRows.map((row) => row.id));

    // The event-log cut. Forking the whole conversation takes the whole log,
    // including trailing events that carry no message id. Forking through a
    // message takes the log as far as the newest event that message produced,
    // which is what "everything that had happened by then" means.
    const cutSequence = cutMessageId
      ? (copiedMessageIds.size === 0
          ? 0
          : (db
              .prepare<unknown[], { sequence: number | null }>(
                `
                  SELECT MAX(sequence) AS sequence
                  FROM conversation_events
                  WHERE conversation_id = ?
                    AND message_id IN (${[...copiedMessageIds].map(() => '?').join(', ')})
                `
              )
              .get(parent.id, ...copiedMessageIds)?.sequence ?? 0))
      : (db
          .prepare<{ conversationId: string }, { sequence: number | null }>(
            'SELECT MAX(sequence) AS sequence FROM conversation_events WHERE conversation_id = @conversationId'
          )
          .get({ conversationId: parent.id })?.sequence ?? 0);

    // --- read everything that will be copied ---------------------------------
    //
    // All of it, before a single row is written. The id map has to be complete
    // before any stored JSON is rewritten: `rewriteJson` substitutes ids it has
    // already been told about and mints nothing, because a pass that minted a
    // fresh id for every string it walked would rewrite prose. So the ids come
    // out of the typed columns, where they are unambiguously ids, and the JSON
    // is only ever asked to look them up.
    const copiedMessageIdList = [...copiedMessageIds];
    const messagePlaceholders = copiedMessageIdList.map(() => '?').join(', ');

    const turnRows =
      copiedMessageIdList.length === 0
        ? []
        : db
            .prepare<unknown[], TurnCopyRow>(
              `
                SELECT
                  id, request_id, assistant_message_id, provider_id, model_id, status,
                  started_sequence, completed_sequence, created_at, updated_at
                FROM conversation_turns
                WHERE conversation_id = ?
                  AND assistant_message_id IN (${messagePlaceholders})
              `
            )
            .all(parent.id, ...copiedMessageIdList);

    const toolRows =
      copiedMessageIdList.length === 0
        ? []
        : db
            .prepare<unknown[], Record<string, unknown>>(
              `
                SELECT *
                FROM tool_executions
                WHERE conversation_id = ?
                  AND message_id IN (${messagePlaceholders})
              `
            )
            .all(parent.id, ...copiedMessageIdList);

    const eventRows =
      cutSequence > 0
        ? db
            .prepare<{ conversationId: string; cutSequence: number }, Record<string, unknown>>(
              `
                SELECT *
                FROM conversation_events
                WHERE conversation_id = @conversationId AND sequence <= @cutSequence
                ORDER BY sequence ASC
              `
            )
            .all({ conversationId: parent.id, cutSequence })
        : [];

    const activityRows =
      cutSequence > 0
        ? db
            .prepare<{ conversationId: string; cutSequence: number }, Record<string, unknown>>(
              `
                SELECT *
                FROM conversation_activities
                WHERE conversation_id = @conversationId AND sequence <= @cutSequence
                ORDER BY sequence ASC
              `
            )
            .all({ conversationId: parent.id, cutSequence })
        : [];

    // --- mint the replacements -----------------------------------------------
    const ids = new IdMap();

    for (const row of messageRows) {
      ids.take(row.id);
    }

    for (const row of turnRows) {
      ids.take(row.id);
      ids.take(row.request_id);
      ids.take(row.assistant_message_id);
    }

    for (const row of toolRows) {
      // `tool_executions.id` *is* the tool call id the transcript renders
      // against, which is why it has to be in the map before `parts_json` and
      // `response_messages_json` are rewritten.
      ids.take(row.id as string);
      ids.take(row.message_id as string);
      ids.take(row.request_id as string);
      ids.take((row.approval_id as string | null) ?? null);
    }

    for (const row of [...eventRows, ...activityRows]) {
      ids.take((row.turn_id as string | null) ?? null);
      ids.take((row.request_id as string | null) ?? null);
      ids.take((row.message_id as string | null) ?? null);
      ids.take((row.tool_call_id as string | null) ?? null);
      ids.take((row.approval_id as string | null) ?? null);
    }

    for (const row of eventRows) {
      ids.take(row.event_id as string);
    }

    // Activity ids are derived from the ids above, so they are minted last —
    // by which point the suffix each one wraps already has its replacement.
    for (const row of activityRows) {
      remapActivityId(ids, row.id as string);
    }

    // --- the new conversation row -------------------------------------------
    const forkId = randomUUID();
    const now = new Date().toISOString();
    const title = input.title?.replace(/\s+/g, ' ').trim().slice(0, 200) || deriveForkTitle(parent.title, kind);

    db
      .prepare(
        `
          INSERT INTO conversations (
            id,
            title,
            created_at,
            updated_at,
            default_provider_id,
            default_model_id,
            title_auto,
            workspace_mode,
            execution_target,
            worktree_root,
            project_id,
            tool_permission_mode,
            status,
            fork_of_conversation_id,
            fork_point_sequence,
            side_of_conversation_id
          )
          VALUES (
            @id,
            @title,
            @createdAt,
            @createdAt,
            @defaultProviderId,
            @defaultModelId,
            0,
            @workspaceMode,
            @executionTarget,
            @worktreeRoot,
            @projectId,
            @toolPermissionMode,
            'idle',
            @forkOf,
            @forkPointSequence,
            @sideOf
          )
        `
      )
      .run({
        id: forkId,
        title,
        createdAt: now,
        // Model, provider, workspace and permission mode all follow the fork:
        // a fork of a code-mode chat that landed in `work` with no project would
        // lose file access mid-thread and make every path in the history it just
        // inherited meaningless.
        defaultProviderId: parent.default_provider_id,
        defaultModelId: parent.default_model_id,
        workspaceMode: parent.workspace_mode,
        // executionTarget deliberately does NOT follow the fork: the parent's
        // worktree (<root>/.atlas-worktrees/<parentId>) belongs to the parent's
        // conversation, and a fork carrying the worktree target with no root of
        // its own would show as "Worktree" in the chip while actually running
        // as local. The fork starts local and gets a fresh worktree (under its
        // own id) only when the user switches it to worktree mode.
        executionTarget: 'local',
        // worktreeRoot is intentionally NOT copied: the parent's worktree
        // path (<root>/.atlas-worktrees/<parentId>) belongs to the parent's
        // conversation. The fork gets a fresh worktree when/if the user
        // switches it to worktree mode, provisioned under its own id.
        worktreeRoot: null,
        projectId: parent.project_id,
        toolPermissionMode: parent.tool_permission_mode,
        // `title_auto` is 0 on purpose. The derived title is the only thing
        // telling the user this row is a fork, and an auto-name generated from
        // the parent's first message would quietly take it away.
        forkOf: parent.id,
        forkPointSequence: cutSequence > 0 ? cutSequence : null,
        sideOf: kind === 'side' ? parent.id : null,
      });

    // --- messages ------------------------------------------------------------
    const insertMessage = db.prepare(
      `
        INSERT INTO messages (
          id, conversation_id, role, content, reasoning, parts_json,
          response_messages_json, status, provider_id, model_id, input_tokens,
          output_tokens, reasoning_tokens, latency_ms, error_code, created_at
        )
        VALUES (
          @id, @conversationId, @role, @content, @reasoning, @partsJson,
          @responseMessagesJson, @status, @providerId, @modelId, @inputTokens,
          @outputTokens, @reasoningTokens, @latencyMs, @errorCode, @createdAt
        )
      `
    );

    for (const row of messageRows) {
      const rewrittenParts = ids.rewriteJson(row.parts_json);
      let partsJson = rewrittenParts;

      if (rewrittenParts) {
        try {
          partsJson = JSON.stringify(
            adoptAttachments(JSON.parse(rewrittenParts), forkId, attachmentStore)
          );
        } catch {
          partsJson = rewrittenParts;
        }
      }

      insertMessage.run({
        id: ids.take(row.id),
        conversationId: forkId,
        role: row.role,
        content: row.content,
        reasoning: row.reasoning,
        partsJson,
        responseMessagesJson: ids.rewriteJson(row.response_messages_json),
        status: row.status,
        providerId: row.provider_id,
        modelId: row.model_id,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        reasoningTokens: row.reasoning_tokens,
        latencyMs: row.latency_ms,
        errorCode: row.error_code,
        createdAt: row.created_at,
      });
    }

    // --- turns ---------------------------------------------------------------
    //
    // Taken by the messages they produced rather than by sequence: a turn whose
    // assistant message did not make the cut has nothing in the fork to belong
    // to. A `running` turn is rewritten to `interrupted` — the run it describes
    // is attached to the parent, and nothing in the fork will ever finish it.
    if (turnRows.length > 0) {
      const insertTurn = db.prepare(
        `
          INSERT INTO conversation_turns (
            id, conversation_id, request_id, assistant_message_id, provider_id,
            model_id, status, started_sequence, completed_sequence, created_at, updated_at
          )
          VALUES (
            @id, @conversationId, @requestId, @assistantMessageId, @providerId,
            @modelId, @status, @startedSequence, @completedSequence, @createdAt, @updatedAt
          )
        `
      );

      for (const row of turnRows) {
        insertTurn.run({
          id: ids.take(row.id),
          conversationId: forkId,
          requestId: ids.take(row.request_id),
          assistantMessageId: ids.take(row.assistant_message_id),
          providerId: row.provider_id,
          modelId: row.model_id,
          status: row.status === 'running' ? 'interrupted' : row.status,
          startedSequence: row.started_sequence,
          completedSequence: row.completed_sequence,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      }
    }

    // --- tool executions -----------------------------------------------------
    //
    // `message_id` is a real foreign key, so these cannot be left pointing at
    // the parent even if we wanted them to. Copied last among the message-shaped
    // tables because the rows they reference must exist first.
    if (toolRows.length > 0) {
      const insertTool = db.prepare(
        `
          INSERT INTO tool_executions (
            id, conversation_id, message_id, request_id, tool_name, input_preview,
            input_json, state, started_at, finished_at, partial_output_preview,
            final_output_preview, output_json, error_code, error_message,
            requires_approval, approval_id, approved_at, denied_at, approval_reason,
            created_at, updated_at
          )
          VALUES (
            @id, @conversationId, @messageId, @requestId, @toolName, @inputPreview,
            @inputJson, @state, @startedAt, @finishedAt, @partialOutputPreview,
            @finalOutputPreview, @outputJson, @errorCode, @errorMessage,
            @requiresApproval, @approvalId, @approvedAt, @deniedAt, @approvalReason,
            @createdAt, @updatedAt
          )
        `
      );

      for (const row of toolRows) {
        insertTool.run({
          // `tool_executions.id` *is* the tool call id the transcript renders
          // against, so it goes through the same map the parts JSON did.
          id: ids.take(row.id as string),
          conversationId: forkId,
          messageId: ids.take(row.message_id as string),
          requestId: ids.take(row.request_id as string),
          toolName: row.tool_name as string,
          inputPreview: (row.input_preview as string | null) ?? null,
          inputJson: ids.rewriteJson((row.input_json as string | null) ?? null),
          state: row.state as string,
          startedAt: (row.started_at as string | null) ?? null,
          finishedAt: (row.finished_at as string | null) ?? null,
          partialOutputPreview: (row.partial_output_preview as string | null) ?? null,
          finalOutputPreview: (row.final_output_preview as string | null) ?? null,
          outputJson: ids.rewriteJson((row.output_json as string | null) ?? null),
          errorCode: (row.error_code as string | null) ?? null,
          errorMessage: (row.error_message as string | null) ?? null,
          requiresApproval: (row.requires_approval as number) ?? 0,
          approvalId: ids.take((row.approval_id as string | null) ?? null),
          approvedAt: (row.approved_at as string | null) ?? null,
          deniedAt: (row.denied_at as string | null) ?? null,
          approvalReason: (row.approval_reason as string | null) ?? null,
          createdAt: row.created_at as string,
          updatedAt: row.updated_at as string,
        });
      }
    }

    // --- the event log -------------------------------------------------------
    //
    // Sequences are preserved rather than renumbered. They are unique per
    // conversation, so carrying them over is safe, and it is the only way
    // `getLastSequence` reports a watermark the fork's first new turn can
    // continue from instead of colliding with.
    if (eventRows.length > 0) {
      const insertEvent = db.prepare(
        `
          INSERT INTO conversation_events (
            event_id, conversation_id, turn_id, request_id, sequence, occurred_at,
            activity_type, tone, tool_type, message_id, tool_call_id, approval_id,
            provider_id, provider_event_type, payload_json
          )
          VALUES (
            @eventId, @conversationId, @turnId, @requestId, @sequence, @occurredAt,
            @activityType, @tone, @toolType, @messageId, @toolCallId, @approvalId,
            @providerId, @providerEventType, @payloadJson
          )
        `
      );

      for (const row of eventRows) {
        insertEvent.run({
          eventId: ids.take(row.event_id as string),
          conversationId: forkId,
          turnId: ids.take(row.turn_id as string),
          requestId: ids.take(row.request_id as string),
          sequence: row.sequence as number,
          occurredAt: row.occurred_at as string,
          activityType: row.activity_type as string,
          tone: row.tone as string,
          toolType: (row.tool_type as string | null) ?? null,
          // An event whose message did not make the cut keeps its own id
          // remapped anyway — the map is shared, so it resolves to whatever the
          // message pass minted if that message *was* copied, and to a fresh id
          // pointing at nothing if it was not. Either way it never points back
          // into the parent.
          messageId: ids.take((row.message_id as string | null) ?? null),
          toolCallId: ids.take((row.tool_call_id as string | null) ?? null),
          approvalId: ids.take((row.approval_id as string | null) ?? null),
          providerId: row.provider_id as string,
          providerEventType: (row.provider_event_type as string | null) ?? null,
          payloadJson: ids.rewriteJson(row.payload_json as string) ?? '{}',
        });
      }

    }

    // --- activities ----------------------------------------------------------
    if (activityRows.length > 0) {
      const insertActivity = db.prepare(
        `
          INSERT INTO conversation_activities (
            id, conversation_id, turn_id, request_id, message_id, activity_type,
            tone, tool_type, tool_call_id, approval_id, title, summary, status,
            sequence, is_final, payload_json, created_at, updated_at
          )
          VALUES (
            @id, @conversationId, @turnId, @requestId, @messageId, @activityType,
            @tone, @toolType, @toolCallId, @approvalId, @title, @summary, @status,
            @sequence, @isFinal, @payloadJson, @createdAt, @updatedAt
          )
        `
      );

      for (const row of activityRows) {
        insertActivity.run({
          id: remapActivityId(ids, row.id as string),
          conversationId: forkId,
          turnId: ids.take(row.turn_id as string),
          requestId: ids.take(row.request_id as string),
          messageId: ids.take((row.message_id as string | null) ?? null),
          activityType: row.activity_type as string,
          tone: row.tone as string,
          toolType: (row.tool_type as string | null) ?? null,
          toolCallId: ids.take((row.tool_call_id as string | null) ?? null),
          approvalId: ids.take((row.approval_id as string | null) ?? null),
          title: row.title as string,
          summary: (row.summary as string | null) ?? null,
          status: row.status as string,
          sequence: row.sequence as number,
          isFinal: (row.is_final as number) ?? 0,
          payloadJson: ids.rewriteJson((row.payload_json as string | null) ?? null),
          createdAt: row.created_at as string,
          updatedAt: row.updated_at as string,
        });
      }
    }

    return {
      conversationId: forkId,
      forkPointSequence: cutSequence > 0 ? cutSequence : null,
      copiedMessageCount: messageRows.length,
    };
  });

  return run();
}
