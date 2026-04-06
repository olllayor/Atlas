import {
  Bug,
  Code2,
  FileText,
  Lightbulb,
  PenTool,
  Search,
} from 'lucide-react';

type SuggestionItem = {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
  prompt: string;
};

const suggestions: SuggestionItem[] = [
  { icon: Lightbulb, text: 'Explain a concept', prompt: 'Explain quantum computing in simple terms' },
  { icon: Code2, text: 'Write code', prompt: 'Write a Python function that sorts a list' },
  { icon: Bug, text: 'Debug an error', prompt: 'Help me debug this error: ' },
  { icon: FileText, text: 'Summarize text', prompt: 'Summarize the key points of ' },
  { icon: PenTool, text: 'Help me write', prompt: 'Help me write an email that ' },
  { icon: Search, text: 'Research something', prompt: 'Tell me about ' },
];

type EmptyStateProps = {
  onSuggestionClick: (prompt: string) => void;
};

export function EmptyState({ onSuggestionClick }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg-hover">
          <svg
            className="h-4 w-4 text-text-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <h1 className="font-code-sans text-xl font-normal text-[var(--text-secondary)]">
          Atlas
        </h1>
      </div>
      <p className="text-sm text-text-muted">What can I help with?</p>

      <div className="mt-8 grid w-full max-w-lg grid-cols-2 gap-3">
        {suggestions.map(({ icon: Icon, text, prompt }) => (
          <button
            key={text}
            type="button"
            onClick={() => onSuggestionClick(prompt)}
            className="flex items-center gap-3 border border-border-medium px-4 py-3 text-left text-sm text-text-tertiary transition hover:bg-bg-active hover:text-text-primary"
          >
            <Icon className="h-4 w-4 shrink-0 text-text-muted" />
            <span className="truncate font-normal">{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
