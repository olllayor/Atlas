import type { GitHubService } from '../../workspace/GitHubCli';
import { getSharedGitHubService } from '../../workspace/GitHubCli';
import { canWriteFiles, type ToolWorkspace } from './toolWorkspace';

/**
 * The repository root a GitHub action may touch.
 *
 * Resolved from the workspace rather than from tool input, so the model cannot
 * aim a push at a folder the conversation is not attached to.
 */
function requireRoot(workspace: ToolWorkspace | undefined): string {
  if (!canWriteFiles(workspace)) {
    throw new Error(
      'GitHub actions need a project folder attached in Code mode. Attach one, then try again.'
    );
  }

  return workspace.root;
}

async function requireBranch(service: GitHubService, root: string): Promise<string> {
  const branch = await service.getCurrentBranch(root);

  if (!branch) {
    throw new Error(
      'HEAD is detached, so there is no branch to push. Switch to a branch with git_branch first.'
    );
  }

  return branch;
}

/**
 * A read-only report: is `gh` usable here, and does this branch have a PR?
 *
 * Deliberately answers the "why can't I" questions too — a missing binary and a
 * signed-out CLI are the two states the model would otherwise discover by
 * failing a mutation.
 */
export async function githubPrStatusToolExecute(
  _input: Record<string, never>,
  workspace?: ToolWorkspace,
  service: GitHubService = getSharedGitHubService()
) {
  const root = requireRoot(workspace);
  const status = await service.getStatus();

  if (!status.installed) {
    return 'GitHub CLI is not installed. Install it with `brew install gh` to create pull requests.';
  }

  if (!status.authenticated) {
    return 'GitHub CLI is installed but not signed in. Run `gh auth login` to create pull requests.';
  }

  const slug = await service.getOriginSlug(root);
  if (!slug) {
    return 'This repository has no GitHub `origin` remote, so pull requests are unavailable here.';
  }

  const branch = await service.getCurrentBranch(root);
  if (!branch) {
    return `Repository ${slug.owner}/${slug.repo} is on a detached HEAD, so it has no branch to open a pull request from.`;
  }

  const pr = await service.findOpenPr(root, branch);
  const lines = [`Repository: ${slug.owner}/${slug.repo}`, `Branch: ${branch}`];

  if (pr) {
    lines.push(
      `Open pull request: #${pr.number}${pr.isDraft ? ' (draft)' : ''} — ${pr.title}`,
      `Into: ${pr.baseRefName}`,
      pr.url
    );
  } else {
    lines.push('No open pull request for this branch.');
  }

  return lines.join('\n');
}

export async function gitPushToolExecute(
  input: { branch?: string; force?: boolean },
  workspace?: ToolWorkspace,
  service: GitHubService = getSharedGitHubService()
) {
  const root = requireRoot(workspace);
  const branch = input.branch?.trim() || (await requireBranch(service, root));
  return service.pushBranch(root, branch, input.force === true);
}

/**
 * Push the current branch and open a pull request for it.
 *
 * The push is folded in because a PR cannot exist without it, and the model
 * hitting "no upstream" after writing a title and body is a pointless round
 * trip. An existing PR is returned rather than treated as a failure.
 */
export async function githubPrCreateToolExecute(
  input: { title: string; body?: string; base?: string; draft?: boolean },
  workspace?: ToolWorkspace,
  service: GitHubService = getSharedGitHubService()
) {
  const root = requireRoot(workspace);
  const slug = await service.getOriginSlug(root);

  if (!slug) {
    throw new Error(
      'This repository has no GitHub `origin` remote. Pull request creation supports GitHub only.'
    );
  }

  const branch = await requireBranch(service, root);
  await service.pushBranch(root, branch);

  const result = await service.createPr(root, {
    title: input.title,
    body: input.body ?? '',
    base: input.base,
    draft: input.draft,
    branch
  });

  if (result.alreadyExisted && result.pr) {
    return `Branch ${branch} already has an open pull request: #${result.pr.number} — ${result.pr.title}\n${result.pr.url}`;
  }

  const number = result.pr ? `#${result.pr.number} ` : '';
  return `Opened pull request ${number}for ${branch}.\n${result.url}`.trim();
}
