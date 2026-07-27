import { PlusIcon } from '@radix-ui/react-icons';
import { useEffect, useMemo, useState } from 'react';

import type {
  CustomProviderApiFormat,
  CustomProviderModelInput
} from '../../../shared/customProviders';
import {
  CUSTOM_PROVIDER_API_FORMATS,
  DEFAULT_CUSTOM_PROVIDER_API_FORMAT,
  formatContextWindow
} from '../../../shared/customProviders';
import { useProvidersStore } from '../../stores/useProvidersStore';
import { AddModelDialog } from './AddModelDialog';
import { ApiFormatSelect } from './ApiFormatSelect';

/**
 * The "Add model provider" pane. Models can be staged here before the provider
 * exists, so the whole configuration lands in a single save.
 */
export function ProviderForm({ onCreated }: { onCreated: () => void }) {
  const create = useProvidersStore((state) => state.create);
  const testConnection = useProvidersStore((state) => state.testConnection);
  const discoverModels = useProvidersStore((state) => state.discoverModels);
  const isSaving = useProvidersStore((state) => state.isSaving);
  const isDiscovering = useProvidersStore((state) => state.isDiscovering);
  const presets = useProvidersStore((state) => state.presets);
  const loadPresets = useProvidersStore((state) => state.loadPresets);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiFormat, setApiFormat] = useState<CustomProviderApiFormat>(DEFAULT_CUSTOM_PROVIDER_API_FORMAT);
  const [models, setModels] = useState<CustomProviderModelInput[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Only presets that publish an API root can prefill the form.
  const usablePresets = useMemo(() => presets.filter((preset) => preset.baseUrl), [presets]);

  const probe = { baseUrl: baseUrl.trim(), apiFormat, apiKey: apiKey.trim() };
  const canProbe = Boolean(probe.baseUrl && probe.apiKey);

  const handleImportModels = async () => {
    const discovered = await discoverModels(probe);
    if (discovered.length === 0) {
      return;
    }

    setModels((current) => {
      const known = new Set(current.map((model) => model.id));
      return [
        ...current,
        ...discovered
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
            supportsTemperature: model.supportsTemperature
          }))
      ];
    });
  };

  const handleSubmit = async () => {
    const created = await create({
      name,
      baseUrl,
      apiFormat,
      apiKey: apiKey.trim() || undefined,
      models
    });

    if (created) {
      setName('');
      setBaseUrl('');
      setApiKey('');
      setModels([]);
      onCreated();
    }
  };

  return (
    <div>
      <h2 className="text-[17px] font-normal text-text-primary">Add model provider</h2>
      <p className="mt-1.5 text-[13px] text-text-tertiary">
        Configure a custom API endpoint and initial model.
      </p>

      {usablePresets.length > 0 ? (
        <Field
          label="Start from a known provider"
          htmlFor="provider-preset"
          hint="Fills in the name, base URL and API format. Everything stays editable."
        >
          <select
            id="provider-preset"
            defaultValue=""
            onChange={(event) => {
              const preset = usablePresets.find((entry) => entry.id === event.target.value);
              if (!preset?.baseUrl) {
                return;
              }

              setName(preset.name);
              setBaseUrl(preset.baseUrl);
              setApiFormat(preset.apiFormat);
            }}
            className={`${inputClass} appearance-none`}
          >
            <option value="">Custom endpoint…</option>
            {usablePresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name} ({preset.modelCount} models)
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field label="Name" htmlFor="provider-name">
        <input
          id="provider-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. DeepSeek"
          className={inputClass}
        />
      </Field>

      <Field
        label="Base URL"
        htmlFor="provider-base-url"
        hint="Use the API root, not the completion path — Atlas appends the endpoint itself."
      >
        <input
          id="provider-base-url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.example.com/v1"
          spellCheck={false}
          autoComplete="off"
          className={inputClass}
        />
      </Field>

      <Field label="API key" htmlFor="provider-api-key">
        <input
          id="provider-api-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Enter API key"
          spellCheck={false}
          autoComplete="off"
          className={inputClass}
        />
      </Field>

      <Field label="API format" htmlFor="provider-api-format">
        <ApiFormatSelect id="provider-api-format" value={apiFormat} onChange={setApiFormat} />
        <p className="mt-1.5 text-[12px] text-text-muted">
          {CUSTOM_PROVIDER_API_FORMATS.find((entry) => entry.value === apiFormat)?.hint}
        </p>
      </Field>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-text-tertiary">Model list</span>
          <button
            type="button"
            onClick={handleImportModels}
            disabled={!canProbe || isDiscovering}
            className="text-[12px] text-text-tertiary underline transition hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDiscovering ? 'Fetching…' : 'Fetch from endpoint'}
          </button>
        </div>

        {models.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {models.map((model) => {
              const badge = formatContextWindow(model.contextWindow);

              return (
                <li
                  key={model.id}
                  className="flex items-center justify-between border border-border-default bg-bg-subtle px-3 py-2"
                >
                  <span className="truncate font-mono text-[12.5px] text-text-primary">{model.id}</span>
                  <span className="flex items-center gap-2">
                    {badge ? (
                      <span className="border border-border-default px-1.5 py-0.5 text-[11px] text-text-tertiary">
                        {badge}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setModels((current) => current.filter((entry) => entry.id !== model.id))}
                      className="text-[12px] text-text-tertiary transition hover:text-text-primary"
                    >
                      Remove
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}

        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="mt-3 inline-flex h-9 items-center gap-1.5 border border-border-default bg-bg-subtle px-3 text-[12.5px] text-text-primary transition hover:bg-bg-hover"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Add model
        </button>
      </div>

      <div className="mt-7 flex items-center gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSaving}
          className="inline-flex h-9 items-center bg-bg-button px-4 text-[12.5px] text-text-inverse transition hover:bg-bg-button-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? 'Adding…' : 'Add provider'}
        </button>
        <button
          type="button"
          onClick={() => testConnection(probe)}
          disabled={!canProbe || isDiscovering}
          className="inline-flex h-9 items-center border border-border-default bg-bg-subtle px-3 text-[12.5px] text-text-primary transition hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          Test connection
        </button>
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
    </div>
  );
}

const inputClass =
  'h-11 w-full border border-border-default bg-bg-subtle px-3 text-[13px] text-text-primary outline-none placeholder:text-text-muted focus:border-border-strong';

function Field({
  label,
  htmlFor,
  hint,
  children
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5">
      <label htmlFor={htmlFor} className="block text-[13px] text-text-tertiary">
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {hint ? <p className="mt-1.5 text-[12px] text-text-muted">{hint}</p> : null}
    </div>
  );
}
