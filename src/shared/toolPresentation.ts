import type {
  ToolActivityIcon,
  ToolActivityNativeAppReference,
  ToolActivitySource,
  ToolActivitySurface,
} from './contracts';

export interface ExtractedToolActivityPresentation {
  readonly toolSurface?: ToolActivitySurface;
  readonly toolIcon?: ToolActivityIcon;
  readonly toolSource?: ToolActivitySource;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function trimmedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined;
}

function imageUrl(value: unknown): string | undefined {
  const raw = trimmedString(value, 4096);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'data:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function pageUrl(value: unknown): string | undefined {
  const raw = trimmedString(value, 4096);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function nativeAppReference(value: unknown): ToolActivityNativeAppReference | undefined {
  const app = asRecord(value);
  const appId = trimmedString(app?.appId, 512);
  if (app?._tag === 'app-id' && appId && /^[A-Za-z0-9._-]+$/u.test(appId)) {
    return { _tag: 'app-id', appId };
  }
  const displayName = trimmedString(app?.displayName, 160);
  if (app?._tag === 'display-name' && displayName) {
    return { _tag: 'display-name', displayName };
  }
  return undefined;
}

function activityIcon(value: unknown): ToolActivityIcon | undefined {
  const icon = asRecord(value);
  if (icon?._tag === 'website') {
    const resolvedPageUrl = pageUrl(icon.pageUrl);
    const faviconUrl = imageUrl(icon.faviconUrl);
    const faviconUrlDark = imageUrl(icon.faviconUrlDark);
    if (resolvedPageUrl) {
      return {
        _tag: 'website',
        pageUrl: resolvedPageUrl,
        ...(faviconUrl ? { faviconUrl } : {}),
        ...(faviconUrlDark ? { faviconUrlDark } : {}),
      };
    }
  }
  if (icon?._tag === 'native-app') {
    const app = nativeAppReference(icon.app);
    if (app) return { _tag: 'native-app', app };
  }
  if (icon?._tag === 'themed-logo') {
    const logoUrl = imageUrl(icon.logoUrl);
    const logoUrlDark = imageUrl(icon.logoUrlDark);
    if (logoUrl) {
      return {
        _tag: 'themed-logo',
        logoUrl,
        ...(logoUrlDark ? { logoUrlDark } : {}),
      };
    }
  }
  return undefined;
}

function activitySource(value: unknown): ToolActivitySource | undefined {
  const source = asRecord(value);
  const key = trimmedString(source?.key, 512);
  const name = trimmedString(source?.name, 160);
  const kind = source?.kind;
  if (!key || !name || (kind !== 'browser' && kind !== 'computer' && kind !== 'integration')) {
    return undefined;
  }
  const icon = activityIcon(source?.icon);
  return { key, name, kind, ...(icon ? { icon } : {}) };
}

export function extractToolActivityPresentation(
  payloadValue: unknown,
): ExtractedToolActivityPresentation {
  const payload = asRecord(payloadValue);
  const toolSurface =
    payload?.toolSurface === 'browser' || payload?.toolSurface === 'computer'
      ? payload.toolSurface
      : undefined;
  const toolIcon = activityIcon(payload?.toolIcon);
  const toolSource = activitySource(payload?.toolSource);
  return {
    ...(toolSurface ? { toolSurface } : {}),
    ...(toolIcon ? { toolIcon } : {}),
    ...(toolSource ? { toolSource } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tool Group Summaries (PR #9093 parity)
// ---------------------------------------------------------------------------

export interface WorkLogPresentationEntry {
  readonly label?: string;
  readonly tone?: string;
  readonly toolLifecycleStatus?: string;
  readonly sourceActivityKind?: string;
  readonly taskId?: string;
  readonly toolSource?: ToolActivitySource;
  readonly toolSurface?: ToolActivitySurface;
  readonly itemType?: string;
  readonly command?: string;
  readonly changedFiles?: readonly string[];
  readonly toolTitle?: string;
  readonly turnId?: string;
  readonly toolCallId?: string;
  readonly detail?: string;
  readonly requestKind?: string;
}

export type ToolGroupAction =
  | 'command'
  | 'edit'
  | 'read'
  | 'browser'
  | 'search'
  | 'code-search'
  | 'update'
  | 'other';

function normalizeCompactToolLabel(label: string | undefined): string {
  return (label ?? '').trim().toLowerCase();
}

export function omitSupersededLifecycleMarkers<T>(
  entries: readonly T[],
  workEntryFor: (entry: T) => WorkLogPresentationEntry,
): T[] {
  const laterTerminalIdentities = new Set<string>();
  const reversedEntries: T[] = [];

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const workEntry = workEntryFor(entry);
    const normalizedLabel = normalizeCompactToolLabel(workEntry.toolTitle ?? workEntry.label);
    const identity = [
      workEntry.turnId ?? 'no-turn',
      workEntry.itemType ?? '',
      normalizedLabel,
    ].join('\u001f');
    const activityKind = workEntry.sourceActivityKind;
    const isStatuslessIdlessMarker =
      workEntry.toolCallId === undefined &&
      workEntry.toolLifecycleStatus === undefined &&
      (activityKind === 'tool.started' || activityKind === 'tool.updated');
    if (isStatuslessIdlessMarker && laterTerminalIdentities.has(identity)) continue;

    reversedEntries.push(entry);
    if (
      activityKind === 'tool.completed' ||
      (workEntry.toolLifecycleStatus !== undefined &&
        workEntry.toolLifecycleStatus !== 'inProgress')
    ) {
      laterTerminalIdentities.add(identity);
    }
  }

  return reversedEntries.reverse();
}

function toolGroupAction(entry: WorkLogPresentationEntry): ToolGroupAction {
  if (
    entry.sourceActivityKind === 'approval.requested' ||
    entry.sourceActivityKind === 'approval.resolved'
  ) {
    return 'update';
  }
  if (entry.toolSurface === 'browser') return 'browser';
  if (
    entry.requestKind === 'file-read' ||
    entry.itemType === 'image_view' ||
    (entry.itemType === 'dynamic_tool_call' &&
      entry.toolTitle?.trim().toLowerCase() === 'read file')
  ) {
    return 'read';
  }
  if (
    entry.requestKind === 'file-change' ||
    entry.itemType === 'file_change' ||
    (entry.changedFiles?.length ?? 0) > 0
  ) {
    return 'edit';
  }
  if (entry.requestKind === 'command' || entry.itemType === 'command_execution' || entry.command) {
    return 'command';
  }
  if (entry.itemType === 'web_search') return 'search';
  return 'other';
}

function toolGroupActionCount(
  action: ToolGroupAction,
  entries: ReadonlyArray<WorkLogPresentationEntry>,
): number {
  if (action !== 'edit') return entries.length;

  const changedFiles = new Set<string>();
  let editsWithoutFileDetails = 0;
  for (const entry of entries) {
    if (!entry.changedFiles || entry.changedFiles.length === 0) {
      editsWithoutFileDetails += 1;
      continue;
    }
    for (const file of entry.changedFiles) changedFiles.add(file);
  }
  return changedFiles.size + editsWithoutFileDetails;
}

function toolGroupActionLabel(action: ToolGroupAction, count: number): string {
  switch (action) {
    case 'read':
      return `Read ${count} ${count === 1 ? 'file' : 'files'}`;
    case 'edit':
      return `Changed ${count} ${count === 1 ? 'file' : 'files'}`;
    case 'command':
      return `Ran ${count} ${count === 1 ? 'command' : 'commands'}`;
    case 'browser':
      return `Used browser ${count} ${count === 1 ? 'time' : 'times'}`;
    case 'search':
      return `Searched the web ${count} ${count === 1 ? 'time' : 'times'}`;
    case 'code-search':
      return `Searched code ${count} ${count === 1 ? 'time' : 'times'}`;
    case 'other':
      return `Used ${count} ${count === 1 ? 'tool' : 'tools'}`;
    case 'update':
      return `Received ${count} ${count === 1 ? 'update' : 'updates'}`;
  }
}

export function summarizeToolGroup(entries: ReadonlyArray<WorkLogPresentationEntry>): string {
  const summaryEntries = omitSupersededLifecycleMarkers(entries, (entry) => entry);
  const sources = new Map<string, ToolActivitySource>();
  const groupedEntries = new Map<ToolGroupAction, WorkLogPresentationEntry[]>();
  for (const entry of summaryEntries) {
    if (entry.toolSource) {
      sources.set(entry.toolSource.key, entry.toolSource);
      continue;
    }
    const action = toolGroupAction(entry);
    const group = groupedEntries.get(action);
    if (group) group.push(entry);
    else groupedEntries.set(action, [entry]);
  }
  const labels = [...groupedEntries].map(([action, actionEntries]) =>
    toolGroupActionLabel(action, toolGroupActionCount(action, actionEntries)),
  );
  if (sources.size > 0) {
    const sourceValues = [...sources.values()];
    const sourceNames = sourceValues.map((source) => source.name);
    const formattedNames =
      sourceNames.length < 2
        ? sourceNames[0]!
        : sourceNames.length === 2
          ? sourceNames.join(' and ')
          : `${sourceNames.slice(0, -1).join(', ')}, and ${sourceNames.at(-1)}`;
    const allIntegrations = sourceValues.every((source) => source.kind === 'integration');
    labels.unshift(
      `Used ${formattedNames}${allIntegrations ? ` ${sources.size === 1 ? 'integration' : 'integrations'}` : ''}`,
    );
  }
  const sentenceLabels = labels.map((label, index) =>
    index === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1),
  );
  if (sentenceLabels.length < 2) return sentenceLabels[0] ?? '';
  if (sentenceLabels.length === 2) return sentenceLabels.join(' and ');
  return `${sentenceLabels.slice(0, -1).join(', ')}, and ${sentenceLabels.at(-1)}`;
}
