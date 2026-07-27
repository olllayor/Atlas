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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

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

  if (updateState.status === 'downloaded') {
    return 'Restart required';
  }

  return 'Check for updates';
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
      : 'Soon';

  return (
    <div className="flex w-full items-center gap-1">
      {/*
        Direct-link Settings button. One click takes the user to the
        settings workspace — no extra dropdown hop for the most-used item.
        The settings shortcut label (Cmd+, etc.) sits to the right of the
        label so the user knows how to invoke it from the keyboard.
      */}
      <button
        type="button"
        aria-label="Open settings"
        aria-keyshortcuts={settingsShortcutLabel ?? undefined}
        onClick={() => onOpenSettings('general')}
        className={`flex min-w-0 flex-1 items-center rounded-md px-2 py-1.5 text-sm text-text-tertiary transition hover:bg-[var(--bg-subtle)] hover:text-text-primary ${
          collapsed ? 'justify-center' : 'gap-2'
        }`}
      >
        <GearIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {!collapsed ? (
          <span className="truncate text-[13px] font-medium">Settings</span>
        ) : null}
      </button>

      {/* Overflow menu: refresh catalog, check updates, landing page, usage. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            aria-haspopup="menu"
            className={`flex shrink-0 items-center justify-center rounded-md p-1.5 text-text-faint transition hover:bg-[var(--bg-subtle)] hover:text-text-secondary ${
              collapsed ? '' : ''
            }`}
          >
            <DotsHorizontalIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-[260px] border border-[var(--border-default)] bg-bg-overlay text-white shadow-elevated"
        >
          <div className="border border-[var(--border-default)] bg-bg-elevated px-3 py-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border border-[var(--border-default)] bg-[var(--bg-hover)] text-[var(--text-tertiary)]">
                <PersonIcon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-normal text-[var(--text-secondary)]">
                  Atlas local profile
                </div>
                <div className="mt-0.5 truncate text-[12px] text-[var(--text-muted)]">
                  {subtitle}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--text-faint)]">
                  Stored on this device
                </div>
              </div>
            </div>
          </div>

          <DropdownMenuSeparator className="mx-0 my-1 border-[var(--border-default)]" />

          <DropdownMenuLabel className="px-3 pb-1 pt-1.5 text-[10px] font-normal uppercase tracking-[0.16em] text-text-faint">
            Quick links
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => onOpenSettings('general')}
            className="px-3 text-[13px] text-[var(--text-secondary)] focus:bg-[var(--bg-hover)] focus:text-white"
          >
            <GearIcon className="h-4 w-4 text-[var(--text-muted)]" />
            <span>Open settings</span>
            {settingsShortcutLabel ? (
              <span className="ml-auto text-[10px] tracking-[0.08em] text-[var(--text-faint)]">
                {settingsShortcutLabel}
              </span>
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => onOpenSettings('usage')}
            className="px-3 text-[13px] text-[var(--text-secondary)] focus:bg-[var(--bg-hover)] focus:text-white"
          >
            <TimerIcon className="h-4 w-4 text-[var(--text-muted)]" />
            <span>Usage & limits</span>
            <span className="ml-auto text-[11px] text-[var(--text-faint)]">{usageLabel}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onOpenLanding}
            className="px-3 text-[13px] text-[var(--text-secondary)] focus:bg-[var(--bg-hover)] focus:text-white"
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center font-mono text-[11px] text-[var(--text-muted)]">
              {'>_'}
            </span>
            <span>Landing page</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator className="mx-0 my-1 border-[var(--border-default)]" />

          <DropdownMenuLabel className="px-3 pb-1 pt-1.5 text-[10px] font-normal uppercase tracking-[0.16em] text-text-faint">
            Actions
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={onRefreshModels}
            className="px-3 text-[13px] text-[var(--text-secondary)] focus:bg-[var(--bg-hover)] focus:text-white"
          >
            <ReloadIcon
              className={`h-4 w-4 text-[var(--text-muted)] ${isRefreshingModels ? 'animate-spin' : ''}`}
            />
            <span>{isRefreshingModels ? 'Refreshing catalog…' : 'Refresh model catalog'}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onCheckForUpdates}
            className="px-3 text-[13px] text-[var(--text-secondary)] focus:bg-[var(--bg-hover)] focus:text-white"
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
