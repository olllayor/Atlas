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
 * network. `together` and `codex` have no dedicated mark upstream. They are
 * aliased to the closest real one instead of shipping their fallback glyph.
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

/**
 * Local agent ids and spare catalog names that share another brand's mark.
 * `cursor` stays monogram: no mark asset exists for it here.
 */
const LOGO_ALIASES: Record<string, string> = {
  together: 'togetherai',
  codex: 'openai',
  antigravity: 'google',
  'claude-code': 'anthropic',
  grok: 'xai'
};

/**
 * Brand color for each mark key. The SVGs stay `currentColor`; callers paint
 * them by setting `color` on the wrapper. Keys are logo ids, not raw provider
 * ids, so aliases resolve first.
 */
const BRAND_COLORS: Record<string, string> = {
  anthropic: '#D97757',
  openai: '#10A37F',
  google: '#4285F4',
  mistral: '#FF7000',
  deepseek: '#4D6BFE',
  xai: '#E8E8E8',
  groq: '#F55036',
  perplexity: '#20B8CD',
  openrouter: '#6467F2',
  cohere: '#FF5A5A',
  togetherai: '#4DFF9C',
  opencode: '#A855F7'
};

function resolveLogoKey(providerId: string): string | null {
  const id = providerId.trim().toLowerCase();
  if (LOGOS[id]) return id;
  const alias = LOGO_ALIASES[id];
  return alias && LOGOS[alias] ? alias : null;
}

function resolveLogo(providerId: string): string | null {
  const key = resolveLogoKey(providerId);
  return key ? LOGOS[key]! : null;
}

/** Brand color for a provider id, or null when the mark stays monochrome. */
export function resolveProviderBrandColor(providerId: string): string | null {
  const key = resolveLogoKey(providerId);
  return key ? (BRAND_COLORS[key] ?? null) : null;
}

/**
 * Icon for a rail row: the real brand mark when one exists (painted via
 * `currentColor`, with brand color applied when we have one), otherwise a
 * monogram of the display name.
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
    const color = resolveProviderBrandColor(providerId);
    return (
      <span
        className={`inline-block shrink-0 [&>svg]:h-full [&>svg]:w-full ${className}`}
        style={color ? { color } : undefined}
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
