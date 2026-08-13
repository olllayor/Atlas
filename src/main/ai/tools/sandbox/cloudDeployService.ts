import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';

import type { SettingsRepo } from '../../../db/repositories/settingsRepo';
import { cloudHealthCheck } from './cloudflareComputer';

const execFileAsync = promisify(execFile);

export function generateRandomSecret(): string {
  return `atlas_cs_${randomUUID().replace(/-/g, '')}`;
}

export function resolveWorkerDirectory(): string | null {
  const candidates = [
    join(process.cwd(), 'workers', 'cloud-sandbox'),
    join(app.getAppPath(), 'workers', 'cloud-sandbox'),
    join(process.cwd(), '..', 'workers', 'cloud-sandbox'),
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, 'wrangler.toml')) || existsSync(join(dir, 'src', 'index.ts'))) {
      return dir;
    }
  }

  return candidates[0];
}

export type DeployResult = {
  success: boolean;
  url?: string;
  secret?: string;
  error?: string;
};

export async function deployCloudSandboxWorker(settingsRepo: SettingsRepo): Promise<DeployResult> {
  const workerDir = resolveWorkerDirectory();

  if (!workerDir || !existsSync(workerDir)) {
    return {
      success: false,
      error: `Cloud Sandbox worker source directory not found at ${workerDir || 'workers/cloud-sandbox'}.`,
    };
  }

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  // Step 1: Check Wrangler login status
  try {
    const { stdout, stderr } = await execFileAsync(npxCmd, ['wrangler', 'whoami'], {
      cwd: workerDir,
      timeout: 15_000,
    });
    const combined = stdout + stderr;
    if (combined.includes('Not logged in') || combined.includes('error')) {
      return {
        success: false,
        error: 'Cloudflare CLI (Wrangler) is not logged in. Please run "npx wrangler login" in your terminal first.',
      };
    }
  } catch (err: any) {
    return {
      success: false,
      error: `Wrangler auth check failed: ${err.message || String(err)}. Make sure Node and Wrangler are installed.`,
    };
  }

  // Step 2: Deploy worker
  let deployedUrl: string | null = null;
  try {
    const { stdout, stderr } = await execFileAsync(npxCmd, ['wrangler', 'deploy'], {
      cwd: workerDir,
      timeout: 60_000,
    });

    const output = stdout + '\n' + stderr;
    const urlMatch = output.match(/https:\/\/[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+\.workers\.dev/);
    if (urlMatch) {
      deployedUrl = urlMatch[0];
    }
  } catch (err: any) {
    return {
      success: false,
      error: `Wrangler deployment failed: ${err.message || String(err)}`,
    };
  }

  if (!deployedUrl) {
    return {
      success: false,
      error: 'Worker deployed, but could not detect worker URL from deployment output.',
    };
  }

  // Step 3: Generate and set CF_API_SECRET
  const secret = generateRandomSecret();
  try {
    const child = execFile(npxCmd, ['wrangler', 'secret', 'put', 'CF_API_SECRET'], {
      cwd: workerDir,
      timeout: 20_000,
    });

    if (child.stdin) {
      child.stdin.write(secret + '\n');
      child.stdin.end();
    }

    await new Promise<void>((resolve, reject) => {
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Wrangler secret put exited with code ${code}`));
      });
      child.on('error', reject);
    });
  } catch (err: any) {
    // Non-fatal if secret put fails — user can set secret manually, but report progress
  }

  // Step 4: Persist settings — the bearer token goes to the keychain, not the
  // plaintext settings JSON, so an attacker reading userData gets nothing.
  settingsRepo.setCloudSandboxWorkerUrl(deployedUrl);
  await settingsRepo.setCloudSandboxWorkerSecret(secret);
  settingsRepo.setCloudSandboxEnabled(true);

  // Step 5: Test health check on newly deployed worker
  const health = await cloudHealthCheck({ endpoint: deployedUrl, authToken: secret });

  return {
    success: true,
    url: deployedUrl,
    secret,
    error: health.success ? undefined : `Worker deployed at ${deployedUrl}, but health check failed: ${health.error}`,
  };
}
