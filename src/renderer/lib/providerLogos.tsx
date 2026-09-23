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

const meta = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M16.94 4.77C15.52 4.77 14.19 5.37 13.12 6.38 12.05 5.37 10.72 4.77 9.3 4.77 5.76 4.77 2.9 7.78 2.9 11.51c0 3.84 2.89 6.85 6.4 6.85 1.42 0 2.75-.6 3.82-1.61 1.07 1.01 2.4 1.61 3.82 1.61 3.51 0 6.4-3.01 6.4-6.85 0-3.73-2.86-6.74-6.4-6.74zm0 11.52c-2.3 0-4.17-2.07-4.17-4.78 0-2.7 1.87-4.77 4.17-4.77 2.3 0 4.17 2.07 4.17 4.77 0 2.71-1.87 4.78-4.17 4.78zm-7.64 0c-2.3 0-4.17-2.07-4.17-4.78 0-2.7 1.87-4.77 4.17-4.77 2.3 0 4.17 2.07 4.17 4.77 0 2.71-1.87 4.78-4.17 4.78z"/></svg>`;

const nvidia = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M9.82 7.02c1.78 0 3.47.53 4.93 1.46.99-.86 1.87-1.64 2.92-2.37-2.26-1.57-4.99-2.43-7.85-2.43-6.85 0-12.4 5.56-12.4 12.41 0 1.34.22 2.63.61 3.84.97-.89 2.05-1.66 3.16-2.33-.25-.49-.38-1.01-.38-1.51 0-4.94 4.07-8.99 9.01-9.07zm0 2.8c-3.45 0-6.27 2.82-6.27 6.27 0 .54.08 1.06.21 1.56 1.08-.75 2.26-1.39 3.49-1.9-.07-.22-.11-.44-.11-.66 0-1.48 1.2-2.68 2.68-2.68 1.48 0 2.68 1.2 2.68 2.68 0 1.48-1.2 2.68-2.68 2.68-.31 0-.6-.05-.88-.15-.89.87-1.89 1.63-2.97 2.27 1.16.5 2.45.79 3.85.79 4.95 0 8.99-4.04 8.99-9.01-.01-4.88-4.06-8.85-8.99-8.85z"/></svg>`;

const alibaba = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.5a9.5 9.5 0 0 0-9.5 9.5c0 3.5 1.9 6.56 4.75 8.2v-2.2A7.5 7.5 0 0 1 4.5 12a7.5 7.5 0 1 1 14.54 2.6l1.83.92A9.5 9.5 0 0 0 12 2.5zm-1 7v6h2v-6h-2zm3.5 7.5h-5v1.5h5V17z"/></svg>`;

const ollama = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 2a4 4 0 0 0-4 4c0 1.5.8 2.8 2 3.5V11H8a3 3 0 0 0-3 3v5a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-4h2v4a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-4h2v4a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-5a3 3 0 0 0-3-3h-2V9.5c1.2-.7 2-2 2-3.5a4 4 0 0 0-4-4zm-1.5 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm3 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg>`;

const zhipu = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M4 4h16l-8.5 9.5H20V20H4l8.5-9.5H4V4z"/></svg>`;

/**
 * Brand marks pulled from models.dev's `/logos/<id>.svg` (monochrome,
 * `fill="currentColor"`), bundled locally so the rail never depends on the
 * network.
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
  xai,
  meta,
  nvidia,
  alibaba,
  ollama,
  zhipu
};

/**
 * Local agent ids and spare catalog names that share another brand's mark.
 */
const LOGO_ALIASES: Record<string, string> = {
  together: 'togetherai',
  codex: 'openai',
  antigravity: 'google',
  'claude-code': 'anthropic',
  grok: 'xai',
  llama: 'meta',
  qwen: 'alibaba',
  nemotron: 'nvidia',
  glm: 'zhipu',
  chatglm: 'zhipu',
  yi: 'alibaba'
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
  opencode: '#A855F7',
  nvidia: '#76B900',
  meta: '#0668E1',
  alibaba: '#FF6A00',
  zhipu: '#0F5BFF',
  ollama: '#E2E8F0'
};

const MONOGRAM_PALETTES = [
  'bg-accent-surface text-accent-strong border-accent/25',
  'bg-bg-subtle text-text-primary border-border-default',
  'bg-success-bg text-success border-success-border',
  'bg-warning-bg text-warning-text border-warning-border',
  'bg-bg-elevated text-text-secondary border-border-medium'
];

export function getMonogramPalette(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return MONOGRAM_PALETTES[Math.abs(hash) % MONOGRAM_PALETTES.length];
}

