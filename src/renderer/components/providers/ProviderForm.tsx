import { ChevronDownIcon, Cross2Icon, DownloadIcon, PlusIcon } from '@radix-ui/react-icons';
import { useEffect, useMemo, useState } from 'react';

import type {
  CustomProviderApiFormat,
  CustomProviderModelInput,
  DiscoveredModel,
  ProviderPreset
} from '../../../shared/customProviders';
import {
  CUSTOM_PROVIDER_API_FORMATS,
  DEFAULT_CUSTOM_PROVIDER_API_FORMAT,
  formatContextWindow
} from '../../../shared/customProviders';
import { useProvidersStore } from '../../stores/useProvidersStore';
import { AddModelDialog } from './AddModelDialog';
import { ApiFormatSelect } from './ApiFormatSelect';
import { ApiKeyInput } from './ApiKeyInput';
import { ConfirmDialog } from './ConfirmDialog';
import {
  baseUrlWarning,
  ErrorBanner,
  Field,
  fieldInputClass,
  validateBaseUrl
} from './formPrimitives';
import { ModelSelectionDialog } from './ModelSelectionDialog';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; message: string }
  | { kind: 'failed'; message: string };

/**
 * The "Add model provider" pane. Models can be staged here before the provider
 * exists, so the whole configuration lands in a single save.
 */
