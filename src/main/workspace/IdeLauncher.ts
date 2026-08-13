import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * "Open in <editor>" — the folder this conversation edits, handed to the editor
 * the user actually keeps it open in.
 *
 * Detection is by inspection, never by execution: an editor counts as installed
 * when its app bundle, its `PATH` launcher or its Windows executable is on disk.
 * Nothing here runs a probe command, so a machine without a given editor costs
 * a handful of `existsSync` calls rather than a process spawn.
 */
export type IdeDefinition = {
  id: string;
  name: string;
  /** `.app` bundle names to look for in the macOS application folders. */
  macApps?: string[];
  /** Command-line launchers to look for on `PATH`. */
  bins?: string[];
  /** Windows install paths; `%VAR%` segments come from the environment. */
  winPaths?: string[];
};

/**
 * Order is the tie-breaker for "which one did you mean" on a machine with
 * several installed and no saved preference, so it runs from the editors people
 * drive an agent from, through the terminals, to the file manager.
 *
 */
export const IDE_CATALOG: IdeDefinition[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    macApps: ['Visual Studio Code'],
    bins: ['code'],
    winPaths: [
      '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe',
      '%PROGRAMFILES%\\Microsoft VS Code\\Code.exe'
    ]
  },
  {
    id: 'cursor',
    name: 'Cursor',
    macApps: ['Cursor'],
    bins: ['cursor'],
    winPaths: ['%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe']
  },
  {
    id: 'vscode-insiders',
    name: 'VS Code Insiders',
    macApps: ['Visual Studio Code - Insiders'],
    bins: ['code-insiders'],
    winPaths: ['%LOCALAPPDATA%\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe']
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    macApps: ['Windsurf'],
    bins: ['windsurf'],
    winPaths: ['%LOCALAPPDATA%\\Programs\\Windsurf\\Windsurf.exe']
  },
  {
    id: 'zed',
    name: 'Zed',
    macApps: ['Zed'],
    bins: ['zed'],
    winPaths: ['%LOCALAPPDATA%\\Programs\\Zed\\Zed.exe']
  },
  {
    id: 'webstorm',
    name: 'WebStorm',
    macApps: ['WebStorm'],
    bins: ['webstorm']
  },
  {
    id: 'intellij',
    name: 'IntelliJ IDEA',
    macApps: ['IntelliJ IDEA', 'IntelliJ IDEA Ultimate', 'IntelliJ IDEA Community Edition'],
    bins: ['idea']
  },
  {
    id: 'pycharm',
    name: 'PyCharm',
    macApps: ['PyCharm', 'PyCharm Professional Edition', 'PyCharm Community Edition'],
    bins: ['pycharm', 'charm']
  },
  {
    id: 'goland',
    name: 'GoLand',
    macApps: ['GoLand'],
    bins: ['goland']
  },
  {
    id: 'rustrover',
    name: 'RustRover',
    macApps: ['RustRover'],
    bins: ['rustrover']
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    macApps: ['Sublime Text'],
    bins: ['subl'],
    winPaths: ['%PROGRAMFILES%\\Sublime Text\\subl.exe']
  },
  /*
    Not editors, but the same gesture: once there is a control for "hand this
    folder to something else", a Finder window and a terminal belong in it. They
    are matched by bundle only — their CLI names (`open`, `explorer`) either do
    not take a working directory or would shadow something else on `PATH`.
  */
  {
    id: 'finder',
    name: 'Finder',
    macApps: ['Finder'],
    winPaths: ['%WINDIR%\\explorer.exe']
  },
  {
    id: 'terminal',
    name: 'Terminal',
    macApps: ['Utilities/Terminal', 'Terminal']
  },
  {
    id: 'ghostty',
    name: 'Ghostty',
    macApps: ['Ghostty']
  },
  {
    id: 'iterm',
    name: 'iTerm',
    macApps: ['iTerm']
  },
  {
    id: 'warp',
    name: 'Warp',
    macApps: ['Warp']
  },
  {
    id: 'xcode',
    name: 'Xcode',
    macApps: ['Xcode']
  }
];

export type ResolvedIde = {
  id: string;
  name: string;
  /** What the OS is handed: a `PATH` launcher, an app bundle, or an `.exe`. */
  target: string;
  kind: 'cli' | 'macApp' | 'exe';
  /**
   * Where the real application lives, for the OS to render an icon from.
   *
   * Kept apart from `target` because the two disagree for every editor that
   * ships a shim: `/usr/local/bin/code` is the right thing to launch and the
   * wrong thing to ask for an icon — it is a script, and macOS would hand back
   * a generic executable badge instead of the editor's own mark.
   */
  iconPath: string | null;
};

export type DetectIdesOptions = {
  platform?: NodeJS.Platform;
  /** Directories searched for the `bins` launchers. */
  pathDirs?: string[];
  /** Directories searched for macOS `.app` bundles. */
  appDirs?: string[];
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
  catalog?: IdeDefinition[];
};

/**
 * A GUI-launched Electron app inherits Finder's `PATH` — `/usr/bin:/bin` and
 * little else — so the directories every editor's CLI shim actually installs
 * into are searched explicitly rather than trusted to be inherited.
 */
export function defaultPathDirs(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  home: string = homedir()
): string[] {
  const fromEnv = (env.PATH ?? '').split(delimiter).filter(Boolean);

  if (platform === 'win32') {
    return fromEnv;
  }

  return [
    ...fromEnv,
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    join(home, '.local', 'bin')
  ];
}

