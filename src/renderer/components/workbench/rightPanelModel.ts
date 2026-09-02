/**
 * The right panel's surface model.
 *
 * The panel is not a tab bar over a fixed set of views: it is an ordered list
 * of *surfaces* per conversation, plus which one is showing. Each surface is a
 * pointer — a kind, and for multi-instance kinds a resource id — while the
 * feature behind it keeps owning its own state. The diff surface owns nothing;
 * the review panel does.
 *
 * This is the shape t3code arrived at (`apps/web/src/rightPanelStore.ts`), and
 * it is worth copying for one reason: identity lives in the surface id. A file,
 * a terminal or a pull request can be open several times over as peer tabs
 * without the panel needing a case for each, and the same resource can never
 * open twice.
 *
 * Everything here is pure. The zustand wrapper and localStorage live in
 * `stores/useRightPanelStore.ts`; this module is what the tests exercise.
 */

/**
 * Surfaces that exist today. Pull request lands in a later phase; adding one
 * is an entry here plus an entry in the registry.
 */
export const RIGHT_PANEL_KINDS = [
  'diff',
  'git',
  'tasks',
  'agents',
  'terminal',
  'files',
  'file',
  'browser',
] as const;
export type RightPanelKind = (typeof RIGHT_PANEL_KINDS)[number];

/**
 * A singleton surface is addressed by its kind alone. Multi-instance kinds
 * append the resource they point at (`terminal:term-2`, `file:src/app.ts`), so
 * the id stays the dedupe key for every kind.
 */
export type SurfaceId = RightPanelKind | `${RightPanelKind}:${string}`;

export type RightPanelSurface = {
  id: SurfaceId;
  kind: RightPanelKind;
};

export type ConversationPanelState = {
  isOpen: boolean;
  activeSurfaceId: SurfaceId | null;
  surfaces: RightPanelSurface[];
};

export type RightPanelState = {
  byConversationId: Record<string, ConversationPanelState>;
};

/** Shared empty tail, so "this conversation has no panel yet" keeps one identity. */
export const EMPTY_PANEL_STATE: ConversationPanelState = Object.freeze({
  isOpen: false,
  activeSurfaceId: null,
  surfaces: [],
});

export function surfaceId(kind: RightPanelKind, resourceId?: string): SurfaceId {
  return resourceId === undefined ? kind : `${kind}:${resourceId}`;
}

export function makeSurface(kind: RightPanelKind, resourceId?: string): RightPanelSurface {
  return { id: surfaceId(kind, resourceId), kind };
}

/**
 * The lowest unused `<prefix>-N`, so closing a middle tab reuses its number
 * instead of counting forever.
 */
