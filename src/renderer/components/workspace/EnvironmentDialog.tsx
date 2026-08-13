/**
 * The workspace context drawer: everything the turn will run against.
 *
 * Path, detected project type, git branch, and the environment variables that
 * get merged into the agent's shell commands. Values are held in the OS
 * keychain, never in SQLite, so this panel can show keys and masked values but
 * has no way to reveal a stored secret — only to replace it.
 */

import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Trash2 } from 'lucide-react';

import type { EnvVarItem, ProjectContextInfo, WorkspaceProject } from '../../../shared/contracts';
import { notify, notifyError } from '../../lib/notify';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function EnvironmentDialog({
  open,
  onOpenChange,
  project,
  context,
  branch,
  onReveal,
  onEnvChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: WorkspaceProject;
  context: ProjectContextInfo;
  branch: string | null;
  onReveal: (projectId: string) => void;
  onEnvChanged: () => void;
}) {
  const [vars, setVars] = useState<EnvVarItem[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!window.atlasChat?.workspace?.listEnv) return;
    try {
      setVars(await window.atlasChat.workspace.listEnv(project.id));
    } catch (err) {
      console.warn('Failed to list env vars:', err);
    }
  }, [project.id]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const addVar = async () => {
    const key = newKey.trim();
    if (!key || busy) return;

    setBusy(true);
    try {
      await window.atlasChat.workspace.setEnv(project.id, key, newValue);
      setNewKey('');
      setNewValue('');
      await load();
      onEnvChanged();
      notify({ tone: 'success', title: `${key} saved`, description: 'Available to this project’s commands.' });
    } catch (err) {
      notifyError('Could not save the variable', err);
    } finally {
      setBusy(false);
    }
  };

  const deleteVar = async (key: string) => {
    setBusy(true);
    try {
      await window.atlasChat.workspace.deleteEnv(project.id, key);
      await load();
      onEnvChanged();
    } catch (err) {
      notifyError('Could not delete the variable', err);
    } finally {
      setBusy(false);
    }
  };

  const typeLabel = [
    context.projectType.type === 'unknown' ? null : context.projectType.type,
    context.projectType.framework,
    context.projectType.packageManager,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{project.title}</DialogTitle>
          <DialogDescription className="break-all">{project.root}</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-text-tertiary">Environment</dt>
          <dd className="text-text-primary">{typeLabel || 'Not detected'}</dd>
          <dt className="text-text-tertiary">Branch</dt>
          <dd className="text-text-primary">{branch ?? 'Not a git repository'}</dd>
          {context.detectedEnvKeys.length > 0 ? (
            <>
              <dt className="text-text-tertiary">.env file</dt>
              {/*
                Listed, not loaded: Atlas never reads values out of a .env file
                into the agent's environment. Seeing the keys is how the user
                decides which ones to configure here.
              */}
              <dd className="break-words text-text-faint">{context.detectedEnvKeys.join(', ')}</dd>
            </>
          ) : null}
        </dl>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm text-text-tertiary">Variables passed to commands</h3>

          {vars.length === 0 ? (
            <p className="text-sm text-text-faint">
              None yet. Anything added here is merged into the environment of every shell command
              this project runs.
            </p>
          ) : (
            <ul>
              {vars.map((item) => (
                <li
                  key={item.key}
                  className="flex items-center gap-2 border-t border-border-subtle py-1.5 first:border-t-0"
                >
                  <code className="min-w-0 flex-1 truncate font-mono text-sm text-text-primary">
                    {item.key}
                  </code>
                  <span className="shrink-0 font-mono text-sm text-text-faint">{item.maskedValue}</span>
                  <button
                    type="button"
                    onClick={() => void deleteVar(item.key)}
                    disabled={busy}
                    aria-label={`Delete ${item.key}`}
                    className="shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-error disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2">
            <Input
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
              placeholder="KEY"
              className="w-40 font-mono text-sm"
              spellCheck={false}
            />
            <Input
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
              placeholder="value"
              type="password"
              className="min-w-0 flex-1 font-mono text-sm"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void addVar();
                }
              }}
            />
            <Button onClick={() => void addVar()} disabled={busy || !newKey.trim()}>
              Add
            </Button>
          </div>
        </section>

        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => onReveal(project.id)} disabled={!project.exists}>
            <FolderOpen className="size-4" strokeWidth={1.75} />
            Reveal folder
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
