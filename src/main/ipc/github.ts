import { shell } from 'electron';
import { ipcMain } from 'electron/main';

import type {
  GitHubPrStatus,
  PullRequestActionRequest,
  PullRequestActivity,
  PullRequestCommentRequest,
  PullRequestDetail,
  PullRequestDiffResult,
  PullRequestListRequest,
  PullRequestListResult,
  PullRequestRef,
  PullRequestUnavailable
} from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { AppDatabase } from '../db/client';
import type { GitHubService } from '../workspace/GitHubCli';
import { describeConversationWorkspace } from '../workspace/conversationWorkspace';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

/** Nothing is available until a project is attached; every flag reads false. */
const UNAVAILABLE: GitHubPrStatus = {
  cliInstalled: false,
  authenticated: false,
  isGitHubRemote: false,
  slug: null,
  branch: null,
  pr: null
};

/** The default page. Large enough to fill a panel, small enough to be one read. */
const DEFAULT_PR_LIST_LIMIT = 30;

/**
 * What a repository and a `gh` install have to be before pull requests can be
 * listed at all, resolved once for every handler.
 *
 * The shape follows t3code's rule that unavailability is a value with a reason
 * rather than an empty list: a missing `gh`, a signed-out `gh` and a GitLab
 * remote are three different fixes, and the panel prints the one that applies
 * instead of an empty state that reads like a broken feature.
 *
 * The project is resolved from the conversation row, never from an argument,
 * so the renderer cannot ask about a repository it is not attached to.
 */
async function resolveRepository(
  db: AppDatabase,
  githubService: GitHubService,
  conversationId: string
): Promise<{ root: string; slug: string } | { unavailable: PullRequestUnavailable }> {
  const workspace = describeConversationWorkspace(db, conversationId);
  const project = workspace.project;

  if (!project || !project.exists) {
    return {
      unavailable: {
        reason: 'no-project',
        hint: 'Attach a project folder to this conversation to see its pull requests.',
        action: null
      }
    };
  }

  const cli = await githubService.getStatus();

  if (!cli.installed) {
    return {
      unavailable: {
        reason: 'missing-cli',
        hint: 'Pull requests are read through the GitHub CLI, which is not installed.',
        action: 'brew install gh'
      }
    };
  }

  if (!cli.authenticated) {
    return {
      unavailable: {
        reason: 'signed-out',
        hint: 'The GitHub CLI is installed but not signed in.',
        action: 'gh auth login'
      }
    };
  }

  const slug = await githubService.getOriginSlug(project.root);

  if (!slug) {
    // Two causes, one message: a folder with no `origin` at all, and one whose
    // `origin` points somewhere other than github.com. Neither is a fault, and
    // neither has a command that fixes it.
    return {
      unavailable: {
        reason: 'not-github',
        hint: 'This project has no GitHub remote on `origin`.',
        action: null
      }
    };
  }

  return { root: project.root, slug: `${slug.owner}/${slug.repo}` };
}

/**
 * The same resolution for a handler that has nothing to show when it fails.
 *
 * A list can render an unavailable state; a detail read cannot, because the
 * reader only got there by clicking a row that had already loaded. So this
 * throws the reason as a sentence instead.
 */
async function requireRepository(
  db: AppDatabase,
  githubService: GitHubService,
  conversationId: string
): Promise<{ root: string; slug: string }> {
  const resolved = await resolveRepository(db, githubService, conversationId);

  if ('unavailable' in resolved) {
    const { hint, action } = resolved.unavailable;
    throw new Error(action ? `${hint} Run \`${action}\`.` : hint);
  }

  return resolved;
}

