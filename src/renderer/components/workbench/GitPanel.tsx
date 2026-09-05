/**
 * The workbench Git tab: branch, working-tree status, history, and commit.
 *
 * Presentation follows the same rules as the rest of the workbench — borderless
 * rows, hairline separators, opacity for hierarchy — so git reads as part of
 * the surface rather than as an embedded client.
 */

import { useCallback, useEffect, useState } from 'react';
import { GitBranch, GitCommitHorizontal, RefreshCw } from 'lucide-react';

import type { GitLogEntry, GitStateSummary } from '../../../shared/contracts';
import { notify, notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

const EMPTY_STATE: GitStateSummary = {
  isRepo: false,
  branch: null,
  files: [],
  ahead: null,
  behind: null,
};

/** `git status --porcelain` codes, spelled out the way the UI says them. */
function describeStatus(indexStatus: string, workingTreeStatus: string) {
  if (indexStatus === '?' && workingTreeStatus === '?') return 'Untracked';
  if (indexStatus === 'A') return 'Added';
  if (indexStatus === 'D' || workingTreeStatus === 'D') return 'Deleted';
  if (indexStatus === 'R') return 'Renamed';
  if (indexStatus !== ' ' && indexStatus !== '?') return 'Staged';
  return 'Modified';
}

function formatCommitDate(raw: string) {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function GitPanel({ conversationId }: { conversationId?: string }) {
  const [state, setState] = useState<GitStateSummary>(EMPTY_STATE);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!conversationId || !window.atlasChat?.git) return;
    setLoading(true);
    try {
      const [nextState, nextLog] = await Promise.all([
        window.atlasChat.git.getState(conversationId),
        window.atlasChat.git.getLog(conversationId, 30),
      ]);
      setState(nextState);
      setLog(nextLog);
    } catch (err) {
      console.warn('Failed to load git state:', err);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!conversationId) {
    return <GitEmptyState title="No conversation" body="Open a conversation to see its repository." />;
  }

  if (!state.isRepo) {
    return (
      <GitEmptyState
        title="Not a git repository"
        body="Attach a project folder that is a git repository to see its branch, status and history here."
      />
    );
  }

  const dirtyCount = state.files.length;

  return (
    <div className="px-4 py-2">
      <div className="flex items-center gap-2 py-1.5">
        <GitBranch className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
        <span className="min-w-0 truncate text-base text-text-primary">{state.branch ?? 'HEAD'}</span>
        {state.ahead ? (
          <span className="shrink-0 tabular-nums text-sm text-text-faint">↑{state.ahead}</span>
        ) : null}
        {state.behind ? (
          <span className="shrink-0 tabular-nums text-sm text-text-faint">↓{state.behind}</span>
        ) : null}

        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Refresh git state"
          className="ml-auto rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <RefreshCw className={cn('size-3.5', loading && 'motion-spin-steps')} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setCommitOpen(true)}
          disabled={dirtyCount === 0}
          className="shrink-0 rounded bg-bg-surface px-2 py-0.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          Commit…
        </button>
      </div>

      <section>
        <h3 className="pb-1 pt-3 text-sm font-normal text-text-tertiary">
          Working tree{dirtyCount > 0 ? ` · ${dirtyCount}` : ''}
        </h3>
        {dirtyCount === 0 ? (
          <p className="py-1 text-sm text-text-faint">Clean — nothing to commit.</p>
        ) : (
          <ul>
            {state.files.map((file) => (
              <li
                key={`${file.indexStatus}${file.workingTreeStatus}:${file.path}`}
                className="flex min-h-8 items-center gap-2.5 border-t border-border-subtle first:border-t-0"
              >
                <span className="min-w-0 flex-1 truncate text-base text-text-primary" title={file.path}>
                  {file.path}
                </span>
                <span className="shrink-0 text-sm text-text-faint">
                  {describeStatus(file.indexStatus, file.workingTreeStatus)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="pb-1 pt-3 text-sm font-normal text-text-tertiary">History</h3>
        {log.length === 0 ? (
          <p className="py-1 text-sm text-text-faint">No commits yet.</p>
        ) : (
          <ul>
            {log.map((entry) => (
              <li key={entry.hash} className="flex min-h-10 items-center gap-2.5 border-t border-border-subtle first:border-t-0">
                <GitCommitHorizontal className="size-3.5 shrink-0 text-text-faint" aria-hidden />
                <code className="shrink-0 font-mono text-sm text-text-tertiary">{entry.shortHash}</code>
                <span className="min-w-0 flex-1 truncate text-base text-text-primary" title={entry.message}>
                  {entry.message}
                </span>
                <span className="shrink-0 text-sm text-text-faint" title={`${entry.author} · ${entry.date}`}>
                  {formatCommitDate(entry.date)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CommitDialog
        open={commitOpen}
        conversationId={conversationId}
        pendingCount={dirtyCount}
        onOpenChange={setCommitOpen}
        onCommitted={() => void refresh()}
      />
    </div>
  );
}

function GitEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
      <p className="text-base text-text-secondary">{title}</p>
      <p className="max-w-[36ch] text-sm leading-relaxed text-text-faint">{body}</p>
    </div>
  );
}

function CommitDialog({
  open,
  conversationId,
  pendingCount,
  onOpenChange,
  onCommitted,
}: {
  open: boolean;
  conversationId: string;
  pendingCount: number;
  onOpenChange: (open: boolean) => void;
  onCommitted: () => void;
}) {
  const [message, setMessage] = useState('');
  const [addAll, setAddAll] = useState(true);
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMessage('');
      setAmend(false);
      setAddAll(true);
    }
  }, [open]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const output = await window.atlasChat.git.commit({
        conversationId,
        message,
        amend,
        addAll,
      });
      notify({ tone: 'success', title: 'Committed', description: output.split('\n')[0] });
      onOpenChange(false);
      onCommitted();
    } catch (err) {
      notifyError('Commit failed', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Commit changes</DialogTitle>
          <DialogDescription>
            {pendingCount} file{pendingCount === 1 ? '' : 's'} changed in the working tree.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={amend ? 'Leave empty to keep the existing message' : 'Commit message'}
          rows={4}
          autoFocus
          className="resize-none"
        />

        <div className="flex flex-col gap-2 text-sm text-text-secondary">
          <label className="flex items-center gap-2">
            {/* Bare checkbox — `Input` wraps a text-field chrome (h-9 border
                box) around what must stay a 16px native control. */}
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-[var(--accent)]"
              checked={addAll}
              onChange={(event) => setAddAll(event.target.checked)}
            />
            Stage all changes first (<code className="font-mono text-xs">git add -A</code>)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-[var(--accent)]"
              checked={amend}
              onChange={(event) => setAmend(event.target.checked)}
            />
            Amend the previous commit
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || (!message.trim() && !amend)}>
            {busy ? 'Committing…' : 'Commit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
