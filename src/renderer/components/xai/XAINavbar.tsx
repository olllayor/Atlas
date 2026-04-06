import { useState } from 'react';

interface NavProps {
  onBackToApp?: () => void;
}

export function XAINavbar({ onBackToApp }: NavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[var(--bg-base)] border-b border-[var(--border-default)]">
      <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <a href="#" className="xai-mono text-sm uppercase tracking-[1.4px] text-white hover:text-[var(--text-tertiary)] transition-colors">
            ATLAS
          </a>
          <div className="hidden md:flex items-center gap-6">
            <a href="#features" className="xai-sans text-sm text-white hover:text-[var(--text-tertiary)] transition-colors">Features</a>
            <a href="#models" className="xai-sans text-sm text-white hover:text-[var(--text-tertiary)] transition-colors">Models</a>
            <a href="#docs" className="xai-sans text-sm text-white hover:text-[var(--text-tertiary)] transition-colors">Docs</a>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-4">
          {onBackToApp && (
            <button onClick={onBackToApp} className="xai-sans text-sm text-white hover:text-[var(--text-tertiary)] transition-colors">
              APP
            </button>
          )}
          <button className="xai-btn-primary">
            GET STARTED
          </button>
        </div>

        <button
          className="md:hidden text-white p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {mobileOpen ? (
              <path d="M18 6L6 18M6 6l12 12" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-[var(--bg-base)] border-t border-[var(--border-default)] px-6 py-4 flex flex-col gap-4">
          <a href="#features" className="xai-sans text-sm text-white hover:text-[var(--text-tertiary)] transition-colors py-2">Features</a>
          <a href="#models" className="xai-sans text-sm text-white hover:text-[var(--text-tertiary)] transition-colors py-2">Models</a>
          <a href="#docs" className="xai-sans text-sm text-white hover:text-[var(--text-tertiary)] transition-colors py-2">Docs</a>
          <hr className="border-[var(--border-default)]" />
          {onBackToApp && (
            <button onClick={onBackToApp} className="xai-sans text-sm text-white hover:text-[var(--text-tertiary)] transition-colors py-2 text-left">
              APP
            </button>
          )}
          <button className="xai-btn-primary w-full">
            GET STARTED
          </button>
        </div>
      )}
    </nav>
  );
}
