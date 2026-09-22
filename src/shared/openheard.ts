import type { KeybindingCommand } from './keybindings';

export type OpenHeardDestination =
  | { readonly kind: 'board' }
  | { readonly kind: 'roadmap' }
  | { readonly kind: 'changelog' }
  | { readonly kind: 'newPost' };

export type OpenHeardChromeCommandId = Extract<KeybindingCommand, `openheard.${string}`>;

export type OpenHeardChromeCommand = {
  id: OpenHeardChromeCommandId;
  title: string;
  description: string;
  keywords: string[];
  destination: OpenHeardDestination;
};

export const OPENHEARD_PUBLIC_ORIGIN = 'https://atlas.openheard.com';

/**
 * `newPost` opens the board root because compose is client-side and has no
 * dedicated public route yet.
 */
export function openHeardPublicUrl(destination: OpenHeardDestination): string {
  switch (destination.kind) {
    case 'board':
      return `${OPENHEARD_PUBLIC_ORIGIN}/`;
    case 'roadmap':
      return `${OPENHEARD_PUBLIC_ORIGIN}/roadmap`;
    case 'changelog':
      return `${OPENHEARD_PUBLIC_ORIGIN}/changelog`;
    case 'newPost':
      return `${OPENHEARD_PUBLIC_ORIGIN}/`;
    default: {
      const exhaustiveCheck: never = destination;
      return exhaustiveCheck;
    }
  }
}

export const OPENHEARD_CHROME_COMMANDS: readonly OpenHeardChromeCommand[] = [
  {
    id: 'openheard.board.open',
    title: 'Feature board',
    description: 'Open the public Atlas feature board in your browser.',
    keywords: ['openheard', 'feature requests', 'board', 'vote'],
    destination: { kind: 'board' },
  },
  {
    id: 'openheard.roadmap.open',
    title: 'Roadmap',
    description: 'Open the public Atlas roadmap in your browser.',
    keywords: ['roadmap', 'planned', 'openheard', 'upcoming', 'shipped next'],
    destination: { kind: 'roadmap' },
  },
  {
    id: 'openheard.changelog.open',
    title: 'Changelog',
    description: 'Open the public Atlas changelog in your browser.',
    keywords: ['changelog', 'releases', 'notes', 'openheard', 'shipped', 'updates'],
    destination: { kind: 'changelog' },
  },
  {
    id: 'openheard.newPost.open',
    title: 'Suggest an idea',
    description: 'Open the feature board to post a new idea.',
    keywords: ['suggest', 'idea', 'request', 'post', 'feedback', 'openheard', 'compose'],
    destination: { kind: 'newPost' },
  },
];
