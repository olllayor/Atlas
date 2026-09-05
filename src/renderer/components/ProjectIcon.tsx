import {
  BookOpen,
  Bot,
  Braces,
  CircuitBoard,
  Cloud,
  CodeXml,
  Database,
  FlaskConical,
  FolderCode,
  Gamepad2,
  Globe,
  Image,
  Layers,
  Monitor,
  Music,
  Package,
  Server,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Terminal,
  Video,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';

import {
  projectIconColorClassName,
  selectProjectIcon,
  type ProjectIconName,
} from '../lib/projectIcons';
import { cn } from '../lib/utils';

/*
 * Automatic project icon: the classified Lucide glyph in its stable color.
 * Canonical lucide names only (no deprecated `*2` aliases).
 */
const PROJECT_ICONS: Record<ProjectIconName, ComponentType<LucideProps>> = {
  ai: Bot,
  book: BookOpen,
  braces: Braces,
  circuit: CircuitBoard,
  cloud: Cloud,
  code: CodeXml,
  database: Database,
  desktop: Monitor,
  'folder-code': FolderCode,
  game: Gamepad2,
  image: Image,
  layers: Layers,
  mobile: Smartphone,
  music: Music,
  package: Package,
  security: ShieldCheck,
  server: Server,
  shopping: ShoppingBag,
  terminal: Terminal,
  test: FlaskConical,
  video: Video,
  web: Globe,
};

export function ProjectIcon({
  title,
  root,
  className,
  strokeWidth = 1.75,
}: {
  title: string;
  root: string;
  className?: string;
  strokeWidth?: number;
}) {
  const selection = selectProjectIcon(title, root);
  if (selection.kind === 'custom') {
    return (
      <img
        src={selection.url}
        alt=""
        className={cn('shrink-0 rounded-sm object-cover', className)}
        aria-hidden
      />
    );
  }
  const Icon = PROJECT_ICONS[selection.icon] ?? PROJECT_ICONS.code;
  return (
    <Icon
      className={cn('shrink-0', projectIconColorClassName(selection.icon), className)}
      strokeWidth={strokeWidth}
      aria-hidden
    />
  );
}
