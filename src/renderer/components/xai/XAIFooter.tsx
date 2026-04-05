interface XAIFooterProps {
  brand?: string;
  links?: Array<{ label: string; href: string }>;
  ctaText?: string;
  onCTAClick?: () => void;
}

export function XAIFooter({
  brand = 'ATLAS',
  links = [
    { label: 'GitHub', href: '#' },
    { label: 'Docs', href: '#' },
    { label: 'API', href: '#' },
    { label: 'Privacy', href: '#' },
  ],
  ctaText = 'GET STARTED',
  onCTAClick,
}: XAIFooterProps) {
  return (
    <footer className="py-24 px-6 border-t border-white/10">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex flex-col items-center text-center mb-16">
          <h2 className="xai-mono text-4xl md:text-6xl font-light text-white mb-6">
            READY TO BUILD?
          </h2>
          <p className="xai-body max-w-[500px] mb-8">
            Start exploring free-tier AI models today. No credit card required.
          </p>
          <button className="xai-btn-primary" onClick={onCTAClick}>
            {ctaText}
          </button>
        </div>

        <hr className="border-white/10 mb-12" />

        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <span className="xai-mono text-sm uppercase tracking-[1.4px] text-white">
            {brand}
          </span>

          <div className="flex items-center gap-6">
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="xai-sans text-sm text-white hover:text-white/50 transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>

          <span className="xai-meta">
            MIT License
          </span>
        </div>
      </div>
    </footer>
  );
}
