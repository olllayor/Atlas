import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { formatTiming, type SubagentTiming } from '../../../shared/subagentFormat';

// Minimal catalog for S5: lists direct children of a conversation, with lazy hasChildren disclosure.
// Order-robust: backend orders by created_at ASC, frontend preserves that order and never reorders on expansion.
// Orphaning: children are fetched per-parent, so a deleted parent's children are never shown (cascade deletes rows).
// Status is fetched once per mount; live refresh arrives with S6 liveness wiring.

type CatalogEntry = {
  id: string;
  title: string;
  mode: string | null;
  label: string | null;
  hasChildren: boolean;
  status: 'running' | 'inactive';
  timing: SubagentTiming;
  createdAt: string;
};

function StatusDot({ status }: { status: string }) {
  if (status === 'running') return <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />;
  return <span className="h-2 w-2 rounded-full bg-border-strong" />;
}

function ModeBadge({ mode }: { mode: string | null }) {
  if (!mode) return null;
  return <span className="rounded bg-bg-muted px-1.5 py-0.5 text-[10px] font-mono text-text-muted">{mode}</span>;
}

/**
 * @deprecated Superseded by the Agents panel. Nothing mounts this any more:
 * the floating `SUBAGENTS · N` banner was a second roster to keep in sync with
 * the panel, and two surfaces showing one fleet drift apart. Kept for one
 * release in case the panel has to be rolled back.
 */
export function SubagentCatalog({ parentId, onSelect }: { parentId: string; onSelect?: (childId: string) => void }) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Map<string, CatalogEntry[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const entriesRef = useRef<CatalogEntry[]>(entries);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  const refresh = useEffectEvent(async () => {
    try {
      const list = (await window.atlasChat.subagents.list(parentId)) as any;
      setEntries(list);
    } catch {}
  });

  useEffect(() => {
    let cancelled = false;
    // Switching parents must not retain the previous tree's expanded state / child caches.
    setExpanded(new Set());
    setChildrenMap(new Map());
    setLoading(new Set());
    window.atlasChat.subagents.list(parentId).then((list: any) => {
      if (cancelled) return;
      // Order-robust: preserve backend order (created_at ASC), do not sort by status
      setEntries(list as any);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [parentId]);

  // S6 live refresh: reuse the runtime-sync push channel already flowing through chatEvent
  // (onRuntimeEvent → chatEvent with type 'runtime-sync'), rather than adding polling IPC.
  // Refresh on any runtime-sync for this parent, its known direct children, OR any
  // unknown child (new spawn whose id is not yet in `entries`). The latter fixes the
  // "new child missed" race where the childId is fresh and not in the snapshot.
  // Debounced to coalesce bursts (task fan-out can emit N descriptors at once).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, 80);
    };
    const unsub = window.atlasChat.chat.subscribe((event: any) => {
      if (event?.type !== 'runtime-sync') return;
      const cid = event.conversationId ?? event.payload?.conversationId;
      if (!cid) {
        schedule();
        return;
      }
      if (cid === parentId) {
        schedule();
        return;
      }
      if (entriesRef.current.some((e) => e.id === cid)) {
        schedule();
        return;
      }
      // Unknown cid could be a brand-new direct child just spawned under this
      // parent — the renderer's snapshot doesn't know it yet. Optimistically
      // refresh and let list(parentId) confirm; cost is one indexed query.
      // Since this catalog is mounted only for the active conversation, the
      // single extra query per turn is cheaper than missing the spawn.
      schedule();
    });
    return () => {
      if (timer) clearTimeout(timer);
      try { unsub?.(); } catch {}
    };
  // Subscribe only on parentId change; entries are read via ref to avoid churn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId]);

  const toggle = async (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
      setExpanded(next);
      return;
    }
    next.add(id);
    setExpanded(next);
    if (childrenMap.has(id)) return;
    setLoading((s) => new Set(s).add(id));
    try {
      const children = await window.atlasChat.subagents.list(id) as any;
      setChildrenMap((m) => new Map(m).set(id, children));
    } catch {}
    setLoading((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  };

  if (entries.length === 0) return null;

  return (
    <div className="mx-5 mt-2 rounded-lg border border-border-default bg-bg-surface/50 p-2 text-xs">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Subagents · {entries.length}</div>
      <div className="space-y-1">
        {entries.map((e) => (
          <div key={e.id} className="rounded border border-transparent hover:border-border-hover hover:bg-bg-hover/50">
            <div className="flex items-center gap-2 px-2 py-1.5">
              {e.hasChildren ? (
                <button
                  type="button"
                  onClick={() => void toggle(e.id)}
                  className="h-4 w-4 shrink-0 rounded hover:bg-bg-muted flex items-center justify-center"
                  aria-label={expanded.has(e.id) ? 'Collapse' : 'Expand'}
                >
                  <span className="text-[10px]">{expanded.has(e.id) ? '▼' : '▶'}</span>
                </button>
              ) : (
                <span className="h-4 w-4 shrink-0" />
              )}
              <StatusDot status={e.status} />
              <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{e.label ?? e.title}</span>
              <ModeBadge mode={e.mode} />
              <span className="shrink-0 text-[10px] text-text-muted">{formatTiming(e.timing as any)}</span>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(e.id)}
                  className="rounded bg-brand px-1.5 py-0.5 text-[10px] text-brand-text hover:opacity-90"
                >
                  Open
                </button>
              ) : null}
            </div>
            {expanded.has(e.id) && (
              <div className="ml-6 border-l border-border-subtle pl-2">
                {loading.has(e.id) ? (
                  <div className="py-1 text-[11px] text-text-muted">Loading…</div>
                ) : (
                  (() => {
                    const children = childrenMap.get(e.id) ?? [];
                    if (children.length === 0) return <div className="py-1 text-[11px] text-text-muted">No children</div>;
                    return (
                      <div className="space-y-1">
                        {children.map((c) => (
                          <div key={c.id} className="flex items-center gap-2 px-1 py-1 text-[11px]">
                            <StatusDot status={c.status} />
                            <span className="truncate">{c.label ?? c.title}</span>
                            <span className="ml-auto text-[10px] text-text-muted">{formatTiming(c.timing as any)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