export function defaultAppDirs(home: string = homedir()): string[] {
  return [
    '/Applications',
    join(home, 'Applications'),
    '/System/Applications',
    // Finder does not live with the others.
    '/System/Library/CoreServices'
  ];
}

function isExecutable(path: string, platform: NodeJS.Platform) {
  if (platform === 'win32') {
    return existsSync(path);
  }

  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** `%LOCALAPPDATA%\Programs\…` → an absolute path, or null when the var is unset. */
function expandWindowsPath(template: string, env: Record<string, string | undefined>) {
  let missing = false;

  const expanded = template.replace(/%([^%]+)%/g, (_match, name: string) => {
    const value = env[name] ?? env[name.toUpperCase()];
    if (!value) {
      missing = true;
      return '';
    }

    return value;
  });

  return missing ? null : expanded;
}

/**
 * Which editors this machine has, in catalog order.
 *
 * The CLI launcher wins over the app bundle when both exist: `code <folder>`
 * reuses an already-open window, while `open -a` tends to raise whatever the
 * editor last had. That difference is the whole point of the button.
 */
export function detectIdes(options: DetectIdesOptions = {}): ResolvedIde[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const catalog = options.catalog ?? IDE_CATALOG;
  const pathDirs = options.pathDirs ?? defaultPathDirs(platform, env);
  const appDirs = options.appDirs ?? defaultAppDirs();
  const executable = options.exists
    ? options.exists
    : (path: string) => isExecutable(path, platform);

  const found: ResolvedIde[] = [];

  for (const ide of catalog) {
    const resolved = resolveOne(ide);
    if (resolved) {
      found.push(resolved);
    }
  }

  return found;

  function resolveOne(ide: IdeDefinition): ResolvedIde | null {
    // The bundle is looked up first even when a shim will win the launch: it is
    // the only thing that can produce an icon, and finding it is a stat call.
    const bundle = platform === 'darwin' ? findBundle(ide) : null;
    const winExe = platform === 'win32' ? findWindowsExe(ide) : null;
    const shim = findShim(ide);

    if (shim) {
      return {
        id: ide.id,
        name: ide.name,
        target: shim,
        kind: 'cli',
        iconPath: bundle ?? winExe
      };
    }

    if (bundle) {
      return { id: ide.id, name: ide.name, target: bundle, kind: 'macApp', iconPath: bundle };
    }

    if (winExe) {
      return { id: ide.id, name: ide.name, target: winExe, kind: 'exe', iconPath: winExe };
    }

    return null;
  }

  function findShim(ide: IdeDefinition) {
    for (const bin of ide.bins ?? []) {
      const target = findOnPath(bin);
      if (target) return target;
    }

    return null;
  }

  function findBundle(ide: IdeDefinition) {
    for (const appName of ide.macApps ?? []) {
      for (const dir of appDirs) {
        const target = join(dir, `${appName}.app`);
        if (exists(target)) return target;
      }
    }

    return null;
  }

  function findWindowsExe(ide: IdeDefinition) {
    for (const template of ide.winPaths ?? []) {
      const target = expandWindowsPath(template, env);
      if (target && exists(target)) return target;
    }

    return null;
  }

  function findOnPath(bin: string) {
    const extensions =
      platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];

    for (const dir of pathDirs) {
      for (const extension of extensions) {
        const candidate = join(dir, `${bin}${extension.toLowerCase()}`);
        if (executable(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }
}

/**
 * The argv for launching `root`. Kept separate from the spawn so it can be
 * asserted in tests — this is the one place a user-controlled path meets a
 * process, and it must stay an argument vector rather than a shell string.
 */
export function ideLaunchCommand(ide: ResolvedIde, root: string): { command: string; args: string[] } {
  if (ide.kind === 'macApp') {
    return { command: 'open', args: ['-a', ide.target, root] };
  }

  return { command: ide.target, args: [root] };
}

/**
 * Which editor a click should use: the saved preference when it is still
 * installed, otherwise the first one found. A preference for an editor that has
 * since been uninstalled is ignored rather than treated as an error.
 */
export function pickPreferredIde(ides: ResolvedIde[], preferredId: string | null) {
  return ides.find((ide) => ide.id === preferredId) ?? ides[0] ?? null;
}

export class IdeLauncher {
  private cache: { at: number; ides: ResolvedIde[] } | null = null;

  /** Long enough that opening the menu twice costs one scan, short enough that installing an editor shows up. */
  private readonly cacheTtlMs = 30_000;

  constructor(private readonly detect: () => ResolvedIde[] = () => detectIdes()) {}

  list(): ResolvedIde[] {
    if (this.cache && Date.now() - this.cache.at < this.cacheTtlMs) {
      return this.cache.ides;
    }

    const ides = this.detect();
    this.cache = { at: Date.now(), ides };
    return ides;
  }

  /** Drops the cached scan, so a freshly installed editor appears on the next open. */
  refresh() {
    this.cache = null;
  }

  /**
   * Launching is detached and fire-and-forget, but the spawn itself is awaited:
   * a missing binary or a quarantined bundle fails here, where the renderer can
   * still show it, rather than silently doing nothing.
   */
  async open(ide: ResolvedIde, root: string) {
    const { command, args } = ideLaunchCommand(ide, root);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });

      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }
}
