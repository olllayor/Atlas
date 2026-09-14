/**
 * Process-level crash handlers for the Electron main process.
 *
 * Installed as early as possible so a failure during module evaluation of a
 * later import still leaves a log line and a clean exit, instead of a zombie
 * process with a dead renderer and no explanation.
 */

import { app } from 'electron/main';

import { logger } from '../observability/logger';

export function installCrashHandlers(): void {
  // Uncaught exceptions leave the process in an unknown state: native handles
  // may be half-released, the DB write path interrupted mid-transaction. Exit
  // rather than limp on; the next launch recovers via SQLite/WAL.
  process.on('uncaughtException', (error) => {
    // logger.configure happens in whenReady; console is the backstop for
    // crashes before that (and for packaged builds where echo is off).
    logger.error('process.uncaught_exception', { error });
    // eslint-disable-next-line no-console
    console.error('[atlas] uncaughtException', error);
    logger.flushSync();
    app.exit(1);
  });

  // Rejections are deliberately non-fatal: fire-and-forget promises are used
  // widely (sweeps, network refreshes, spawn teardown) and many already carry
  // their own catch. Exiting here would turn a flaky network into a crash.
  process.on('unhandledRejection', (reason) => {
    logger.warn('process.unhandled_rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
}