export function ProviderForm({
  onCreated,
  onDirtyChange
}: {
  onCreated: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const create = useProvidersStore((state) => state.create);
  const testConnection = useProvidersStore((state) => state.testConnection);
  const discoverModels = useProvidersStore((state) => state.discoverModels);
  const isSaving = useProvidersStore((state) => state.isSaving);
  const isDiscovering = useProvidersStore((state) => state.isDiscovering);
  const isTesting = useProvidersStore((state) => state.isTesting);
  const presets = useProvidersStore((state) => state.presets);
  const loadPresets = useProvidersStore((state) => state.loadPresets);
  const storeError = useProvidersStore((state) => state.error);
  const clearError = useProvidersStore((state) => state.clearError);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const [presetId, setPresetId] = useState('');
  const [pendingPreset, setPendingPreset] = useState<ProviderPreset | null>(null);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiFormat, setApiFormat] = useState<CustomProviderApiFormat>(DEFAULT_CUSTOM_PROVIDER_API_FORMAT);
  const [models, setModels] = useState<CustomProviderModelInput[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [touched, setTouched] = useState<{ name: boolean; baseUrl: boolean }>({
    name: false,
    baseUrl: false
  });
  const [testState, setTestState] = useState<TestState>({ kind: 'idle' });
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[] | null>(null);

  // Only presets that publish an API root can prefill the form.
  const usablePresets = useMemo(() => presets.filter((preset) => preset.baseUrl), [presets]);

  const nameError = name.trim() ? null : 'Give this provider a name.';
  const baseUrlError = validateBaseUrl(baseUrl);
  const baseUrlHint = baseUrlWarning(baseUrl);
  const isValid = !nameError && !baseUrlError;

  const isDirty =
    name.trim().length > 0 || baseUrl.trim().length > 0 || apiKey.length > 0 || models.length > 0;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // A probe result is only meaningful for the inputs that produced it.
  useEffect(() => {
    setTestState({ kind: 'idle' });
  }, [baseUrl, apiFormat, apiKey]);

  const probe = { baseUrl: baseUrl.trim(), apiFormat, apiKey: apiKey.trim() || undefined };
  // Local endpoints (Ollama, LM Studio, vLLM) need no key at all.
  const canProbe = Boolean(probe.baseUrl) && !baseUrlError;

  const applyPreset = (preset: ProviderPreset) => {
    setPresetId(preset.id);
    setName(preset.name);
    setBaseUrl(preset.baseUrl ?? '');
    setApiFormat(preset.apiFormat);
    setTouched({ name: true, baseUrl: true });
  };

  const handlePresetChange = (nextId: string) => {
    if (!nextId) {
      setPresetId('');
      return;
    }

    const preset = usablePresets.find((entry) => entry.id === nextId);
    if (!preset) {
      return;
    }

    // Never silently discard something the user typed.
    if (name.trim() || baseUrl.trim()) {
      setPendingPreset(preset);
      return;
    }

    applyPreset(preset);
  };

  const handleFetchModels = async () => {
    const discovered = await discoverModels(probe);
    if (discovered.length > 0) {
      setDiscoveredModels(discovered);
    }
  };

  const handleTest = async () => {
    setTestState({ kind: 'testing' });
    const result = await testConnection(probe);
    setTestState(result.ok ? { kind: 'ok', message: result.message } : { kind: 'failed', message: result.message });
  };

  const handleSubmit = async () => {
    setTouched({ name: true, baseUrl: true });
    if (!isValid) {
      return;
    }

    const created = await create({
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiFormat,
      apiKey: apiKey.trim() || undefined,
      models
    });

    if (created) {
      setName('');
      setBaseUrl('');
      setApiKey('');
      setModels([]);
      setPresetId('');
      setTouched({ name: false, baseUrl: false });
      onCreated();
    }
  };

  return (
    <div>
      <h2 className="text-md text-text-primary">Add model provider</h2>
      <p className="mt-1.5 text-sm text-text-tertiary">
        Point Atlas at any OpenAI-, Anthropic- or Responses-compatible endpoint.
      </p>

      {storeError ? <ErrorBanner message={storeError} onDismiss={clearError} /> : null}

      {usablePresets.length > 0 ? (
        <Field
          label="Start from a known provider"
          htmlFor="provider-preset"
          hint="Fills in the name, base URL and API format. Everything stays editable."
        >
          <div className="relative">
            <select
              id="provider-preset"
              value={presetId}
              onChange={(event) => handlePresetChange(event.target.value)}
              className={`${fieldInputClass} appearance-none pr-9`}
            >
              <option value="">Custom endpoint…</option>
              {usablePresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <ChevronGlyph />
          </div>
        </Field>
      ) : null}

      <Field
        label="Name"
        htmlFor="provider-name"
        error={touched.name ? nameError : null}
      >
        <input
          id="provider-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, name: true }))}
          placeholder="DeepSeek"
          className={fieldInputClass}
        />
      </Field>

      <Field
        label="Base URL"
        htmlFor="provider-base-url"
        hint={
          baseUrlHint ??
          'Use the API root, not the completion path — Atlas appends the endpoint itself.'
        }
        error={touched.baseUrl ? baseUrlError : null}
      >
        <input
          id="provider-base-url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, baseUrl: true }))}
          placeholder="https://api.deepseek.com/v1"
          spellCheck={false}
          autoComplete="off"
          className={fieldInputClass}
        />
      </Field>

      <Field
        label="API key"
        htmlFor="provider-api-key"
        hint="Optional for local endpoints. Stored in your OS keychain."
      >
        <ApiKeyInput id="provider-api-key" value={apiKey} onChange={setApiKey} />
      </Field>

      <Field
        label="API format"
        htmlFor="provider-api-format"
        hint={CUSTOM_PROVIDER_API_FORMATS.find((entry) => entry.value === apiFormat)?.hint}
      >
        <ApiFormatSelect id="provider-api-format" value={apiFormat} onChange={setApiFormat} />
      </Field>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-2xs font-medium uppercase tracking-[var(--tracking-label)] text-text-faint">
            Models
          </span>
          <button
            type="button"
            onClick={() => void handleFetchModels()}
            disabled={!canProbe || isDiscovering}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default bg-bg-subtle px-2.5 text-xs text-text-primary transition hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            {isDiscovering ? 'Fetching…' : 'Fetch from endpoint'}
          </button>
        </div>

        {models.length > 0 ? (
          <ul className="mt-3 max-h-[280px] divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-default scroll-container">
            {models.map((model) => {
              const badge = formatContextWindow(model.contextWindow ?? null);

              return (
                <li key={model.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary" title={model.id}>
                    {model.id}
                  </span>
                  {badge ? (
                    <span className="shrink-0 rounded-sm border border-border-default px-1.5 py-0.5 text-2xs text-text-tertiary">
                      {badge}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setModels((current) => current.filter((entry) => entry.id !== model.id))}
                    aria-label={`Remove ${model.id}`}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition hover:bg-bg-hover hover:text-error"
                  >
                    <Cross2Icon className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md border border-border-default bg-bg-subtle px-3 text-xs text-text-primary transition hover:bg-bg-hover"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Add model
        </button>
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={isSaving || !isValid}
          className="inline-flex h-9 items-center rounded-md bg-bg-button px-4 text-xs text-text-inverse transition hover:bg-bg-button-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? 'Adding…' : 'Add provider'}
        </button>
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={!canProbe || isTesting}
          className="inline-flex h-9 items-center rounded-md border border-border-default bg-bg-subtle px-3 text-xs text-text-primary transition hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          Test connection
        </button>
        <TestResult state={testState} />
      </div>

      <AddModelDialog
        open={dialogOpen}
        existingModelIds={models.map((model) => model.id)}
        onCancel={() => setDialogOpen(false)}
        onSave={(model) => {
          setModels((current) => [...current, model]);
          setDialogOpen(false);
        }}
      />

      <ModelSelectionDialog
        open={discoveredModels != null}
        models={discoveredModels ?? []}
        alreadyAddedIds={models.map((model) => model.id)}
        onCancel={() => setDiscoveredModels(null)}
        onImport={(selection) => {
          setModels((current) => {
            const known = new Set(current.map((model) => model.id));
            return [
              ...current,
              ...selection
                .filter((model) => !known.has(model.id))
                .map<CustomProviderModelInput>((model) => ({
                  id: model.id,
                  label: model.label,
                  isFree: model.isFree,
                  contextWindow: model.contextWindow,
                  maxOutputTokens: model.maxOutputTokens,
                  supportsVision: model.supportsVision,
                  supportsDocumentInput: model.supportsDocumentInput,
                  supportsTools: model.supportsTools,
                  supportsReasoning: model.supportsReasoning,
                  supportsTemperature: model.supportsTemperature,
                  reasoningEfforts: model.reasoningEfforts
                }))
            ];
          });
          // No toast: the picker closes and the staged rows appear in the list
          // directly below. Announcing a change the user is already looking at
          // is noise.
          setDiscoveredModels(null);
        }}
      />

      <ConfirmDialog
        open={pendingPreset != null}
        title="Replace what you typed?"
        description={`Applying “${pendingPreset?.name ?? ''}” overwrites the name, base URL and API format currently in this form.`}
        confirmLabel="Apply preset"
        onCancel={() => setPendingPreset(null)}
        onConfirm={() => {
          if (pendingPreset) {
            applyPreset(pendingPreset);
          }

          setPendingPreset(null);
        }}
      />
    </div>
  );
}

function TestResult({ state }: { state: TestState }) {
  if (state.kind === 'idle') {
    return null;
  }

  if (state.kind === 'testing') {
    return <span className="text-xs text-text-tertiary">Testing…</span>;
  }

  if (state.kind === 'ok') {
    return (
      <span role="status" className="text-xs text-success">
        {state.message}
      </span>
    );
  }

  return (
    <span role="alert" className="min-w-0 truncate text-xs text-error" title={state.message}>
      Failed: {state.message}
    </span>
  );
}

function ChevronGlyph() {
  return (
    <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
  );
}
