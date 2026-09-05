import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { SqliteDatabase } from "../src/main/db/client.js";
import { ConversationsRepo } from "../src/main/db/repositories/conversationsRepo.js";
import { RuntimeStateRepo } from "../src/main/db/repositories/runtimeStateRepo.js";
import { applySchema } from "../src/main/db/schema.js";
import { dropSupersededToolUpdatedEvents } from "../src/shared/runtimeActivity.js";

/**
 * t3code PR #8368 parity:
 * - Drops superseded tool.updated activities/events once tool.completed occurs
 * - Preserves in-flight updates when tool is still running
 * - Scoped to (turnId, toolCallId)
 * - Retains full sequence watermark
 */

function createDatabase(prefix: string) {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  const raw = new DatabaseSync(join(tempDir, "atlas.db"));
  const database = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction:
      <TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) =>
      (...args: TArgs) => {
        raw.exec("BEGIN");
        try {
          const result = callback(...args);
          raw.exec("COMMIT");
          return result;
        } catch (error) {
          raw.exec("ROLLBACK");
          throw error;
        }
      },
  } as unknown as SqliteDatabase;

  applySchema(database);
  return { raw, database, tempDir };
}

test("dropSupersededToolUpdatedEvents: drops tool.updated followed by tool.completed for the same toolCallId", () => {
  const events = [
    { activityType: "tool.started", turnId: "t1", toolCallId: "c1", sequence: 1 },
    { activityType: "tool.updated", turnId: "t1", toolCallId: "c1", sequence: 2 },
    { activityType: "tool.updated", turnId: "t1", toolCallId: "c1", sequence: 3 },
    { activityType: "tool.completed", turnId: "t1", toolCallId: "c1", sequence: 4 },
  ];

  const filtered = dropSupersededToolUpdatedEvents(events);
  assert.deepEqual(
    filtered.map((e) => e.sequence),
    [1, 4]
  );
});

test("dropSupersededToolUpdatedEvents: preserves in-flight tool.updated when no completion exists", () => {
  const events = [
    { activityType: "tool.started", turnId: "t1", toolCallId: "c1", sequence: 1 },
    { activityType: "tool.updated", turnId: "t1", toolCallId: "c1", sequence: 2 },
  ];

  const filtered = dropSupersededToolUpdatedEvents(events);
  assert.deepEqual(
    filtered.map((e) => e.sequence),
    [1, 2]
  );
});

test("dropSupersededToolUpdatedEvents: does not drop tool.updated across turn boundaries", () => {
  const events = [
    { activityType: "tool.updated", turnId: "t1", toolCallId: "c1", sequence: 1 },
    { activityType: "tool.completed", turnId: "t2", toolCallId: "c1", sequence: 2 },
  ];

  const filtered = dropSupersededToolUpdatedEvents(events);
  assert.deepEqual(
    filtered.map((e) => e.sequence),
    [1, 2],
    "updates from turn 1 must not be superseded by a completion in turn 2"
  );
});

test("dropSupersededToolUpdatedEvents: preserves anonymous events without a toolCallId", () => {
  const events = [
    { activityType: "tool.updated", turnId: "t1", toolCallId: null, sequence: 1 },
    { activityType: "tool.completed", turnId: "t1", toolCallId: null, sequence: 2 },
  ];

  const filtered = dropSupersededToolUpdatedEvents(events);
  assert.deepEqual(
    filtered.map((e) => e.sequence),
    [1, 2]
  );
});

test("dropSupersededToolUpdatedEvents: preserves non-tool events and order", () => {
  const events = [
    { activityType: "message.delta", turnId: "t1", toolCallId: null, sequence: 1 },
    { activityType: "tool.updated", turnId: "t1", toolCallId: "c1", sequence: 2 },
    { activityType: "approval.requested", turnId: "t1", toolCallId: "c1", sequence: 3 },
    { activityType: "tool.completed", turnId: "t1", toolCallId: "c1", sequence: 4 },
    { activityType: "message.delta", turnId: "t1", toolCallId: null, sequence: 5 },
  ];

  const filtered = dropSupersededToolUpdatedEvents(events);
  assert.deepEqual(
    filtered.map((e) => e.sequence),
    [1, 3, 4, 5]
  );
});

test("RuntimeStateRepo.listEventsAfter: drops intermediate superseded tool.updated events on recovery", (t) => {
  const { raw, database, tempDir } = createDatabase("atlas-drop-superseded-");
  const conversations = new ConversationsRepo(database);
  const runtimeState = new RuntimeStateRepo(database);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversation = conversations.create();
  const messageId = conversations.addMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "",
    status: "streaming",
    providerId: "openrouter",
    modelId: "openrouter/test-model",
  });

  runtimeState.createTurn({
    id: "turn-coalesce",
    conversationId: conversation.id,
    requestId: "req-1",
    assistantMessageId: messageId,
    providerId: "openrouter",
    modelId: "openrouter/test-model",
  });

  // 1. Tool started
  runtimeState.recordEvent({
    eventId: "e1",
    conversationId: conversation.id,
    turnId: "turn-coalesce",
    requestId: "req-1",
    activityType: "tool.started",
    tone: "tool",
    toolType: "command_execution",
    toolCallId: "bash-1",
    messageId,
    provider: "openrouter",
    providerEventType: "tool-input-start",
    payload: { toolName: "bash" },
  });

  // 2. Chatty intermediate tool updates (e.g. stdout streaming lines)
  for (let i = 2; i <= 6; i++) {
    runtimeState.recordEvent({
      eventId: `e${i}`,
      conversationId: conversation.id,
      turnId: "turn-coalesce",
      requestId: "req-1",
      activityType: "tool.updated",
      tone: "tool",
      toolType: "command_execution",
      toolCallId: "bash-1",
      messageId,
      provider: "openrouter",
      providerEventType: "tool-output-available",
      payload: { toolName: "bash", summary: `output line ${i}` },
    });
  }

  // 7. Tool completed
  runtimeState.recordEvent({
    eventId: "e7",
    conversationId: conversation.id,
    turnId: "turn-coalesce",
    requestId: "req-1",
    activityType: "tool.completed",
    tone: "tool",
    toolType: "command_execution",
    toolCallId: "bash-1",
    messageId,
    provider: "openrouter",
    providerEventType: "tool-output-available",
    payload: { toolName: "bash", summary: "command succeeded", status: "completed" },
  });

  // Replay from sequence 0: events e2 through e6 are superseded by e7 and should be dropped!
  const replay = runtimeState.listEventsAfter(conversation.id, 0);

  assert.equal(replay.lastSequence, 7, "lastSequence watermark must reflect highest DB sequence");
  assert.deepEqual(
    replay.events.map((e) => e.eventId),
    ["e1", "e7"],
    "intermediate tool.updated events must be dropped from recovery payload"
  );
});
