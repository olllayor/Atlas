import {
  BoxIcon,
  DesktopIcon,
  GearIcon,
  KeyboardIcon,
  LockClosedIcon,
  MinusIcon,
  MixerHorizontalIcon,
  MoonIcon,
  PersonIcon,
  PlusIcon,
  ReloadIcon,
  RocketIcon,
  SunIcon,
  TimerIcon,
  UpdateIcon,
} from '@radix-ui/react-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  CSSProperties,
  FocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PropsWithChildren
} from 'react';
import { costFromUsage } from 'tokenlens';

import type {
  AppUpdateSnapshot,
  ConversationPage,
  ConversationStats,
  DesignTheme,
  DiagnosticsSnapshot,
  FontFamilyOverride,
  KeybindingCommand,
  KeybindingRule,
  ProviderId,
  SettingsSection,
  SettingsSummary,
  ThemeMode,
  UsageProviderSummary,
  UsageSummary,
  VisualMode,
} from '../../shared/contracts';
import {
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  CONTRAST_MAX,
  CONTRAST_MIN,
  DEFAULT_SETTINGS_APPEARANCE,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
  designThemeSupportsLight,
  normalizeThemeColor,
} from '../../shared/contracts';
import { exportTheme, parseThemeImport } from '../lib/themeOverrides';
import { notify } from '../lib/notify';
import { isMacPlatform } from '../lib/platform';
import { RailBackButton } from './railPrimitives';
import { getDefaultKeybindingRules } from '../../shared/keybindings';
import { resolveProviderMetadata } from '../../shared/providerMetadata';
import { APP_COMMAND_DEFINITIONS, APP_COMMANDS_BY_ID } from '../lib/keybindingCommands';
import { ModelSettingsPage } from './providers/ModelSettingsPage';
import { PluginsSettingsPage } from './plugins/PluginsSettingsPage';
import { SlotLabel } from './ui/slot-label';
import { Switch as UiSwitch } from './ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { ShortcutPlatform } from '../lib/keybindings';
import {
  createShortcutFromKeyboardEvent,
  formatShortcutLabel,
  resolveKeybindingConflicts,
  serializeShortcut,
} from '../lib/keybindings';

type AppearancePatch = NonNullable<import('../../shared/contracts').SettingsUpdateRequest['appearance']>;

type SettingsWorkspaceProps = {
  settings: SettingsSummary | null;
  updateState: AppUpdateSnapshot;
  usageSummary: UsageSummary;
  isRefreshingModels: boolean;
  activeSection: SettingsSection;
  shortcutPlatform: ShortcutPlatform;
  onBack: () => void;
  onNavigate: (section: SettingsSection) => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  onDesignThemeChange: (theme: DesignTheme) => void;
  onBorderRadiusChange: (mode: import('../../shared/contracts').BorderRadiusMode) => void;
  onUiFontSizeChange: (value: number) => void;
  onCodeFontSizeChange: (value: number) => void;
  onUiFontFamilyChange: (value: FontFamilyOverride) => void;
  onCodeFontFamilyChange: (value: FontFamilyOverride) => void;
  onAppearancePatch: (patch: AppearancePatch) => void;
  onUpdateKeybindings: (rules: KeybindingRule[]) => void;
  onToggleFreeModels: (value: boolean) => void;
  onVisualModeChange: (mode: VisualMode) => void;
  onUpdateAction: () => void;
  onRefreshModels: () => void;
  telemetryEnabled: boolean;
  onTelemetryChange: (enabled: boolean) => void;
  onUpdatePreferences?: (patch: import('../../shared/contracts').SettingsUpdateRequest) => Promise<void>;
};

type NavItem = {
  key: SettingsSection;
  label: string;
  icon: typeof GearIcon;
};

const activeNavItems: NavItem[] = [
  { key: 'general', label: 'General', icon: GearIcon },
  { key: 'providers', label: 'Model settings', icon: MixerHorizontalIcon },
  { key: 'appearance', label: 'Appearance', icon: DesktopIcon },
  { key: 'keyboard', label: 'Keyboard', icon: KeyboardIcon },
  { key: 'privacy', label: 'Privacy', icon: LockClosedIcon },
  { key: 'usage', label: 'Usage', icon: TimerIcon },
  { key: 'beta', label: 'Beta', icon: RocketIcon },
];

/**
 * The Plugins section exists only while the beta is on.
 *
 * A hidden feature keeps no settings page: navigating to it from a stale
 * deep-link would render a control room for a system that is switched off.
 */
function navItemsFor(pluginsBetaEnabled: boolean): NavItem[] {
  return pluginsBetaEnabled
    ? [...activeNavItems.slice(0, 2), { key: 'plugins' as const, label: 'Plugins', icon: BoxIcon }, ...activeNavItems.slice(2)]
    : activeNavItems;
}

