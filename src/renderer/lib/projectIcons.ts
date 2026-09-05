export const PROJECT_ICON_NAMES = [
  'ai',
  'book',
  'braces',
  'circuit',
  'cloud',
  'code',
  'database',
  'desktop',
  'folder-code',
  'game',
  'image',
  'layers',
  'mobile',
  'music',
  'package',
  'security',
  'server',
  'shopping',
  'terminal',
  'test',
  'video',
  'web'
] as const;

export type ProjectIconName = (typeof PROJECT_ICON_NAMES)[number];

export type ProjectIconSelection =
  | { readonly kind: 'lucide'; readonly icon: ProjectIconName }
  | { readonly kind: 'custom'; readonly url: string };

const KEYWORD_MAP: ReadonlyArray<readonly [string, ProjectIconName]> = [
  ['database', 'database'],
  ['db', 'database'],
  ['sql', 'database'],
  ['mobile', 'mobile'],
  ['ios', 'mobile'],
  ['android', 'mobile'],
  ['agent', 'ai'],
  ['ai', 'ai'],
  ['llm', 'ai'],
  ['terminal', 'terminal'],
  ['cli', 'terminal'],
  ['shell', 'terminal'],
  ['server', 'server'],
  ['backend', 'server'],
  ['api', 'server'],
  ['web', 'web'],
  ['site', 'web'],
  ['frontend', 'web'],
  ['test', 'test'],
  ['spec', 'test'],
  ['game', 'game'],
  ['book', 'book'],
  ['doc', 'book'],
  ['image', 'image'],
  ['video', 'video'],
  ['music', 'music'],
  ['audio', 'music'],
  ['security', 'security'],
  ['auth', 'security'],
  ['cloud', 'cloud'],
  ['desktop', 'desktop'],
  ['package', 'package'],
  ['circuit', 'circuit'],
  ['layers', 'layers'],
  ['code', 'code']
];

function stableIndex(seed: string, modulus: number): number {
  if (modulus <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % modulus;
}

function extractName(title: string, root: string): string {
  const cleanTitle = title.trim();
  if (cleanTitle) return cleanTitle;
  const cleanRoot = root.trim().replace(/[\\/]+$/, '');
  const parts = cleanRoot.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

export function selectProjectIcon(title: string, root: string): ProjectIconSelection {
  const name = extractName(title, root).toLowerCase();
  const tokens = name.split(/[^a-z0-9]+/).filter(Boolean);

  for (const [keyword, icon] of KEYWORD_MAP) {
    if (tokens.includes(keyword) || name.includes(keyword)) {
      return { kind: 'lucide', icon };
    }
  }

  const hashKey = name || root || 'default';
  const icon = PROJECT_ICON_NAMES[stableIndex(hashKey, PROJECT_ICON_NAMES.length)]!;
  return { kind: 'lucide', icon };
}

/*
 * One stable color per icon, mirroring upstream's PROJECT_ICON_COLOR_BY_NAME.
 * Fixed 600-step Tailwind classes so the icon reads the same in light and dark.
 * Full class strings in a static record so Tailwind sees them literally.
 */
// design-tokens-allow: project icon stable identifier colors
const PROJECT_ICON_COLOR_CLASS_BY_NAME: Record<ProjectIconName, string> = {
  // design-tokens-allow: project icon stable identifier colors
  ai: 'text-violet-600',
  book: 'text-amber-600',
  braces: 'text-purple-600',
  circuit: 'text-teal-600',
  cloud: 'text-sky-600',
  // design-tokens-allow: project icon stable identifier colors
  code: 'text-blue-600',
  database: 'text-cyan-600',
  desktop: 'text-indigo-600',
  'folder-code': 'text-orange-600',
  game: 'text-emerald-600',
  // design-tokens-allow: project icon stable identifier colors
  image: 'text-pink-600',
  layers: 'text-fuchsia-600',
  mobile: 'text-lime-600',
  music: 'text-fuchsia-600',
  package: 'text-orange-600',
  // design-tokens-allow: project icon stable identifier colors
  security: 'text-teal-600',
  server: 'text-blue-600',
  shopping: 'text-rose-600',
  terminal: 'text-green-600',
  test: 'text-yellow-600',
  // design-tokens-allow: project icon stable identifier colors
  video: 'text-red-600',
  web: 'text-sky-600'
};

export function projectIconColorClassName(icon: ProjectIconName): string {
  return PROJECT_ICON_COLOR_CLASS_BY_NAME[icon];
}
