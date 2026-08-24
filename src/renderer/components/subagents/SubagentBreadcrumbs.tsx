import { useEffect, useState } from 'react';

type Crumb = { id: string; title: string };

export function SubagentBreadcrumbs({ conversationId, onSelect }: { conversationId: string; onSelect?: (id: string) => void }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const chain: Crumb[] = [];
      let currentId: string | null = conversationId;
      // Walk up to 10 levels to avoid loops
      for (let i = 0; i < 10 && currentId; i++) {
        try {
          const detail: any = await window.atlasChat.conversations.get(currentId);
          const conv = detail?.conversation ?? detail;
          if (!conv) break;
          chain.unshift({ id: conv.id, title: conv.title });
          const parentId = (conv as any).sideOfConversationId ?? (conv as any).side_of_conversation_id ?? null;
          const origin = (conv as any).origin ?? null;
          // Only continue if this is a subagent (origin === 'subagent')
          if (origin !== 'subagent' || !parentId) break;
          currentId = parentId;
        } catch {
          break;
        }
      }
      if (!cancelled) {
        // Order-robust: chain is already root→leaf, no reordering
        setCrumbs(chain);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

  if (loading || crumbs.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 px-5 text-xs text-text-muted">
      {crumbs.map((c, idx) => (
        <span key={c.id} className="flex items-center gap-1">
          {idx > 0 && <span className="text-text-faint">›</span>}
          {idx === crumbs.length - 1 ? (
            <span className="font-medium text-text-primary truncate max-w-[160px]">{c.title}</span>
          ) : (
            <button
              type="button"
              onClick={() => onSelect?.(c.id)}
              className="truncate max-w-[120px] hover:text-text-primary hover:underline text-left"
              title={c.title}
            >
              {c.title}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
