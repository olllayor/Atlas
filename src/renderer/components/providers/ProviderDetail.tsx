import { CheckIcon, Cross2Icon, EyeClosedIcon, EyeOpenIcon, Pencil1Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { useEffect, useState } from 'react';

import type {
  CustomProvider,
  CustomProviderApiFormat,
  CustomProviderModel
} from '../../../shared/customProviders';
import { formatContextWindow } from '../../../shared/customProviders';
import { useProvidersStore } from '../../stores/useProvidersStore';
import { AddModelDialog } from './AddModelDialog';
import { ApiFormatSelect } from './ApiFormatSelect';

export function ProviderDetail({ provider }: { provider: CustomProvider }) {
  const update = useProvidersStore((state) => state.update);
  const remove = useProvidersStore((state) => state.remove);
  const addModel = useProvidersStore((state) => state.addModel);
  const updateModel = useProvidersStore((state) => state.updateModel);
  const removeModel = useProvidersStore((state) => state.removeModel);
  const discoverModels = useProvidersStore((state) => state.discoverModels);
  const isDiscovering = useProvidersStore((state) => state.isDiscovering);

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(provider.name);
  const [baseUrlDraft, setBaseUrlDraft] = useState(provider.baseUrl);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [revealKey, setRevealKey] = useState(false);
  const [editingModel, setEditingModel] = useState<CustomProviderModel | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Switching providers must not carry the previous provider's drafts over.
  useEffect(() => {
    setRenaming(false);
    setNameDraft(provider.name);
    setBaseUrlDraft(provider.baseUrl);
    setApiKeyDraft('');
    setRevealKey(false);
    setConfirmingDelete(false);
  }, [provider.id, provider.name, provider.baseUrl]);

  const commitBaseUrl = () => {
    const next = baseUrlDraft.trim();
    if (!next || next === provider.baseUrl) {
      setBaseUrlDraft(provider.baseUrl);
      return;
    }

    void update({ providerId: provider.id, baseUrl: next });
  };

  const commitName = () => {
    const next = nameDraft.trim();
    setRenaming(false);

    if (!next || next === provider.name) {
      setNameDraft(provider.name);
      return;
    }

    void update({ providerId: provider.id, name: next });
  };

  const commitApiKey = () => {
    const next = apiKeyDraft.trim();
    if (!next) {
      return;
    }

    void update({ providerId: provider.id, apiKey: next });
    setApiKeyDraft('');
    setRevealKey(false);
  };

  const handleImport = async () => {
    const discovered = await discoverModels({ providerId: provider.id });
    const known = new Set(provider.models.map((model) => model.id));
    const additions = discovered.filter((model) => !known.has(model.id));

    for (const model of additions) {
      await addModel(provider.id, {
        id: model.id,
        label: model.label,
        isFree: model.isFree,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        supportsVision: model.supportsVision,
        supportsDocumentInput: model.supportsDocumentInput,
        supportsTools: model.supportsTools,
        supportsReasoning: model.supportsReasoning,
        supportsTemperature: model.supportsTemperature
      });
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        {renaming ? (
          <input
            value={nameDraft}
            autoFocus
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitName();
              if (event.key === 'Escape') {
                setNameDraft(provider.name);
                setRenaming(false);
              }
            }}
            className="h-9 min-w-0 flex-1 border border-border-default bg-bg-subtle px-2 text-[17px] text-text-primary outline-none focus:border-border-strong"
          />
        ) : (
          <>
            <h2 className="text-[17px] font-normal text-text-primary">{provider.name}</h2>
            <button
              type="button"
              onClick={() => setRenaming(true)}
              aria-label="Rename provider"
              className="text-text-tertiary transition hover:text-text-primary"
            >
              <Pencil1Icon className="h-4 w-4" />
            </button>
          </>
        )}

        <span className="ml-1 inline-flex h-7 items-center border border-border-default bg-bg-subtle px-2.5 text-[11px] text-text-tertiary">
          {provider.enabled ? 'Enabled' : 'Disabled'}
        </span>

        <button
          type="button"
          onClick={() => update({ providerId: provider.id, enabled: !provider.enabled })}
          className="inline-flex h-7 items-center border border-border-default bg-bg-subtle px-2.5 text-[11.5px] text-text-primary transition hover:bg-bg-hover"
        >
          {provider.enabled ? 'Disable' : 'Enable'}
        </button>

        <span className="flex-1" />

        {confirmingDelete ? (
          <span className="flex items-center gap-2">
            <span className="text-[12px] text-text-tertiary">Remove {provider.name}?</span>
            <button
              type="button"
              onClick={() => remove(provider.id)}
              className="inline-flex h-7 items-center border border-border-strong bg-bg-hover px-2.5 text-[11.5px] text-text-primary"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              aria-label="Cancel remove"
              className="text-text-tertiary transition hover:text-text-primary"
            >
              <Cross2Icon className="h-4 w-4" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label="Remove provider"
            className="text-text-tertiary transition hover:text-text-primary"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <FieldLabel>Base URL</FieldLabel>
      <input
        value={baseUrlDraft}
        onChange={(event) => setBaseUrlDraft(event.target.value)}
        onBlur={commitBaseUrl}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        spellCheck={false}
        autoComplete="off"
        className={inputClass}
      />

      <FieldLabel>API format</FieldLabel>
      <ApiFormatSelect
        value={provider.apiFormat}
        onChange={(apiFormat: CustomProviderApiFormat) => update({ providerId: provider.id, apiFormat })}
      />

      <FieldLabel>API key</FieldLabel>
      <div className="relative">
        <input
          type={revealKey ? 'text' : 'password'}
          value={apiKeyDraft}
          onChange={(event) => setApiKeyDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitApiKey();
          }}
          placeholder={provider.hasApiKey ? '•'.repeat(48) : 'Enter API key'}
          spellCheck={false}
          autoComplete="off"
          className={`${inputClass} pr-20`}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {apiKeyDraft.trim() ? (
            <button
              type="button"
              onClick={commitApiKey}
              aria-label="Save API key"
              className="inline-flex h-7 w-7 items-center justify-center text-text-tertiary transition hover:text-text-primary"
            >
              <CheckIcon className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setRevealKey((current) => !current)}
            aria-label={revealKey ? 'Hide API key' : 'Show API key'}
            className="inline-flex h-7 w-7 items-center justify-center text-text-tertiary transition hover:text-text-primary"
          >
            {revealKey ? <EyeClosedIcon className="h-4 w-4" /> : <EyeOpenIcon className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <p className="mt-1.5 text-[12px] text-text-muted">
        Stored in your OS keychain. Saved keys are never read back into this field.
      </p>

      <div className="mt-6 flex items-center justify-between">
        <span className="text-[13px] text-text-tertiary">Model list</span>
        <button
          type="button"
          onClick={handleImport}
          disabled={!provider.hasApiKey || isDiscovering}
          className="text-[12px] text-text-tertiary underline transition hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDiscovering ? 'Fetching…' : 'Fetch from endpoint'}
        </button>
      </div>

      {provider.models.length === 0 ? (
        <p className="mt-3 border border-dashed border-border-default px-3 py-6 text-center text-[12.5px] text-text-muted">
          No models yet. Add one by ID, or fetch the list from the endpoint.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border-subtle border border-border-default">
          {provider.models.map((model) => {
            const badge = formatContextWindow(model.contextWindow);

            return (
              <li key={model.id} className="flex items-center gap-2 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-text-primary">
                  {model.id}
                </span>

                {badge ? (
                  <span className="shrink-0 border border-border-default px-1.5 py-0.5 text-[11px] text-text-tertiary">
                    {badge}
                  </span>
                ) : null}

                <button
                  type="button"
                  onClick={() => updateModel(provider.id, model.id, { supportsTools: !model.supportsTools })}
                  aria-label={model.supportsTools ? 'Disable tools for this model' : 'Enable tools for this model'}
                  title={model.supportsTools ? 'Tools enabled' : 'Tools disabled'}
                  className={`shrink-0 text-[11px] transition ${
                    model.supportsTools ? 'text-text-secondary' : 'text-text-faint hover:text-text-tertiary'
                  }`}
                >
                  tools
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setEditingModel(model);
                    setDialogOpen(true);
                  }}
                  aria-label={`Edit ${model.id}`}
                  className="shrink-0 text-text-tertiary transition hover:text-text-primary"
                >
                  <Pencil1Icon className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => removeModel(provider.id, model.id)}
                  aria-label={`Remove ${model.id}`}
                  className="shrink-0 text-text-tertiary transition hover:text-text-primary"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
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
        className="mt-3 inline-flex h-9 items-center gap-1.5 border border-border-default bg-bg-subtle px-3 text-[12.5px] text-text-primary transition hover:bg-bg-hover"
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
            void useProvidersStore.getState().setModels(
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
    </div>
  );
}

const inputClass =
  'h-11 w-full border border-border-default bg-bg-subtle px-3 text-[13px] text-text-primary outline-none placeholder:text-text-muted focus:border-border-strong';

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 mt-5 text-[13px] text-text-tertiary">{children}</div>;
}
