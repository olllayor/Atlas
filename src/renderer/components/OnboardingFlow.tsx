import { KeyRound } from 'lucide-react';

/**
 * Atlas ships with no providers, so first run points at Model settings rather
 * than asking for a key it would not know where to send.
 */
type OnboardingFlowProps = {
  hasCredential: boolean;
  onOpenProviderSettings: () => void;
  onContinue: () => void;
};

export function OnboardingFlow({ hasCredential, onOpenProviderSettings, onContinue }: OnboardingFlowProps) {
  if (hasCredential) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-md border border-[var(--border-default)] bg-bg-overlay p-8 text-center shadow-elevated">
          <div className="mx-auto flex h-14 w-14 items-center justify-center border border-[var(--border-strong)] bg-[var(--bg-hover)]">
            <svg
              className="h-7 w-7 text-[var(--text-secondary)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="mt-5 text-xl font-normal text-text-primary">You're all set</h2>
          <p className="mt-2 text-sm text-text-tertiary">
            Your provider is configured and ready. Start a conversation below.
          </p>
          <button type="button" onClick={onContinue} className="btn-primary mt-6 w-full px-4 py-2.5">
            Start chatting
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md border border-[var(--border-default)] bg-bg-overlay p-8 shadow-elevated">
        <div className="text-center">
          <p className="text-xs font-normal uppercase tracking-[0.2em] text-text-muted">Welcome to</p>
          <h1 className="mt-2 text-2xl font-normal text-text-primary">Atlas</h1>
          <p className="mt-2 text-sm text-text-tertiary">
            A local-first chat client. Bring your own endpoint and key, keep everything on your machine.
          </p>
        </div>

        <div className="mt-8 space-y-4">
          <Step
            index={1}
            title="Add a model provider"
            body="Pick a known provider, or enter any OpenAI-, Anthropic- or Responses-compatible endpoint."
          />
          <Step index={2} title="Paste your API key" body="Stored in your OS keychain. It never leaves this machine." />
          <Step index={3} title="Choose your models" body="Fetch the provider's model list, or add model IDs by hand." />
        </div>

        <button
          type="button"
          onClick={onOpenProviderSettings}
          className="btn-primary mt-7 flex w-full items-center justify-center gap-2 px-4 py-2.5"
        >
          <KeyRound className="h-4 w-4" />
          Add a provider
        </button>

        <p className="mt-6 text-center text-[11px] text-text-faint">
          Keys are stored in your OS keychain. Nothing leaves your machine.
        </p>
      </div>
    </div>
  );
}

function Step({ index, title, body }: { index: number; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-[var(--border-strong)] bg-[var(--bg-hover)] text-sm font-normal text-text-primary">
        {index}
      </div>
      <div>
        <h3 className="text-sm font-normal text-text-primary">{title}</h3>
        <p className="mt-0.5 text-xs text-text-muted">{body}</p>
      </div>
    </div>
  );
}
