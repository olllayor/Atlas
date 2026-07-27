import { Cross2Icon } from '@radix-ui/react-icons';
import { useEffect, useState } from 'react';

import type { CustomProviderModel, CustomProviderModelInput } from '../../../shared/customProviders';
import { DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW } from '../../../shared/customProviders';

type AddModelDialogProps = {
  open: boolean;
  /** Supplied when editing an existing row; omitted when adding a new one. */
  initialModel?: CustomProviderModel | null;
  existingModelIds: string[];
  onCancel: () => void;
  onSave: (model: CustomProviderModelInput) => void;
};

export function AddModelDialog({
  open,
  initialModel,
  existingModelIds,
  onCancel,
  onSave
}: AddModelDialogProps) {
  const [modelId, setModelId] = useState('');
  const [contextWindow, setContextWindow] = useState(String(DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW));
  const [error, setError] = useState<string | null>(null);

  // Reset whenever the dialog opens so a cancelled edit does not leak forward.
  useEffect(() => {
    if (!open) {
      return;
    }

    setModelId(initialModel?.id ?? '');
    setContextWindow(
      String(initialModel?.contextWindow ?? DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW)
    );
    setError(null);
  }, [initialModel, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, open]);

  if (!open) {
    return null;
  }

  const handleSave = () => {
    const trimmed = modelId.trim();
    if (!trimmed) {
      setError('Enter the model ID exactly as the provider expects it.');
      return;
    }

    const isRename = initialModel != null && initialModel.id !== trimmed;
    if ((initialModel == null || isRename) && existingModelIds.includes(trimmed)) {
      setError('That model is already in the list.');
      return;
    }

    const parsedContext = Number(contextWindow.trim());
    if (contextWindow.trim() && (!Number.isFinite(parsedContext) || parsedContext <= 0)) {
      setError('Context window must be a positive number of tokens.');
      return;
    }

    onSave({
      ...initialModel,
      id: trimmed,
      label: initialModel?.label && initialModel.id === trimmed ? initialModel.label : trimmed,
      contextWindow: contextWindow.trim() ? Math.floor(parsedContext) : null
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={initialModel ? 'Edit model' : 'Add model'}
        className="w-full max-w-[520px] border border-border-default bg-bg-overlay p-6 shadow-elevated"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-normal text-text-primary">
            {initialModel ? 'Edit model' : 'Add model'}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center text-text-tertiary transition hover:text-text-primary"
          >
            <Cross2Icon className="h-4 w-4" />
          </button>
        </div>

        <label className="mt-6 block text-[13px] text-text-tertiary" htmlFor="custom-model-id">
          Model ID
        </label>
        <input
          id="custom-model-id"
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          placeholder="Model ID"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          className="mt-2 h-11 w-full border border-border-default bg-bg-subtle px-3 font-mono text-[13px] text-text-primary outline-none placeholder:text-text-muted focus:border-border-strong"
        />

        <label className="mt-5 block text-[13px] text-text-tertiary" htmlFor="custom-model-context">
          Context window
        </label>
        <input
          id="custom-model-context"
          value={contextWindow}
          inputMode="numeric"
          onChange={(event) => setContextWindow(event.target.value)}
          className="mt-2 h-11 w-full border border-border-default bg-bg-subtle px-3 text-[13px] text-text-primary outline-none placeholder:text-text-muted focus:border-border-strong"
        />

        {error ? <p className="mt-3 text-[12px] text-text-tertiary">{error}</p> : null}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center border border-border-default bg-bg-subtle px-4 text-[12.5px] text-text-primary transition hover:bg-bg-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex h-9 items-center bg-bg-button px-4 text-[12.5px] text-text-inverse transition hover:bg-bg-button-hover"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
