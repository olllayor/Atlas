import { KeyRound, X } from 'lucide-react';
import { useState } from 'react';

import type { ProviderId } from '../../shared/contracts';
import { PROVIDER_METADATA } from '../../shared/providerMetadata';

type OnboardingFlowProps = {
  hasCredential: boolean;
  providerId: ProviderId;
  providerLabel: string;
  providerLink: string;
  providerLinkLabel: string;
  isSavingKey: boolean;
  isValidatingKey: boolean;
  keyDraft: string;
  onProviderChange: (providerId: ProviderId) => void;
  onKeyDraftChange: (value: string) => void;
  onSaveKey: () => void;
  onValidateKey: () => void;
  onContinue: () => void;
};

export function OnboardingFlow({
  hasCredential,
  providerId,
  providerLabel,
  providerLink,
  providerLinkLabel,
  isSavingKey,
  isValidatingKey,
  keyDraft,
  onProviderChange,
  onKeyDraftChange,
  onSaveKey,
  onValidateKey,
  onContinue,
}: OnboardingFlowProps) {
  const [step, setStep] = useState<'key' | 'validating' | 'done'>(
    hasCredential ? 'done' : 'key'
  );
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    try {
      await onSaveKey();
      if (keyDraft.trim()) {
        setStep('validating');
        await onValidateKey();
        setStep('done');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save key');
      setStep('key');
    }
  };

  if (step === 'done') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-md border border-[var(--border-default)] bg-bg-base p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center border border-[var(--border-strong)] bg-[var(--bg-hover)]">
            <svg className="h-7 w-7 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="mt-5 text-xl font-normal text-text-primary">You're all set</h2>
          <p className="mt-2 text-sm text-text-tertiary">
            Your API key is configured and ready. Start a conversation below.
          </p>
          <button
            type="button"
            onClick={onContinue}
            className="btn-primary mt-6 w-full px-4 py-2.5"
          >
            Start chatting
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md border border-[var(--border-default)] bg-bg-base p-8">
        <div className="text-center">
          <p className="text-xs font-normal uppercase tracking-[0.2em] text-text-muted">Welcome to</p>
          <h1 className="mt-2 text-2xl font-normal text-text-primary">Atlas</h1>
          <p className="mt-2 text-sm text-text-tertiary">
            A local-first chat client. Bring your own API key, keep everything on your machine.
          </p>
        </div>

        <div className="mt-8">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-[var(--border-strong)] bg-[var(--bg-hover)] text-sm font-normal text-text-primary">
              1
            </div>
            <div>
              <h3 className="text-sm font-normal text-text-primary">Add your {providerLabel} API key</h3>
              <p className="mt-0.5 text-xs text-text-muted">
                Get one at{' '}
                <a
                  href={providerLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-tertiary underline hover:text-text-primary"
                >
                  {providerLinkLabel}
                </a>
              </p>
            </div>
          </div>

          <div className="mt-5 inline-flex border border-[var(--border-default)] bg-bg-subtle p-1">
            {(['openrouter', 'glm'] as const).map((id) => {
              const isActive = id === providerId;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onProviderChange(id)}
                  className={`inline-flex h-9 items-center px-3 text-[13px] font-normal transition ${
                    isActive
                      ? 'bg-bg-elevated text-text-primary'
                      : 'text-text-tertiary hover:text-text-primary'
                  }`}
                >
                  {PROVIDER_METADATA[id].label}
                </button>
              );
            })}
          </div>

          <div className="mt-5">
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => onKeyDraftChange(e.target.value)}
              placeholder={PROVIDER_METADATA[providerId].keyPlaceholder}
              className="input px-4 py-3"
            />
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSavingKey || isValidatingKey || !keyDraft.trim()}
            className="btn-primary mt-4 flex w-full items-center justify-center gap-2 px-4 py-2.5"
          >
            {isSavingKey || isValidatingKey ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {isSavingKey ? 'Saving...' : 'Validating...'}
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4" />
                Save & Continue
              </>
            )}
          </button>

          {error && (
            <p className="mt-3 text-xs text-[var(--text-tertiary)]">{error}</p>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-text-faint">
          Keys are stored in your OS keychain. Nothing leaves your machine.
        </p>
      </div>
    </div>
  );
}
