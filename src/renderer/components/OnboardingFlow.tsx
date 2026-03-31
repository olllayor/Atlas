import { KeyRound, X } from 'lucide-react';
import { useState } from 'react';

type OnboardingFlowProps = {
  hasCredential: boolean;
  isSavingKey: boolean;
  isValidatingKey: boolean;
  keyDraft: string;
  onKeyDraftChange: (value: string) => void;
  onSaveKey: () => void;
  onValidateKey: () => void;
  onContinue: () => void;
};

export function OnboardingFlow({
  hasCredential,
  isSavingKey,
  isValidatingKey,
  keyDraft,
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
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111418] p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
            <svg className="h-7 w-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="mt-5 text-xl font-semibold text-white">You're all set</h2>
          <p className="mt-2 text-sm text-slate-400">
            Your API key is configured and ready. Start a conversation below.
          </p>
          <button
            type="button"
            onClick={onContinue}
            className="mt-6 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-white/90"
          >
            Start chatting
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111418] p-8 shadow-2xl">
        <div className="text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Welcome to</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">CheapChat</h1>
          <p className="mt-2 text-sm text-slate-400">
            A local-first chat client. Bring your own API key, keep everything on your machine.
          </p>
        </div>

        <div className="mt-8">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-medium text-white">
              1
            </div>
            <div>
              <h3 className="text-sm font-medium text-white">Add your OpenRouter API key</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Get one at{' '}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 underline hover:text-white"
                >
                  openrouter.ai/keys
                </a>
              </p>
            </div>
          </div>

          <div className="mt-5">
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => onKeyDraftChange(e.target.value)}
              placeholder="sk-or-v1-..."
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-white/20"
            />
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSavingKey || isValidatingKey || !keyDraft.trim()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
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
            <p className="mt-3 text-xs text-rose-400">{error}</p>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-600">
          Keys are stored in your OS keychain. Nothing leaves your machine.
        </p>
      </div>
    </div>
  );
}
