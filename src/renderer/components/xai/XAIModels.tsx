interface ModelSpec {
  label: string;
  value: string;
}

interface ModelsProps {
  title?: string;
  specs?: ModelSpec[];
}

const defaultSpecs: ModelSpec[] = [
  { label: 'Providers', value: '12+' },
  { label: 'Models', value: '100+' },
  { label: 'Free Tier', value: 'Yes' },
  { label: 'Streaming', value: 'Native' },
  { label: 'Latency', value: '< 200ms' },
  { label: 'Uptime', value: '99.9%' },
];

export function XAIModels({
  title = 'MODEL MATRIX',
  specs = defaultSpecs,
}: ModelsProps) {
  return (
    <section id="models" className="py-24 px-6">
      <div className="max-w-[1200px] mx-auto">
        <div className="mb-16">
          <span className="xai-mono text-xs uppercase tracking-[1px] text-[var(--text-tertiary)]">{title}</span>
        </div>

        <div className="border border-[var(--border-default)]">
          <div className="grid grid-cols-2 md:grid-cols-3 divide-x divide-white/10">
            {specs.map((spec, index) => (
              <div
                key={index}
                className={`p-6 ${
                  index >= specs.length - (specs.length % 3 === 0 ? 3 : specs.length % 3)
                    ? ''
                    : 'border-b border-[var(--border-default)] md:border-b-0'
                } md:odd:border-b md:odd:border-[var(--border-default)]`}
              >
                <div className="xai-meta mb-2">{spec.label}</div>
                <div className="xai-mono text-2xl font-light text-white">{spec.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
