/**
 * Durable subagent descriptor — versioned `subagent/descriptor` event payload.
 *
 * Ported from deepseek-harness `packages/subagent/subagent/src/descriptor.ts`
 * simplified for Atlas Task->Session migration. The descriptor is the source
 * of truth for listing, cold resume, and projection. It is appended once per
 * child as a `subagent.descriptor` runtime event before the child's first turn.
 *
 * Explicit fields only: `AgentOptions` is not snapshotted generically.
 */

// Re-export shared contract as single source of truth. This file owns the
// validation/fold logic; the shape is owned by shared/contracts so renderer
// and main stay in sync without importing main code.
import type { SubagentDescriptor, SubagentMode } from '../../../shared/contracts';
import { SUBAGENT_DESCRIPTOR_VERSION } from '../../../shared/contracts';

export { SUBAGENT_DESCRIPTOR_VERSION };
export type { SubagentDescriptor, SubagentMode };
export type SubagentDescriptorData = SubagentDescriptor;
export type SubagentDescriptorInput = Omit<SubagentDescriptor, 'version'>;

const KNOWNS_KEYS = new Set([
  'version',
  'mode',
  'provider',
  'label',
  'agentId',
  'parentConversationId',
  'delegationDepth',
  'model',
  'toolFilter',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertKnownKeys(value: Record<string, unknown>, path: string): void {
  const unknown = Object.keys(value).find((k) => !KNOWNS_KEYS.has(k));
  if (unknown !== undefined) {
    throw new Error(`persisted subagent descriptor ${path} has unknown field "${unknown}"`);
  }
}

/** Detach via structuredClone + validate required fields. */
export function snapshotSubagentDescriptor(input: SubagentDescriptorInput): SubagentDescriptorData {
  if (!input.label || typeof input.label !== 'string') {
    throw new Error('subagent descriptor label must be a non-empty string');
  }
  if (!input.agentId || typeof input.agentId !== 'string') {
    throw new Error('subagent descriptor agentId is required');
  }
  if (!input.parentConversationId || typeof input.parentConversationId !== 'string') {
    throw new Error('subagent descriptor parentConversationId is required');
  }
  if (input.mode !== 'one-shot' && input.mode !== 'continuable') {
    throw new Error(`subagent descriptor mode must be 'one-shot'|'continuable' (got ${String(input.mode)})`);
  }
  if (!input.provider || typeof input.provider !== 'string') {
    throw new Error('subagent descriptor provider is required');
  }
  if (!Number.isInteger(input.delegationDepth) || input.delegationDepth < 0) {
    throw new Error('subagent descriptor delegationDepth must be a non-negative integer');
  }

  const detached: SubagentDescriptorData = {
    version: SUBAGENT_DESCRIPTOR_VERSION,
    mode: input.mode,
    provider: String(input.provider),
    label: String(input.label),
    agentId: String(input.agentId),
    parentConversationId: String(input.parentConversationId),
    delegationDepth: input.delegationDepth,
    ...(input.model !== undefined ? { model: String(input.model) } : {}),
    ...(input.toolFilter !== undefined ? { toolFilter: [...input.toolFilter] } : {}),
  };

  // Use structuredClone where available for true detachment; fallback to JSON.
  try {
    return typeof structuredClone === 'function' ? structuredClone(detached) : JSON.parse(JSON.stringify(detached));
  } catch {
    return JSON.parse(JSON.stringify(detached));
  }
}

/** Validate and parse a persisted descriptor payload. Returns undefined on non-object. */
export function parseSubagentDescriptor(value: unknown): SubagentDescriptorData | undefined {
  if (!isRecord(value)) {
    throw new Error('persisted subagent descriptor payload must be an object');
  }
  assertKnownKeys(value, 'root');
  const version = value['version'];
  if (version !== SUBAGENT_DESCRIPTOR_VERSION) {
    // Unknown version -> caller treats as unsupported diagnostic row; do not throw
    // if strictly newer, but throw for corrupt old.
    if (typeof version !== 'number') throw new Error('persisted subagent descriptor version must be a number');
    if (version > SUBAGENT_DESCRIPTOR_VERSION) {
      // Future version — caller should render as diagnostic unsupported.
      throw new Error(`unsupported subagent descriptor version ${version} (current ${SUBAGENT_DESCRIPTOR_VERSION})`);
    }
    throw new Error(`persisted subagent descriptor version mismatch (got ${version}, expected ${SUBAGENT_DESCRIPTOR_VERSION})`);
  }
  const mode = value['mode'];
  if (mode !== 'one-shot' && mode !== 'continuable') {
    throw new Error(`persisted subagent descriptor mode must be 'one-shot'|'continuable' (got ${String(mode)})`);
  }
  const provider = value['provider'];
  const label = value['label'];
  const agentId = value['agentId'];
  const parentConversationId = value['parentConversationId'];
  const delegationDepth = value['delegationDepth'];
  if (typeof provider !== 'string' || !provider) throw new Error('persisted subagent descriptor provider must be a non-empty string');
  if (typeof label !== 'string' || !label) throw new Error('persisted subagent descriptor label must be a non-empty string');
  if (typeof agentId !== 'string' || !agentId) throw new Error('persisted subagent descriptor agentId must be a non-empty string');
  if (typeof parentConversationId !== 'string' || !parentConversationId) throw new Error('persisted subagent descriptor parentConversationId must be a non-empty string');
  if (typeof delegationDepth !== 'number' || !Number.isInteger(delegationDepth) || delegationDepth < 0) {
    throw new Error('persisted subagent descriptor delegationDepth must be a non-negative integer');
  }
  const model = value['model'];
  if (model !== undefined && (typeof model !== 'string' || !model)) {
    throw new Error('persisted subagent descriptor model must be a non-empty string when present');
  }
  const toolFilter = value['toolFilter'];
  if (toolFilter !== undefined) {
    if (!Array.isArray(toolFilter) || toolFilter.some((v) => typeof v !== 'string')) {
      throw new Error('persisted subagent descriptor toolFilter must be an array of strings');
    }
  }
  return {
    version: SUBAGENT_DESCRIPTOR_VERSION,
    mode: mode as SubagentMode,
    provider: provider as string,
    label: label as string,
    agentId: agentId as string,
    parentConversationId: parentConversationId as string,
    delegationDepth: delegationDepth as number,
    ...(model !== undefined ? { model: model as string } : {}),
    ...(toolFilter !== undefined ? { toolFilter: toolFilter as string[] } : {}),
  };
}

/** Fold the last valid descriptor from a list of envelopes (last-wins). */
export function foldSubagentDescriptor(
  events: ReadonlyArray<{ activityType: string; payload: Record<string, unknown> }>,
): SubagentDescriptorData | undefined {
  let last: SubagentDescriptorData | undefined;
  for (const event of events) {
    if (event.activityType !== 'subagent.descriptor') continue;
    const payload = (event.payload as Record<string, unknown>)?.subagentDescriptor ?? event.payload;
    try {
      const parsed = parseSubagentDescriptor(payload);
      if (parsed) last = parsed;
    } catch {
      // Malformed -> reset to undefined so caller sees diagnostic.
      last = undefined;
    }
  }
  return last;
}

/** Helper to build the runtime-event payload wrapper. */
export function descriptorEventPayload(descriptor: SubagentDescriptorData): Record<string, unknown> {
  return { subagentDescriptor: descriptor };
}
