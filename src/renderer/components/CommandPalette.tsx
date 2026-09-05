import * as React from 'react';
import { defaultFilter } from 'cmdk';

import type { KeybindingCommand, MessageSearchHit } from '../../shared/contracts';
import { cn } from '../lib/utils';
import {
  createPaletteFilter,
  messageHitValue,
  splitSnippetSegments,
  useMessageSearch,
} from '../hooks/useMessageSearch';
import { formatRelativeTimestamp } from './sidebarViewModel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from './ui/command';

export type CommandPaletteItem = {
  command: KeybindingCommand;
  description: string;
  disabled?: boolean;
  section: string;
  shortcutLabel?: string | null;
  title: string;
  keywords?: string[];
};

/** A recent chat, jumpable straight from the palette. */
export type CommandPaletteConversation = {
  id: string;
  title: string;
  timestampLabel?: string | null;
};

type CommandPaletteProps = {
  items: CommandPaletteItem[];
  /**
   * Recent conversations. The sidebar's "Search" row opens this dialog, so
   * it has to actually search chats — it used to open a list of eight static
   * commands and nothing else.
   */
  conversations?: CommandPaletteConversation[];
  initialQuery?: string | null;
  /**
   * How many chats to show before the user types anything. Every chat is
   * always searchable — this only trims the resting list so the launcher
   * does not open as a second sidebar.
   */
  recentConversationLimit?: number;
  onSelectConversation?: (conversationId: string) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (command: KeybindingCommand) => void;
  open: boolean;
};

/**
 * cmdk's own matcher, kept for every row that is not a server hit — see
 * `createPaletteFilter`. Imported from the primitive rather than reimplemented
 * so the command list keeps scoring exactly as it did before.
 */
const paletteFilter = createPaletteFilter(defaultFilter);

const ROLE_LABELS: Record<MessageSearchHit['role'], string> = {
  assistant: 'Assistant',
  system: 'System',
  user: 'You',
};

/**
 * The highlighted snippet.
 *
 * The matched spans arrive wrapped in two Private Use Area code points, and they
 * are split into React nodes here — never assembled into an HTML string. The
 * snippet is verbatim message text, so `dangerouslySetInnerHTML` would hand
 * whatever anyone ever pasted into a chat straight to the parser.
 */
function SnippetText({ snippet }: { snippet: string }) {
  const segments = React.useMemo(() => splitSnippetSegments(snippet), [snippet]);

  return (
    <>
      {segments.map((segment, index) => (
        <span
          className={cn(segment.match && 'rounded-xs bg-bg-active font-medium text-text-primary')}
          key={index}
        >
          {segment.text}
        </span>
      ))}
    </>
  );
}

/**
 * Command palette / launcher, styled per the Codex reference
 * (`docs/codex-parity/reference-visual-spec.md` §3, §6): an overlay surface
 * with a hairline border and no heavy shadow, sidebar-style 15px rows with
 * hover tint, and dim non-uppercase section headers.
 *
 * Composed from `Dialog` + `Command` rather than `CommandDialog` for one
 * reason: `loop` has to reach the cmdk root, and `CommandDialog` forwards
 * its props to the Dialog instead.
 */
