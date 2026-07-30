import {
  DotsHorizontalIcon,
  GearIcon,
  PersonIcon,
  ReloadIcon,
  TimerIcon,
  UpdateIcon,
} from '@radix-ui/react-icons';

import type { AppUpdateSnapshot, ConversationStats, SettingsSection, SettingsSummary } from '../../shared/contracts';
import { resolveProviderMetadata } from '../../shared/providerMetadata';
import { cn } from '../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

type SidebarSettingsMenuProps = {
  collapsed: boolean;
  settings: SettingsSummary | null;
  updateState: AppUpdateSnapshot;
  isRefreshingModels: boolean;
  conversationStats: ConversationStats | null;
  loadedMessageCount: number;
  settingsShortcutLabel?: string | null;
  onOpenSettings: (section?: SettingsSection) => void;
  onOpenLanding: () => void;
  onRefreshModels: () => void;
  onCheckForUpdates: () => void;
};

function getProfileSubtitle(settings: SettingsSummary | null) {
  const configuredProvider = settings?.providers.find((provider) => provider.hasSecret);

  if (!configuredProvider?.hasSecret) {
    return 'No API key configured';
  }

  const metadata = resolveProviderMetadata(configuredProvider.providerId, settings?.customProviders ?? []);

  if (configuredProvider.status === 'valid') {
    return metadata.configuredLabel;
  }

  if (configuredProvider.status === 'invalid') {
    return metadata.needsAttentionLabel;
  }

  return metadata.savedLabel;
}

function getUpdateLabel(updateState: AppUpdateSnapshot) {
  if (updateState.status === 'checking') {
    return 'Checking…';
  }

  if (updateState.status === 'available') {
    return 'Update available';
  }

  if (updateState.status === 'downloading') {
    const percent = updateState.progress?.percent;
    return typeof percent === 'number' ? `Downloading… ${Math.round(percent)}%` : 'Downloading…';
  }

  if (updateState.status === 'downloaded') {
    return 'Restart required';
  }

  return 'Check for updates';
}

/** Anything the user should notice on the closed trigger, not just inside it. */
function hasUpdateBadge(updateState: AppUpdateSnapshot) {
  return updateState.status === 'available' || updateState.status === 'downloaded';
}

const ARIA_KEY_NAMES: Record<string, string> = {
  '⌘': 'Meta',
  '⌥': 'Alt',
  '⇧': 'Shift',
  '⌃': 'Control',
  cmd: 'Meta',
  command: 'Meta',
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  ' ': 'Space',
};

/**
 * `aria-keyshortcuts` takes tokens (`Meta+Comma`), not the glyph string we
 * paint on screen (`⌘,`). Screen readers announced the raw glyphs before.
 */
export function toAriaKeyshortcuts(label: string | null | undefined) {
  if (!label) {
    return undefined;
  }

  const parts = label.includes('+')
    ? label.split('+').map((part) => part.trim()).filter(Boolean)
    : Array.from(label.trim());

  const tokens = parts.map((part) => {
    const mapped = ARIA_KEY_NAMES[part] ?? ARIA_KEY_NAMES[part.toLowerCase()];
    if (mapped) {
      return mapped;
    }
    return part.length === 1 ? part.toUpperCase() : part;
  });

  return tokens.length > 0 ? tokens.join('+') : undefined;
}

