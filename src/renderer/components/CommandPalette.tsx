import * as React from 'react';

import type { KeybindingCommand } from '../../shared/contracts';
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
  onSelectConversation,
  onOpenChange,
  onSelect,
  open,
  recentConversationLimit = 8,
}: CommandPaletteProps) {
  // cmdk can only match what is rendered, so the full chat list is mounted
  // once the user types. The slice applies to the resting list only.
  const [search, setSearch] = React.useState('');
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
            <CommandEmpty className="py-10 text-center text-sm text-text-muted">
              No matches.
            </CommandEmpty>

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
                      <CommandShortcut className="ml-auto shrink-0 pl-3 text-sm tracking-normal text-text-faint">
                        {item.shortcutLabel}
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
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
