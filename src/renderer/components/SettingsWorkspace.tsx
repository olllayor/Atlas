import {
  ArrowLeftIcon,
  ChevronRightIcon,
  DesktopIcon,
  GearIcon,
  MoonIcon,
  ReloadIcon,
  SunIcon,
  TimerIcon,
  UpdateIcon,
} from '@radix-ui/react-icons';
import type { CSSProperties, PropsWithChildren } from 'react';
import { costFromUsage } from 'tokenlens';

import type {
  AppUpdateSnapshot,
  ConversationPage,
  ConversationStats,
  DiagnosticsSnapshot,
  ProviderId,
  SettingsSection,
  SettingsSummary,
  ThemeMode,
  UsageProviderSummary,
  UsageSummary,
} from '../../shared/contracts';
import { PROVIDER_METADATA } from '../../shared/providerMetadata';

type SettingsWorkspaceProps = {
  settings: SettingsSummary | null;
  updateState: AppUpdateSnapshot;
  usageSummary: UsageSummary;
  notice: { tone: 'error' | 'success' | 'info'; message: string } | null;
  activeCredentialProviderId: ProviderId;
  keyDraft: string;
  isSaving: boolean;
  isValidating: boolean;
  isRefreshingModels: boolean;
  activeSection: SettingsSection;
  onBack: () => void;
  onNavigate: (section: SettingsSection) => void;
  onDismissNotice: () => void;
  onSelectProvider: (providerId: ProviderId) => void;
  onKeyDraftChange: (value: string) => void;
  onSaveKey: () => void;
  onValidateKey: () => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  onToggleFreeModels: (value: boolean) => void;
  onUpdateAction: () => void;
  onRefreshModels: () => void;
};

type NavItem = {
  key: SettingsSection;
  label: string;
  icon: typeof GearIcon;
};

type FutureNavItem = {
  label: string;
  icon: typeof GearIcon;
};

const activeNavItems: NavItem[] = [
  { key: 'general', label: 'General', icon: GearIcon },
  { key: 'appearance', label: 'Appearance', icon: DesktopIcon },
  { key: 'usage', label: 'Usage', icon: TimerIcon },
];

const futureNavItems: FutureNavItem[] = [
  { label: 'Configuration', icon: ChevronRightIcon },
  { label: 'Personalization', icon: ChevronRightIcon },
  { label: 'MCP servers', icon: ChevronRightIcon },
  { label: 'Git', icon: ChevronRightIcon },
  { label: 'Environments', icon: ChevronRightIcon },
  { label: 'Worktrees', icon: ChevronRightIcon },
  { label: 'Archived threads', icon: ChevronRightIcon },
];