export function SidebarSettingsMenu({
  collapsed,
  settings,
  updateState,
  isRefreshingModels,
  conversationStats,
  loadedMessageCount,
  settingsShortcutLabel,
  onOpenSettings,
  onOpenLanding,
  onRefreshModels,
  onCheckForUpdates,
}: SidebarSettingsMenuProps) {
  const subtitle = getProfileSubtitle(settings);
  const usageLabel = conversationStats
    ? `${conversationStats.storedMessageCount ?? 0} stored`
    : loadedMessageCount > 0
      ? `${loadedMessageCount} loaded`
      : null;
  const showBadge = hasUpdateBadge(updateState);

  /*
    Reporting the outcome of a manual check used to live here *as well as* in
    the store, so one click produced two toasts for the same event — "Atlas is
    up to date." (info, from `checkForUpdates`) stacked on "Atlas is up to
    date" (success, with the version, from this effect). Worse, the two
    disagreed on tone and punctuation, and Settings — which calls the same
    action without going through this menu — only ever showed one of them.

    The store owns it now: it knows the outcome, and every entry point that
    triggers a check gets the same answer.
  */

  const triggerButton = (
    <button
      type="button"
      aria-label={collapsed ? 'Settings and more' : 'More actions'}
      aria-haspopup="menu"
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary',
        collapsed ? 'h-9 w-9' : 'p-1.5'
      )}
    >
      {collapsed ? (
        <GearIcon className="h-4 w-4" aria-hidden="true" />
      ) : (
        <DotsHorizontalIcon className="h-4 w-4" aria-hidden="true" />
      )}
      {showBadge ? (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand"
        />
      ) : null}
    </button>
  );

  return (
    <div className={cn('flex w-full items-center gap-1', collapsed && 'justify-center')}>
      {/*
        Expanded: Settings is a direct one-click destination — it is the
        most-used item and should not need a dropdown hop. Collapsed: there
        is no room for two controls, so the gear *is* the menu trigger.
      */}
      {!collapsed ? (
        <button
          type="button"
          aria-label="Open settings"
          aria-keyshortcuts={toAriaKeyshortcuts(settingsShortcutLabel)}
          onClick={() => onOpenSettings('general')}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <GearIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate text-md font-normal">Settings</span>
        </button>
      ) : null}

      <DropdownMenu>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">
              {showBadge ? 'Settings — update available' : 'Settings'}
            </TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
        )}
        <DropdownMenuContent
          align={collapsed ? 'start' : 'end'}
          side={collapsed ? 'right' : 'top'}
          sideOffset={8}
          className="w-[260px] border border-[var(--border-default)] bg-bg-overlay text-text-primary shadow-elevated"
        >
          <div className="rounded-md bg-bg-elevated px-3 py-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-hover text-text-tertiary">
                <PersonIcon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-normal text-[var(--text-secondary)]">
                  Atlas local profile
                </div>
                <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                  {subtitle}
                </div>
                <div className="mt-0.5 text-2xs text-[var(--text-faint)]">
                  Stored on this device
                </div>
              </div>
            </div>
          </div>

          <DropdownMenuSeparator className="mx-0 my-1 border-[var(--border-default)]" />

          <DropdownMenuLabel className="px-3 pb-1 pt-1.5 text-xs font-normal text-text-faint">
            Quick links
          </DropdownMenuLabel>
          {/* Collapsed has no standalone Settings button, so the menu carries
              one; expanded does, and a duplicate entry is just noise. */}
          {collapsed ? (
            <DropdownMenuItem
              onSelect={() => onOpenSettings('general')}
              className="px-3 text-sm text-[var(--text-secondary)] focus:bg-[var(--bg-hover)] focus:text-text-primary"
            >
              <GearIcon className="h-4 w-4 text-[var(--text-muted)]" />
              <span>Open settings</span>
              {settingsShortcutLabel ? (
                <span className="ml-auto text-3xs tracking-[0.08em] text-[var(--text-faint)]">
                  {settingsShortcutLabel}
                </span>
              ) : null}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() => onOpenSettings('usage')}
            className="px-3 text-sm text-[var(--text-secondary)] focus:bg-[var(--bg-hover)] focus:text-text-primary"
          >
            <TimerIcon className="h-4 w-4 text-[var(--text-muted)]" />
            <span>Usage & limits</span>
            {usageLabel ? (
              <span className="ml-auto text-2xs text-[var(--text-faint)]">{usageLabel}</span>
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onOpenLanding}
            className="px-3 text-sm text-[var(--text-secondary)] focus:bg-[var(--bg-hover)] focus:text-text-primary"
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center font-mono text-2xs text-[var(--text-muted)]">
              {'>_'}
            </span>
            <span>Landing page</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator className="mx-0 my-1 border-[var(--border-default)]" />

          <DropdownMenuLabel className="px-3 pb-1 pt-1.5 text-xs font-normal text-text-faint">
            Actions
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={onRefreshModels}
            className="px-3 text-sm text-[var(--text-secondary)] focus:bg-[var(--bg-hover)] focus:text-text-primary"
          >
            <ReloadIcon
              className={`h-4 w-4 text-[var(--text-muted)] ${isRefreshingModels ? 'animate-spin' : ''}`}
            />
            <span>{isRefreshingModels ? 'Refreshing catalog…' : 'Refresh model catalog'}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              // No "Checking…" toast: the item's own label and spinner already
              // say it, and a toast that is immediately replaced by the result
              // toast is two notifications for one click.
              onCheckForUpdates();
            }}
            className="px-3 text-sm text-[var(--text-secondary)] focus:bg-[var(--bg-hover)] focus:text-text-primary"
          >
            <UpdateIcon
              className={`h-4 w-4 text-[var(--text-muted)] ${
                updateState.status === 'checking' ? 'animate-spin' : ''
              }`}
            />
            <span>{getUpdateLabel(updateState)}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
