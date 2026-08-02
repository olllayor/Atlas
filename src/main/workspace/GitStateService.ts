import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ToolWorkspace } from '../ai/tools/toolWorkspace';
import { runGit } from '../ai/tools/codeTools';

export type GitFileStatus = {
  path: string;
  indexStatus: string;
  workingTreeStatus: string;
};

export type GitLogEntry = {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
};

export type GitBranchInfo = {
  name: string;
  current: boolean;
  remote: boolean;
};

export class GitStateService {
  isGitRepo(root: string): boolean {
    const absRoot = resolve(root);
    return existsSync(resolve(absRoot, '.git'));
  }

  async getBranch(root: string): Promise<string | null> {
    if (!this.isGitRepo(root)) return null;
    const workspace: ToolWorkspace = { mode: 'code', root };
    try {
      const output = await runGit(['branch', '--show-current'], workspace);
      return output.trim() || 'HEAD (detached)';
    } catch (err) {
      console.warn('[GitStateService] getBranch failed:', err);
      return null;
    }
  }

  async getStatus(root: string): Promise<GitFileStatus[]> {
    if (!this.isGitRepo(root)) return [];
    const workspace: ToolWorkspace = { mode: 'code', root };
    try {
      const output = await runGit(['status', '--porcelain=v1'], workspace);
      const lines = output.split('\n').filter(Boolean);
      return lines.map((line) => {
        const indexStatus = line[0] || ' ';
        const workingTreeStatus = line[1] || ' ';
        let path = line.slice(3).trim();
        // Handle renamed/copied files: 'R  old -> new' or 'C  old -> new'
        if ((indexStatus === 'R' || indexStatus === 'C') && path.includes(' -> ')) {
          path = path.split(' -> ').pop()!.trim();
        }
        return { path, indexStatus, workingTreeStatus };
      });
    } catch (err) {
      console.warn('[GitStateService] getStatus failed:', err);
      return [];
    }
  }

  async getLog(root: string, maxCount = 20): Promise<GitLogEntry[]> {
    if (!this.isGitRepo(root)) return [];
    const workspace: ToolWorkspace = { mode: 'code', root };
    try {
      // Format: hash%x1fshortHash%x1fmessage%x1fauthor%x1fdate
      const output = await runGit(
        ['log', `--max-count=${maxCount}`, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ad', '--date=iso'],
        workspace
      );
      const lines = output.split('\n').filter(Boolean);
      return lines.map((line) => {
        const [hash = '', shortHash = '', message = '', author = '', date = ''] = line.split('\x1f');
        return { hash, shortHash, message, author, date };
      });
    } catch (err) {
      console.warn('[GitStateService] getLog failed:', err);
      return [];
    }
  }

  async getBranches(root: string): Promise<GitBranchInfo[]> {
    if (!this.isGitRepo(root)) return [];
    const workspace: ToolWorkspace = { mode: 'code', root };
    try {
      const output = await runGit(['branch', '-a', '--no-color'], workspace);
      const lines = output.split('\n').filter(Boolean);
      return lines.map((line) => {
        const current = line.startsWith('*');
        const cleanName = line.replace(/^\*?\s+/, '').trim();
        const remote = cleanName.startsWith('remotes/');
        return { name: cleanName, current, remote };
      });
    } catch (err) {
      console.warn('[GitStateService] getBranches failed:', err);
      return [];
    }
  }
}
