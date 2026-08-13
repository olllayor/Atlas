import {
  DownloadIcon,
  MagnifyingGlassIcon,
  Pencil1Icon,
  PlusIcon,
  TrashIcon
} from '@radix-ui/react-icons';
import { useEffect, useMemo, useState } from 'react';

import type {
  CustomProvider,
  CustomProviderApiFormat,
  CustomProviderModel,
  CustomProviderModelInput,
  DiscoveredModel
} from '../../../shared/customProviders';
import { formatContextWindow } from '../../../shared/customProviders';
import { notify } from '../../lib/notify';
import { useProvidersStore } from '../../stores/useProvidersStore';
import { Switch } from '../ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { AddModelDialog } from './AddModelDialog';
import { ApiFormatSelect } from './ApiFormatSelect';
import { ApiKeyInput } from './ApiKeyInput';
import { ConfirmDialog } from './ConfirmDialog';
import {
  baseUrlWarning,
  ErrorBanner,
  Field,
  fieldInputClass,
  fingerprintApiKey,
  SavedHint,
  useSavedFlash,
  validateBaseUrl
} from './formPrimitives';
import { ModelSelectionDialog } from './ModelSelectionDialog';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; message: string }
  | { kind: 'failed'; message: string };

export function ProviderDetail({ provider }: { provider: CustomProvider }) {
  const update = useProvidersStore((state) => state.update);
  const remove = useProvidersStore((state) => state.remove);
  const setModels = useProvidersStore((state) => state.setModels);
  const addModel = useProvidersStore((state) => state.addModel);
  const discoverModels = useProvidersStore((state) => state.discoverModels);
  const testConnection = useProvidersStore((state) => state.testConnection);
  const isDiscovering = useProvidersStore((state) => state.isDiscovering);
  const isTesting = useProvidersStore((state) => state.isTesting);
  const isSaving = useProvidersStore((state) => state.isSaving);
  const storeError = useProvidersStore((state) => state.error);
  const clearError = useProvidersStore((state) => state.clearError);

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(provider.name);
  const [baseUrlDraft, setBaseUrlDraft] = useState(provider.baseUrl);
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [keyFingerprint, setKeyFingerprint] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState<CustomProviderModel | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pendingModelDelete, setPendingModelDelete] = useState<CustomProviderModel | null>(null);
  const [modelFilter, setModelFilter] = useState('');
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[] | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [testState, setTestState] = useState<TestState>({ kind: 'idle' });

  const baseUrlSaved = useSavedFlash();
  const nameSaved = useSavedFlash();
  const keySaved = useSavedFlash();

  // Switching providers must not carry the previous provider's drafts over.
  useEffect(() => {
    setRenaming(false);
    setNameDraft(provider.name);
    setBaseUrlDraft(provider.baseUrl);
    setBaseUrlError(null);
    setApiKeyDraft('');
    setKeyFingerprint(null);
    setConfirmingDelete(false);
    setModelFilter('');
    setTestState({ kind: 'idle' });
  }, [provider.id, provider.name, provider.baseUrl]);

  const commitBaseUrl = () => {
    const next = baseUrlDraft.trim();
    const error = validateBaseUrl(next);
    if (error) {
      // Keep what the user typed and say why it did not stick.
      setBaseUrlError(error);
      return;
    }

    setBaseUrlError(null);
    if (next === provider.baseUrl) {
      return;
    }

    void update({ providerId: provider.id, baseUrl: next }).then(() => baseUrlSaved.flash());
  };

  const commitName = () => {
    const next = nameDraft.trim();
    setRenaming(false);

    if (!next || next === provider.name) {
      setNameDraft(provider.name);
      return;
    }

    void update({ providerId: provider.id, name: next }).then(() => nameSaved.flash());
  };

  const commitApiKey = () => {
    const next = apiKeyDraft.trim();
    if (!next) {
      return;
    }

    const fingerprint = fingerprintApiKey(next);
    void update({ providerId: provider.id, apiKey: next }).then(() => {
      setKeyFingerprint(fingerprint);
      keySaved.flash();
    });
    setApiKeyDraft('');
  };

  const handleFetchModels = async () => {
    const discovered = await discoverModels({ providerId: provider.id });
    if (discovered.length > 0) {
      setDiscoveredModels(discovered);
    }
  };

  const handleImport = async (selection: DiscoveredModel[]) => {
    const known = new Set(provider.models.map((model) => model.id));
    const additions = selection
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
      }));

    if (additions.length === 0) {
      setDiscoveredModels(null);
      return;
    }

    setIsImporting(true);
    // One IPC round-trip for the whole batch, not one per model.
    await setModels(provider.id, [...provider.models, ...additions]);
    setIsImporting(false);
    setDiscoveredModels(null);
    notify({
      tone: 'success',
      title: `Imported ${additions.length} model${additions.length === 1 ? '' : 's'}`,
      description: `${provider.name} now lists ${provider.models.length + additions.length}`
    });
  };

  const handleTest = async () => {
    setTestState({ kind: 'testing' });
    const result = await testConnection({ providerId: provider.id });
    setTestState(
      result.ok ? { kind: 'ok', message: result.message } : { kind: 'failed', message: result.message }
    );
  };

  const deleteModel = (model: CustomProviderModel) => {
    const snapshot = provider.models;
    void setModels(
      provider.id,
      snapshot.filter((entry) => entry.id !== model.id)
    ).then(() => {
      notify({
        tone: 'info',
        title: `Removed ${model.id}`,
        actionLabel: 'Undo',
        onAction: () => void setModels(provider.id, snapshot)
      });
    });
  };

  const visibleModels = useMemo(() => {
    const needle = modelFilter.trim().toLowerCase();
    if (!needle) {
      return provider.models;
    }

    return provider.models.filter(
      (model) =>
        model.id.toLowerCase().includes(needle) || model.label.toLowerCase().includes(needle)
    );
  }, [modelFilter, provider.models]);

  const keyPlaceholder = keyFingerprint
    ? `Saved · ${keyFingerprint}`
    : provider.hasApiKey
      ? 'Saved · hidden in keychain'
      : 'Paste your API key';

  return (
    <div>
      <div className="flex items-center gap-3">
        {renaming ? (
          <input
            value={nameDraft}
            autoFocus
            aria-label="Provider name"
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitName();
              if (event.key === 'Escape') {
                setNameDraft(provider.name);
                setRenaming(false);
              }
            }}
            className={`${fieldInputClass} min-w-0 flex-1 text-md`}
          />
        ) : (
          <>
            <h2 className="min-w-0 truncate text-md text-text-primary" title={provider.name}>
              {provider.name}
            </h2>
            <button
              type="button"
              onClick={() => setRenaming(true)}
              aria-label="Rename provider"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary"
            >
              <Pencil1Icon className="h-4 w-4" />
            </button>
            <SavedHint show={nameSaved.saved} />
          </>
        )}

        <span className="flex-1" />

        <label className="flex shrink-0 items-center gap-2 text-xs text-text-tertiary">
          <span>{provider.enabled ? 'Enabled' : 'Disabled'}</span>
          <Switch
            checked={provider.enabled}
            onCheckedChange={(enabled) => void update({ providerId: provider.id, enabled })}
            aria-label="Provider enabled"
            className="data-[state=checked]:bg-brand"
          />
        </label>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label={`Remove ${provider.name}`}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition hover:bg-error-bg hover:text-error"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Remove {provider.name}</TooltipContent>
        </Tooltip>
      </div>

      {storeError ? <ErrorBanner message={storeError} onDismiss={clearError} /> : null}

      <Field
        label="Base URL"
        htmlFor="provider-detail-base-url"
        hint={
          baseUrlWarning(baseUrlDraft) ??
          'Use the API root, not the completion path — Atlas appends the endpoint itself.'
        }
        error={baseUrlError}
      >
        <div className="flex items-center gap-2">
          <input
            id="provider-detail-base-url"
            value={baseUrlDraft}
            onChange={(event) => {
              setBaseUrlDraft(event.target.value);
              setBaseUrlError(null);
            }}
            onBlur={commitBaseUrl}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                setBaseUrlDraft(provider.baseUrl);
                setBaseUrlError(null);
              }
            }}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={baseUrlError != null}
            className={fieldInputClass}
          />
          <SavedHint show={baseUrlSaved.saved} />
        </div>
      </Field>

      <Field label="API format" htmlFor="provider-detail-api-format">
        <ApiFormatSelect
          id="provider-detail-api-format"
          value={provider.apiFormat}
          onChange={(apiFormat: CustomProviderApiFormat) =>
            void update({ providerId: provider.id, apiFormat })
          }
        />
      </Field>

      <Field
        label="API key"
        htmlFor="provider-detail-api-key"
        hint="Stored in your OS keychain. Saved keys are never read back into this field."
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ApiKeyInput
              id="provider-detail-api-key"
              value={apiKeyDraft}
              onChange={setApiKeyDraft}
              placeholder={keyPlaceholder}
              onSave={commitApiKey}
              isSaving={isSaving}
            />
          </div>
          <SavedHint show={keySaved.saved} />
        </div>
      </Field>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={isTesting}
          className="inline-flex h-9 items-center rounded-md border border-border-default bg-bg-subtle px-3 text-xs text-text-primary transition hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          Test connection
        </button>
        <TestResult state={testState} />
      </div>

      <div className="mt-7 flex items-center justify-between gap-3">
        <span className="text-2xs font-medium uppercase tracking-[var(--tracking-label)] text-text-faint">
          Models · {provider.models.length}
        </span>
        <button
          type="button"
          onClick={() => void handleFetchModels()}
          disabled={isDiscovering}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default bg-bg-subtle px-2.5 text-xs text-text-primary transition hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          {isDiscovering ? 'Fetching…' : 'Fetch from endpoint'}
        </button>
      </div>

      {provider.models.length > 6 ? (
        <div className="relative mt-3">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            value={modelFilter}
            onChange={(event) => setModelFilter(event.target.value)}
            placeholder="Filter models…"
            aria-label="Filter models"
            spellCheck={false}
            className={`${fieldInputClass} pl-9`}
          />
        </div>
      ) : null}

      {provider.models.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-border-default px-3 py-6 text-center text-xs text-text-muted">
          No models yet. Add one by ID, or fetch the list from the endpoint.
        </p>
      ) : visibleModels.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-border-default px-3 py-6 text-center text-xs text-text-muted">
          No models match “{modelFilter.trim()}”.
        </p>
      ) : (
        <ul className="mt-3 max-h-[320px] divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-default scroll-container">
          {visibleModels.map((model) => {
            const badge = formatContextWindow(model.contextWindow);

            return (
              <li key={model.id} className="flex items-center gap-1.5 px-3 py-1.5">
                <span
                  className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary"
                  title={model.id}
                >
                  {model.id}
                </span>

                {badge ? (
                  <span className="shrink-0 rounded-sm border border-border-default px-1.5 py-0.5 text-2xs text-text-tertiary">
                    {badge}
                  </span>
                ) : null}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingModel(model);
                        setDialogOpen(true);
                      }}
                      aria-label={`Edit ${model.id}`}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary"
                    >
                      <Pencil1Icon className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Edit {model.id}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setPendingModelDelete(model)}
                      aria-label={`Remove ${model.id}`}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition hover:bg-error-bg hover:text-error"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Remove {model.id}</TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => {
          setEditingModel(null);
          setDialogOpen(true);
        }}
        className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md border border-border-default bg-bg-subtle px-3 text-xs text-text-primary transition hover:bg-bg-hover"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Add model
      </button>

      <AddModelDialog
        open={dialogOpen}
        initialModel={editingModel}
        existingModelIds={provider.models.map((model) => model.id)}
        onCancel={() => {
          setDialogOpen(false);
          setEditingModel(null);
        }}
        onSave={(model) => {
          if (editingModel) {
            void setModels(
              provider.id,
              provider.models.map((entry) => (entry.id === editingModel.id ? { ...entry, ...model } : entry))
            );
          } else {
            void addModel(provider.id, model);
          }

          setDialogOpen(false);
          setEditingModel(null);
        }}
      />

      <ModelSelectionDialog
        open={discoveredModels != null}
        models={discoveredModels ?? []}
        alreadyAddedIds={provider.models.map((model) => model.id)}
        isImporting={isImporting}
        onCancel={() => setDiscoveredModels(null)}
        onImport={(selection) => void handleImport(selection)}
      />

      <ConfirmDialog
        open={pendingModelDelete != null}
        title="Remove this model?"
        description={
          <span className="break-all font-mono text-xs">{pendingModelDelete?.id}</span>
        }
        confirmLabel="Remove"
        tone="danger"
        onCancel={() => setPendingModelDelete(null)}
        onConfirm={() => {
          if (pendingModelDelete) {
            deleteModel(pendingModelDelete);
          }

          setPendingModelDelete(null);
        }}
      />

      <ConfirmDialog
        open={confirmingDelete}
        title="Remove this provider?"
        description={
          <>
            <span className="block truncate font-medium text-text-secondary" title={provider.name}>
              {provider.name}
            </span>
            <span className="mt-1 block">
              Its {provider.models.length} model{provider.models.length === 1 ? '' : 's'} and its stored
              API key are deleted. Existing conversations are kept.
            </span>
          </>
        }
        confirmLabel="Remove provider"
        tone="danger"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false);
          void remove(provider.id);
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
