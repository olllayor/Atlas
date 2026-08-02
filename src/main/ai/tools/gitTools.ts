import type { ToolWorkspace } from './toolWorkspace';
import { runGit } from './codeTools';

export async function gitLogToolExecute(
  input: { maxCount?: number; path?: string },
  workspace?: ToolWorkspace
) {
  const maxCount = Math.max(1, Math.min(input.maxCount ?? 20, 100));
  const args = ['log', `--max-count=${maxCount}`, '--oneline'];

  if (input.path?.trim()) {
    args.push('--', input.path.trim());
  }

  const output = await runGit(args, workspace);
  return output.trim() || 'No commit history.';
}

export async function gitBranchToolExecute(
  input: { action: 'list' | 'create' | 'switch' | 'delete'; name?: string },
  workspace?: ToolWorkspace
) {
  switch (input.action) {
    case 'list': {
      const output = await runGit(['branch', '-a'], workspace);
      return output.trim() || 'No branches found.';
    }

    case 'create': {
      if (!input.name?.trim()) {
        throw new Error('Branch name is required for create.');
      }
      await runGit(['branch', input.name.trim()], workspace);
      return `Branch '${input.name.trim()}' created.`;
    }

    case 'switch': {
      if (!input.name?.trim()) {
        throw new Error('Branch name is required for switch.');
      }
      await runGit(['checkout', input.name.trim()], workspace);
      return `Switched to branch '${input.name.trim()}'.`;
    }

    case 'delete': {
      if (!input.name?.trim()) {
        throw new Error('Branch name is required for delete.');
      }
      await runGit(['branch', '-d', input.name.trim()], workspace);
      return `Branch '${input.name.trim()}' deleted.`;
    }

    default:
      throw new Error(`Unknown branch action: ${String(input.action)}`);
  }
}

export async function gitCommitToolExecute(
  input: { message: string; amend?: boolean; addAll?: boolean },
  workspace?: ToolWorkspace
) {
  if (!input.message?.trim() && !input.amend) {
    throw new Error('Commit message is required.');
  }

  if (input.addAll) {
    await runGit(['add', '-A'], workspace);
  }

  const args = ['commit'];
  if (input.message?.trim()) {
    args.push('-m', input.message.trim());
  }
  if (input.amend) {
    args.push('--amend');
  }

  const output = await runGit(args, workspace);
  return output.trim() || 'Committed changes successfully.';
}

export async function gitStashToolExecute(
  input: { action: 'push' | 'pop' | 'list' | 'drop'; message?: string },
  workspace?: ToolWorkspace
) {
  switch (input.action) {
    case 'list': {
      const output = await runGit(['stash', 'list'], workspace);
      return output.trim() || 'Stash is empty.';
    }

    case 'push': {
      const args = ['stash', 'push'];
      if (input.message?.trim()) {
        args.push('-m', input.message.trim());
      }
      const output = await runGit(args, workspace);
      return output.trim() || 'Stash pushed.';
    }

    case 'pop': {
      const output = await runGit(['stash', 'pop'], workspace);
      return output.trim() || 'Stash popped.';
    }

    case 'drop': {
      const output = await runGit(['stash', 'drop'], workspace);
      return output.trim() || 'Stash dropped.';
    }

    default:
      throw new Error(`Unknown stash action: ${String(input.action)}`);
  }
}
