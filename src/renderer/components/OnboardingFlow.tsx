import { CheckIcon, PlusIcon } from '@radix-ui/react-icons';
import type { CSSProperties } from 'react';

/**
 * Atlas ships with no providers, so first run points at Model settings rather
 * than asking for a key it would not know where to send.
 *
 * `onContinue` is the single exit that does not go through Settings: it dismisses
 * onboarding and drops the user into an empty chat. Before a credential exists
 * that is "Skip for now"; once one exists it is "Start chatting".
 */
type OnboardingFlowProps = {
  hasCredential: boolean;
  onOpenProviderSettings: () => void;
  onContinue: () => void;
};

export function OnboardingFlow({ hasCredential, onOpenProviderSettings, onContinue }: OnboardingFlowProps) {
  return (
    <div className="flex h-screen flex-col bg-bg-base">
      {/* The window is otherwise undraggable while onboarding is mounted. */}
      <div
        className="h-titlebar-height shrink-0"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      />

      <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-titlebar-height">
        {hasCredential ? (
          <Card>
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckIcon className="h-5 w-5" />
            </div>
            <h1 className="mt-4 text-center text-xl font-normal text-text-primary">You're all set</h1>
            <p className="mt-2 text-center text-sm leading-relaxed text-text-tertiary">
              Your provider is configured. Pick a model in the composer and start a conversation.
            </p>
            <button
              type="button"
              onClick={onContinue}
              className="mt-6 inline-flex h-9 w-full items-center justify-center rounded-md bg-bg-button px-4 text-sm text-text-inverse transition hover:bg-bg-button-hover"
            >
              Start chatting
            </button>
          </Card>
        ) : (
          <Card>
            <h1 className="text-xl font-normal text-text-primary">Welcome to Atlas</h1>
            <p className="mt-2 text-sm leading-relaxed text-text-tertiary">
              A local-first chat client. Add any OpenAI-, Anthropic- or Responses-compatible endpoint and
              its key — the key goes to your OS keychain, and conversations stay on this machine.
            </p>

            <button
              type="button"
              onClick={onOpenProviderSettings}
              className="mt-6 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-bg-button px-4 text-sm text-text-inverse transition hover:bg-bg-button-hover"
            >
              <PlusIcon className="h-4 w-4" />
              Add a provider
            </button>

            <button
              type="button"
              onClick={onContinue}
              className="mt-2 inline-flex h-9 w-full items-center justify-center rounded-md px-4 text-sm text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary"
            >
              Skip for now
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[420px] rounded-lg border border-border-default bg-bg-overlay p-7 shadow-elevated">
      {children}
    </div>
  );
}
