interface Feature {
  tag?: string;
  title: string;
  description: string;
}

interface FeaturesProps {
  title?: string;
  features?: Feature[];
}

const defaultFeatures: Feature[] = [
  {
    tag: 'OPENROUTER',
    title: 'Multi-Provider Access',
    description: 'Connect to dozens of AI providers through a single unified interface. Switch models seamlessly without managing multiple API keys.',
  },
  {
    tag: 'BYOK',
    title: 'Bring Your Own Keys',
    description: 'Your credentials, your control. Store API keys securely in your system keychain with zero telemetry on your usage patterns.',
  },
  {
    tag: 'DISCOVERY',
    title: 'Free Model Discovery',
    description: 'Automatically discover and test free-tier models across providers. Find the best model for your use case without spending a cent.',
  },
  {
    tag: 'STREAMING',
    title: 'Real-Time Streaming',
    description: 'Watch responses stream in real-time with token-by-token rendering. Full support for reasoning traces and tool use visualization.',
  },
  {
    tag: 'NATIVE',
    title: 'Desktop Native',
    description: 'Built on Electron with React and TypeScript. Native performance, offline conversation storage, and full system integration.',
  },
  {
    tag: 'OPEN SOURCE',
    title: 'Transparent & Extensible',
    description: 'MIT licensed, fully open source. Audit the code, contribute features, or fork for your own purposes. No black boxes.',
  },
];

export function XAIFeatures({
  title = 'CAPABILITIES',
  features = defaultFeatures,
}: FeaturesProps) {
  return (
    <section id="features" className="py-24 px-6">
      <div className="max-w-[1200px] mx-auto">
        <div className="mb-16">
          <span className="xai-mono text-xs uppercase tracking-[1px] text-[var(--text-tertiary)]">{title}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feature, index) => (
            <div key={index} className="xai-card group">
              {feature.tag && (
                <div className="mb-4">
                  <span className="xai-tag">{feature.tag}</span>
                </div>
              )}
              <h3 className="xai-section-heading text-white mb-3">
                {feature.title}
              </h3>
              <p className="xai-body">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
