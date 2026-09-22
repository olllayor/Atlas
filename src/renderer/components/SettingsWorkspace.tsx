import {
  BoxIcon,
  GearIcon,
  KeyboardIcon,
  LockClosedIcon,
  PersonIcon,
  ReloadIcon,
  RocketIcon,
  SunIcon,
  TimerIcon,
  UpdateIcon,
} from '@radix-ui/react-icons';
import { AlertCircle, Check, Search, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PropsWithChildren,
} from 'react';
import { costFromUsage } from 'tokenlens';

import type {
  AppUpdateSnapshot,
  BorderRadiusMode,
  ConversationPage,
  ConversationStats,
  DesignTheme,
  DiagnosticsSnapshot,
  FontFamilyOverride,
  KeybindingCommand,
  KeybindingRule,
  ProviderId,
  ReasoningEffort,
  ReduceMotionMode,
  SettingsSection,
  SettingsSummary,
  ThemeMode,
  ToolPermissionMode,
  UsageProviderSummary,
  UsageSummary,
  VisualMode,
  WorkspaceMode,
} from '../../shared/contracts';
import {
  DEFAULT_PANEL_ANIMATION_DURATION_MS,
  DEFAULT_SETTINGS_APPEARANCE,
  MAX_PANEL_ANIMATION_DURATION_MS,
  MIN_PANEL_ANIMATION_DURATION_MS,
} from '../../shared/contracts';
import { notify } from '../lib/notify';
import { isMacPlatform } from '../lib/platform';
import { cn } from '../lib/utils';
import { useIsFullScreen } from '../hooks/useIsFullScreen';
import { RailBackButton } from './railPrimitives';
import { getDefaultKeybindingRules, upsertKeybindingRule } from '../../shared/keybindings';
import type { KeybindingShortcut } from '../../shared/keybindings';
import { resolveProviderMetadata } from '../../shared/providerMetadata';
import { APP_COMMAND_DEFINITIONS, APP_COMMANDS_BY_ID } from '../lib/keybindingCommands';
import { ModelSettingsPage } from './providers/ModelSettingsPage';
import { PluginsSettingsPage } from './plugins/PluginsSettingsPage';
import { ConfirmDialog } from './providers/ConfirmDialog';
import { SlotLabel } from './ui/slot-label';
import { PanelAnimationsPreview } from './settings/PanelAnimationsPreview';
import { SettingsTypographySection } from './settings/SettingsTypographySection';
import { ThemeAppearanceSection } from './settings/ThemeAppearanceSection';
import { Switch } from './ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { ShortcutPlatform } from '../lib/keybindings';
import {
  createShortcutFromKeyboardEvent,
  formatShortcutLabel,
  resolveKeybindingConflicts,
} from '../lib/keybindings';

type AppearancePatch = NonNullable<import('../../shared/contracts').SettingsUpdateRequest['appearance']>;

export type SettingsWorkspaceProps = {
  settings: SettingsSummary | null;
  updateState: AppUpdateSnapshot;
  usageSummary: UsageSummary;
  isRefreshingModels: boolean;
  telemetryEnabled?: boolean;
  activeSection?: SettingsSection;
  shortcutPlatform?: ShortcutPlatform;
  onBack: () => void;
  onNavigate: (section: SettingsSection) => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  onDesignThemeChange: (theme: DesignTheme) => void;
  onBorderRadiusChange: (mode: BorderRadiusMode) => void;
  onUiFontSizeChange: (value: number) => void;
  onCodeFontSizeChange: (value: number) => void;
  onUiFontFamilyChange: (value: FontFamilyOverride) => void;
  onCodeFontFamilyChange: (value: FontFamilyOverride) => void;
  onAppearancePatch: (patch: AppearancePatch) => void;
  onTelemetryChange: (enabled: boolean) => void;
  onToggleFreeModels: (enabled: boolean) => void;
  onVisualModeChange: (mode: VisualMode) => void;
  onToggleSkillsInSlashMenu: (enabled: boolean) => void;
  onUpdatePreferences?: (patch: import('../../shared/contracts').SettingsUpdateRequest) => Promise<void>;
  onUpdateKeybindings?: (rules: KeybindingRule[]) => void;
  onUpdateAction: () => void;
  onRefreshModels: () => void;
};

type NavItem = {
  key: SettingsSection;
  label: string;
  icon: typeof GearIcon;
};

const BASE_NAV_ITEMS: readonly NavItem[] = [
  { key: 'general', label: 'General', icon: GearIcon },
  { key: 'providers', label: 'Providers', icon: PersonIcon },
  { key: 'appearance', label: 'Appearance', icon: SunIcon },
  { key: 'keyboard', label: 'Keyboard', icon: KeyboardIcon },
  { key: 'usage', label: 'Usage', icon: TimerIcon },
  { key: 'privacy', label: 'Privacy', icon: LockClosedIcon },
  { key: 'beta', label: 'Beta', icon: RocketIcon },
];

const PLUGINS_NAV_ITEM: NavItem = { key: 'plugins', label: 'Plugins', icon: BoxIcon };

function navItemsFor(pluginsBetaEnabled: boolean): readonly NavItem[] {
  if (!pluginsBetaEnabled) {
    return BASE_NAV_ITEMS;
  }
  const next = [...BASE_NAV_ITEMS];
  next.splice(2, 0, PLUGINS_NAV_ITEM);
  return next;
}