export function SettingsWorkspace({
  settings,
  updateState,
  usageSummary,
  isRefreshingModels,
  activeSection,
  shortcutPlatform,
  onBack,
  onNavigate,
  onThemeModeChange,
  onDesignThemeChange,
  onBorderRadiusChange,
  onUiFontSizeChange,
  onCodeFontSizeChange,
  onUiFontFamilyChange,
  onCodeFontFamilyChange,
  onAppearancePatch,
  onUpdateKeybindings,
  onToggleFreeModels,
  onVisualModeChange,
  onUpdateAction,
  onRefreshModels,
  telemetryEnabled,
  onTelemetryChange,
  onUpdatePreferences,
}: SettingsWorkspaceProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Sections have wildly different lengths; a carried-over scrollTop lands the
  // user on blank space.
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [activeSection]);

  return (
    <div className="app-shell flex h-screen overflow-hidden bg-bg-base text-text-primary">
      <aside className="sidebar-surface relative flex w-sidebar-width shrink-0 flex-col">
        <div
          className="relative h-titlebar-height shrink-0"
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        />

        <div className="scroll-container relative min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <RailBackButton label="Back to app" onClick={onBack} />

          <nav className="mt-5 space-y-1">
            {navItemsFor(settings?.pluginsBetaEnabled ?? false).map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.key;

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onNavigate(item.key)}
                  // Selected uses --bg-active and hover --bg-hover, the same
                  // two-step fill the chat list uses; this rail had both on
                  // --bg-hover, so the current section was indistinguishable
                  // from whichever row the pointer happened to be over.
                  className={`flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-left text-md font-normal transition-colors ${
                    isActive
                      ? 'bg-bg-active text-text-primary'
                      : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 bg-bg-base">
        <div
          className="relative h-titlebar-height shrink-0"
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        />

        <div
          ref={scrollerRef}
          className="relative h-[calc(100vh-var(--titlebar-height))] overflow-y-auto scroll-container"
        >
          <div className="mx-auto w-full max-w-[760px] px-10 pb-16">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-bg-base pb-4 pt-8">
              <h1 className="text-xl font-normal tracking-[-0.025em] text-text-primary">
                {sectionTitle(activeSection)}
              </h1>
              {activeSection === 'providers' ? (
                <ActionButton onClick={onRefreshModels} disabled={isRefreshingModels}>
                  <ReloadIcon className={`h-3.5 w-3.5 ${isRefreshingModels ? 'motion-spin-steps' : ''}`} />
                  <span>{isRefreshingModels ? 'Refreshing…' : 'Refresh catalog'}</span>
                </ActionButton>
              ) : null}
            </div>

            <div className="mt-4 space-y-8">
              {activeSection === 'general' ? (
                <GeneralPage
                  settings={settings}
                  updateState={updateState}
                  isRefreshingModels={isRefreshingModels}
                  onOpenProviders={() => onNavigate('providers')}
                  onToggleFreeModels={onToggleFreeModels}
                  onVisualModeChange={onVisualModeChange}
                  onUpdateAction={onUpdateAction}
                  onRefreshModels={onRefreshModels}
                />
              ) : null}

              {activeSection === 'providers' ? <ModelSettingsPage /> : null}

              {activeSection === 'plugins' ? <PluginsSettingsPage /> : null}

              {activeSection === 'appearance' ? (
                <AppearancePage
                  settings={settings}
                  onThemeModeChange={onThemeModeChange}
                  onDesignThemeChange={onDesignThemeChange}
                  onBorderRadiusChange={onBorderRadiusChange}
                  onUiFontSizeChange={onUiFontSizeChange}
                  onCodeFontSizeChange={onCodeFontSizeChange}
                  onUiFontFamilyChange={onUiFontFamilyChange}
                  onCodeFontFamilyChange={onCodeFontFamilyChange}
                  onAppearancePatch={onAppearancePatch}
                />
              ) : null}

              {activeSection === 'keyboard' ? (
                <KeyboardPage
                  keybindings={settings?.keyboard.keybindings ?? getDefaultKeybindingRules()}
                  platform={shortcutPlatform}
                  onUpdateKeybindings={onUpdateKeybindings}
                />
              ) : null}

              {activeSection === 'usage' ? <UsagePage usageSummary={usageSummary} /> : null}

              {activeSection === 'privacy' ? (
                <PrivacyPage
                  telemetryEnabled={telemetryEnabled}
                  onTelemetryChange={onTelemetryChange}
                />
              ) : null}

              {activeSection === 'beta' ? (
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
      return 'Model settings';
    case 'plugins':
      return 'Plugins';
    case 'appearance':
      return 'Appearance';
    case 'keyboard':
      return 'Keyboard';
    case 'usage':
      return 'Usage';
    case 'privacy':
      return 'Privacy';
    case 'beta':
      return 'Beta features';
  }
}

function BetaPage({
  settings,
  onUpdatePreferences,
}: {
  settings: SettingsSummary | null;
  onUpdatePreferences?: (patch: import('../../shared/contracts').SettingsUpdateRequest) => Promise<void>;
}) {
  const [workerUrl, setWorkerUrl] = useState(settings?.chat.cloudSandboxWorkerUrl ?? '');
  // Secret is never seeded from settings: the renderer only learns whether one
  // exists via `cloudSandboxHasSecret`. Local state holds only what the user
  // has typed since open, which is what gets saved.
  const [workerSecret, setWorkerSecret] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; text: string } | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStep, setDeployStep] = useState<string | null>(null);

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

  const handleClearSecret = () => {
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
        notify({ tone: 'info', title: 'Auth Secret generated', description: 'Random Bearer secret generated — press Enter or blur to save to keychain.' });
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
        // The deployer already wrote the token to the keychain — never bounce
        // it back through updatePref or the settings summary round-trip would
        // re-expose it to the renderer.
        updatePref({
          chat: {
            cloudSandboxEnabled: true,
            cloudSandboxWorkerUrl: result.url,
          },
        });
        if (result.secret) setWorkerSecret(result.secret);
        // Leave the token visible in the field so the user can copy it for
        // safekeeping; suggest doing so explicitly in the toast.
        setDeployStep(null);
        setTestResult({ success: true, text: 'Worker deployed & connected!' });
        notify({
          tone: 'success',
          title: 'Cloud Sandbox deployed — auth secret saved to keychain',
          description: result.secret
            ? 'Copy the token from the field if you want a backup — you won\'t see it again after you save.'
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

  return (
    <div className="space-y-6">
      <SettingsGroup title="Plugins (Beta)">
        <SettingsRow
          title="Enable plugins"
          description="Install plugin bundles: skills, commands, and MCP servers. Off, the feature is invisible everywhere in the app."
        >
          <UiSwitch
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
          <UiSwitch
            checked={settings?.chat.cloudSandboxEnabled ?? false}
            onCheckedChange={handleToggleEnabled}
            aria-label="Enable Cloud Sandbox"
          />
        </SettingsRow>

        <SettingsRow
          title="Automated Worker Setup"
          description="Deploy your Cloud Sandbox worker and provision security secrets to Cloudflare automatically using Wrangler."
        >
          <div className="flex flex-col gap-2 items-end">
            <button
              type="button"
              onClick={handleAutoDeploy}
              disabled={isDeploying}
              className="flex items-center gap-1.5 h-8 rounded-md bg-brand px-3 text-xs font-medium text-brand-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              <RocketIcon className={`h-3.5 w-3.5 ${isDeploying ? 'motion-spin-steps' : ''}`} />
              <span>{isDeploying ? 'Deploying to Cloudflare…' : '⚡ Deploy Cloud Sandbox'}</span>
            </button>
            {deployStep ? (
              <span className="text-2xs text-text-tertiary animate-pulse font-mono">
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
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={workerUrl}
                placeholder="https://my-sandbox.workers.dev"
                onChange={(e) => setWorkerUrl(e.target.value)}
                onBlur={handleSaveUrl}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveUrl();
                }}
                className="h-8 w-64 rounded-md border border-border-default bg-transparent px-2.5 text-xs font-mono text-text-primary outline-none transition focus:border-brand placeholder:text-text-muted"
              />
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || !workerUrl.trim()}
                className="h-8 rounded-md bg-bg-hover hover:bg-bg-active px-3 text-xs font-medium text-text-primary transition disabled:opacity-50"
              >
                {isTesting ? 'Testing…' : 'Test connection'}
              </button>
            </div>
            {testResult ? (
              <span
                className={`text-2xs font-mono px-2 py-0.5 rounded ${
                  testResult.success
                    ? 'bg-status-success/15 text-status-success'
                    : 'bg-status-error/15 text-status-error'
                }`}
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
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={workerSecret}
                placeholder={settings?.chat.cloudSandboxHasSecret ? 'Replace saved secret…' : 'Optional Bearer secret'}
                onChange={(e) => setWorkerSecret(e.target.value)}
                onBlur={handleSaveSecret}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveSecret();
                }}
                className="h-8 w-64 rounded-md border border-border-default bg-transparent px-2.5 text-xs font-mono text-text-primary outline-none transition focus:border-brand placeholder:text-text-muted"
              />
              {settings?.chat.cloudSandboxHasSecret && !workerSecret.trim() ? (
                <button
                  type="button"
                  onClick={handleClearSecret}
                  className="h-8 rounded-md bg-bg-hover hover:bg-bg-active px-3 text-xs font-medium text-status-error transition"
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleGenerateSecret}
                className="h-8 rounded-md bg-bg-hover hover:bg-bg-active px-3 text-xs font-medium text-text-primary transition"
              >
                Generate Secret
              </button>
            </div>
            {settings?.chat.cloudSandboxHasSecret ? (
              <span className="text-2xs font-mono text-text-tertiary">
                ✓ auth secret stored in OS keychain
              </span>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

function GeneralPage({
  settings,
  updateState,
  isRefreshingModels,
  onOpenProviders,
  onToggleFreeModels,
  onVisualModeChange,
  onUpdateAction,
  onRefreshModels,
}: {
  settings: SettingsSummary | null;
  updateState: AppUpdateSnapshot;
  isRefreshingModels: boolean;
  onOpenProviders: () => void;
  onToggleFreeModels: (value: boolean) => void;
  onVisualModeChange: (mode: VisualMode) => void;
  onUpdateAction: () => void;
  onRefreshModels: () => void;
}) {
  const lastSyncedLabel = formatTimestamp(settings?.modelCatalogLastSyncedAt);
  const updateLabel = getUpdateLabel(updateState);

  return (
    <>
      <SettingsGroup title="Providers">
        <SettingsRow
          title="Model providers"
          description="API keys and model lists live in Model settings, one entry per endpoint."
        >
          <ActionButton onClick={onOpenProviders}>
            <SlotLabel text="Open model settings" />
          </ActionButton>
        </SettingsRow>

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

      <SettingsGroup title="Chat">
        <SettingsStackedRow
          title="Inline visuals"
          description="Diagrams, charts and interactive blocks rendered inside a reply. On automatic, the assistant only draws one when you ask for something visual."
        >
          <VisualModePicker
            current={settings?.chat.visualMode ?? 'auto'}
            onChange={onVisualModeChange}
          />
        </SettingsStackedRow>
      </SettingsGroup>

      <SettingsGroup title="Catalog and updates">
        <SettingsRow
          title="Model catalog"
          description={`Last synced ${lastSyncedLabel}. ${settings?.modelCatalogCount ?? 0} models cached locally.`}
        >
          <ActionButton onClick={onRefreshModels} disabled={isRefreshingModels}>
            <ReloadIcon className={`h-3.5 w-3.5 ${isRefreshingModels ? 'motion-spin-steps' : ''}`} />
            <span>{isRefreshingModels ? 'Refreshing…' : 'Refresh'}</span>
          </ActionButton>
        </SettingsRow>

        <SettingsRow title="App updates" description={updateDescription(updateState)}>
          <ActionButton onClick={onUpdateAction} disabled={updateState.status === 'checking'}>
            <UpdateIcon className={`h-3.5 w-3.5 ${updateState.status === 'checking' ? 'motion-spin-steps' : ''}`} />
            <span>{updateLabel}</span>
          </ActionButton>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function AppearancePage({
  settings,
  onThemeModeChange,
  onDesignThemeChange,
  onBorderRadiusChange,
  onUiFontSizeChange,
  onCodeFontSizeChange,
  onUiFontFamilyChange,
  onCodeFontFamilyChange,
  onAppearancePatch,
}: {
  settings: SettingsSummary | null;
  onThemeModeChange: (mode: ThemeMode) => void;
  onDesignThemeChange: (theme: DesignTheme) => void;
  onBorderRadiusChange: (mode: import('../../shared/contracts').BorderRadiusMode) => void;
  onUiFontSizeChange: (value: number) => void;
  onCodeFontSizeChange: (value: number) => void;
  onUiFontFamilyChange: (value: FontFamilyOverride) => void;
  onCodeFontFamilyChange: (value: FontFamilyOverride) => void;
  onAppearancePatch: (patch: AppearancePatch) => void;
}) {
  const appearance = settings?.appearance ?? DEFAULT_SETTINGS_APPEARANCE;
  const themeMode = appearance.themeMode;
  const designTheme = appearance.designTheme;

  const handleCopyTheme = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportTheme(appearance), null, 2));
      notify({ tone: 'success', title: 'Theme copied' });
    } catch {
      notify({ tone: 'error', title: 'Could not copy the theme' });
    }
  };

  const handleImportTheme = async () => {
    let raw = '';
    try {
      raw = await navigator.clipboard.readText();
    } catch {
      notify({ tone: 'error', title: 'Could not read the clipboard' });
      return;
    }

    const parsed = parseThemeImport(raw);
    if (!parsed) {
      notify({
        tone: 'warning',
        title: 'Nothing to import',
        description: 'Copy a theme JSON to the clipboard first'
      });
      return;
    }

    const { uiFontFamily, codeFontFamily, ...colorPatch } = parsed;
    onAppearancePatch(colorPatch);
    if (uiFontFamily !== undefined) {
      onUiFontFamilyChange(uiFontFamily);
    }
    if (codeFontFamily !== undefined) {
      onCodeFontFamilyChange(codeFontFamily);
    }
    notify({ tone: 'success', title: 'Theme imported' });
  };

  return (
    <>
      <SettingsGroup title="Theme">
        <SettingsStackedRow
          title="Theme mode"
          description="Choose whether Atlas follows your system appearance or stays fixed."
        >
          <ThemeModePicker
            current={themeMode}
            designTheme={designTheme}
            onChange={onThemeModeChange}
          />
        </SettingsStackedRow>
        <SettingsStackedRow
          title="Design theme"
          description="Choose a design system aesthetic for the interface."
        >
          <DesignThemePicker current={designTheme} onChange={onDesignThemeChange} />
        </SettingsStackedRow>
        <ThemeSplitPreview designTheme={designTheme} />
      </SettingsGroup>

      <SettingsGroup title="Custom colors">
        <SettingsRow title="Accent" description="Highlight color for selection, focus, and links.">
          <ColorField
            value={appearance.accentColor}
            placeholder="Theme default"
            onCommit={(value) => onAppearancePatch({ accentColor: value })}
          />
        </SettingsRow>
        <SettingsRow title="Background" description="Base background the whole interface sits on.">
          <ColorField
            value={appearance.backgroundColor}
            placeholder="Theme default"
            onCommit={(value) => onAppearancePatch({ backgroundColor: value })}
          />
        </SettingsRow>
        <SettingsRow title="Foreground" description="Primary text color; secondary shades derive from it.">
          <ColorField
            value={appearance.foregroundColor}
            placeholder="Theme default"
            onCommit={(value) => onAppearancePatch({ foregroundColor: value })}
          />
        </SettingsRow>
        <SettingsRow title="Contrast" description="Strength of borders, dividers, and secondary text.">
          <ContrastSlider
            value={appearance.contrast}
            onCommit={(value) => onAppearancePatch({ contrast: value })}
          />
        </SettingsRow>
        <SettingsRow
          title="Translucent sidebar"
          description={
            isMacPlatform
              ? 'Let the desktop show through the sidebar.'
              : 'Unavailable on this platform — window vibrancy is macOS-only.'
          }
        >
          <Switch
            checked={appearance.translucentSidebar && isMacPlatform}
            onCheckedChange={(value) => onAppearancePatch({ translucentSidebar: value })}
            ariaLabel="Toggle translucent sidebar"
            disabled={!isMacPlatform}
          />
        </SettingsRow>
        <SettingsRow title="Share theme" description="Copy the current theme as JSON, or import one from the clipboard.">
          <div className="flex items-center gap-2">
            <ActionButton onClick={() => void handleImportTheme()}>
              <SlotLabel text="Import" />
            </ActionButton>
            <ActionButton onClick={() => void handleCopyTheme()}>
              <SlotLabel text="Copy theme" />
            </ActionButton>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Preferences">
        <SettingsRow
          title="Use pointer cursors"
          description="Change the cursor to a pointer when hovering over interactive elements."
        >
          <Switch
            checked={appearance.pointerCursors}
            onCheckedChange={(value) => onAppearancePatch({ pointerCursors: value })}
            ariaLabel="Toggle pointer cursors"
          />
        </SettingsRow>
        <SettingsRow
          title="Raw transcript"
          description="Render replies, tool output and diffs as plain text, so selections copy without formatting artifacts."
        >
          <Switch
            checked={appearance.rawTranscript}
            onCheckedChange={(value) => onAppearancePatch({ rawTranscript: value })}
            ariaLabel="Toggle raw transcript"
          />
        </SettingsRow>
        <SettingsRow title="Reduce motion" description="Reduce animations or match your system setting.">
          <div
            role="radiogroup"
            aria-label="Reduce motion"
            className="inline-flex rounded-full border border-border-default p-0.5"
          >
            {([
              { value: 'system', label: 'System' },
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ] as const).map((option) => {
              const isActive = appearance.reduceMotion === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => onAppearancePatch({ reduceMotion: option.value })}
                  className={`h-7 rounded-full px-3 text-2xs font-normal transition ${
                    isActive ? 'bg-bg-active text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
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

      <SettingsGroup title="Typography">
        <SettingsRow title="UI font size" description="Font size for the Atlas user interface.">
          <NumberStepper
            value={appearance.uiFontSize}
            min={UI_FONT_SIZE_MIN}
            max={UI_FONT_SIZE_MAX}
            defaultValue={DEFAULT_SETTINGS_APPEARANCE.uiFontSize}
            onChange={onUiFontSizeChange}
          />
        </SettingsRow>
        <SettingsRow title="Code font size" description="Font size for code blocks, tool payloads, and diffs.">
          <NumberStepper
            value={appearance.codeFontSize}
            min={CODE_FONT_SIZE_MIN}
            max={CODE_FONT_SIZE_MAX}
            defaultValue={DEFAULT_SETTINGS_APPEARANCE.codeFontSize}
            onChange={onCodeFontSizeChange}
          />
        </SettingsRow>
        <SettingsRow title="UI font family" description="Override the Atlas interface typeface.">
          <FontFamilyField
            value={appearance.uiFontFamily}
            placeholder="System font"
            onCommit={onUiFontFamilyChange}
          />
        </SettingsRow>
        <SettingsRow title="Code font family" description="Override the typeface used for code surfaces.">
          <FontFamilyField
            value={appearance.codeFontFamily}
            placeholder="System monospace"
            onCommit={onCodeFontFamilyChange}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

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

  const updateCommandShortcut = (command: KeybindingCommand, shortcut: KeybindingRule['shortcut']) => {
    onUpdateKeybindings(
      keybindings.map((rule) => (rule.command === command ? { ...rule, shortcut } : rule)),
    );
  };

  const resetCommandShortcut = (command: KeybindingCommand) => {
    const defaultRule = getDefaultKeybindingRules().find((rule) => rule.command === command);
    if (!defaultRule) {
      return;
    }

    updateCommandShortcut(command, defaultRule.shortcut);
  };

  const resetAllShortcuts = () => {
    onUpdateKeybindings(getDefaultKeybindingRules());
  };

  const handleCapture = (command: KeybindingCommand) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
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

  return (
    <>
      <SettingsGroup title="Keyboard shortcuts">
        <SettingsRow
          title="Customize Atlas shortcuts"
          description="Shortcuts are stored locally on this device. Duplicate bindings are allowed and the last matching rule wins."
        >
          <ActionButton onClick={resetAllShortcuts}>Reset all to defaults</ActionButton>
        </SettingsRow>
      </SettingsGroup>

      {groupedCommands.map(([section, definitions]) => (
        <SettingsGroup key={section} title={section}>
          {definitions.map((definition) => {
            const rule = keybindings.find((entry) => entry.command === definition.command);
            const shortcut = rule?.shortcut ?? getDefaultKeybindingRules().find((entry) => entry.command === definition.command)?.shortcut;
            const conflicts = resolveKeybindingConflicts(keybindings, definition.command);
            const shortcutLabel = shortcut ? formatShortcutLabel(shortcut, platform) : 'Not set';
            const isCapturing = capturingCommand === definition.command;

            return (
              <div className="py-3" key={definition.command}>
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0">
                    <div className="text-md font-normal text-text-primary">{definition.title}</div>
                    <div className="mt-0.5 text-sm leading-relaxed text-text-tertiary">{definition.description}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCapturingCommand((current) => (current === definition.command ? null : definition.command))
                      }
                      onKeyDown={isCapturing ? handleCapture(definition.command) : undefined}
                      className={`inline-flex h-8 min-w-[128px] items-center justify-center rounded-md border px-3 font-mono text-xs transition ${
                        isCapturing
                          ? 'border-border-strong bg-bg-hover text-text-primary'
                          : 'border-border-subtle bg-transparent text-text-primary hover:bg-bg-hover'
                      }`}
                    >
                      {isCapturing ? 'Press keys…' : shortcutLabel}
                    </button>
                    <ActionButton onClick={() => resetCommandShortcut(definition.command)}>Reset</ActionButton>
                  </div>
                </div>
                {conflicts.length > 0 ? (
                  <div className="mt-2 text-2xs text-text-muted">
                    Also bound to{' '}
                    {conflicts.map((command) => APP_COMMANDS_BY_ID[command].title).join(', ')}. The last matching rule wins.
                  </div>
                ) : null}
                {shortcut ? (
                  <div className="mt-1.5 text-2xs font-mono text-text-faint/70">{serializeShortcut(shortcut)}</div>
                ) : null}
              </div>
            );
          })}
        </SettingsGroup>
      ))}
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
              {provider.meterValue != null ? <span className="text-xs text-text-tertiary">{provider.meterLabel}</span> : null}
            </div>
            {provider.meterValue != null ? (
              <div className="mt-3 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-ghost">
                  <div
                    className="h-full rounded-full bg-[var(--text-muted)]"
                    style={{ width: `${provider.meterValue}%` }}
                  />
                </div>
                <span className="w-12 text-right text-xs text-text-tertiary">{provider.meterLabel}</span>
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

/**
 * Codex settings feel (reference spec §6): no cards, no bordered
 * containers. Groups are separated by whitespace plus a single hairline,
 * headed by a dim 13px-scale label; rows are borderless label + control.
 */
function SettingsGroup({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <section className="border-t border-border-subtle pt-6 first:border-t-0 first:pt-0">
      <div className="mb-1.5 text-2xs font-medium uppercase tracking-[var(--tracking-label)] text-text-faint">
        {title}
      </div>
      <div>{children}</div>
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
      <div className="min-w-0">
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

function NumberStepper({
  value,
  min,
  max,
  defaultValue,
  unit = 'px',
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex h-9 items-center overflow-hidden rounded-md border border-border-default">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="inline-flex h-full w-9 items-center justify-center text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Decrease value"
        >
          <MinusIcon className="h-4 w-4" />
        </button>
        <span className="inline-flex h-full min-w-[64px] items-center justify-center gap-0.5 px-3 text-sm font-normal tabular-nums text-text-primary">
          {value}
          <span className="text-text-muted">{unit}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="inline-flex h-full w-9 items-center justify-center text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Increase value"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>
      {/* Reset sits after the control it resets, not in front of it. */}
      <Tooltip>
        <TooltipTrigger asChild>
          {/* `span`: a disabled button swallows pointer events, and "reset"
              is exactly what you hover to understand when it is greyed out. */}
          <span className="inline-flex">
            <button
              type="button"
              onClick={() => onChange(defaultValue)}
              disabled={value === defaultValue}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={`Reset to ${defaultValue}${unit}`}
            >
              <ReloadIcon className="h-4 w-4" />
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Reset to {defaultValue}
          {unit}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function FontFamilyField({
  value,
  placeholder,
  onCommit,
}: {
  value: FontFamilyOverride;
  placeholder: string;
  onCommit: (value: FontFamilyOverride) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [saved, setSaved] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  // Warn — never block — when the machine has no such family installed.
  useEffect(() => {
    const family = draft.trim();
    if (!family) {
      setMissing(false);
      return;
    }

    let cancelled = false;
    const check = () => {
      if (cancelled) {
        return;
      }

      try {
        const quoted = /[",]/.test(family) ? family : `"${family}"`;
        setMissing(!document.fonts.check(`16px ${quoted}`));
      } catch {
        setMissing(false);
      }
    };

    void document.fonts.ready.then(check);
    return () => {
      cancelled = true;
    };
  }, [draft]);

  useEffect(() => {
    if (!saved) {
      return;
    }

    const timer = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(timer);
  }, [saved]);

  const commitValue = (rawValue: string) => {
    const normalized = rawValue.trim();
    onCommit(normalized.length > 0 ? normalized : null);
    setSaved(true);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    commitValue(event.currentTarget.value);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commitValue(event.currentTarget.value);
      event.currentTarget.blur();
    }

    if (event.key === 'Escape') {
      setDraft(value ?? '');
      event.currentTarget.blur();
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        // The field previews the typeface it names.
        style={draft.trim() ? { fontFamily: draft } : undefined}
        className="h-9 min-w-[190px] rounded-md border border-border-default bg-transparent px-3 text-sm font-normal text-text-primary outline-none transition hover:bg-bg-hover focus:border-border-strong placeholder:text-text-muted"
        spellCheck={false}
      />
      {missing ? (
        <span role="status" className="text-2xs text-warning-text">
          Not installed on this machine — the system font will be used.
        </span>
      ) : saved ? (
        <span role="status" className="text-2xs text-success">
          Saved
        </span>
      ) : null}
    </div>
  );
}

/**
 * Segmented pickers: the selected cell needs a border + elevated surface, not a
 * 6% white wash that reads as "hovered".
 */
const SEGMENT_BASE =
  'inline-flex h-8 items-center rounded-full border px-3 text-sm font-normal transition';
const SEGMENT_ACTIVE = 'border-border-default bg-bg-elevated text-text-primary';
const SEGMENT_IDLE =
  'border-transparent text-text-tertiary hover:bg-bg-hover hover:text-text-primary';

function ColorField({
  value,
  placeholder,
  onCommit,
}: {
  value: string | null;
  placeholder: string;
  onCommit: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');

  // Track external changes (import, reset) without clobbering mid-edit text.
  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const commitDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      if (value !== null) {
        onCommit(null);
      }
      return;
    }

    const normalized = normalizeThemeColor(trimmed.startsWith('#') ? trimmed : `#${trimmed}`);
    if (normalized) {
      onCommit(normalized);
    } else {
      setDraft(value ?? '');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <label className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-full border border-border-medium">
        <span className="absolute inset-0" style={{ backgroundColor: value ?? 'transparent' }} />
        <input
          type="color"
          value={value ?? '#808080'}
          onChange={(event) => onCommit(event.target.value)}
          aria-label="Pick color"
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      <input
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
        className="h-8 w-32 rounded-md border border-border-default bg-bg-subtle px-2.5 font-mono text-xs uppercase text-text-primary placeholder:normal-case placeholder:text-text-faint focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]"
      />
      {value !== null ? (
        <button
          type="button"
          onClick={() => onCommit(null)}
          className="text-2xs text-text-muted transition hover:text-text-secondary"
        >
          Reset
        </button>
      ) : null}
    </div>
  );
}

function ContrastSlider({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="flex w-56 items-center gap-3">
      <input
        type="range"
        min={CONTRAST_MIN}
        max={CONTRAST_MAX}
        value={draft}
        aria-label="Contrast"
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={() => onCommit(draft)}
        onKeyUp={(event) => {
          if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
            onCommit(draft);
          }
        }}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-bg-active accent-[var(--accent)]"
      />
      <span className="w-7 shrink-0 text-right text-sm tabular-nums text-text-secondary">{draft}</span>
    </div>
  );
}

/**
 * `designTheme` gates the Light segment: a theme with no light palette (see
 * `DESIGN_THEMES_WITH_LIGHT`) cannot honour it — the app would paint a dark
 * UI under `color-scheme: light`, whitening native inputs and scrollbars.
 * Offering a mode that cannot be honoured is worse than not offering it, so
 * the segment is disabled and says why. Every shipped theme currently ships
 * both palettes; the gate stays so a future dark-only theme is refused here
 * rather than half-applied. `System` stays available either way.
 */
function ThemeModePicker({
  current,
  designTheme,
  onChange,
}: {
  current: ThemeMode;
  designTheme: DesignTheme;
  onChange: (mode: ThemeMode) => void;
}) {
  const supportsLight = designThemeSupportsLight(designTheme);
  // A preference stored before the theme changed (or before this gate existed)
  // can still say `light`. The app paints dark in that case, so the picker says
  // dark too rather than highlighting a segment that is disabled and inert.
  const effective: ThemeMode = current === 'light' && !supportsLight ? 'dark' : current;
  const items: Array<{ mode: ThemeMode; label: string; icon: typeof SunIcon }> = [
    { mode: 'light', label: 'Light', icon: SunIcon },
    { mode: 'dark', label: 'Dark', icon: MoonIcon },
    { mode: 'system', label: 'System', icon: DesktopIcon },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme mode"
      className="inline-flex rounded-full border border-border-subtle p-0.5"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.mode === effective;
        const isDisabled = item.mode === 'light' && !supportsLight;

        return (
          <button
            key={item.mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-disabled={isDisabled}
            disabled={isDisabled}
            title={isDisabled ? 'This design theme has no light palette.' : undefined}
            onClick={() => onChange(item.mode)}
            className={`${SEGMENT_BASE} gap-2 ${isActive ? SEGMENT_ACTIVE : SEGMENT_IDLE} ${
              isDisabled ? 'cursor-not-allowed opacity-40' : ''
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

function VisualModePicker({
  current,
  onChange,
}: {
  current: VisualMode;
  onChange: (mode: VisualMode) => void;
}) {
  const items: Array<{ mode: VisualMode; label: string }> = [
    { mode: 'auto', label: 'Automatic' },
    { mode: 'always', label: 'Always' },
    { mode: 'off', label: 'Never' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Inline visuals"
      className="inline-flex rounded-full border border-border-subtle p-0.5"
    >
      {items.map((item) => {
        const isActive = item.mode === current;

        return (
          <button
            key={item.mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(item.mode)}
            className={`${SEGMENT_BASE} ${isActive ? SEGMENT_ACTIVE : SEGMENT_IDLE}`}
          >
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function DesignThemePicker({ current, onChange }: { current: DesignTheme; onChange: (theme: DesignTheme) => void }) {  const items: Array<{ theme: DesignTheme; label: string; description: string }> = [
    { theme: 'codex', label: 'Codex', description: 'Squircle, tinted elevation' },
    { theme: 'xai', label: 'xAI', description: 'Brutalist monochrome' },
    { theme: 'default', label: 'Default', description: 'Modern balanced' },
    { theme: 'cursor', label: 'Cursor', description: 'Warm minimalism' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Design theme"
      className="inline-flex rounded-full border border-border-subtle p-0.5"
    >
      {items.map((item) => {
        const isActive = item.theme === current;

        return (
          <button
            key={item.theme}
            type="button"
            role="radio"
            aria-checked={isActive}
            title={item.description}
            onClick={() => onChange(item.theme)}
            className={`${SEGMENT_BASE} ${isActive ? SEGMENT_ACTIVE : SEGMENT_IDLE}`}
          >
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Live split preview of the selected design theme's light and dark
 * palettes.
 *
 * Each half is a plain element carrying `data-theme` and
 * `data-design-theme`, so the real stylesheets re-resolve every token
 * inside it — there is no second copy of any palette in TS, a theme edit
 * updates the preview for free, and the user's custom-color overrides
 * (inline custom properties on <html>) flow in through normal inheritance.
 */
function ThemeSplitPreview({ designTheme }: { designTheme: DesignTheme }) {
  return (
    <div className="grid grid-cols-2 gap-2 pb-3">
      {(['light', 'dark'] as const).map((mode) => (
        <div
          key={mode}
          data-theme={mode}
          data-design-theme={designTheme}
          className="min-w-0 space-y-2 rounded-lg border border-border-subtle bg-bg-base p-3"
        >
          <div className="flex items-center justify-between">
            {/* Sample chrome: title bar with a status dot. */}
            <span className="text-xs font-medium text-text-primary">Atlas</span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-success" />
              <span className="text-3xs uppercase tracking-[0.08em] text-text-faint">{mode}</span>
            </span>
          </div>

          {/* Sample transcript lines. */}
          <div className="space-y-1.5 rounded-md bg-bg-subtle p-2">
            <div className="h-1.5 w-4/5 rounded-full bg-text-secondary/70" />
            <div className="h-1.5 w-3/5 rounded-full bg-text-tertiary/60" />
            <div className="h-1.5 w-2/3 rounded-full bg-text-faint/50" />
          </div>

          {/* Sample actions: primary, accent fill, and an accent chip — the
              three pairings the WCAG guard measures. */}
          <div className="flex items-center gap-1.5">
            <span className="inline-flex h-6 shrink-0 items-center rounded-sm bg-bg-button px-2.5 text-2xs font-medium text-text-inverse">
              Primary
            </span>
            <span className="inline-flex h-6 shrink-0 items-center rounded-sm bg-brand px-2.5 text-2xs font-medium text-brand-text">
              Accent
            </span>
            <span className="inline-flex h-4 min-w-4 shrink-0 items-center rounded-[4px] bg-brand-surface px-1 font-mono text-[10px] font-semibold leading-none text-brand-strong">
              TS
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function BorderRadiusPicker({
  current,
  onChange,
}: {
  current: import('../../shared/contracts').BorderRadiusMode;
  onChange: (mode: import('../../shared/contracts').BorderRadiusMode) => void;
}) {
  const items: Array<{ mode: import('../../shared/contracts').BorderRadiusMode; label: string }> = [
    { mode: 'theme-default', label: 'Theme Default' },
    { mode: 'none', label: 'Sharp Edges' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Border radius"
      className="inline-flex rounded-full border border-border-subtle p-0.5"
    >
      {items.map((item) => {
        const isActive = item.mode === current;

        return (
          <button
            key={item.mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(item.mode)}
            className={`${SEGMENT_BASE} ${isActive ? SEGMENT_ACTIVE : SEGMENT_IDLE}`}
            style={item.mode === 'none' ? { borderRadius: 0 } : undefined}
          >
            <span>{item.label}</span>
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
      className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-normal transition disabled:cursor-not-allowed disabled:opacity-60 ${
        variant === 'primary'
          ? 'bg-bg-button text-text-inverse hover:bg-bg-button-hover'
          : 'border border-border-subtle bg-transparent text-text-primary hover:bg-bg-hover'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The shared Radix switch, with the ON track on the brand accent — a 12%-vs-4%
 * white wash was unreadable at a glance. Focus ring and disabled state come
 * from the primitive.
 */
function Switch({
  checked,
  onCheckedChange,
  ariaLabel,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <UiSwitch
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={ariaLabel}
      disabled={disabled}
      className="data-[state=checked]:bg-brand"
    />
  );
}

function StatusPill({
  children,
  tone = 'muted',
}: PropsWithChildren<{ tone?: 'success' | 'warning' | 'muted' }>) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning-text'
        : 'text-text-tertiary';

  return (
    <span
      className={`inline-flex h-7 items-center rounded-full border border-border-subtle px-2.5 text-xs font-normal ${toneClass}`}
    >
      {children}
    </span>
  );
}

function ValueBadge({ children }: PropsWithChildren) {
  return (
    <span className="text-sm font-normal tabular-nums text-text-secondary">{children}</span>
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
  return (
    <>
      <SettingsGroup title="Usage analytics">
        <SettingsRow
          title="Share anonymous usage events"
          description="Atlas can send anonymous event data (app launched, model selected, preferences updated) to help prioritize fixes. No message content, file names, or API keys are ever sent. Disabling this takes effect immediately."
        >
          <Switch
            checked={telemetryEnabled}
            onCheckedChange={onTelemetryChange}
            ariaLabel="Share anonymous usage events"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Local data">
        <SettingsRow
          title="Conversation history"
          description="All conversations and messages are stored locally in a SQLite database under your user data directory. They never leave your machine unless you explicitly use a tool that does so (e.g. web search or web fetch)."
        >
          <span className="text-sm text-text-tertiary">Local only</span>
        </SettingsRow>
        <SettingsRow
          title="API keys"
          description="Provider keys are stored in the operating system keychain via the keytar library. The renderer never has direct access to key values — only a boolean indicating whether a key is configured."
        >
          <span className="text-sm text-text-tertiary">OS keychain</span>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

