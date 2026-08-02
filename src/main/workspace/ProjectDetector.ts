import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type ProjectType = 'node' | 'python' | 'rust' | 'go' | 'unknown';

export type ProjectTypeInfo = {
  type: ProjectType;
  packageManager?: string;
  framework?: string;
  entryFile?: string;
};

export type GitInfo = {
  isRepo: boolean;
  branch: string | null;
};

export class ProjectDetector {
  private cache = new Map<string, { typeInfo: ProjectTypeInfo; timestamp: number }>();
  private readonly CACHE_TTL_MS = 10_000;

  detectProjectType(root: string): ProjectTypeInfo {
    const absRoot = resolve(root);
    const cached = this.cache.get(absRoot);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.typeInfo;
    }

    const typeInfo = this.runDetection(absRoot);
    this.cache.set(absRoot, { typeInfo, timestamp: Date.now() });
    return typeInfo;
  }

  private runDetection(root: string): ProjectTypeInfo {
    if (!existsSync(root)) {
      return { type: 'unknown' };
    }

    // 1. Node.js detection
    const pkgPath = join(root, 'package.json');
    if (existsSync(pkgPath)) {
      let packageManager: string | undefined;
      let framework: string | undefined;
      let entryFile: string | undefined;

      if (existsSync(join(root, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
      else if (existsSync(join(root, 'yarn.lock'))) packageManager = 'yarn';
      else if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) packageManager = 'bun';
      else if (existsSync(join(root, 'package-lock.json'))) packageManager = 'npm';

      try {
        const pkgContent = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
          packageManager?: string;
          main?: string;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };

        if (pkgContent.packageManager) {
          packageManager = pkgContent.packageManager.split('@')[0];
        }

        entryFile = pkgContent.main;
        const allDeps = { ...pkgContent.devDependencies, ...pkgContent.dependencies };

        if (allDeps.next) framework = 'Next.js';
        else if (allDeps['@remix-run/react']) framework = 'Remix';
        else if (allDeps.nuxt) framework = 'Nuxt';
        else if (allDeps.vite) framework = 'Vite';
        else if (allDeps.astro) framework = 'Astro';
        else if (allDeps.svelte || allDeps['@sveltejs/kit']) framework = 'Svelte';
        else if (allDeps.vue) framework = 'Vue';
        else if (allDeps.react) framework = 'React';
        else if (allDeps.express) framework = 'Express';
        else if (allDeps.fastify) framework = 'Fastify';
        else if (allDeps.electron) framework = 'Electron';
      } catch {
        // Ignore parse error
      }

      return { type: 'node', packageManager: packageManager ?? 'npm', framework, entryFile };
    }

    // 2. Python detection
    if (
      existsSync(join(root, 'pyproject.toml')) ||
      existsSync(join(root, 'requirements.txt')) ||
      existsSync(join(root, 'Pipfile')) ||
      existsSync(join(root, 'setup.py'))
    ) {
      let framework: string | undefined;
      let packageManager: string | undefined = 'pip';

      if (existsSync(join(root, 'poetry.lock'))) packageManager = 'poetry';
      else if (existsSync(join(root, 'uv.lock'))) packageManager = 'uv';
      else if (existsSync(join(root, 'Pipfile.lock'))) packageManager = 'pipenv';

      const reqPath = join(root, 'requirements.txt');
      let reqText = '';
      if (existsSync(reqPath)) {
        try {
          reqText = readFileSync(reqPath, 'utf8').toLowerCase();
        } catch {
          reqText = '';
        }
      }

      const pyprojectPath = join(root, 'pyproject.toml');
      if (existsSync(pyprojectPath)) {
        try {
          reqText += '\n' + readFileSync(pyprojectPath, 'utf8').toLowerCase();
        } catch {
          // ignore
        }
      }

      if (reqText.includes('django')) framework = 'Django';
      else if (reqText.includes('fastapi')) framework = 'FastAPI';
      else if (reqText.includes('flask')) framework = 'Flask';

      return { type: 'python', packageManager, framework };
    }

    // 3. Rust detection
    if (existsSync(join(root, 'Cargo.toml'))) {
      let framework: string | undefined;
      try {
        const cargoText = readFileSync(join(root, 'Cargo.toml'), 'utf8').toLowerCase();
        if (cargoText.includes('actix-web')) framework = 'Actix Web';
        else if (cargoText.includes('axum')) framework = 'Axum';
        else if (cargoText.includes('rocket')) framework = 'Rocket';
        else if (cargoText.includes('tauri')) framework = 'Tauri';
      } catch {
        // ignore
      }

      return { type: 'rust', packageManager: 'cargo', framework };
    }

    // 4. Go detection
    if (existsSync(join(root, 'go.mod'))) {
      let framework: string | undefined;
      try {
        const goText = readFileSync(join(root, 'go.mod'), 'utf8').toLowerCase();
        if (goText.includes('github.com/gin-gonic/gin')) framework = 'Gin';
        else if (goText.includes('github.com/gofiber/fiber')) framework = 'Fiber';
        else if (goText.includes('github.com/labstack/echo')) framework = 'Echo';
      } catch {
        // ignore
      }

      return { type: 'go', packageManager: 'go', framework };
    }

    return { type: 'unknown' };
  }

  detectEnvFile(root: string): string[] {
    const absRoot = resolve(root);
    if (!existsSync(absRoot)) return [];

    const envFiles = ['.env', '.env.local', '.env.development', '.env.test'];
    const keysSet = new Set<string>();

    for (const envFile of envFiles) {
      const fullPath = join(absRoot, envFile);
      if (existsSync(fullPath)) {
        try {
          const content = readFileSync(fullPath, 'utf8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(trimmed);
            if (match?.[1]) {
              keysSet.add(match[1]);
            }
          }
        } catch {
          // ignore
        }
      }
    }

    return Array.from(keysSet);
  }

  invalidateCache(root?: string) {
    if (root) {
      this.cache.delete(resolve(root));
    } else {
      this.cache.clear();
    }
  }
}