export function registerGitHubIpc(db: AppDatabase, githubService: GitHubService) {
  ipcMain.handle(
    IPC_CHANNELS.githubPrStatus,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrStatus,
      async (event, conversationId: string): Promise<GitHubPrStatus> => {
        assertTrustedSender(event);

        // Resolved from the conversation row, never from an argument, so the
        // renderer cannot ask about a repository it is not attached to.
        const workspace = describeConversationWorkspace(db, conversationId);
        const project = workspace.project;

        if (!project || !project.exists) {
          return UNAVAILABLE;
        }

        const cli = await githubService.getStatus();
        const slug = await githubService.getOriginSlug(project.root);

        if (!cli.installed || !cli.authenticated || !slug) {
          return {
            ...UNAVAILABLE,
            cliInstalled: cli.installed,
            authenticated: cli.authenticated,
            isGitHubRemote: slug !== null,
            slug: slug ? `${slug.owner}/${slug.repo}` : null,
            branch: await githubService.getCurrentBranch(project.root)
          };
        }

        const branch = await githubService.getCurrentBranch(project.root);
        // A lookup failure is not worth failing the whole status on — the chip
        // still has something useful to say without it.
        const pr = branch ? await githubService.findOpenPr(project.root, branch).catch(() => null) : null;

        return {
          cliInstalled: true,
          authenticated: true,
          isGitHubRemote: true,
          slug: `${slug.owner}/${slug.repo}`,
          branch,
          pr
        };
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrList,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrList,
      async (event, request: PullRequestListRequest): Promise<PullRequestListResult> => {
        assertTrustedSender(event);

        const resolved = await resolveRepository(db, githubService, request.conversationId);

        if ('unavailable' in resolved) {
          return {
            unavailable: resolved.unavailable,
            entries: [],
            truncated: false,
            repository: null,
            viewer: null
          };
        }

        // Both involvement filters are defined in terms of the signed-in login,
        // so it is read before the listing rather than sent as `@me` and left
        // to each qualifier to interpret. A failure here is not fatal: the
        // listing falls back to every pull request, which is a wider answer
        // rather than a wrong one.
        const viewer = await githubService.getViewerLogin(resolved.root).catch(() => null);

        const page = await githubService.listPullRequests({
          root: resolved.root,
          state: request.state,
          involvement: request.involvement,
          viewer,
          ...(request.query ? { query: request.query } : {}),
          limit: request.limit ?? DEFAULT_PR_LIST_LIMIT
        });

        return {
          unavailable: null,
          entries: page.entries,
          truncated: page.truncated,
          repository: resolved.slug,
          viewer
        };
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrDetail,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrDetail,
      async (event, ref: PullRequestRef): Promise<PullRequestDetail | null> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, ref.conversationId);
        return githubService.getPullRequestDetail(root, ref.number);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrActivity,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrActivity,
      async (event, ref: PullRequestRef): Promise<PullRequestActivity> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, ref.conversationId);
        return githubService.getPullRequestActivity(root, ref.number);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrDiff,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrDiff,
      async (event, ref: PullRequestRef): Promise<PullRequestDiffResult> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, ref.conversationId);
        return githubService.getPullRequestDiff(root, ref.number);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrAction,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrAction,
      async (event, request: PullRequestActionRequest): Promise<void> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, request.conversationId);
        await githubService.runPullRequestAction({
          root,
          number: request.number,
          action: request.action,
          ...(request.mergeMethod ? { mergeMethod: request.mergeMethod } : {})
        });
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrComment,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrComment,
      async (event, request: PullRequestCommentRequest): Promise<void> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, request.conversationId);
        await githubService.commentOnPullRequest(root, request.number, request.body);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubOpenPr,
    withUserFacingErrors(IPC_CHANNELS.githubOpenPr, async (event, url: string): Promise<void> => {
      assertTrustedSender(event);

      // The URL originates from `gh`, but it reaches the OS handler, so the
      // host is checked here rather than trusted along the way.
      if (!/^https:\/\/github\.com\//.test(url)) {
        throw new Error('Only github.com pull request links can be opened.');
      }

      await shell.openExternal(url);
    })
  );
}
