/**
 * The Files surface: the workspace's tree, and a box that searches it.
 *
 * The whole listing arrives in one call, so expanding a folder and typing in
 * the search box are both local. Typing swaps the tree for a ranked flat list
 * of paths, which is what a person actually wants from a search box in a
 * narrow column — a filtered tree hides the match behind the folders holding
 * it.
 *
 * Read-only by design. Editing files is the agent's job, and a second writer
 * in the same workspace is a merge conflict waiting for a name.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, File, FolderClosed, FolderOpen, RefreshCw, Search, X } from 'lucide-react';

import type { WorkspaceEntry } from '../../../shared/contracts';
import { cn } from '../../lib/utils';
import { useExpandedFolders, useFileTreeStore } from '../../stores/useFileTreeStore';
import { buildFileTree, filterFilePaths, flattenFileTree } from './fileTreeModel';

/** Beyond this a search result list stops being something you scan. */
const MAX_SEARCH_RESULTS = 200;

export type FilesPanelProps = {
  conversationId: string;
  /** Opens a file as its own surface. */
  onOpenFile: (relativePath: string) => void;
};

export function FilesPanel({ conversationId, onOpenFile }: FilesPanelProps) {
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  const expandedList = useExpandedFolders(conversationId);
  const toggleFolder = useFileTreeStore((state) => state.toggle);
  const collapseAll = useFileTreeStore((state) => state.collapseAll);

  useEffect(() => {
    let disposed = false;
    setLoading(true);

    void window.atlasChat.workspace
      .listEntries(conversationId, refreshToken > 0 ? { refresh: true } : undefined)
      .then((result) => {
        if (disposed) return;
        setEntries(result.entries);
        setTruncated(result.truncated);
        setError(null);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setEntries([]);
        setError(err instanceof Error ? err.message : 'Could not read this workspace.');
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [conversationId, refreshToken]);

  const expanded = useMemo(() => new Set(expandedList), [expandedList]);
  const tree = useMemo(() => buildFileTree(entries), [entries]);
  const rows = useMemo(() => flattenFileTree(tree, expanded), [tree, expanded]);

  const filePaths = useMemo(
    () => entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path),
    [entries]
  );
  const search = useMemo(
    () => filterFilePaths(filePaths, query, MAX_SEARCH_RESULTS),
    [filePaths, query]
  );

  const searching = query.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <Search className="size-3.5 shrink-0 text-text-faint" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !query) return;
            event.stopPropagation();
            setQuery('');
          }}
          placeholder="Search files"
          aria-label="Search files"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-faint"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery('')}
            className="rounded p-0.5 text-text-faint transition-colors hover:text-text-primary"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Collapse all folders"
          onClick={() => collapseAll(conversationId)}
          className="rounded p-0.5 text-text-faint transition-colors hover:text-text-primary"
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Rescan workspace"
          onClick={() => setRefreshToken((token) => token + 1)}
          className="rounded p-0.5 text-text-faint transition-colors hover:text-text-primary"
        >
          <RefreshCw className={cn('size-3.5', loading && 'opacity-40')} aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2 scrollbar-auto-hide">
        {error ? (
          <Message
            title="Could not read this workspace"
            // Listing goes through ripgrep, the same binary the agent's search
            // tools need, so the fix is the same one.
            body={error}
          />
        ) : loading && entries.length === 0 ? (
          <Message title="Reading the workspace" body="Listing every file the project tracks." />
        ) : entries.length === 0 ? (
          <Message
            title="No files to show"
            body="Attach a project folder to this conversation, or check that the folder is not empty."
          />
        ) : searching ? (
          <SearchResults
            matches={search.matches}
            truncated={search.truncated}
            onOpenFile={onOpenFile}
          />
        ) : (
          <ul>
            {rows.map((row) => (
              <TreeRow
                key={row.path}
                row={row}
                onSelect={() =>
                  row.kind === 'directory'
                    ? toggleFolder(conversationId, row.path)
                    : onOpenFile(row.path)
                }
              />
            ))}
          </ul>
        )}

        {truncated ? (
          <p className="px-3 pt-2 text-xs text-text-faint">
            This workspace is larger than the file index holds. Some files are not listed.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TreeRow({
  row,
  onSelect,
}: {
  row: ReturnType<typeof flattenFileTree>[number];
  onSelect: () => void;
}) {
  const Icon =
    row.kind === 'file' ? File : row.expanded ? FolderOpen : FolderClosed;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        title={row.path}
        // Depth is padding rather than nesting: a flat list of rows keeps the
        // scroller's height honest and the DOM shallow at any tree depth.
        style={{ paddingLeft: `${12 + row.depth * 14}px` }}
        className="flex w-full items-center gap-1.5 py-[3px] pr-3 text-left text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
      >
        {row.kind === 'directory' ? (
          row.expanded ? (
            <ChevronDown className="size-3 shrink-0 text-text-faint" aria-hidden />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-text-faint" aria-hidden />
          )
        ) : (
          <span className="size-3 shrink-0" aria-hidden />
        )}
        <Icon className="size-3.5 shrink-0 text-text-faint" aria-hidden />
        <span className="truncate">{row.name}</span>
      </button>
    </li>
  );
}

function SearchResults({
  matches,
  truncated,
  onOpenFile,
}: {
  matches: ReturnType<typeof filterFilePaths>['matches'];
  truncated: boolean;
  onOpenFile: (relativePath: string) => void;
}) {
  if (matches.length === 0) {
    return <Message title="No matching files" body="Every character of the query has to appear in the path, in order." />;
  }

  return (
    <>
      <ul>
        {matches.map((match) => {
          const separator = match.path.lastIndexOf('/');
          const folder = separator < 0 ? '' : match.path.slice(0, separator + 1);
          const name = separator < 0 ? match.path : match.path.slice(separator + 1);

          return (
            <li key={match.path}>
              <button
                type="button"
                onClick={() => onOpenFile(match.path)}
                title={match.path}
                className="flex w-full items-baseline gap-2 py-[3px] pr-3 pl-3 text-left transition-colors hover:bg-bg-hover"
              >
                <span className="shrink-0 truncate text-sm text-text-primary">{name}</span>
                <span className="min-w-0 truncate text-xs text-text-faint" dir="rtl">
                  {folder}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {truncated ? (
        <p className="px-3 pt-2 text-xs text-text-faint">
          Showing the first {MAX_SEARCH_RESULTS} matches. Narrow the query to see the rest.
        </p>
      ) : null}
    </>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center">
      <p className="text-base text-text-secondary">{title}</p>
      <p className="max-w-[36ch] text-sm leading-relaxed text-text-faint">{body}</p>
    </div>
  );
}
