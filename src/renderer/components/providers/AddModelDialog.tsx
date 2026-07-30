import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import type { CustomProviderModel, CustomProviderModelInput } from '../../../shared/customProviders';
import { DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW } from '../../../shared/customProviders';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import type { CapabilityValue } from './CapabilityControl';
import { CapabilityControl } from './CapabilityControl';
import { fieldInputClass, fieldLabelClass, InlineError } from './formPrimitives';

type AddModelDialogProps = {
  open: boolean;
  /** Supplied when editing an existing row; omitted when adding a new one. */
  initialModel?: CustomProviderModel | null;
  existingModelIds: string[];
  onCancel: () => void;
  onSave: (model: CustomProviderModelInput) => void;
};

/**
 * Reasoning and temperature stay optimistic and unasked-for: both are cheap to
 * get wrong (a rejected parameter, not a rejected turn) and neither has a
 * learning path, so a switch for them would be a question with no good answer.
 * Images, documents and tools are the ones that fail a whole send, and all
 * three are now editable below.
 */
const UNASKED_CAPABILITIES = {
  supportsReasoning: true,
  supportsTemperature: true
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
  const [supportsVision, setSupportsVision] = useState<CapabilityValue>(null);
  const [supportsDocumentInput, setSupportsDocumentInput] = useState<CapabilityValue>(null);
  const [supportsTools, setSupportsTools] = useState<CapabilityValue>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset whenever the dialog opens so a cancelled edit does not leak forward.
  useEffect(() => {
    if (!open) {
      return;
    }

    setModelId(initialModel?.id ?? '');
    setContextWindow(String(initialModel?.contextWindow ?? DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW));
    // `?? null` rather than a default of `true`: an existing model's stored
    // answer — including a `false` learned from a provider refusal — is the
    // thing being edited, and it must survive being looked at.
    setSupportsVision(initialModel?.supportsVision ?? null);
    setSupportsDocumentInput(initialModel?.supportsDocumentInput ?? null);
    setSupportsTools(initialModel?.supportsTools ?? null);
    setError(null);
  }, [initialModel, open]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

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
      ...UNASKED_CAPABILITIES,
      id: trimmed,
      label: initialModel?.label && initialModel.id === trimmed ? initialModel.label : trimmed,
      contextWindow: contextWindow.trim() ? Math.floor(parsedContext) : null,
      maxOutputTokens: initialModel?.maxOutputTokens ?? null,
      supportsVision,
      supportsDocumentInput,
      supportsTools
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>{initialModel ? 'Edit model' : 'Add model'}</DialogTitle>
          <DialogDescription>
            Enter the model ID exactly as the provider expects it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div>
            <label className={fieldLabelClass} htmlFor="custom-model-id">
              Model ID
            </label>
            <input
              id="custom-model-id"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder="deepseek-chat"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              className={`${fieldInputClass} mt-2 font-mono`}
            />
          </div>

          <div>
            <label className={fieldLabelClass} htmlFor="custom-model-context">
              Context window
            </label>
            <input
              id="custom-model-context"
              value={contextWindow}
              inputMode="numeric"
              onChange={(event) => setContextWindow(event.target.value)}
              placeholder="128000"
              className={`${fieldInputClass} mt-2 tabular-nums`}
            />
          </div>

          <fieldset className="grid gap-3.5">
            <legend className={`${fieldLabelClass} mb-1`}>Capabilities</legend>
            <CapabilityControl
              id="custom-model-vision"
              label="Images"
              hint="On Auto, images are attempted and the answer is remembered the first time the provider refuses one."
              value={supportsVision}
              onChange={setSupportsVision}
            />
            <CapabilityControl
              id="custom-model-documents"
              label="Documents"
              hint="PDFs and Office files. Text files are sent as prompt text and never need this."
              value={supportsDocumentInput}
              onChange={setSupportsDocumentInput}
            />
            <CapabilityControl
              id="custom-model-tools"
              label="Tools"
              hint="Web search, shell and file tools. Set to No for a model that answers tool-carrying requests with an error."
              value={supportsTools}
              onChange={setSupportsTools}
            />
          </fieldset>

          {error ? <InlineError>{error}</InlineError> : null}

          <DialogFooter className="mt-1">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border-default bg-bg-subtle px-4 text-xs text-text-primary transition hover:bg-bg-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center rounded-md bg-bg-button px-4 text-xs text-text-inverse transition hover:bg-bg-button-hover"
            >
              {initialModel ? 'Save changes' : 'Add model'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