export function getMonogramInitials(text: string): string {
  const clean = text.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export function resolveLogoKey(providerId: string, label?: string): string | null {
  const cleanId = providerId.trim().toLowerCase().replace(/^custom:/, '');
  if (LOGOS[cleanId]) return cleanId;
  const alias = LOGO_ALIASES[cleanId];
  if (alias && LOGOS[alias]) return alias;

  for (const key of Object.keys(LOGOS)) {
    if (cleanId.includes(key)) return key;
  }

  if (label) {
    const l = label.trim().toLowerCase();
    for (const [aliasKey, target] of Object.entries(LOGO_ALIASES)) {
      if (l.includes(aliasKey) && LOGOS[target]) return target;
    }
    for (const key of Object.keys(LOGOS)) {
      if (l.includes(key)) return key;
    }
  }

  return null;
}

function resolveLogo(providerId: string, label?: string): string | null {
  const key = resolveLogoKey(providerId, label);
  return (key && LOGOS[key]) || null;
}

export function resolveProviderBrandColor(providerId: string, label?: string): string | null {
  const key = resolveLogoKey(providerId, label);
  return key ? (BRAND_COLORS[key] ?? null) : null;
}

/**
 * Resolves model family brand logo by inspecting model ID and human label.
 * Allows multi-provider gateways to display authentic model logos.
 */
export function resolveModelFamilyBrand(modelId: string, modelLabel?: string): string | null {
  const target = `${modelId} ${modelLabel ?? ''}`.toLowerCase();
  if (target.includes('claude') || target.includes('anthropic')) return 'anthropic';
  if (
    target.includes('gpt') ||
    target.includes('o1-') ||
    target.includes('o3-') ||
    target.includes('o4-') ||
    target.includes('chatgpt') ||
    target.includes('codex')
  ) {
    return 'openai';
  }
  if (target.includes('gemini') || target.includes('antigravity')) return 'google';
  if (target.includes('deepseek')) return 'deepseek';
  if (target.includes('qwen') || target.includes('alibaba') || target.includes('tongyi')) return 'alibaba';
  if (target.includes('llama') || target.includes('meta')) return 'meta';
  if (
    target.includes('mistral') ||
    target.includes('codestral') ||
    target.includes('mixtral') ||
    target.includes('ministral') ||
    target.includes('pixtral')
  ) {
    return 'mistral';
  }
  if (target.includes('nemotron') || target.includes('nvidia')) return 'nvidia';
  if (target.includes('glm') || target.includes('zhipu') || target.includes('chatglm')) return 'zhipu';
  if (target.includes('grok') || target.includes('xai')) return 'xai';
  if (target.includes('command') || target.includes('cohere')) return 'cohere';
  if (target.includes('sonar') || target.includes('perplexity')) return 'perplexity';
  if (target.includes('groq')) return 'groq';
  if (target.includes('ollama')) return 'ollama';
  if (target.includes('together')) return 'togetherai';
  if (target.includes('opencode')) return 'opencode';
  return null;
}

/**
 * Icon for a rail row or provider chip: the real brand mark when one exists
 * (painted via `currentColor`, with brand color applied when we have one),
 * otherwise a stylish colored monogram of the display name.
 */
export function ProviderLogo({
  providerId,
  label,
  className = 'size-5'
}: {
  providerId: string;
  label: string;
  className?: string;
}) {
  const key = resolveLogoKey(providerId, label);
  const svg = key ? LOGOS[key] : null;

  if (svg) {
    const color = resolveProviderBrandColor(key ?? providerId, label);
    return (
      <span
        className={`inline-block shrink-0 [&>svg]:h-full [&>svg]:w-full ${className}`}
        style={color ? { color } : undefined}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  const palette = getMonogramPalette(label || providerId);
  const initials = getMonogramInitials(label || providerId);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md text-2xs font-bold tracking-tight border select-none ${palette} ${className}`}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/**
 * Resolves and renders the most authentic brand logo for a model,
 * prioritizing the model's authentic brand family before falling back to provider.
 */
export function ModelLogo({
  modelId,
  modelLabel,
  providerId,
  providerLabel,
  className = 'size-5'
}: {
  modelId: string;
  modelLabel?: string;
  providerId: string;
  providerLabel?: string;
  className?: string;
}) {
  const familyKey = resolveModelFamilyBrand(modelId, modelLabel);
  if (familyKey) {
    return <ProviderLogo providerId={familyKey} label={modelLabel ?? modelId} className={className} />;
  }
  return <ProviderLogo providerId={providerId} label={providerLabel ?? providerId} className={className} />;
}
