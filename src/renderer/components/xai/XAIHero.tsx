interface HeroProps {
  headline?: string;
  subtitle?: string;
  primaryCTA?: string;
  secondaryCTA?: string;
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
}

export function XAIHero({
  headline = 'ATLAS',
  subtitle = 'OpenRouter-first BYOK desktop chat client for free-tier model discovery and streaming.',
  primaryCTA = 'TRY GROK',
  secondaryCTA = 'VIEW API',
  onPrimaryClick,
  onSecondaryClick,
}: HeroProps) {
  return (
    <section className="min-h-screen flex flex-col items-center justify-center px-6 pt-16">
      <div className="max-w-[1200px] w-full flex flex-col items-center text-center">
        <h1 className="xai-display text-white mb-8">
          {headline}
        </h1>
        <p className="xai-body max-w-[600px] mb-12">
          {subtitle}
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <button className="xai-btn-primary" onClick={onPrimaryClick}>
            {primaryCTA}
          </button>
          <button className="xai-btn-ghost" onClick={onSecondaryClick}>
            {secondaryCTA}
          </button>
        </div>
      </div>
    </section>
  );
}
