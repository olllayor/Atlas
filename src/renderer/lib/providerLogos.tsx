import anthropic from '../assets/providerLogos/anthropic.svg?raw';
import cohere from '../assets/providerLogos/cohere.svg?raw';
import deepseek from '../assets/providerLogos/deepseek.svg?raw';
import google from '../assets/providerLogos/google.svg?raw';
import groq from '../assets/providerLogos/groq.svg?raw';
import mistral from '../assets/providerLogos/mistral.svg?raw';
import openai from '../assets/providerLogos/openai.svg?raw';
import opencode from '../assets/providerLogos/opencode.svg?raw';
import openrouter from '../assets/providerLogos/openrouter.svg?raw';
import perplexity from '../assets/providerLogos/perplexity.svg?raw';
import togetherai from '../assets/providerLogos/togetherai.svg?raw';
import xai from '../assets/providerLogos/xai.svg?raw';

/**
 * Brand marks pulled from models.dev's `/logos/<id>.svg` (monochrome,
 * `fill="currentColor"`), bundled locally so the rail never depends on the
 * network. `together` and `codex` have no dedicated mark upstream — aliased
 * to the closest real one instead of shipping their fallback glyph.
 */
const LOGOS: Record<string, string> = {
  anthropic,
  cohere,
  deepseek,
  google,
  groq,
  mistral,
  openai,
  opencode,
  openrouter,
  perplexity,
  togetherai,
  xai
};

const LOGO_ALIASES: Record<string, string> = {
  together: 'togetherai',
  codex: 'openai'
};

function resolveLogo(providerId: string): string | null {
  const id = providerId.toLowerCase();
  return LOGOS[id] ?? LOGOS[LOGO_ALIASES[id] ?? ''] ?? null;
}

/**
 * Icon for a rail row: the real brand mark when one exists (colored via
 * `currentColor`, so it inherits the wrapping element's text color),
 * otherwise a monogram of the display name.
 */
export function ProviderLogo({
  providerId,
  label,
  className = 'h-3.5 w-3.5'
}: {
  providerId: string;
  label: string;
  className?: string;
}) {
  const svg = resolveLogo(providerId);
  if (svg) {
    return (
      <span
        className={`inline-block shrink-0 [&>svg]:h-full [&>svg]:w-full ${className}`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[4px] bg-bg-elevated text-[9px] font-semibold text-text-tertiary ${className}`}
      aria-hidden
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}