export function CommandPalette({
  items,
  conversations,
  initialQuery,
  onSelectConversation,
  onOpenChange,
  onSelect,
  open,
  recentConversationLimit = 8,
}: CommandPaletteProps) {
  // cmdk can only match what is rendered, so the full chat list is mounted
  // once the user types. The slice applies to the resting list only.
  const [search, setSearch] = React.useState(initialQuery ?? '');

  React.useEffect(() => {
    if (open && initialQuery !== undefined && initialQuery !== null) {
      setSearch(initialQuery);
    }
  }, [open, initialQuery]);
  // A disabled row explains nothing and can't be tooltipped through cmdk's
  // `pointer-events-none`, so unavailable commands are simply not offered.
  const availableItems = items.filter((item) => !item.disabled);
  const grouped = availableItems.reduce<Record<string, CommandPaletteItem[]>>((result, item) => {
    if (!result[item.section]) {
      result[item.section] = [];
    }

    result[item.section]!.push(item);
    return result;
  }, {});
  const allConversations = conversations ?? [];
  const isSearching = search.trim().length > 0;
  // Title matching stays client-side and instant; this is the other axis — the
  // message bodies, which only the main process's index can see. It runs only
  // while the dialog is open, so a closed palette never queries.
  const messageSearch = useMessageSearch(search, open);
  const messageHits = messageSearch.hits;
  const showNoMessages =
    messageSearch.status === 'ready' && messageHits.length === 0 && messageSearch.query === search.trim();
  const now = Date.now();
  const recentConversations = isSearching
    ? allConversations
    : allConversations.slice(0, recentConversationLimit);

  // Reset on close rather than in an `onOpenChange` wrapper: commands close
  // the palette by flipping `open` in the store, never through the dialog.
  React.useEffect(() => {
    if (!open) {
      setSearch('');
    }
  }, [open]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden border-border-subtle bg-bg-overlay p-0 text-text-primary"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>Search chats and commands</DialogDescription>
        </DialogHeader>

        <Command
          filter={paletteFilter}
          loop
          className="bg-transparent **:data-[slot=command-input-wrapper]:h-12 [&_[data-slot=command-input-wrapper]]:border-border-subtle"
        >
          <CommandInput
            className="bg-transparent text-md text-text-primary placeholder:text-text-muted"
            onValueChange={setSearch}
            placeholder="Search chats and commands…"
            value={search}
          />
          <CommandList className="max-h-[420px] px-2 py-2">
            {/* "No matches." is a lie while the index is still being asked, so
                the empty state waits for the answer instead of racing it. */}
            {messageSearch.showLoading ? null : (
              <CommandEmpty className="py-10 text-center text-sm text-text-muted">
                No matches.
              </CommandEmpty>
            )}

            {recentConversations.length > 0 ? (
              <CommandGroup
                className="overflow-hidden px-0 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:font-normal [&_[cmdk-group-heading]]:normal-case [&_[cmdk-group-heading]]:tracking-normal [&_[cmdk-group-heading]]:text-text-tertiary"
                heading="Chats"
              >
                {recentConversations.map((conversation) => (
                  <CommandItem
                    className="rounded-md px-3 py-2 data-[selected=true]:bg-bg-hover data-[selected=true]:text-text-primary"
                    key={conversation.id}
                    keywords={['chat', 'conversation']}
                    onSelect={() => {
                      onSelectConversation?.(conversation.id);
                      onOpenChange(false);
                    }}
                    value={`chat:${conversation.id} ${conversation.title}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-md text-text-primary">
                      {conversation.title}
                    </span>
                    {conversation.timestampLabel ? (
                      <span className="ml-auto shrink-0 pl-3 text-sm tabular-nums text-text-faint">
                        {conversation.timestampLabel}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {Object.entries(grouped).map(([section, sectionItems]) => (
              <CommandGroup
                className="overflow-hidden px-0 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:font-normal [&_[cmdk-group-heading]]:normal-case [&_[cmdk-group-heading]]:tracking-normal [&_[cmdk-group-heading]]:text-text-tertiary"
                heading={section}
                key={section}
              >
                {sectionItems.map((item) => (
                  <CommandItem
                    className="rounded-md px-3 py-2 data-[selected=true]:bg-bg-hover data-[selected=true]:text-text-primary"
                    key={item.command}
                    keywords={item.keywords}
                    onSelect={() => onSelect(item.command)}
                    value={item.title}
                  >
                    {/* Title only. Eight self-explanatory commands do not
                        need a second line competing for the same width. */}
                    <span className="min-w-0 flex-1 truncate text-md text-text-primary">
                      {item.title}
                    </span>
                    {item.shortcutLabel ? (
                      <CommandShortcut className="ml-auto shrink-0 pl-3 text-sm tracking-normal text-text-muted">
                        {item.shortcutLabel}
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}

            {/* Message bodies, kept in their own section and last: a snippet
                from the middle of a chat is a weaker answer than a command or a
                title the user actually typed, and mixing the two would move the
                default Enter target out from under them. */}
            {messageHits.length > 0 ? (
              <CommandGroup
                className="overflow-hidden px-0 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:font-normal [&_[cmdk-group-heading]]:normal-case [&_[cmdk-group-heading]]:tracking-normal [&_[cmdk-group-heading]]:text-text-tertiary"
                heading="Messages"
              >
                {messageHits.map((hit) => {
                  const timestamp = formatRelativeTimestamp(Date.parse(hit.createdAt) || null, now);

                  return (
                    <CommandItem
                      className="items-start rounded-md px-3 py-2 data-[selected=true]:bg-bg-hover data-[selected=true]:text-text-primary"
                      key={`${hit.conversationId}:${hit.messageId}`}
                      onSelect={() => {
                        // Only the conversation, not the message: the transcript
                        // is virtualised and paginated, and there is no anchor to
                        // land on a specific message from outside it.
                        onSelectConversation?.(hit.conversationId);
                        onOpenChange(false);
                      }}
                      value={messageHitValue(hit.conversationId, hit.messageId)}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-md text-text-primary">
                            {hit.conversationTitle}
                          </span>
                          <span className="shrink-0 text-sm text-text-tertiary">
                            {ROLE_LABELS[hit.role]}
                          </span>
                          {timestamp ? (
                            <span className="shrink-0 text-sm tabular-nums text-text-faint">
                              {timestamp}
                            </span>
                          ) : null}
                        </div>
                        {/* Clamped: a snippet is a window into a message, and an
                            unbounded one would stretch the dialog to its width. */}
                        <span className="line-clamp-2 min-w-0 text-sm break-words text-text-secondary">
                          <SnippetText snippet={hit.snippet} />
                        </span>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}

            {/* Status lines are plain elements, not `CommandItem`s: they are not
                selectable, and registering them would give Enter something
                useless to land on. A failed search shows nothing at all — a
                toast per keystroke would be a worse bug than the missing rows,
                and the palette still works on titles and commands without it. */}
            {messageSearch.showLoading ? (
              <div className="px-3 py-2 text-sm text-text-tertiary">Searching messages…</div>
            ) : null}
            {showNoMessages && !messageSearch.showLoading ? (
              <div className="px-3 py-2 text-sm text-text-tertiary">No messages match.</div>
            ) : null}
          </CommandList>

          <div className="flex shrink-0 items-center gap-3 border-t border-border-subtle px-3 py-2 text-3xs text-text-muted">
            <span>↑↓ navigate</span>
            <span aria-hidden>·</span>
            <span>↵ select</span>
            <span aria-hidden>·</span>
            <span>esc close</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
