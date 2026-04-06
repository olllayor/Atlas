interface DocsSectionProps {
  title?: string;
  description?: string;
  codeBlock?: string;
  primaryCTA?: string;
  secondaryCTA?: string;
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
}

const defaultCode = `import { createClient } from '@atlas/chat';

const client = createClient({
  provider: 'openrouter',
  model: 'meta-llama/llama-3.1-8b-instruct',
});

const response = await client.chat({
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true,
});`;

export function XAIDocsSection({
  title = 'BUILT FOR BUILDERS',
  description = 'A clean, minimal API surface that gets out of your way. Integrate Atlas into your workflow or use it as a standalone desktop application.',
  codeBlock = defaultCode,
  primaryCTA = 'LEARN MORE',
  secondaryCTA = 'VIEW API',
  onPrimaryClick,
  onSecondaryClick,
}: DocsSectionProps) {
  return (
    <section id="docs" className="py-24 px-6">
      <div className="max-w-[1200px] mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-start">
          <div>
            <span className="xai-mono text-xs uppercase tracking-[1px] text-[var(--text-tertiary)] block mb-6">
              {title}
            </span>
            <h2 className="xai-section-heading text-white mb-6">
              {description}
            </h2>
            <div className="flex flex-col sm:flex-row gap-4">
              <button className="xai-btn-primary" onClick={onPrimaryClick}>
                {primaryCTA}
              </button>
              <button className="xai-btn-ghost" onClick={onSecondaryClick}>
                {secondaryCTA}
              </button>
            </div>
          </div>

          <div className="xai-card p-0 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-default)]">
              <div className="w-3 h-3 rounded-full bg-white/20" />
              <div className="w-3 h-3 rounded-full bg-white/20" />
              <div className="w-3 h-3 rounded-full bg-white/20" />
              <span className="xai-meta ml-2">terminal</span>
            </div>
            <pre className="p-6 text-sm xai-mono text-[var(--text-secondary)] overflow-x-auto">
              <code>{codeBlock}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