export function SettingsWorkspace({
  settings,
  updateState,
  usageSummary,
  notice,
  activeCredentialProviderId,
  keyDraft,
  isSaving,
  isValidating,
  isRefreshingModels,
  activeSection,
  onBack,
  onNavigate,
  onDismissNotice,
  onSelectProvider,
  onKeyDraftChange,
  onSaveKey,
  onValidateKey,
  onThemeModeChange,
  onToggleFreeModels,
  onUpdateAction,
  onRefreshModels,
}: SettingsWorkspaceProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg-base text-text-primary">
      <aside className="relative flex w-[292px] shrink-0 flex-col border-r border-border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0)_15%),var(--bg-panel)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_34%)]" />
        <div
          className="relative h-[52px] shrink-0 border-b border-border-subtle"
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        />

        <div className="relative min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left text-[13px] font-medium text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary"
          >
            <ArrowLeftIcon className="h-4 w-4 shrink-0" />
            <span>Back to app</span>
          </button>

          <nav className="mt-5 space-y-1">
            {activeNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.key;

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onNavigate(item.key)}
                  className={`flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[13px] transition ${
                    isActive
                      ? 'bg-[linear-gradient(180deg,rgba(255,255,255,0.075),rgba(255,255,255,0.04))] font-medium text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
                      : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-6 border-t border-border-subtle pt-4">
            <div className="mb-2 px-3 text-[10px] font-medium uppercase tracking-[0.16em] text-text-faint">
              Soon
            </div>
            <div className="space-y-1">
              {futureNavItems.map((item) => {
                const Icon = item.icon;

                return (
                  <div
                    key={item.label}
                    className="flex h-9 items-center gap-2.5 rounded-xl px-3 text-[13px] text-text-faint/75"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 bg-[radial-gradient(circle_at_top,rgba(110,125,193,0.12),transparent_22%),linear-gradient(180deg,var(--bg-surface),var(--bg-base))]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.02),transparent_20%,transparent_80%,rgba(255,255,255,0.02))]" />
        <div
          className="relative h-[52px] shrink-0 border-b border-border-subtle"
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        />

        {notice ? (
          <div
            className={`relative flex items-center justify-between border-b px-4 py-2 text-sm ${
              notice.tone === 'error'
                ? 'border-error-border bg-error-bg text-error-text'
                : notice.tone === 'success'
                  ? 'border-success-border bg-success-bg text-success-text'
                  : 'border-warning-border bg-warning-bg text-warning-text'
            }`}
          >
            <span>{notice.message}</span>
            <button onClick={onDismissNotice} className="ml-3 text-current opacity-70 transition hover:opacity-100">
              ✕
            </button>
          </div>
        ) : null}

        <div className="relative h-[calc(100vh-52px)] overflow-y-auto">
          <div className="mx-auto w-full max-w-[760px] px-10 pb-16 pt-8">
            <h1 className="text-[20px] font-semibold tracking-[-0.025em] text-text-primary">
              {sectionTitle(activeSection)}
            </h1>

            <div className="mt-8 space-y-8">
              {activeSection === 'general' ? (
                <GeneralPage
                  settings={settings}
                  updateState={updateState}
                  activeCredentialProviderId={activeCredentialProviderId}
                  keyDraft={keyDraft}
                  isSaving={isSaving}
                  isValidating={isValidating}
                  isRefreshingModels={isRefreshingModels}
                  onSelectProvider={onSelectProvider}
                  onKeyDraftChange={onKeyDraftChange}
                  onSaveKey={onSaveKey}
                  onValidateKey={onValidateKey}
                  onToggleFreeModels={onToggleFreeModels}
                  onUpdateAction={onUpdateAction}
                  onRefreshModels={onRefreshModels}
                />
              ) : null}

              {activeSection === 'appearance' ? (
                <AppearancePage settings={settings} onThemeModeChange={onThemeModeChange} />
              ) : null}

              {activeSection === 'usage' ? <UsagePage usageSummary={usageSummary} /> : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function sectionTitle(section: SettingsSection) {
  if (section === 'appearance') {
    return 'Appearance';
  }

  if (section === 'usage') {
    return 'Usage';
  }

  return 'General';
}

function GeneralPage({
  settings,
  updateState,
  activeCredentialProviderId,
  keyDraft,
  isSaving,
  isValidating,
  isRefreshingModels,
  onSelectProvider,
  onKeyDraftChange,
  onSaveKey,
  onValidateKey,
  onToggleFreeModels,
  onUpdateAction,
  onRefreshModels,
}: {
  settings: SettingsSummary | null;
  updateState: AppUpdateSnapshot;
  activeCredentialProviderId: ProviderId;
  keyDraft: string;
  isSaving: boolean;
  isValidating: boolean;
  isRefreshingModels: boolean;
  onSelectProvider: (providerId: ProviderId) => void;
  onKeyDraftChange: (value: string) => void;
  onSaveKey: () => void;
  onValidateKey: () => void;
  onToggleFreeModels: (value: boolean) => void;
  onUpdateAction: () => void;
  onRefreshModels: () => void;
}) {
  const provider = settings?.providers.find((entry) => entry.providerId === activeCredentialProviderId) ?? null;
  const metadata = PROVIDER_METADATA[activeCredentialProviderId];
  const savedStateLabel = provider?.hasSecret ? 'Saved' : 'Missing';
  const lastSyncedLabel = formatTimestamp(settings?.modelCatalogLastSyncedAt);
  const updateLabel = getUpdateLabel(updateState);

  return (
    <>
      <SettingsGroup title="Provider access">
        <SettingsStackedRow
          title={metadata.keyLabel}
          description="Stored in your macOS keychain. Paste a new key to replace the current one."
        >
          <ProviderPicker current={activeCredentialProviderId} onChange={onSelectProvider} />

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusPill tone={provider?.hasSecret ? 'success' : 'muted'}>{savedStateLabel}</StatusPill>
            <StatusPill
              tone={
                provider?.status === 'valid'
                  ? 'success'
                  : provider?.status === 'invalid'
                    ? 'warning'
                    : 'muted'
              }
            >
              {provider?.status ?? 'unknown'}
            </StatusPill>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={keyDraft}
              onChange={(event) => onKeyDraftChange(event.target.value)}
              placeholder={
                provider?.hasSecret
                  ? 'A key is already saved. Paste to replace it.'
                  : metadata.keyPlaceholder
              }
              className="h-10 min-w-0 flex-1 rounded-xl border border-border-default bg-bg-subtle px-3 text-[13px] text-text-primary outline-none placeholder:text-text-muted focus:border-border-strong"
            />
            <div className="flex gap-2">
              <ActionButton onClick={onSaveKey} disabled={isSaving} variant="primary">
                {isSaving ? 'Saving…' : 'Save'}
              </ActionButton>
              <ActionButton onClick={onValidateKey} disabled={isValidating}>
                {isValidating ? 'Validating…' : 'Validate'}
              </ActionButton>
            </div>
          </div>

          <div className="mt-3 text-[12px] text-text-tertiary">
            Get one at{' '}
            <a
              href={metadata.keyLink}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-text-primary"
            >
              {metadata.keyLinkLabel}
            </a>
          </div>
        </SettingsStackedRow>

        <SettingsRow
          title="Free models by default"
          description="Use the free-only filter whenever the model catalog is loaded."
        >
          <Switch
            checked={settings?.showFreeOnlyByDefault ?? true}
            onCheckedChange={onToggleFreeModels}
            ariaLabel="Toggle free models by default"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Catalog and updates">
        <SettingsRow
          title="Model catalog"
          description={`Last synced ${lastSyncedLabel}. ${settings?.modelCatalogCount ?? 0} models cached locally.`}
        >
          <ActionButton onClick={onRefreshModels} disabled={isRefreshingModels}>
            <ReloadIcon className={`h-3.5 w-3.5 ${isRefreshingModels ? 'animate-spin' : ''}`} />
            <span>{isRefreshingModels ? 'Refreshing…' : 'Refresh'}</span>
          </ActionButton>
        </SettingsRow>

        <SettingsRow title="App updates" description={updateDescription(updateState)}>
          <ActionButton onClick={onUpdateAction} disabled={updateState.status === 'checking'}>
            <UpdateIcon className={`h-3.5 w-3.5 ${updateState.status === 'checking' ? 'animate-spin' : ''}`} />
            <span>{updateLabel}</span>
          </ActionButton>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Coming soon">
        <DisabledRow
          title="Language"
          description="Atlas will expose app language and localization settings in a later pass."
        />
        <DisabledRow
          title="Notifications"
          description="Completion and permission notification preferences will live here."
        />
      </SettingsGroup>
    </>
  );
}

function AppearancePage({
  settings,
  onThemeModeChange,
}: {
  settings: SettingsSummary | null;
  onThemeModeChange: (mode: ThemeMode) => void;
}) {
  const themeMode = settings?.appearance.themeMode ?? 'dark';

  return (
    <>
      <SettingsGroup title="Theme">
        <SettingsStackedRow
          title="Theme mode"
          description="Choose whether Atlas follows your system appearance or stays fixed."
        >
          <ThemeModePicker current={themeMode} onChange={onThemeModeChange} />
        </SettingsStackedRow>
      </SettingsGroup>

      <SettingsGroup title="Coming soon">
        <DisabledRow
          title="Accent controls"
          description="Accent color and contrast tuning will be added after the base theme system settles."
        />
        <DisabledRow
          title="Typography"
          description="UI and code font controls will land here when broader appearance settings ship."
        />
      </SettingsGroup>
    </>
  );
}

function UsagePage({ usageSummary }: { usageSummary: UsageSummary }) {
  return (
    <>
      <SettingsGroup title="Provider usage">
        {usageSummary.providers.map((provider) => (
          <SettingsStackedRow
            key={provider.providerId}
            title={provider.label}
            description={provider.secondary}
          >
            <div className="flex items-center justify-between gap-3">
              <StatusPill tone={toneForMetricState(provider.state)}>{provider.primary}</StatusPill>
              {provider.meterValue != null ? <span className="text-[12px] text-text-tertiary">{provider.meterLabel}</span> : null}
            </div>
            {provider.meterValue != null ? (
              <div className="mt-3 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-subtle">
                  <div className="h-full rounded-full bg-text-secondary/80" style={{ width: `${provider.meterValue}%` }} />
                </div>
                <span className="w-12 text-right text-[12px] text-text-tertiary">{provider.meterLabel}</span>
              </div>
            ) : null}
          </SettingsStackedRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Local cache">
        <SettingsRow
          title="Loaded token usage"
          description={`${formatCompactNumber(usageSummary.local.inputTokens)} input, ${formatCompactNumber(usageSummary.local.outputTokens)} output, ${formatCompactNumber(usageSummary.local.reasoningTokens)} reasoning`}
        >
          <ValueBadge>{formatCompactNumber(usageSummary.local.totalTokens)} tokens</ValueBadge>
        </SettingsRow>

        <SettingsRow
          title="Estimated local cost"
          description="Computed from loaded conversations when model pricing data is available."
        >
          <ValueBadge>{usageSummary.local.estimatedCostUsd == null ? 'Unavailable' : formatUsd(usageSummary.local.estimatedCostUsd)}</ValueBadge>
        </SettingsRow>

        <SettingsRow
          title="Loaded conversations"
          description={`${usageSummary.local.loadedMessageCount} messages currently in memory`}
        >
          <ValueBadge>{usageSummary.local.loadedConversationCount}</ValueBadge>
        </SettingsRow>

        <SettingsRow
          title="Stored history"
          description={`${formatCompactNumber(usageSummary.local.storedMessageCount)} messages persisted across ${formatCompactNumber(usageSummary.local.storedConversationCount)} conversations`}
        >
          <ValueBadge>{formatCompactNumber(usageSummary.local.storedConversationCount)}</ValueBadge>
        </SettingsRow>

        <SettingsRow
          title="Database size"
          description="SQLite conversation store on disk."
        >
          <ValueBadge>{formatBytes(usageSummary.local.databaseSizeBytes)}</ValueBadge>
        </SettingsRow>

        <SettingsRow
          title="Renderer heap"
          description="Current JS heap used by the renderer process."
        >
          <ValueBadge>{usageSummary.local.rendererHeapBytes == null ? 'Unavailable' : formatBytes(usageSummary.local.rendererHeapBytes)}</ValueBadge>
        </SettingsRow>

        <SettingsRow
          title="Main-process RSS"
          description="Resident memory used by the Electron main process."
        >
          <ValueBadge>{usageSummary.local.mainProcessRssBytes == null ? 'Unavailable' : formatBytes(usageSummary.local.mainProcessRssBytes)}</ValueBadge>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function SettingsGroup({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <section>
      <div className="mb-3 text-[13px] font-medium text-text-secondary">{title}</div>
      <div className="overflow-hidden rounded-[18px] border border-border-default bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))]">
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description: string }>) {
  return (
    <div className="flex items-start justify-between gap-5 border-t border-border-subtle px-4 py-4 first:border-t-0">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-text-primary">{title}</div>
        <div className="mt-1 text-[12.5px] leading-5 text-text-tertiary">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingsStackedRow({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description: string }>) {
  return (
    <div className="border-t border-border-subtle px-4 py-4 first:border-t-0">
      <div className="text-[14px] font-medium text-text-primary">{title}</div>
      <div className="mt-1 text-[12.5px] leading-5 text-text-tertiary">{description}</div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function DisabledRow({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border-subtle px-4 py-4 first:border-t-0">
      <div className="min-w-0 opacity-70">
        <div className="text-[14px] font-medium text-text-secondary">{title}</div>
        <div className="mt-1 text-[12.5px] leading-5 text-text-muted">{description}</div>
      </div>
      <StatusPill tone="muted">Soon</StatusPill>
    </div>
  );
}

function ThemeModePicker({ current, onChange }: { current: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  const items: Array<{ mode: ThemeMode; label: string; icon: typeof SunIcon }> = [
    { mode: 'light', label: 'Light', icon: SunIcon },
    { mode: 'dark', label: 'Dark', icon: MoonIcon },
    { mode: 'system', label: 'System', icon: DesktopIcon },
  ];

  return (
    <div className="inline-flex rounded-[14px] border border-border-default bg-bg-subtle p-1">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.mode === current;

        return (
          <button
            key={item.mode}
            type="button"
            onClick={() => onChange(item.mode)}
            className={`inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium transition ${
              isActive
                ? 'bg-bg-elevated text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProviderPicker({
  current,
  onChange,
}: {
  current: ProviderId;
  onChange: (providerId: ProviderId) => void;
}) {
  const items: ProviderId[] = ['openrouter', 'glm'];

  return (
    <div className="mb-4 inline-flex rounded-[14px] border border-border-default bg-bg-subtle p-1">
      {items.map((providerId) => {
        const isActive = providerId === current;

        return (
          <button
            key={providerId}
            type="button"
            onClick={() => onChange(providerId)}
            className={`inline-flex h-9 items-center rounded-[10px] px-3 text-[13px] font-medium transition ${
              isActive
                ? 'bg-bg-elevated text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
          >
            {PROVIDER_METADATA[providerId].label}
          </button>
        );
      })}
    </div>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
  variant = 'secondary',
}: PropsWithChildren<{
  disabled?: boolean;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[12.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
        variant === 'primary'
          ? 'bg-bg-button text-text-inverse hover:bg-bg-button-hover'
          : 'border border-border-default bg-bg-subtle text-text-primary hover:bg-bg-hover'
      }`}
    >
      {children}
    </button>
  );
}

function Switch({
  checked,
  onCheckedChange,
  ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange(!checked)}
      className={`relative inline-flex h-7 w-11 items-center rounded-full transition ${
        checked ? 'bg-text-secondary/85' : 'bg-bg-subtle'
      }`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-white shadow-sm transition ${checked ? 'translate-x-[22px]' : 'translate-x-[4px]'}`}
      />
    </button>
  );
}

function StatusPill({
  children,
  tone = 'muted',
}: PropsWithChildren<{ tone?: 'success' | 'warning' | 'muted' }>) {
  const toneClass =
    tone === 'success'
      ? 'border-success-border bg-success-bg text-success-text'
      : tone === 'warning'
        ? 'border-warning-border bg-warning-bg text-warning-text'
        : 'border-border-default bg-bg-subtle text-text-tertiary';

  return (
    <span className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

function ValueBadge({ children }: PropsWithChildren) {
  return (
    <span className="inline-flex h-8 min-w-[84px] items-center justify-center rounded-xl border border-border-default bg-bg-subtle px-3 text-[12.5px] font-medium text-text-primary">
      {children}
    </span>
  );
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function formatUsd(value?: number | null) {
  if (value == null) {
    return null;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 0.01 ? 4 : 3,
  }).format(value);
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let normalized = value;
  let unitIndex = -1;

  do {
    normalized /= 1024;
    unitIndex += 1;
  } while (normalized >= 1024 && unitIndex < units.length - 1);

  return `${normalized.toFixed(normalized >= 100 ? 0 : normalized >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return 'never';
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function updateDescription(updateState: AppUpdateSnapshot) {
  if (updateState.status === 'available') {
    return `Version ${updateState.latestVersion} is available.`;
  }

  if (updateState.status === 'downloaded') {
    return 'An update has finished downloading and is ready to install.';
  }

  if (updateState.status === 'checking') {
    return 'Checking GitHub Releases for a newer macOS build.';
  }

  if (updateState.status === 'error') {
    return updateState.message;
  }

  if (updateState.status === 'not-available') {
    return `Atlas is up to date as of ${formatTimestamp(updateState.checkedAt)}.`;
  }

  return 'Check GitHub Releases for the latest macOS build.';
}

function getUpdateLabel(updateState: AppUpdateSnapshot) {
  if (updateState.status === 'checking') {
    return 'Checking…';
  }

  if (updateState.status === 'available') {
    return 'Download update';
  }

  if (updateState.status === 'downloaded') {
    return 'Restart to install';
  }

  return 'Check now';
}

function toneForMetricState(state: UsageProviderSummary['state']): 'success' | 'warning' | 'muted' {
  if (state === 'available') {
    return 'success';
  }

  if (state === 'loading') {
    return 'warning';
  }

  return 'muted';
}

export function buildUsageSummary({
  settings,
  conversationPages,
  conversationStats,
  diagnostics,
  rendererHeapBytes,
}: {
  settings: SettingsSummary | null;
  conversationPages: Record<string, ConversationPage>;
  conversationStats: ConversationStats | null;
  diagnostics: DiagnosticsSnapshot | null;
  rendererHeapBytes: number | null;
}): UsageSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let totalCost = 0;
  let hasCost = false;

  for (const page of Object.values(conversationPages)) {
    for (const message of page.messages) {
      inputTokens += message.inputTokens ?? 0;
      outputTokens += message.outputTokens ?? 0;
      reasoningTokens += message.reasoningTokens ?? 0;

      const estimatedCost = estimateMessageCost(message.modelId, {
        inputTokens: message.inputTokens ?? undefined,
        outputTokens: message.outputTokens ?? undefined,
        reasoningTokens: message.reasoningTokens ?? undefined,
      });

      if (estimatedCost != null) {
        totalCost += estimatedCost;
        hasCost = true;
      }
    }
  }

  const openRouter = buildProviderUsageSummary('openrouter', settings);
  const glm = buildProviderUsageSummary('glm', settings);

  return {
    local: {
      totalTokens: inputTokens + outputTokens + reasoningTokens,
      inputTokens,
      outputTokens,
      reasoningTokens,
      estimatedCostUsd: hasCost ? totalCost : null,
      storedConversationCount: conversationStats?.storedConversationCount ?? 0,
      storedMessageCount: conversationStats?.storedMessageCount ?? 0,
      databaseSizeBytes: conversationStats?.databaseSizeBytes ?? diagnostics?.databaseSizeBytes ?? 0,
      loadedConversationCount: Object.keys(conversationPages).length,
      loadedMessageCount: Object.values(conversationPages).reduce((total, page) => total + page.messages.length, 0),
      rendererHeapBytes,
      mainProcessRssBytes: diagnostics?.mainProcess.rssBytes ?? null,
    },
    providers: [openRouter, glm],
  };
}

function buildProviderUsageSummary(providerId: ProviderId, settings: SettingsSummary | null): UsageProviderSummary {
  const provider = settings?.providers.find((entry) => entry.providerId === providerId) ?? null;
  const label = `${PROVIDER_METADATA[providerId].label} usage`;

  if (!provider?.hasSecret) {
    return {
      providerId,
      label,
      state: 'not_connected',
      primary: 'Not connected',
      secondary: `Add a ${PROVIDER_METADATA[providerId].label} key before provider telemetry can appear here.`,
    };
  }

  return {
    providerId,
    label,
    state: 'unavailable',
    primary: 'Pending provider telemetry',
    secondary: `The layout is ready for ${PROVIDER_METADATA[providerId].label} telemetry once provider metrics are wired in.`,
  };
}

function estimateMessageCost(
  modelId: string | null,
  usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number }
) {
  if (!modelId) {
    return undefined;
  }

  try {
    return costFromUsage({
      id: modelId,
      usage,
    });
  } catch {
    return undefined;
  }
}
