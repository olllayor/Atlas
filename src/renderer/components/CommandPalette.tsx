import type { KeybindingCommand } from '../../shared/contracts';
import {
  CommandDialog,
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
};

type CommandPaletteProps = {
  items: CommandPaletteItem[];
  onOpenChange: (open: boolean) => void;
  onSelect: (command: KeybindingCommand) => void;
  open: boolean;
};

export function CommandPalette({ items, onOpenChange, onSelect, open }: CommandPaletteProps) {
  const grouped = items.reduce<Record<string, CommandPaletteItem[]>>((result, item) => {
    if (!result[item.section]) {
      result[item.section] = [];
    }

    result[item.section]!.push(item);
    return result;
  }, {});

  return (
    <CommandDialog
      className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-bg-base p-0 text-white"
      description="Search for Atlas actions"
      onOpenChange={onOpenChange}
      open={open}
      title="Command Palette"
    >
      <CommandInput
        className="border-b border-[var(--border-subtle)] bg-transparent px-4 text-sm text-white placeholder:text-[var(--text-faint)]"
        placeholder="Type a command..."
      />
      <CommandList className="max-h-[420px] px-2 py-2">
        <CommandEmpty className="py-10 text-center text-sm text-[var(--text-muted)]">No matching commands.</CommandEmpty>
        {Object.entries(grouped).map(([section, sectionItems]) => (
          <CommandGroup
            className="overflow-hidden px-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.16em] [&_[cmdk-group-heading]]:text-[var(--text-faint)]"
            heading={section}
            key={section}
          >
            {sectionItems.map((item) => (
              <CommandItem
                className="rounded-[var(--radius-sm)] px-3 py-3 data-[selected=true]:bg-[var(--bg-hover)] data-[selected=true]:text-white"
                disabled={item.disabled}
                key={item.command}
                onSelect={() => onSelect(item.command)}
                value={`${item.title} ${item.description}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-normal text-[var(--text-secondary)]">{item.title}</div>
                  <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{item.description}</div>
                </div>
                {item.shortcutLabel ? (
                  <CommandShortcut className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-ghost)] px-2 py-1 text-[10px] tracking-[0.08em] text-[var(--text-secondary)]">
                    {item.shortcutLabel}
                  </CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
