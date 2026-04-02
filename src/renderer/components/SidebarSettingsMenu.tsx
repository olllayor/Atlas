import {
  ChevronRightIcon,
  DotFilledIcon,
  GearIcon,
  PersonIcon,
  ReloadIcon,
  TimerIcon,
  UpdateIcon,
} from '@radix-ui/react-icons';

import type { AppUpdateSnapshot, ConversationStats, SettingsSection, SettingsSummary } from '../../shared/contracts';
import { PROVIDER_METADATA } from '../../shared/providerMetadata';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  onOpenSettings: (section?: SettingsSection) => void;
  onRefreshModels: () => void;
  onCheckForUpdates: () => void;
};

function getProfileSubtitle(settings: SettingsSummary | null) {
  const configuredProvider = settings?.providers.find((provider) => provider.hasSecret);

  if (!configuredProvider?.hasSecret) {
    return 'No API key configured';
  }

  const metadata = PROVIDER_METADATA[configuredProvider.providerId];

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
  onOpenSettings,
  onRefreshModels,
  onCheckForUpdates,
}: SidebarSettingsMenuProps) {
  const subtitle = getProfileSubtitle(settings);
  const usageLabel = conversationStats
    ? `${conversationStats.storedMessageCount} stored`
    : loadedMessageCount > 0
      ? `${loadedMessageCount} loaded`
      : 'Soon';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`flex w-full items-center rounded-xl px-2.5 py-2 text-sm text-text-tertiary outline-none transition hover:bg-white/[0.035] hover:text-text-primary focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 ${
            collapsed ? 'justify-center' : 'gap-2'
          }`}
        >
          <GearIcon className="h-4 w-4 shrink-0" />
          {!collapsed ? <span className="truncate text-[13px] font-medium">Settings</span> : null}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={collapsed ? 'center' : 'start'}
        side="top"
        sideOffset={10}
        className="w-[276px] rounded-2xl border border-white/10 bg-[#3a3f47]/96 p-2 text-white shadow-[0_22px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      >
        <div className="rounded-[14px] bg-white/[0.045] px-3 py-3.5">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-white/70">
              <PersonIcon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-white/92">Atlas local profile</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-white/52">
                <DotFilledIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{subtitle}</span>
              </div>
              <div className="mt-1 text-[12px] text-white/40">Stored on this device</div>
            </div>
          </div>
        </div>

        <DropdownMenuSeparator className="mx-0 my-2 bg-white/8" />

        <DropdownMenuItem
          onSelect={() => onOpenSettings('general')}
          className="h-10 rounded-xl px-3 text-[13px] text-white/82 focus:bg-white/[0.06] focus:text-white"
        >
          <GearIcon className="h-4 w-4 text-white/46" />
          <span>Settings</span>
          <ChevronRightIcon className="ml-auto h-4 w-4 text-white/30" />
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={() => onOpenSettings('usage')}
          className="h-10 rounded-xl px-3 text-[13px] text-white/82 focus:bg-white/[0.06] focus:text-white"
        >
          <TimerIcon className="h-4 w-4 text-white/46" />
          <span>Usage & limits</span>
          <span className="ml-auto text-[11px] text-white/32">{usageLabel}</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={onRefreshModels}
          className="h-10 rounded-xl px-3 text-[13px] text-white/82 focus:bg-white/[0.06] focus:text-white"
        >
          <ReloadIcon className={`h-4 w-4 text-white/46 ${isRefreshingModels ? 'animate-spin' : ''}`} />
          <span>{isRefreshingModels ? 'Refreshing catalog…' : 'Refresh model catalog'}</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={onCheckForUpdates}
          className="h-10 rounded-xl px-3 text-[13px] text-white/82 focus:bg-white/[0.06] focus:text-white"
        >
          <UpdateIcon className={`h-4 w-4 text-white/46 ${updateState.status === 'checking' ? 'animate-spin' : ''}`} />
          <span>{getUpdateLabel(updateState)}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