export function nextOrdinalResourceId(prefix: string, existing: readonly string[]): string {
  const used = new Set(existing);
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

/** The resource a multi-instance surface points at, or null for a singleton. */
export function surfaceResourceId(surface: RightPanelSurface): string | null {
  const separator = surface.id.indexOf(':');
  return separator < 0 ? null : surface.id.slice(separator + 1);
}

function isKind(value: unknown): value is RightPanelKind {
  return typeof value === 'string' && (RIGHT_PANEL_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Reducers. Each takes one conversation's state and returns the next one,
// returning the *same object* when nothing changed so subscribers can skip.
// ---------------------------------------------------------------------------

/** Adds the surface if it is new, and by default brings it to the front. */
export function openSurface(
  current: ConversationPanelState,
  surface: RightPanelSurface,
  activate = true
): ConversationPanelState {
  const known = current.surfaces.some((entry) => entry.id === surface.id);
  if (known && current.isOpen && (!activate || current.activeSurfaceId === surface.id)) {
    return current;
  }

  return {
    isOpen: true,
    surfaces: known ? current.surfaces : [...current.surfaces, surface],
    activeSurfaceId: activate ? surface.id : current.activeSurfaceId,
  };
}

/** Activating a surface the panel does not hold is a no-op, not an insert. */
export function activateSurface(
  current: ConversationPanelState,
  id: SurfaceId
): ConversationPanelState {
  if (!current.surfaces.some((surface) => surface.id === id)) return current;
  if (current.isOpen && current.activeSurfaceId === id) return current;
  return { ...current, isOpen: true, activeSurfaceId: id };
}

/**
 * Closing the active surface hands focus to the one that slid into its place,
 * or to the new last surface when it was the rightmost. Closing the last
 * surface closes the panel: an empty strip with no picker under it is a dead
 * column.
 */
export function closeSurface(
  current: ConversationPanelState,
  id: SurfaceId
): ConversationPanelState {
  const index = current.surfaces.findIndex((surface) => surface.id === id);
  if (index < 0) return current;

  const surfaces = current.surfaces.filter((surface) => surface.id !== id);
  if (current.activeSurfaceId !== id) {
    return { ...current, isOpen: surfaces.length > 0 && current.isOpen, surfaces };
  }

  const fallback = surfaces[Math.min(index, surfaces.length - 1)] ?? null;
  return {
    isOpen: surfaces.length > 0 && current.isOpen,
    surfaces,
    activeSurfaceId: fallback?.id ?? null,
  };
}

export function closeOtherSurfaces(
  current: ConversationPanelState,
  id: SurfaceId
): ConversationPanelState {
  const surface = current.surfaces.find((entry) => entry.id === id);
  if (!surface || current.surfaces.length === 1) return current;
  return { isOpen: true, surfaces: [surface], activeSurfaceId: surface.id };
}

export function closeSurfacesToRight(
  current: ConversationPanelState,
  id: SurfaceId
): ConversationPanelState {
  const index = current.surfaces.findIndex((surface) => surface.id === id);
  if (index < 0 || index === current.surfaces.length - 1) return current;

  const surfaces = current.surfaces.slice(0, index + 1);
  const activeSurvives = surfaces.some((surface) => surface.id === current.activeSurfaceId);
  return {
    ...current,
    surfaces,
    activeSurfaceId: activeSurvives ? current.activeSurfaceId : id,
  };
}

export function closeAllSurfaces(current: ConversationPanelState): ConversationPanelState {
  if (current.surfaces.length === 0 && !current.isOpen) return current;
  return { isOpen: false, surfaces: [], activeSurfaceId: null };
}

/**
 * Showing an empty panel is what puts the picker on screen, so `isOpen` is
 * deliberately independent of whether any surface is open.
 */
export function showPanel(current: ConversationPanelState): ConversationPanelState {
  return current.isOpen ? current : { ...current, isOpen: true };
}

export function hidePanel(current: ConversationPanelState): ConversationPanelState {
  return current.isOpen ? { ...current, isOpen: false } : current;
}

export function togglePanel(current: ConversationPanelState): ConversationPanelState {
  return current.isOpen ? hidePanel(current) : showPanel(current);
}

/**
 * Drops surfaces whose backing resource is gone — a closed terminal, a file in
 * a workspace that was detached. The panel must never hold a tab that opens
 * onto nothing.
 */
export function reconcileSurfaces(
  current: ConversationPanelState,
  isAlive: (surface: RightPanelSurface) => boolean
): ConversationPanelState {
  const surfaces = current.surfaces.filter(isAlive);
  if (surfaces.length === current.surfaces.length) return current;

  const activeSurvives = surfaces.some((surface) => surface.id === current.activeSurfaceId);
  return {
    isOpen: surfaces.length > 0 && current.isOpen,
    surfaces,
    activeSurfaceId: activeSurvives ? current.activeSurfaceId : (surfaces[0]?.id ?? null),
  };
}

/** Applies a reducer to one conversation, pruning entries that fall back to empty. */
export function updateConversation(
  byConversationId: Record<string, ConversationPanelState>,
  conversationId: string,
  reducer: (current: ConversationPanelState) => ConversationPanelState
): Record<string, ConversationPanelState> {
  const current = byConversationId[conversationId] ?? EMPTY_PANEL_STATE;
  const next = reducer(current);
  if (next === current) return byConversationId;

  if (!next.isOpen && next.activeSurfaceId === null && next.surfaces.length === 0) {
    if (!(conversationId in byConversationId)) return byConversationId;
    const { [conversationId]: _removed, ...rest } = byConversationId;
    return rest;
  }

  return { ...byConversationId, [conversationId]: next };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export const RIGHT_PANEL_STORAGE_KEY = 'atlas.rightPanel';
/**
 * Bump whenever a stored surface stops meaning what it meant. `migrate` reads
 * every version: a panel that silently forgets the user's tabs on upgrade is
 * worse than one that opens them in the wrong order.
 */
export const RIGHT_PANEL_STORAGE_VERSION = 1;

type PersistedEnvelope = {
  version: number;
  byConversationId: Record<string, ConversationPanelState>;
};

/**
 * Reads persisted state defensively: anything unrecognised is dropped rather
 * than trusted, including surface kinds retired by a later version.
 */
export function migratePersistedRightPanelState(raw: unknown): RightPanelState {
  if (!raw || typeof raw !== 'object') return { byConversationId: {} };

  const envelope = raw as Partial<PersistedEnvelope>;
  const stored = envelope.byConversationId;
  if (!stored || typeof stored !== 'object') return { byConversationId: {} };

  const byConversationId: Record<string, ConversationPanelState> = {};
  for (const [conversationId, value] of Object.entries(stored)) {
    if (!value || typeof value !== 'object') continue;
    const candidate = value as Partial<ConversationPanelState>;

    const seen = new Set<string>();
    const surfaces = Array.isArray(candidate.surfaces)
      ? candidate.surfaces.flatMap((surface): RightPanelSurface[] => {
          if (!surface || typeof surface !== 'object') return [];
          const { id, kind } = surface as Partial<RightPanelSurface>;
          if (typeof id !== 'string' || !isKind(kind)) return [];
          // The id has to still name the kind it claims, or a later rename
          // would leave a tab routed to one panel and labelled as another.
          if (id !== kind && !id.startsWith(`${kind}:`)) return [];
          if (seen.has(id)) return [];
          seen.add(id);
          return [{ id: id as SurfaceId, kind }];
        })
      : [];

    if (surfaces.length === 0) continue;

    const activeSurfaceId =
      typeof candidate.activeSurfaceId === 'string' &&
      surfaces.some((surface) => surface.id === candidate.activeSurfaceId)
        ? (candidate.activeSurfaceId as SurfaceId)
        : surfaces[0].id;

    byConversationId[conversationId] = {
      isOpen: candidate.isOpen === true,
      activeSurfaceId,
      surfaces,
    };
  }

  return { byConversationId };
}

export function serializeRightPanelState(state: RightPanelState): string {
  return JSON.stringify({
    version: RIGHT_PANEL_STORAGE_VERSION,
    byConversationId: state.byConversationId,
  } satisfies PersistedEnvelope);
}
