/**
 * Pure grammar for `atlas://` deep links (t3code's route-mirroring pattern).
 * Shared by the main-process protocol handler and unit tests; deliberately
 * Electron-free.
 *
 * Routes:
 *   atlas://chat                      → chat view
 *   atlas://chat/<conversationId>     → open that conversation
 *   atlas://chat/new?prompt=<text>    → new conversation, prompt pre-seeded
 *   atlas://settings/<section>        → settings at a section
 *   atlas://plugins                   → plugins workspace
 *   atlas://sites                     → sites workspace
 */

import type { AtlasDeepLink } from './contracts.js';

export const ATLAS_SCHEME = 'atlas';

const VALID_ID = /^[a-zA-Z0-9-]{1,64}$/;
const KNOWN_SECTIONS: ReadonlySet<string> = new Set([
  'general',
  'providers',
  'plugins',
  'appearance',
  'keyboard',
  'usage',
  'privacy',
  'beta',
]);

export function parseAtlasDeepLink(rawUrl: string): AtlasDeepLink | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${ATLAS_SCHEME}:`) return null;

  // `atlas://chat/abc` parses with host='chat', pathname='/abc'.
  const host = url.host || url.pathname.replace(/^\/+/, '').split('/')[0] || '';
  const segments = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);

  switch (host) {
    case 'chat': {
      const [first] = segments;
      const prompt = url.searchParams.get('prompt') ?? undefined;
      if (!first || first === 'new') {
        return prompt ? { kind: 'chat', prompt } : { kind: 'chat' };
      }
      if (!VALID_ID.test(first)) return null;
      return prompt
        ? { kind: 'chat', conversationId: first, prompt }
        : { kind: 'chat', conversationId: first };
    }
    case 'settings': {
      const section = segments[0];
      if (section && !KNOWN_SECTIONS.has(section)) return null;
      return section ? { kind: 'settings', section } : { kind: 'settings' };
    }
    case 'plugins':
      return { kind: 'plugins' };
    case 'sites':
      return { kind: 'sites' };
    default:
      return null;
  }
}