export function SettingsWorkspace({
  settings,
  updateState,
  usageSummary,
  isRefreshingModels,
  telemetryEnabled = false,
  activeSection = 'general',
  shortcutPlatform = 'mac',
  onBack,
  onNavigate,
  onThemeModeChange,
  onDesignThemeChange,
  onBorderRadiusChange,
  onAppearancePatch,
  onTelemetryChange,
  onToggleFreeModels,
  onVisualModeChange,
  onToggleSkillsInSlashMenu,
  onUpdatePreferences,
  onUpdateKeybindings,
  onUpdateAction,
  onRefreshModels,
}: SettingsWorkspaceProps) {
  const isFullScreen = useIsFullScreen();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pluginsBetaEnabled = settings?.pluginsBetaEnabled ?? false;
  const navItems = useMemo(() => navItemsFor(pluginsBetaEnabled), [pluginsBetaEnabled]);

  // If currently on plugins and the user disables plugins beta, redirect to general
  useEffect(() => {
    if (activeSection === 'plugins' && !pluginsBetaEnabled) {
      onNavigate('general');
    }
  }, [activeSection, pluginsBetaEnabled, onNavigate]);

  // Reset scroll position to top whenever changing sections
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [activeSection]);

  // Allow Escape key to return to chat when focus is not in an input or dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const activeEl = document.activeElement;
        const isInteractive =
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.getAttribute('role') === 'dialog' ||
            activeEl.closest('[role="dialog"]'));
        if (!isInteractive) {
          e.preventDefault();
          onBack();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  const titlebarHeightClass = isFullScreen ? 'h-titlebar-height-fullscreen' : 'h-titlebar-height';

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-base text-text-primary">
      <aside className="sidebar-surface relative flex w-sidebar-width shrink-0 flex-col border-r border-border-subtle">
        <div
          className={cn('relative shrink-0', titlebarHeightClass)}
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        />
        <div className="scroll-container relative min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <RailBackButton label="Back to app" onClick={onBack} />

          <nav aria-label="Settings sections" className="mt-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.key === activeSection;

              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => onNavigate(item.key)}
                  className={cn(
                    'flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm font-normal transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer',
                    isActive
                      ? 'bg-bg-active text-text-primary font-medium'
                      : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div
          className={cn('relative shrink-0', titlebarHeightClass)}
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        />
        <div
          ref={scrollContainerRef}
          className={cn(
            'relative overflow-y-auto scroll-container',
            isFullScreen
              ? 'h-[calc(100vh-var(--titlebar-height-fullscreen))]'
              : 'h-[calc(100vh-var(--titlebar-height))]'
          )}
        >
          <div className="mx-auto max-w-[760px] px-8 pb-16">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border-subtle bg-bg-base/95 pb-4 pt-6 backdrop-blur">
              <div>
                <h1 className="text-xl font-medium tracking-[-0.025em] text-text-primary">
                  {sectionTitle(activeSection)}
                </h1>
              </div>
              {activeSection === 'providers' ? (
                <ActionButton onClick={onRefreshModels} disabled={isRefreshingModels}>
                  <ReloadIcon className={cn('h-3.5 w-3.5', isRefreshingModels && 'motion-spin-steps')} aria-hidden />
                  <span>{isRefreshingModels ? 'Refreshing…' : 'Refresh catalog'}</span>
                </ActionButton>
              ) : null}
            </div>

            <div className="pt-6">
              {activeSection === 'general' ? (
                <GeneralPage
                  settings={settings}
                  updateState={updateState}
                  isRefreshingModels={isRefreshingModels}
                  onOpenProviders={() => onNavigate('providers')}
                  onToggleFreeModels={onToggleFreeModels}
                  onVisualModeChange={onVisualModeChange}
                  onToggleSkillsInSlashMenu={onToggleSkillsInSlashMenu}
                  onUpdateAction={onUpdateAction}
                  onRefreshModels={onRefreshModels}
                  onUpdatePreferences={onUpdatePreferences}
                />
              ) : activeSection === 'providers' ? (
                <ModelSettingsPage />
              ) : activeSection === 'plugins' && pluginsBetaEnabled ? (
                <PluginsSettingsPage />
              ) : activeSection === 'appearance' ? (
                <AppearancePage
                  settings={settings}
                  onThemeModeChange={onThemeModeChange}
                  onDesignThemeChange={onDesignThemeChange}
                  onBorderRadiusChange={onBorderRadiusChange}
                  onAppearancePatch={onAppearancePatch}
                />
              ) : activeSection === 'keyboard' ? (
                <KeyboardPage
                  keybindings={settings?.keyboard?.keybindings ?? getDefaultKeybindingRules()}
                  platform={shortcutPlatform}
                  onUpdateKeybindings={onUpdateKeybindings ?? (() => {})}
                />
              ) : activeSection === 'usage' ? (
                <UsagePage usageSummary={usageSummary} />
              ) : activeSection === 'privacy' ? (
                <PrivacyPage
                  telemetryEnabled={telemetryEnabled}
                  onTelemetryChange={onTelemetryChange}
                />
              ) : activeSection === 'beta' ? (
                <BetaPage settings={settings} onUpdatePreferences={onUpdatePreferences} />
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function sectionTitle(section: SettingsSection): string {
  switch (section) {
    case 'general':
      return 'General';
    case 'providers':
      return 'Providers';
    case 'plugins':
      return 'Plugins';
    case 'appearance':
      return 'Appearance';
    case 'keyboard':
      return 'Keyboard shortcuts';
    case 'usage':
      return 'Usage & telemetry';
    case 'privacy':
      return 'Privacy & security';
    case 'beta':
      return 'Beta features';
  }
}

// =============================================================================
// Beta page
// =============================================================================
function BetaPage({
  settings,
  onUpdatePreferences,
}: {
  settings: SettingsSummary | null;
  onUpdatePreferences?: (patch: import('../../shared/contracts').SettingsUpdateRequest) => Promise<void>;
}) {
  const [workerUrl, setWorkerUrl] = useState(settings?.chat.cloudSandboxWorkerUrl ?? '');
  const [workerSecret, setWorkerSecret] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; text: string } | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStep, setDeployStep] = useState<string | null>(null);
  const [confirmClearSecretOpen, setConfirmClearSecretOpen] = useState(false);
  const canDeployCloudSandbox = settings?.chat.canDeployCloudSandbox ?? true;

  useEffect(() => {
    setWorkerUrl(settings?.chat.cloudSandboxWorkerUrl ?? '');
  }, [settings?.chat.cloudSandboxWorkerUrl]);

  const updatePref = (patch: import('../../shared/contracts').SettingsUpdateRequest) => {
    if (onUpdatePreferences) {
      void onUpdatePreferences(patch);
    } else if (window.atlasChat?.settings?.updatePreferences) {
      void window.atlasChat.settings.updatePreferences(patch);
    }
  };

  const handleTogglePlugins = (enabled: boolean) => {
    updatePref({ pluginsBetaEnabled: enabled });
    notify({
      tone: 'success',
      title: enabled ? 'Plugins enabled' : 'Plugins disabled',
      description: enabled
        ? 'The Plugins destination is in the sidebar.'
        : 'Plugins are hidden and their tools are unavailable.',
    });
  };

  const handleToggleSites = (enabled: boolean) => {
    updatePref({ sitesBetaEnabled: enabled });
    notify({
      tone: 'success',
      title: enabled ? 'Atlas Design enabled' : 'Atlas Design disabled',
      description: enabled
        ? 'Atlas Design (Beta) is now accessible in the sidebar.'
        : 'Atlas Design is hidden.',
    });
  };

  const handleToggleEnabled = (enabled: boolean) => {
    updatePref({
      chat: {
        cloudSandboxEnabled: enabled,
        ...(!enabled && settings?.chat.executionTarget === 'cloud' ? { executionTarget: 'local' } : {}),
      },
    });
    notify({
      tone: 'success',
      title: enabled ? 'Cloud Sandbox enabled' : 'Cloud Sandbox disabled',
      description: enabled ? 'Select Send to cloud in the execution target picker.' : 'Returned to local execution.',
    });
  };

  const handleSaveUrl = () => {
    updatePref({
      chat: { cloudSandboxWorkerUrl: workerUrl.trim() || null },
    });
    notify({ tone: 'success', title: 'Worker URL updated', description: 'Cloud Sandbox endpoint saved.' });
  };

  const handleSaveSecret = () => {
    const trimmed = workerSecret.trim();
    if (!trimmed) return;
    updatePref({
      chat: { cloudSandboxWorkerSecret: trimmed },
    });
    setWorkerSecret('');
    notify({ tone: 'success', title: 'Worker Secret updated', description: 'Auth secret saved to OS keychain.' });
  };

  const handleClearSecretConfirmed = () => {
    updatePref({
      chat: { cloudSandboxWorkerSecret: null },
    });
    setWorkerSecret('');
    notify({ tone: 'success', title: 'Worker Secret cleared', description: 'Cloud Sandbox auth secret removed.' });
  };

  const handleGenerateSecret = async () => {
    try {
      const secret = await window.atlasChat?.settings?.generateCloudSandboxSecret?.();
      if (secret) {
        setWorkerSecret(secret);
        notify({ tone: 'info', title: 'Auth Secret generated', description: 'Random Bearer secret generated — click Save or press Enter to save to keychain.' });
      }
    } catch (err: any) {
      notify({ tone: 'error', title: 'Generation failed', description: err.message || String(err) });
    }
  };

  const handleAutoDeploy = async () => {
    setIsDeploying(true);
    setDeployStep('Checking Cloudflare login & deploying worker isolate…');
    try {
      const result = await window.atlasChat?.settings?.deployCloudSandbox?.();
      if (result?.success && result.url) {
        setWorkerUrl(result.url);
        updatePref({
          chat: {
            cloudSandboxEnabled: true,
            cloudSandboxWorkerUrl: result.url,
          },
        });
        if (result.secret) setWorkerSecret(result.secret);
        setDeployStep(null);
        setTestResult({ success: true, text: 'Worker deployed & connected!' });
        notify({
          tone: 'success',
          title: 'Cloud Sandbox deployed — auth secret saved to keychain',
          description: result.secret
            ? 'Copy the token from the field if you want a backup — you won’t see it again after you save.'
            : `Worker published to ${result.url}. Cloud execution enabled.`,
        });
      } else {
        const errorMsg = result?.error || 'Deployment failed.';
        setDeployStep(null);
        notify({ tone: 'error', title: 'Deployment failed', description: errorMsg });
      }
    } catch (err: any) {
      setDeployStep(null);
      notify({ tone: 'error', title: 'Deployment error', description: err.message || String(err) });
    } finally {
      setIsDeploying(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await window.atlasChat?.settings?.testCloudSandbox?.(workerUrl.trim() || undefined, workerSecret.trim() || undefined);
      if (res?.success) {
        const text = `Connected (${res.latencyMs ?? 0}ms)`;
        setTestResult({ success: true, text });
        notify({ tone: 'success', title: 'Connection successful', description: `Cloud Sandbox worker responded in ${res.latencyMs ?? 0}ms.` });
      } else {
        const text = res?.error || 'Could not reach worker endpoint.';
        setTestResult({ success: false, text });
        notify({ tone: 'error', title: 'Connection failed', description: text });
      }
    } catch (err: any) {
      const text = err.message || String(err);
      setTestResult({ success: false, text });
      notify({ tone: 'error', title: 'Connection failed', description: text });
    } finally {
      setIsTesting(false);
    }
  };

  const isCloudSandboxEnabled = settings?.chat.cloudSandboxEnabled ?? false;

  return (
    <div className="space-y-6">
      <SettingsGroup title="Atlas Design (Beta)">
        <SettingsRow
          title="Enable Atlas Design"
          description="Visual design workspace and interactive web prototype builder. Off, the destination is hidden from the sidebar."
        >
          <Switch
            checked={settings?.sitesBetaEnabled ?? false}
            onCheckedChange={handleToggleSites}
            aria-label="Enable Atlas Design"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Plugins (Beta)">
        <SettingsRow
          title="Enable plugins"
          description="Install plugin bundles: skills, commands, and MCP servers. Off, the feature is invisible everywhere in the app."
        >
          <Switch
            checked={settings?.pluginsBetaEnabled ?? false}
            onCheckedChange={handleTogglePlugins}
            aria-label="Enable plugins"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Cloud Sandbox (Experimental)">
        <SettingsRow
          title="Enable Cloud Sandbox"
          description="Allow offloading AI tool execution to a remote Cloudflare Worker isolate shell rather than running commands locally."
        >
          <Switch
            checked={isCloudSandboxEnabled}
            onCheckedChange={handleToggleEnabled}
            aria-label="Enable Cloud Sandbox"
          />
        </SettingsRow>

        {!isCloudSandboxEnabled && (
          <div className="rounded-lg border border-border-subtle bg-bg-surface/50 p-3 text-xs text-text-tertiary">
            Cloud Sandbox is currently disabled. Toggle &ldquo;Enable Cloud Sandbox&rdquo; above to route execution to worker isolates.
          </div>
        )}

        <SettingsRow
          title="Automated Worker Setup"
          description={
            canDeployCloudSandbox
              ? 'Deploy your Cloud Sandbox worker and provision security secrets to Cloudflare automatically using Wrangler.'
              : 'In-app deploy needs a source checkout — packaged apps do not bundle the worker. Paste a worker URL and secret below instead.'
          }
        >
          <div className="flex flex-col gap-2 items-end">
            {canDeployCloudSandbox ? (
              <button
                type="button"
                onClick={handleAutoDeploy}
                disabled={isDeploying}
                className="flex items-center gap-1.5 h-8 rounded-md bg-brand px-3 text-xs font-medium text-brand-foreground transition hover:opacity-90 disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]"
              >
                <RocketIcon className={cn('h-3.5 w-3.5', isDeploying && 'motion-spin-steps')} aria-hidden />
                <span>{isDeploying ? 'Deploying to Cloudflare…' : 'Deploy Cloud Sandbox'}</span>
              </button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={handleAutoDeploy}
                      disabled
                      className="flex items-center gap-1.5 h-8 rounded-md bg-brand px-3 text-xs font-medium text-brand-foreground transition disabled:opacity-50"
                    >
                      <RocketIcon className="h-3.5 w-3.5" aria-hidden />
                      <span>Deploy Cloud Sandbox</span>
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Unavailable in packaged builds. Configure a remote worker URL and secret instead.
                </TooltipContent>
              </Tooltip>
            )}
            {deployStep ? (
              <span role="status" className="text-2xs text-text-tertiary animate-pulse font-mono">
                {deployStep}
              </span>
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow
          title="Cloudflare Worker URL"
          description="HTTPS endpoint URL for your deployed Cloudflare Sandbox worker (e.g. https://atlas-cloud-sandbox.workers.dev)."
        >
          <div className="flex flex-col gap-2 items-end">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <input
                type="url"
                value={workerUrl}
                placeholder="https://my-sandbox.workers.dev"
                aria-label="Cloudflare Worker URL"
                onChange={(e) => setWorkerUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveUrl();
                }}
                className="h-8 w-full min-w-0 rounded-md border border-border-default bg-transparent px-2.5 text-xs font-mono text-text-primary outline-none transition focus:border-brand placeholder:text-text-muted sm:w-64"
              />
              <ActionButton onClick={handleSaveUrl} disabled={!workerUrl.trim()}>
                Save
              </ActionButton>
              <ActionButton onClick={handleTestConnection} disabled={isTesting || !workerUrl.trim()}>
                {isTesting ? 'Testing…' : 'Test connection'}
              </ActionButton>
            </div>
            {workerUrl.trim() && !/^https:\/\/.+\..+/.test(workerUrl.trim()) ? (
              <span role="alert" className="text-2xs font-mono text-status-error">
                Enter a full https:// URL.
              </span>
            ) : null}
            {testResult ? (
              <span
                role="status"
                className={cn(
                  'text-2xs font-mono px-2 py-0.5 rounded',
                  testResult.success
                    ? 'bg-status-success/15 text-status-success'
                    : 'bg-status-error/15 text-status-error'
                )}
              >
                {testResult.text}
              </span>
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow
          title="Worker Auth Secret"
          description="Shared Bearer token sent in Authorization header to authenticate requests with your worker. Stored in your OS keychain — never shown here once saved."
        >
          <div className="flex flex-col gap-2 items-end">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <input
                type="password"
                value={workerSecret}
                placeholder={settings?.chat.cloudSandboxHasSecret ? 'Replace saved secret…' : 'Optional Bearer secret'}
                aria-label="Worker auth secret"
                autoComplete="new-password"
                onChange={(e) => setWorkerSecret(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveSecret();
                }}
                className="h-8 w-full min-w-0 rounded-md border border-border-default bg-transparent px-2.5 text-xs font-mono text-text-primary outline-none transition focus:border-brand placeholder:text-text-muted sm:w-64"
              />
              <ActionButton onClick={handleSaveSecret} disabled={!workerSecret.trim()}>
                Save
              </ActionButton>
              {settings?.chat.cloudSandboxHasSecret && !workerSecret.trim() ? (
                <ActionButton onClick={() => setConfirmClearSecretOpen(true)}>
                  Clear
                </ActionButton>
              ) : null}
              <ActionButton onClick={handleGenerateSecret}>
                Generate Secret
              </ActionButton>
            </div>
            {settings?.chat.cloudSandboxHasSecret ? (
              <span role="status" className="inline-flex items-center gap-1 text-2xs font-mono text-text-tertiary">
                <span aria-hidden className="inline-block size-1.5 rounded-full bg-status-success" />
                auth secret stored in OS keychain
              </span>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsGroup>

      <ConfirmDialog
        open={confirmClearSecretOpen}
        title="Remove worker auth secret?"
        description="The shared Bearer token stored in your OS keychain will be removed. You will need to re-enter it to connect to your remote Cloudflare isolate worker."
        confirmLabel="Remove secret"
        cancelLabel="Keep secret"
        tone="danger"
        onCancel={() => setConfirmClearSecretOpen(false)}
        onConfirm={() => {
          setConfirmClearSecretOpen(false);
          handleClearSecretConfirmed();
        }}
      />
    </div>
  );
}

// =============================================================================
// General page
// =============================================================================
function GeneralPage({
  settings,
  updateState,
  isRefreshingModels,
  onOpenProviders,
  onToggleFreeModels,
  onVisualModeChange,
  onToggleSkillsInSlashMenu,
  onUpdateAction,
  onRefreshModels,
  onUpdatePreferences,
}: {
  settings: SettingsSummary | null;
  updateState: AppUpdateSnapshot;
  isRefreshingModels: boolean;
  onOpenProviders: () => void;
  onToggleFreeModels: (value: boolean) => void;
  onVisualModeChange: (mode: VisualMode) => void;
  onToggleSkillsInSlashMenu: (value: boolean) => void;
  onUpdateAction: () => void;
  onRefreshModels: () => void;
  onUpdatePreferences?: (patch: import('../../shared/contracts').SettingsUpdateRequest) => Promise<void>;
}) {
  const lastSyncedLabel = formatTimestamp(settings?.modelCatalogLastSyncedAt);
  const updateLabel = getUpdateLabel(updateState);

  const updateChatPref = (patch: NonNullable<import('../../shared/contracts').SettingsUpdateRequest['chat']>) => {
    if (onUpdatePreferences) {
      void onUpdatePreferences({ chat: patch });
    } else if (window.atlasChat?.settings?.updatePreferences) {
      void window.atlasChat.settings.updatePreferences({ chat: patch });
    }
  };

  return (
    <>
      <SettingsGroup title="Providers">
        <SettingsRow
          title="Model providers"
          description="Local agents and API endpoints live in Providers, one entry per integration."
        >
          <ActionButton onClick={onOpenProviders}>
            <SlotLabel text="Open Providers" />
          </ActionButton>
        </SettingsRow>

        <SettingsRow
          title="Free models by default"
          description="Use the free-only filter whenever the model catalog is loaded."
        >
          <Switch
            checked={settings?.showFreeOnlyByDefault ?? true}
            onCheckedChange={onToggleFreeModels}
            aria-label="Toggle free models by default"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Chat defaults">
        <SettingsStackedRow
          title="Default conversation mode"
          description="Work mode focuses on clean analysis, writing and chat. Code mode equips the assistant with direct terminal and codebase access."
        >
          <SegmentedPicker<WorkspaceMode>
            ariaLabel="Default conversation mode"
            current={settings?.chat.workspaceMode ?? 'work'}
            onChange={(mode) => updateChatPref({ workspaceMode: mode })}
            items={[
              { value: 'work', label: 'Work', title: 'Analysis, writing and general conversation' },
              { value: 'code', label: 'Code', title: 'Full programming assistant with workspace access' },
            ]}
          />
        </SettingsStackedRow>

        <SettingsStackedRow
          title="Default reasoning effort"
          description="Thinking budget used for reasoning-capable models such as o3-mini, Claude 3.7 Sonnet, and DeepSeek R1."
        >
          <SegmentedPicker<ReasoningEffort>
            ariaLabel="Default reasoning effort"
            current={settings?.chat.reasoningEffort ?? 'medium'}
            onChange={(effort) => updateChatPref({ reasoningEffort: effort })}
            items={[
              { value: 'low', label: 'Low', title: 'Fastest reasoning' },
              { value: 'medium', label: 'Medium', title: 'Balanced reasoning budget' },
              { value: 'high', label: 'High', title: 'Deepest multi-step reasoning' },
            ]}
          />
        </SettingsStackedRow>

        <SettingsStackedRow
          title="Tool approvals"
          description="Determine how the assistant executes local shell commands, edits files, and interacts with system tools."
        >
          <SegmentedPicker<ToolPermissionMode>
            ariaLabel="Tool permissions mode"
            current={settings?.chat.toolPermissionMode ?? 'ask'}
            onChange={(mode) => updateChatPref({ toolPermissionMode: mode })}
            items={[
              { value: 'read-only', label: 'Read only', title: 'Local reads only. No shell commands or file edits' },
              { value: 'ask', label: 'Ask first', title: 'Prompts for approval on shell commands and file modifications' },
              { value: 'full-access', label: 'Full access', title: 'All tools run without asking' },
            ]}
          />
        </SettingsStackedRow>

        <SettingsStackedRow
          title="Inline visuals"
          description="Diagrams, charts and interactive blocks rendered inside a reply. On automatic, the assistant only draws one when you ask for something visual."
        >
          <VisualModePicker
            current={settings?.chat.visualMode ?? 'auto'}
            onChange={onVisualModeChange}
          />
        </SettingsStackedRow>

        <SettingsRow
          title="Skills in slash menu"
          description="Also list skills in the / command menu as /skill:Name rows. Off keeps the menu command-only; skills stay reachable through @ mentions."
        >
          <Switch
            checked={settings?.chat.showSkillsInSlashMenu ?? true}
            onCheckedChange={onToggleSkillsInSlashMenu}
            aria-label="Toggle skills in slash menu"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Catalog and updates">
        <SettingsRow
          title="Model catalog"
          description={`Last synced ${lastSyncedLabel}. ${settings?.modelCatalogCount ?? 0} models cached locally.`}
        >
          <ActionButton onClick={onRefreshModels} disabled={isRefreshingModels}>
            <ReloadIcon className={cn('h-3.5 w-3.5', isRefreshingModels && 'motion-spin-steps')} aria-hidden />
            <span>{isRefreshingModels ? 'Refreshing…' : 'Refresh'}</span>
          </ActionButton>
        </SettingsRow>

        <SettingsRow title="App updates" description={updateDescription(updateState)}>
          <ActionButton
            onClick={onUpdateAction}
            disabled={updateState.status === 'checking' || updateState.status === 'downloading'}
          >
            <UpdateIcon
              className={cn(
                'h-3.5 w-3.5',
                (updateState.status === 'checking' || updateState.status === 'downloading') && 'motion-spin-steps'
              )}
              aria-hidden
            />
            <span>{updateLabel}</span>
          </ActionButton>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

// =============================================================================
// Appearance page
// =============================================================================
function AppearancePage({
  settings,
  onThemeModeChange,
  onDesignThemeChange,
  onBorderRadiusChange,
  onAppearancePatch,
}: {
  settings: SettingsSummary | null;
  onThemeModeChange: (mode: ThemeMode) => void;
  onDesignThemeChange: (theme: DesignTheme) => void;
  onBorderRadiusChange: (mode: BorderRadiusMode) => void;
  onAppearancePatch: (patch: AppearancePatch) => void;
}) {
  const appearance = settings?.appearance ?? DEFAULT_SETTINGS_APPEARANCE;
  const themeMode = appearance.themeMode;
  const panelAnimationDurationMs = appearance.panelAnimationDurationMs ?? DEFAULT_PANEL_ANIMATION_DURATION_MS;
  const panelSliderProgress = Math.min(
    100,
    Math.max(
      0,
      ((panelAnimationDurationMs - MIN_PANEL_ANIMATION_DURATION_MS) /
        (MAX_PANEL_ANIMATION_DURATION_MS - MIN_PANEL_ANIMATION_DURATION_MS)) *
        100
    )
  );

  return (
    <>
      <SettingsGroup
        title="Appearance"
        description="Choose how Atlas looks. Use a built-in theme or make your own."
      >
        <ThemeAppearanceSection
          appearance={appearance}
          themeMode={themeMode}
          onThemeModeChange={onThemeModeChange}
          onAppearancePatch={onAppearancePatch}
          notify={notify}
        />
      </SettingsGroup>

      <SettingsGroup title="Motion" description="Animation speed and motion preferences for side panels and dialogs.">
        <SettingsStackedRow
          title="Reduce motion"
          description="Choose whether interface animations, panel slides, spinners, and smooth scrolling are reduced."
        >
          <SegmentedPicker<ReduceMotionMode>
            ariaLabel="Reduce motion mode"
            current={appearance.reduceMotion ?? 'system'}
            onChange={(mode) => onAppearancePatch({ reduceMotion: mode })}
            items={[
              { value: 'system', label: 'System', title: 'Follow macOS Accessibility setting' },
              { value: 'on', label: 'Reduce', title: 'Always reduce motion and transitions' },
              { value: 'off', label: 'Full motion', title: 'Enable all animations' },
            ]}
          />
        </SettingsStackedRow>

        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 py-3 border-t border-border-subtle">
          <div className="min-w-0 flex-1 basis-48">
            <div className="flex items-center gap-1.5">
              <span id="panel-animations-label" className="text-md font-normal text-text-primary">Panel animations</span>
              {panelAnimationDurationMs !== DEFAULT_PANEL_ANIMATION_DURATION_MS && (
                <button
                  type="button"
                  aria-label="Reset panel animations"
                  title="Reset panel animations to default"
                  onClick={() => onAppearancePatch({ panelAnimationDurationMs: DEFAULT_PANEL_ANIMATION_DURATION_MS })}
                  className="inline-flex size-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer"
                >
                  <Undo2 aria-hidden className="size-3" />
                </button>
              )}
            </div>
            <div className="mt-0.5 text-sm leading-relaxed text-text-tertiary">
              Set how fast panels open and close.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <PanelAnimationsPreview durationMs={panelAnimationDurationMs} />
            <output
              htmlFor="panel-animation-duration"
              className="min-w-14 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-[var(--text-primary)]"
            >
              {panelAnimationDurationMs} ms
            </output>
            <input
              id="panel-animation-duration"
              type="range"
              min={MIN_PANEL_ANIMATION_DURATION_MS}
              max={MAX_PANEL_ANIMATION_DURATION_MS}
              step={25}
              value={panelAnimationDurationMs}
              style={{ '--settings-slider-progress': `${panelSliderProgress}%` } as CSSProperties}
              aria-labelledby="panel-animations-label"
              aria-describedby="panel-animations-label"
              onChange={(e) => onAppearancePatch({ panelAnimationDurationMs: Number(e.target.value) })}
              className="settings-range h-1.5 w-32 cursor-pointer appearance-none rounded-full bg-[var(--bg-active)] accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] touch-manipulation"
            />
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Preferences">
        <SettingsRow
          title="Translucent sidebar"
          description={
            isMacPlatform
              ? 'Let the desktop show through the sidebar.'
              : 'Unavailable on this platform — window vibrancy is macOS-only.'
          }
        >
          <Switch
            checked={Boolean(appearance.translucentSidebar && isMacPlatform)}
            onCheckedChange={(value) => onAppearancePatch({ translucentSidebar: value })}
            aria-label="Toggle translucent sidebar"
            disabled={!isMacPlatform}
          />
        </SettingsRow>
        <SettingsRow
          title="Always show composer context strip"
          description="Keep the active project, execution target and branch strip visible above the composer even after a conversation starts."
        >
          <Switch
            checked={appearance.persistComposerContextStrip ?? false}
            onCheckedChange={(value) => onAppearancePatch({ persistComposerContextStrip: value })}
            aria-label="Always show composer context strip"
          />
        </SettingsRow>
        <SettingsRow
          title="Use pointer cursors"
          description="Change the cursor to a pointer when hovering over interactive elements."
        >
          <Switch
            checked={appearance.pointerCursors}
            onCheckedChange={(value) => onAppearancePatch({ pointerCursors: value })}
            aria-label="Toggle pointer cursors"
          />
        </SettingsRow>
        <SettingsRow
          title="Raw transcript"
          description="Render replies, tool output and diffs as plain text, so selections copy without formatting artifacts."
        >
          <Switch
            checked={appearance.rawTranscript}
            onCheckedChange={(value) => onAppearancePatch({ rawTranscript: value })}
            aria-label="Toggle raw transcript"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Shape">
        <SettingsStackedRow
          title="Border radius"
          description="Control the roundness of UI elements. Theme Default respects each theme's design, Sharp Edges removes all rounded corners."
        >
          <BorderRadiusPicker current={appearance.borderRadius} onChange={onBorderRadiusChange} />
        </SettingsStackedRow>
      </SettingsGroup>

      <SettingsTypographySection
        appearance={appearance}
        onAppearancePatch={onAppearancePatch}
      />
    </>
  );
}

// =============================================================================
// Keyboard shortcuts page
// =============================================================================
const EMPTY_SHORTCUT: KeybindingShortcut = {
  key: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  modKey: false,
};

function KeyboardPage({
  keybindings,
  platform,
  onUpdateKeybindings,
}: {
  keybindings: KeybindingRule[];
  platform: ShortcutPlatform;
  onUpdateKeybindings: (rules: KeybindingRule[]) => void;
}) {
  const [capturingCommand, setCapturingCommand] = useState<KeybindingCommand | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const defaultRules = useMemo(() => getDefaultKeybindingRules(), []);

  const groupedCommands = useMemo(() => {
    const next = new Map<string, typeof APP_COMMAND_DEFINITIONS>();

    for (const definition of APP_COMMAND_DEFINITIONS) {
      if (!next.has(definition.section)) {
        next.set(definition.section, []);
      }

      next.get(definition.section)!.push(definition);
    }

    return Array.from(next.entries());
  }, []);

  const updateCommandShortcut = (command: KeybindingCommand, shortcut: KeybindingShortcut) => {
    onUpdateKeybindings(upsertKeybindingRule(keybindings, command, shortcut));
  };

  const resetCommandShortcut = (command: KeybindingCommand) => {
    const defaultRule = defaultRules.find((rule) => rule.command === command);
    if (!defaultRule) {
      return;
    }

    updateCommandShortcut(command, defaultRule.shortcut);
  };

  const handleCapture = (command: KeybindingCommand) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      setCapturingCommand(null);
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      updateCommandShortcut(command, EMPTY_SHORTCUT);
      setCapturingCommand(null);
      return;
    }

    const shortcut = createShortcutFromKeyboardEvent(event.nativeEvent, platform);
    if (!shortcut) {
      return;
    }

    updateCommandShortcut(command, shortcut);
    setCapturingCommand(null);
  };

  const query = searchQuery.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!query) return groupedCommands;
    return groupedCommands
      .map(([section, definitions]) => {
        const matching = definitions.filter((def) => {
          const rule = keybindings.find((entry) => entry.command === def.command);
          const shortcut = rule?.shortcut ?? defaultRules.find((entry) => entry.command === def.command)?.shortcut;
          const shortcutLabel = shortcut?.key ? formatShortcutLabel(shortcut, platform).toLowerCase() : '';
          return (
            def.title.toLowerCase().includes(query) ||
            def.description.toLowerCase().includes(query) ||
            def.command.toLowerCase().includes(query) ||
            shortcutLabel.includes(query) ||
            (def.keywords?.some((k) => k.toLowerCase().includes(query)) ?? false)
          );
        });
        return [section, matching] as const;
      })
      .filter(([, matching]) => matching.length > 0);
  }, [groupedCommands, query, keybindings, defaultRules, platform]);

  return (
    <>
      <SettingsGroup title="Keyboard shortcuts">
        <SettingsRow
          title="Customize Atlas shortcuts"
          description="Shortcuts are stored locally on this device. Duplicate bindings are allowed and the last matching rule wins."
        >
          <ActionButton onClick={() => setConfirmResetOpen(true)}>Reset all to defaults</ActionButton>
        </SettingsRow>

        <div className="mt-3 flex items-center gap-2 rounded-lg bg-bg-surface px-3 py-1.5 border border-border-subtle focus-within:border-border-strong transition">
          <Search className="size-3.5 text-text-faint shrink-0" aria-hidden />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search shortcuts by name, action or key…"
            aria-label="Search shortcuts"
            className="w-full bg-transparent text-xs text-text-primary placeholder:text-text-faint outline-none"
          />
          {searchQuery.trim() ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear shortcut search"
              className="text-text-muted hover:text-text-primary rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </SettingsGroup>

      {filteredGroups.length === 0 ? (
        <div className="rounded-lg border border-border-default p-8 text-center">
          <p className="text-xs text-text-tertiary">No shortcuts match &ldquo;{searchQuery.trim()}&rdquo;.</p>
          <p className="mt-1 text-2xs text-text-faint">Try searching by command title, keywords, or key sequence.</p>
        </div>
      ) : (
        filteredGroups.map(([section, definitions]) => (
          <SettingsGroup key={section} title={section}>
            {definitions.map((definition) => {
              const defaultRule = defaultRules.find((entry) => entry.command === definition.command);
              const rule = keybindings.find((entry) => entry.command === definition.command);
              const shortcut = rule?.shortcut ?? defaultRule?.shortcut;
              const conflicts = resolveKeybindingConflicts(keybindings, definition.command);
              const shortcutLabel = shortcut?.key ? formatShortcutLabel(shortcut, platform) : 'Not set';
              const isCapturing = capturingCommand === definition.command;
              const isModified = Boolean(
                rule &&
                  defaultRule &&
                  (rule.shortcut.key !== defaultRule.shortcut.key ||
                    rule.shortcut.metaKey !== defaultRule.shortcut.metaKey ||
                    rule.shortcut.ctrlKey !== defaultRule.shortcut.ctrlKey ||
                    rule.shortcut.shiftKey !== defaultRule.shortcut.shiftKey ||
                    rule.shortcut.altKey !== defaultRule.shortcut.altKey)
              );

              return (
                <div className="py-3" key={definition.command}>
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                    <div className="min-w-0 flex-1 basis-48">
                      <div className="flex items-center gap-2">
                        <span className="text-md font-normal text-text-primary">{definition.title}</span>
                        {isModified ? (
                          <span
                            title="Customized shortcut"
                            className="size-1.5 rounded-full bg-brand"
                            aria-label="Customized"
                          />
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-sm leading-relaxed text-text-tertiary">{definition.description}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        aria-label={`${definition.title} shortcut: ${shortcutLabel}. Activate then press keys, Backspace to clear, Escape to cancel.`}
                        onClick={() =>
                          setCapturingCommand((current) => (current === definition.command ? null : definition.command))
                        }
                        onKeyDown={isCapturing ? handleCapture(definition.command) : undefined}
                        onBlur={() => {
                          if (isCapturing) setCapturingCommand(null);
                        }}
                        className={cn(
                          'inline-flex h-8 min-w-[136px] items-center justify-center rounded-md border px-3 font-mono text-xs transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]',
                          isCapturing
                            ? 'border-border-strong bg-bg-hover text-text-primary'
                            : 'border-border-subtle bg-transparent text-text-primary hover:bg-bg-hover'
                        )}
                      >
                        <span aria-live="polite">{isCapturing ? 'Press keys… (Del/Esc)' : shortcutLabel}</span>
                      </button>
                      <ActionButton
                        onClick={() => resetCommandShortcut(definition.command)}
                        disabled={!isModified}
                      >
                        Reset
                      </ActionButton>
                    </div>
                  </div>
                  {conflicts.length > 0 ? (
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-status-warning/15 px-2 py-1 text-2xs font-medium text-status-warning">
                      <AlertCircle className="size-3 shrink-0" aria-hidden />
                      <span>
                        Also bound to {conflicts.map((command) => APP_COMMANDS_BY_ID[command].title).join(', ')}. The last matching rule wins.
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </SettingsGroup>
        ))
      )}

      <ConfirmDialog
        open={confirmResetOpen}
        title="Reset all keyboard shortcuts to defaults?"
        description="All custom key combinations will be removed and restored to Atlas's default shortcut configuration."
        confirmLabel="Reset all shortcuts"
        cancelLabel="Keep custom"
        tone="danger"
        onCancel={() => setConfirmResetOpen(false)}
        onConfirm={() => {
          setConfirmResetOpen(false);
          onUpdateKeybindings(defaultRules);
          notify({ tone: 'success', title: 'Shortcuts reset to defaults' });
        }}
      />
    </>
  );
}

// =============================================================================
// Usage page
// =============================================================================
function UsagePage({ usageSummary }: { usageSummary: UsageSummary }) {
  return (
    <>
      <SettingsGroup title="Provider usage">
        {usageSummary.providers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-subtle p-6 text-center text-xs text-text-tertiary">
            No provider usage metrics available yet. Custom API endpoints and model telemetry will appear here once configured in Providers.
          </div>
        ) : (
          usageSummary.providers.map((provider) => (
            <SettingsStackedRow
              key={provider.providerId}
              title={provider.label}
              description={provider.secondary}
            >
              <div className="flex items-center justify-between gap-3">
                <StatusPill tone={toneForMetricState(provider.state)}>{provider.primary}</StatusPill>
                {provider.meterValue != null ? (
                  <span className="text-xs tabular-nums text-text-tertiary">{provider.meterLabel}</span>
                ) : null}
              </div>
              {provider.meterValue != null ? (
                <div className="mt-3 flex items-center gap-3">
                  <div
                    role="progressbar"
                    aria-label={`${provider.label} usage`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(provider.meterValue)}
                    aria-valuetext={provider.meterLabel ?? `${Math.round(provider.meterValue)}%`}
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-ghost"
                  >
                    <div
                      className="h-full rounded-full bg-brand transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, provider.meterValue))}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </SettingsStackedRow>
          ))
        )}
      </SettingsGroup>

      <SettingsGroup title="Session metrics">
        <SettingsRow
          title="Loaded token usage"
          description="Prompt, completion and reasoning tokens across currently loaded messages."
        >
          <ValueBadge>
            {formatTokens(usageSummary.local.totalTokens)}
          </ValueBadge>
        </SettingsRow>
        <SettingsRow
          title="Estimated local cost"
          description="Based on published token rates for models used in currently loaded conversations."
        >
          <ValueBadge>
            {formatUsd(usageSummary.local.estimatedCostUsd) ?? 'Unavailable'}
          </ValueBadge>
        </SettingsRow>
        <SettingsRow
          title="Stored data"
          description="Total conversations and messages stored in the local SQLite database."
        >
          <ValueBadge>
            {usageSummary.local.storedConversationCount} chats · {usageSummary.local.storedMessageCount} msgs
          </ValueBadge>
        </SettingsRow>
        <SettingsRow
          title="Database size"
          description="Physical disk space occupied by the Atlas conversation store on your machine."
        >
          <ValueBadge>{formatBytes(usageSummary.local.databaseSizeBytes)}</ValueBadge>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

// =============================================================================
// Privacy page
// =============================================================================
function PrivacyPage({
  telemetryEnabled,
  onTelemetryChange,
}: {
  telemetryEnabled: boolean;
  onTelemetryChange: (enabled: boolean) => void;
}) {
  const handleToggle = (enabled: boolean) => {
    onTelemetryChange(enabled);
    notify({
      tone: enabled ? 'info' : 'success',
      title: enabled ? 'Anonymous telemetry enabled' : 'Anonymous telemetry disabled',
      description: enabled
        ? 'App launch and feature adoption metrics will help prioritize fixes.'
        : 'Telemetry reporting turned off immediately.',
    });
  };

  return (
    <>
      <SettingsGroup title="Usage analytics">
        <SettingsRow
          title="Share anonymous usage events"
          description="Atlas can send anonymous event data (app launched, model selected, preferences updated) to help prioritize fixes. No message content, file names, or API keys are ever sent. Disabling this takes effect immediately."
        >
          <Switch
            checked={telemetryEnabled}
            onCheckedChange={handleToggle}
            aria-label="Share anonymous usage events"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Local data & security">
        <SettingsRow
          title="Conversation history"
          description="All conversations and messages are stored locally in a SQLite database under your user data directory. They never leave your machine unless you explicitly use a tool that does so (e.g. web search or web fetch)."
        >
          <ValueBadge>Local only</ValueBadge>
        </SettingsRow>
        <SettingsRow
          title="API keys"
          description="Provider keys are stored in the operating system keychain via the keytar library. The renderer never has direct access to key values — only a boolean indicating whether a key is configured."
        >
          <ValueBadge>OS keychain</ValueBadge>
        </SettingsRow>
        <SettingsRow
          title="Code execution"
          description="Tools execute in an isolated local child process with restricted permissions. If Cloud Sandbox is enabled, tool execution runs inside an isolated Cloudflare Worker isolate."
        >
          <ValueBadge>Sandboxed</ValueBadge>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

// =============================================================================
// UI Primitives & Pickers
// =============================================================================
function SettingsGroup({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description?: string }>) {
  return (
    <section className="border-b border-border-subtle py-6 first:pt-0 last:border-b-0">
      <h2 className="text-2xs font-semibold uppercase tracking-[var(--tracking-label)] text-text-secondary">{title}</h2>
      {description ? (
        <div className="mt-1 text-xs text-text-tertiary">{description}</div>
      ) : null}
      <div className="mt-2 divide-y divide-border-subtle/60">{children}</div>
    </section>
  );
}

function SettingsRow({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description: string }>) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-md font-normal text-text-primary">{title}</div>
        <div className="mt-0.5 text-sm leading-relaxed text-text-tertiary">{description}</div>
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
    <div className="py-3">
      <div className="text-md font-normal text-text-primary">{title}</div>
      <div className="mt-0.5 text-sm leading-relaxed text-text-tertiary">{description}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

const SEGMENT_BASE =
  'inline-flex h-8 items-center rounded-full border px-3 text-sm font-normal transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]';
const SEGMENT_ACTIVE = 'border-border-default bg-bg-elevated text-text-primary font-medium';
const SEGMENT_IDLE =
  'border-transparent text-text-tertiary hover:bg-bg-hover hover:text-text-primary';

function SegmentedPicker<T extends string>({
  items,
  current,
  onChange,
  ariaLabel,
}: {
  items: Array<{ value: T; label: string; title?: string }>;
  current: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const currentIndex = items.findIndex((i) => i.value === current);
    if (currentIndex === -1) return;
    const nextIndex =
      e.key === 'ArrowRight'
        ? (currentIndex + 1) % items.length
        : (currentIndex - 1 + items.length) % items.length;
    onChange(items[nextIndex].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className="inline-flex rounded-full border border-border-subtle p-0.5"
    >
      {items.map((item) => {
        const isActive = item.value === current;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            title={item.title}
            onClick={() => onChange(item.value)}
            className={cn(SEGMENT_BASE, isActive ? SEGMENT_ACTIVE : SEGMENT_IDLE)}
          >
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function VisualModePicker({
  current,
  onChange,
}: {
  current: VisualMode;
  onChange: (mode: VisualMode) => void;
}) {
  const items: Array<{ value: VisualMode; label: string }> = [
    { value: 'auto', label: 'Automatic' },
    { value: 'always', label: 'Always' },
    { value: 'off', label: 'Never' },
  ];

  return (
    <SegmentedPicker<VisualMode>
      ariaLabel="Inline visuals"
      items={items}
      current={current}
      onChange={onChange}
    />
  );
}

function BorderRadiusPicker({
  current,
  onChange,
}: {
  current: BorderRadiusMode;
  onChange: (mode: BorderRadiusMode) => void;
}) {
  const items: Array<{ value: BorderRadiusMode; label: string }> = [
    { value: 'theme-default', label: 'Theme Default' },
    { value: 'none', label: 'Sharp Edges' },
  ];

  return (
    <SegmentedPicker<BorderRadiusMode>
      ariaLabel="Border radius"
      items={items}
      current={current}
      onChange={onChange}
    />
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
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-normal transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary'
          ? 'bg-bg-button text-text-inverse hover:bg-bg-button-hover'
          : 'border border-border-subtle bg-transparent text-text-primary hover:bg-bg-hover'
      )}
    >
      {children}
    </button>
  );
}

function StatusPill({
  tone,
  children,
}: PropsWithChildren<{ tone: 'success' | 'warning' | 'muted' }>) {
  const toneClasses = {
    success: 'bg-status-success/15 text-status-success',
    warning: 'bg-status-warning/15 text-status-warning',
    muted: 'bg-bg-subtle text-text-muted',
  }[tone];

  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-normal', toneClasses)}>
      {children}
    </span>
  );
}

function ValueBadge({ children }: PropsWithChildren) {
  return (
    <span className="inline-flex min-w-[72px] items-center justify-center rounded-md border border-border-subtle bg-bg-surface px-2.5 py-1 font-mono text-xs text-text-secondary">
      {children}
    </span>
  );
}

// =============================================================================
// Helpers & Formatting
// =============================================================================
function formatTimestamp(value?: string | null): string {
  if (!value) {
    return 'never';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'never';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);

  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatUsd(value?: number | null): string | null {
  if (value == null) {
    return null;
  }
  if (value === 0) {
    return '$0.00';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 0.01 ? 4 : 2,
  }).format(value);
}

function getUpdateLabel(state: AppUpdateSnapshot): string {
  switch (state.status) {
    case 'checking':
      return 'Checking…';
    case 'available':
      return 'Download update';
    case 'downloading':
      return `Downloading ${Math.round(state.progress?.percent ?? 0)}%`;
    case 'downloaded':
      return 'Restart to update';
    case 'error':
      return 'Check again';
    default:
      return 'Check for updates';
  }
}

function updateDescription(state: AppUpdateSnapshot): string {
  switch (state.status) {
    case 'available':
      return `Version ${state.latestVersion} is available.`;
    case 'downloading':
      return `Downloading update (${Math.round(state.progress?.percent ?? 0)}%)…`;
    case 'downloaded':
      return `Version ${state.latestVersion} is downloaded and ready to install on restart.`;
    case 'not-available':
      return `Atlas is up to date (${state.currentVersion}).`;
    case 'error':
      return state.message || 'Could not complete update check.';
    default:
      return 'Keep Atlas current with the latest features and fixes.';
  }
}

function toneForMetricState(state: UsageProviderSummary['state']): 'success' | 'warning' | 'muted' {
  if (state === 'available') {
    return 'success';
  }

  if (state === 'loading') {
    return 'muted';
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

  const providerSummaries = (settings?.customProviders ?? []).map((provider) =>
    buildProviderUsageSummary(provider.id, settings)
  );

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
    providers: providerSummaries,
  };
}

function buildProviderUsageSummary(providerId: ProviderId, settings: SettingsSummary | null): UsageProviderSummary {
  const provider = settings?.providers.find((entry) => entry.providerId === providerId) ?? null;
  const providerLabel = resolveProviderMetadata(providerId, settings?.customProviders ?? []).label;
  const label = `${providerLabel} usage`;

  if (!provider?.hasSecret) {
    return {
      providerId,
      label,
      state: 'not_connected',
      primary: 'Not connected',
      secondary: `Add a ${providerLabel} key before provider telemetry can appear here.`,
    };
  }

  return {
    providerId,
    label,
    state: 'unavailable',
    primary: 'Pending provider telemetry',
    secondary: `The layout is ready for ${providerLabel} telemetry once provider metrics are wired in.`,
  };
}

function estimateMessageCost(
  modelId: string | null,
  usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number }
): number | null {
  if (!modelId) {
    return null;
  }

  try {
    const cost = costFromUsage({
      id: modelId,
      usage: {
        prompt_tokens: usage.inputTokens,
        completion_tokens: usage.outputTokens,
      },
    });

    return typeof cost === 'number' && Number.isFinite(cost) ? cost : null;
  } catch {
    return null;
  }
}
