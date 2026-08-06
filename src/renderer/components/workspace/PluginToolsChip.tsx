import { Plug } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { PluginActivationEntry } from '../../../shared/contracts';
import { notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Switch as UiSwitch } from '../ui/switch';

/**
 * Which plugin tools this conversation can reach.
 *
 * Gating is invisible when it works, which is the problem: a user whose GitHub
 * tools are not there has no way to tell whether the plugin is broken or simply
 * asleep. This says which it is, and offers the two ways to wake it — for this
 * conversation, or everywhere.
 *
 * Renders nothing when no installed plugin carries tools, so the ordinary case
 * costs no chrome.
 */
export function PluginToolsChip({ conversationId }: { conversationId?: string }) {
  const [entries, setEntries] = useState<PluginActivationEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!conversationId) {
      setEntries([]);
      return;
    }

    setEntries(await window.atlasChat.plugins.activation(conversationId).catch(() => []));
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!conversationId || entries.length === 0) {
    return null;
  }

  const run = async (action: () => Promise<PluginActivationEntry[]>) => {
    setBusy(true);
    try {
      setEntries(await action());
    } catch (error) {
      notifyError('Could not change plugin tools', error);
    } finally {
      setBusy(false);
    }
  };

  const active = entries.filter((entry) => entry.active).length;

  return (
    <DropdownMenu onOpenChange={(open) => open && void load()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-2xs transition-colors',
            active > 0 ? 'text-text-secondary' : 'text-text-faint',
            'hover:bg-bg-hover'
          )}
          title="Plugin tools available to this chat"
        >
          <Plug className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span>
            {active}/{entries.length}
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72 p-2">
        <p className="px-1 pb-2 text-2xs text-text-faint">
          Plugin tools load when you use one of that plugin&apos;s skills. Turn one on here to make it
          available right away.
        </p>

        <ul className="space-y-1">
          {entries.map((entry) => (
            <li key={entry.name} className="rounded-md px-1 py-1 hover:bg-bg-hover">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs text-text-secondary">{entry.name}</span>
                <UiSwitch
                  checked={entry.active}
                  disabled={busy || entry.alwaysOn}
                  onCheckedChange={(next) =>
                    void run(() =>
                      window.atlasChat.plugins.setActivated(conversationId, entry.name, next)
                    )
                  }
                />
              </div>
              <label className="mt-0.5 flex items-center gap-1.5 text-2xs text-text-faint">
                <input
                  type="checkbox"
                  checked={entry.alwaysOn}
                  disabled={busy}
                  onChange={(event) =>
                    void run(() =>
                      window.atlasChat.plugins.setAlwaysOn(
                        conversationId,
                        entry.name,
                        event.target.checked
                      )
                    )
                  }
                />
                Always available in every chat
              </label>
            </li>
          ))}
        </ul>

        <p className="px-1 pt-2 text-2xs text-text-faint">
          {/* The turn's tool set is fixed before the stream starts, so a change
              here reaches the model on the next message rather than this one. */}
          Changes apply to your next message.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
