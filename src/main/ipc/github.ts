import { shell } from 'electron';
import { ipcMain } from 'electron/main';

import type {
  GitHubPrStatus,
  PullRequestActionRequest,
  PullRequestActivity,
  PullRequestCommentRequest,
  PullRequestCreateRequest,
  PullRequestCreateResult,
  PullRequestDetail,
  PullRequestDiffResult,
  PullRequestLabelCandidate,
  PullRequestListRequest,
  PullRequestListResult,
  PullRequestRef,
  PullRequestRequestReviewersRequest,
  PullRequestReviewThread,
  PullRequestReviewerCandidate,
  PullRequestSetLabelsRequest,
  PullRequestSubmitReviewRequest,
  PullRequestThreadReplyRequest,
  PullRequestThreadResolutionRequest,
  PullRequestUnavailable,
  PullRequestWorkspaceEntry,
  PullRequestWorkspaceListRequest,
  PullRequestWorkspaceListResult
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
 * so the renderer cannot ask about a repository it is not attached to — except
 * on the app-wide Pull requests page, which names a project root that must
 * already be in the projects table.
 */
type RepositoryTarget = { conversationId: string } | { projectRoot: string };

async function resolveRootForTarget(
  db: AppDatabase,
  target: RepositoryTarget
): Promise<{ root: string; title: string } | { unavailable: PullRequestUnavailable }> {
  if ('projectRoot' in target) {
    const project = db.projects.findByRoot(target.projectRoot);

    if (!project || !project.exists) {
      return {
        unavailable: {
          reason: 'no-project',
          hint: 'That folder is not attached to Atlas, or it is no longer on disk.',
          action: null
        }
      };
    }

    return { root: project.root, title: project.title };
  }

  const workspace = describeConversationWorkspace(db, target.conversationId);
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

  return { root: project.root, title: project.title };
}

async function resolveRepository(
  db: AppDatabase,
  githubService: GitHubService,
  target: RepositoryTarget
): Promise<{ root: string; slug: string; title: string } | { unavailable: PullRequestUnavailable }> {
  const resolved = await resolveRootForTarget(db, target);

  if ('unavailable' in resolved) {
    return resolved;
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

  const slug = await githubService.getOriginSlug(resolved.root);

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

  return {
    root: resolved.root,
    title: resolved.title,
    slug: `${slug.owner}/${slug.repo}`
  };
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
  target: RepositoryTarget
): Promise<{ root: string; slug: string }> {
  const resolved = await resolveRepository(db, githubService, target);

  if ('unavailable' in resolved) {
    const { hint, action } = resolved.unavailable;
    throw new Error(action ? `${hint} Run \`${action}\`.` : hint);
  }

  return { root: resolved.root, slug: resolved.slug };
}

function targetOfRef(ref: PullRequestRef): RepositoryTarget {
  return 'conversationId' in ref
    ? { conversationId: ref.conversationId }
    : { projectRoot: ref.projectRoot };
}

function targetOfRequest(request: { conversationId: string } | { projectRoot: string }): RepositoryTarget {
  return 'conversationId' in request
    ? { conversationId: request.conversationId }
    : { projectRoot: request.projectRoot };
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

        const resolved = await resolveRepository(db, githubService, { conversationId: request.conversationId });

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

  /**
   * Every project's pull requests on one page.
   *
   * Projects without a GitHub remote, a missing `gh`, or a signed-out CLI are
   * skipped rather than failing the page: one broken checkout is not a reason
   * to hide every other project's work. The first hard failure (no `gh` at
   * all) is reported as the page's unavailability instead of an empty list.
   */
  ipcMain.handle(
    IPC_CHANNELS.githubPrListWorkspace,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrListWorkspace,
      async (
        event,
        request: PullRequestWorkspaceListRequest
      ): Promise<PullRequestWorkspaceListResult> => {
        assertTrustedSender(event);

        const cli = await githubService.getStatus();
        if (!cli.installed || !cli.authenticated) {
          return {
            unavailable: {
              reason: cli.installed ? 'signed-out' : 'missing-cli',
              hint: cli.installed
                ? 'The GitHub CLI is installed but not signed in.'
                : 'Pull requests are read through the GitHub CLI, which is not installed.',
              action: cli.installed ? 'gh auth login' : 'brew install gh'
            },
            entries: [],
            truncated: false,
            viewer: null
          };
        }

        const projects = db.projects.list().filter((project) => project.exists && project.isGitRepository);
        const limit = request.limitPerProject ?? DEFAULT_PR_LIST_LIMIT;
        const entries: PullRequestWorkspaceEntry[] = [];
        let truncated = false;
        let viewer: string | null = null;
        let sawGitHub = false;

        for (const project of projects) {
          const slug = await githubService.getOriginSlug(project.root).catch(() => null);
          if (!slug) continue;
          sawGitHub = true;

          if (viewer === null) {
            viewer = await githubService.getViewerLogin(project.root).catch(() => null);
          }

          try {
            const page = await githubService.listPullRequests({
              root: project.root,
              state: request.state,
              involvement: request.involvement,
              viewer,
              ...(request.query ? { query: request.query } : {}),
              limit
            });

            if (page.truncated) truncated = true;

            for (const entry of page.entries) {
              entries.push({
                ...entry,
                projectRoot: project.root,
                projectTitle: project.title,
                repository: `${slug.owner}/${slug.repo}`
              });
            }
          } catch {
            // One project's `gh` failure is not a reason to hide the rest.
          }
        }

        if (!sawGitHub) {
          return {
            unavailable: {
              reason: 'not-github',
              hint: 'No attached project has a GitHub remote on `origin`.',
              action: null
            },
            entries: [],
            truncated: false,
            viewer
          };
        }

        entries.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

        return { unavailable: null, entries, truncated, viewer };
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrDetail,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrDetail,
      async (event, ref: PullRequestRef): Promise<PullRequestDetail | null> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, targetOfRef(ref));
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
        const { root } = await requireRepository(db, githubService, targetOfRef(ref));
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
        const { root } = await requireRepository(db, githubService, targetOfRef(ref));
        return githubService.getPullRequestDiff(root, ref.number);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrThreads,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrThreads,
      async (event, ref: PullRequestRef): Promise<PullRequestReviewThread[]> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, targetOfRef(ref));
        return githubService.getPullRequestReviewThreads(root, ref.number);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrAction,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrAction,
      async (event, request: PullRequestActionRequest): Promise<void> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, targetOfRef(request));
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
        const { root } = await requireRepository(db, githubService, targetOfRef(request));
        await githubService.commentOnPullRequest(root, request.number, request.body);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrSubmitReview,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrSubmitReview,
      async (event, request: PullRequestSubmitReviewRequest): Promise<void> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, targetOfRef(request));
        await githubService.submitPullRequestReview({
          root,
          number: request.number,
          verdict: request.verdict,
          body: request.body,
          comments: request.comments ?? []
        });
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrThreadReply,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrThreadReply,
      async (event, request: PullRequestThreadReplyRequest): Promise<void> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, targetOfRef(request));
        await githubService.replyToReviewThread({
          root,
          threadId: request.threadId,
          body: request.body
        });
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrThreadResolve,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrThreadResolve,
      async (event, request: PullRequestThreadResolutionRequest): Promise<void> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, targetOfRef(request));
        await githubService.setReviewThreadResolution({
          root,
          threadId: request.threadId,
          resolved: request.resolved
        });
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrReviewers,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrReviewers,
      async (event, ref: PullRequestRef): Promise<PullRequestReviewerCandidate[]> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, targetOfRef(ref));
        return githubService.listReviewerCandidates(root, ref.number);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrLabels,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrLabels,
      async (event, ref: PullRequestRef): Promise<PullRequestLabelCandidate[]> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, targetOfRef(ref));
        return githubService.listLabelCandidates(root, ref.number);
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrRequestReviewers,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrRequestReviewers,
      async (event, request: PullRequestRequestReviewersRequest): Promise<void> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, targetOfRef(request));
        await githubService.requestReviewers({
          root,
          number: request.number,
          add: request.add,
          remove: request.remove
        });
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.githubPrSetLabels,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrSetLabels,
      async (event, request: PullRequestSetLabelsRequest): Promise<void> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, targetOfRef(request));
        await githubService.setLabels({
          root,
          number: request.number,
          add: request.add,
          remove: request.remove
        });
      }
    )
  );

  /**
   * Opens a pull request from the panel, pushing the branch first when asked.
   *
   * The push is folded in for the same reason the agent tool folds it: a pull
   * request cannot exist without the branch on the remote, and discovering
   * "no upstream" after typing a title is a pointless round trip. An existing
   * pull request is returned rather than treated as a failure.
   */
  ipcMain.handle(
    IPC_CHANNELS.githubPrCreate,
    withUserFacingErrors(
      IPC_CHANNELS.githubPrCreate,
      async (event, request: PullRequestCreateRequest): Promise<PullRequestCreateResult> => {
        assertTrustedSender(event);
        const { root } = await requireRepository(db, githubService, targetOfRequest(request));

        const branch = await githubService.getCurrentBranch(root);
        if (!branch) {
          throw new Error(
            'HEAD is detached, so there is no branch to open a pull request from. Switch to a branch first.'
          );
        }

        if (request.push !== false) {
          await githubService.pushBranch(root, branch);
        }

        const result = await githubService.createPr(root, {
          title: request.title,
          body: request.body ?? '',
          base: request.base,
          draft: request.draft,
          branch
        });

        return {
          number: result.pr?.number ?? null,
          url: result.url,
          alreadyExisted: result.alreadyExisted
        };
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
