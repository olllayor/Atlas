import { shell } from 'electron';
import { ipcMain } from 'electron/main';

import type { GitHubPrStatus } from '../../shared/contracts';
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
