/**
 * Decoders for what `gh --json` prints.
 *
 * Split out from `GitHubCli` for the reason t3code splits its own
 * `gitHubPullRequestJson.ts` from `GitHubPullRequestCli.ts`: parsing is the
 * half that breaks when GitHub changes a field, and it should be testable
 * without spawning a process.
 *
 * Every decoder is total. A row `gh` prints in a shape this does not recognise
 * is dropped, not thrown on: one malformed pull request in a list of forty is
 * not a reason to show the reader an error instead of the other thirty-nine.
 * The one exception is output that is not JSON at all, which means the command
 * did not do what was asked and the caller needs to know.
 */

import type {
  PullRequestActivity,
  PullRequestActor,
  PullRequestCheck,
  PullRequestCheckStatus,
  PullRequestChecksState,
  PullRequestComment,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestInlineCommentDraft,
  PullRequestLabel,
  PullRequestLabelCandidate,
  PullRequestListEntry,
  PullRequestMergeability,
  PullRequestReviewDecision,
  PullRequestReviewThread,
  PullRequestReviewVerdict,
  PullRequestReviewerCandidate,
  PullRequestState,
  PullRequestThreadComment
} from '../../shared/contracts';

/**
 * The fields one list row needs.
 *
 * `additions` and `deletions` are included even though t3code drops them from
 * its cross-repository search for speed: Atlas lists one repository at a time,
 * where the second read they would cost is not worth saving.
 */
export const PR_LIST_FIELDS =
  'number,title,url,author,headRefName,baseRefName,state,isDraft,mergeable,reviewDecision,additions,deletions,createdAt,updatedAt,mergedAt,reviewRequests,labels,statusCheckRollup';

/** The list row, plus what only the detail page shows. */
export const PR_DETAIL_FIELDS = `${PR_LIST_FIELDS},body,changedFiles,closedAt,headRefOid`;

/** The conversation, read on its own so the summary does not wait for it. */
export const PR_ACTIVITY_FIELDS = 'comments,reviews,commits';

function parseJson(raw: string, operation: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Not a parse failure of one row but of the whole answer: `gh` printed
    // something else entirely, which the caller must not read as "no results".
    throw new Error(`Could not read the GitHub response for ${operation}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * `gh` gives an author `{login, name, is_bot}` and no avatar. The field is kept
 * on the contract because the GraphQL road has one; here it stays null rather
 * than being faked from the login.
 */
export function decodeActor(value: unknown): PullRequestActor | null {
  if (!isRecord(value)) {
    return null;
  }

  const login = nullableString(value.login);
  if (!login) {
    return null;
  }

  return {
    login,
    name: nullableString(value.name),
    avatarUrl: nullableString(value.avatarUrl)
  };
}

function decodeState(value: unknown): PullRequestState {
  const raw = stringOr(value, '').toUpperCase();
  if (raw === 'MERGED') return 'merged';
  if (raw === 'CLOSED') return 'closed';
  return 'open';
}

function decodeMergeability(value: unknown): PullRequestMergeability {
  const raw = stringOr(value, '').toUpperCase();
  if (raw === 'MERGEABLE') return 'mergeable';
  if (raw === 'CONFLICTING') return 'conflicting';
  return 'unknown';
}

export function decodeReviewDecision(value: unknown): PullRequestReviewDecision | null {
  const raw = stringOr(value, '').toUpperCase();
  if (raw === 'APPROVED') return 'approved';
  if (raw === 'CHANGES_REQUESTED') return 'changes-requested';
  if (raw === 'REVIEW_REQUIRED') return 'review-required';
  return null;
}

/**
 * Only the accounts. A team-level request names a team rather than a person,
 * and the row has nowhere to say so.
 */
function decodeReviewRequests(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const logins: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const login = nullableString(entry.login);
    if (login) logins.push(login);
  }

  return logins;
}

function decodeLabels(value: unknown): PullRequestLabel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const labels: PullRequestLabel[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const name = nullableString(entry.name);
    if (!name) continue;
    labels.push({ name, color: nullableString(entry.color) });
  }

  return labels;
}

/**
 * One entry of `statusCheckRollup`, which mixes two shapes: a CheckRun carries
 * `status` plus `conclusion`, a StatusContext carries `state` alone.
 */
export function decodeCheck(value: unknown): PullRequestCheck | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = nullableString(value.name) ?? nullableString(value.context);
  if (!name) {
    return null;
  }

  const url = nullableString(value.detailsUrl) ?? nullableString(value.targetUrl);
  return { name, status: decodeCheckStatus(value), url };
}

function decodeCheckStatus(entry: Record<string, unknown>): PullRequestCheckStatus {
  // A StatusContext has no run of its own; its `state` is the whole answer.
  const contextState = stringOr(entry.state, '').toUpperCase();
  if (contextState) {
    if (contextState === 'SUCCESS') return 'success';
    if (contextState === 'FAILURE' || contextState === 'ERROR') return 'failure';
    return 'pending';
  }

  // A CheckRun that has not completed has no conclusion yet, so `status` is
  // read first: a queued run reporting a stale conclusion is still queued.
  const status = stringOr(entry.status, '').toUpperCase();
  if (status && status !== 'COMPLETED') {
    return 'pending';
  }

  const conclusion = stringOr(entry.conclusion, '').toUpperCase();
  if (conclusion === 'SUCCESS') return 'success';
  if (conclusion === 'SKIPPED') return 'skipped';
  if (conclusion === 'CANCELLED') return 'cancelled';
  if (conclusion === 'NEUTRAL') return 'success';
  if (!conclusion) return 'pending';
  return 'failure';
}

export function decodeChecks(value: unknown): PullRequestCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const checks: PullRequestCheck[] = [];
  for (const entry of value) {
    const check = decodeCheck(entry);
    if (check) checks.push(check);
  }

  return checks;
}

/**
 * The rollup as one glyph.
 *
 * Failing outranks pending: a run still going cannot un-fail the one that
 * already did, and the reader's next move is the same either way. Skipped and
 * cancelled runs count as neither — a skipped check is not a passing one, but
 * a pull request whose every check was skipped has nothing to report.
 */
export function rollupChecksState(checks: readonly PullRequestCheck[]): PullRequestChecksState | null {
  let sawPending = false;
  let sawSuccess = false;

  for (const check of checks) {
    if (check.status === 'failure') return 'failing';
    if (check.status === 'pending') sawPending = true;
    if (check.status === 'success') sawSuccess = true;
  }

  if (sawPending) return 'pending';
  if (sawSuccess) return 'passing';
  return null;
}

function decodeListEntry(value: unknown): PullRequestListEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const number = numberOr(value.number, 0);
  const url = nullableString(value.url);
  // Without these two the row cannot be opened or asked about again, which is
  // every one of its interactions.
  if (number <= 0 || !url) {
    return null;
  }

  const checks = decodeChecks(value.statusCheckRollup);

  return {
    number,
    url,
    title: stringOr(value.title, ''),
    author: decodeActor(value.author),
    headRefName: stringOr(value.headRefName, ''),
    baseRefName: stringOr(value.baseRefName, ''),
    state: decodeState(value.state),
    isDraft: value.isDraft === true,
    mergeability: decodeMergeability(value.mergeable),
    additions: numberOr(value.additions, 0),
    deletions: numberOr(value.deletions, 0),
    createdAt: stringOr(value.createdAt, ''),
    updatedAt: stringOr(value.updatedAt, ''),
    mergedAt: nullableString(value.mergedAt),
    reviewRequests: decodeReviewRequests(value.reviewRequests),
    labels: decodeLabels(value.labels),
    reviewDecision: decodeReviewDecision(value.reviewDecision),
    checksState: rollupChecksState(checks)
  };
}

export function decodePullRequestList(raw: string): PullRequestListEntry[] {
  const parsed = parseJson(raw, 'the pull request list');
  if (!Array.isArray(parsed)) {
    return [];
  }

  const entries: PullRequestListEntry[] = [];
  for (const value of parsed) {
    const entry = decodeListEntry(value);
    if (entry) entries.push(entry);
  }

  return entries;
}

export function decodePullRequestDetail(raw: string): PullRequestDetail | null {
  const parsed = parseJson(raw, 'the pull request');
  const entry = decodeListEntry(parsed);
  if (!entry || !isRecord(parsed)) {
    return null;
  }

  return {
    ...entry,
    body: stringOr(parsed.body, ''),
    changedFiles: numberOr(parsed.changedFiles, 0),
    closedAt: nullableString(parsed.closedAt),
    headRefOid: nullableString(parsed.headRefOid),
    checks: decodeChecks(parsed.statusCheckRollup)
  };
}

/** A review's own verdict, which is not the pull request's rollup decision. */
function decodeReviewVerdict(value: unknown): PullRequestReviewDecision | null {
  const raw = stringOr(value, '').toUpperCase();
  if (raw === 'APPROVED') return 'approved';
  if (raw === 'CHANGES_REQUESTED') return 'changes-requested';
  return null;
}

function decodeComments(value: unknown): PullRequestComment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const comments: PullRequestComment[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const body = stringOr(entry.body, '');
    if (!body.trim()) continue;

    comments.push({
      id: stringOr(entry.id, ''),
      author: decodeActor(entry.author),
      body,
      createdAt: stringOr(entry.createdAt, ''),
      url: nullableString(entry.url),
      kind: 'comment',
      verdict: null
    });
  }

  return comments;
}

/**
 * Reviews, as entries in the same conversation as the comments.
 *
 * A review with no body is dropped unless it carried a verdict: an approval
 * with nothing written is still worth showing, but a bare `COMMENTED` review
 * is the envelope around line comments the timeline does not render, and it
 * would appear as a blank row from its author.
 */
function decodeReviews(value: unknown): PullRequestComment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const reviews: PullRequestComment[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const verdict = decodeReviewVerdict(entry.state);
    const body = stringOr(entry.body, '');
    if (!body.trim() && !verdict) continue;

    reviews.push({
      id: stringOr(entry.id, ''),
      author: decodeActor(entry.author),
      body,
      createdAt: stringOr(entry.submittedAt, ''),
      url: nullableString(entry.url),
      kind: 'review',
      verdict
    });
  }

  return reviews;
}

function decodeCommits(value: unknown): PullRequestCommit[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const commits: PullRequestCommit[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const oid = nullableString(entry.oid);
    if (!oid) continue;

    // `gh` reports commit authors as a list, since a co-authored commit has
    // several. The first is the one a single line names.
    const authors = Array.isArray(entry.authors) ? entry.authors : [];
    commits.push({
      oid,
      messageHeadline: stringOr(entry.messageHeadline, ''),
      author: decodeActor(authors[0]),
      committedAt: nullableString(entry.committedDate) ?? nullableString(entry.authoredDate)
    });
  }

  return commits;
}

/**
 * The conversation in one list, oldest first.
 *
 * Comments and reviews arrive as two collections and are read as one thread,
 * because that is how they were written: a review posted between two comments
 * belongs between them, not after both.
 */
export function decodePullRequestActivity(raw: string): PullRequestActivity {
  const parsed = parseJson(raw, 'the pull request activity');
  if (!isRecord(parsed)) {
    return { comments: [], commits: [] };
  }

  const merged = [...decodeComments(parsed.comments), ...decodeReviews(parsed.reviews)];
  merged.sort((left, right) => {
    const leftAt = Date.parse(left.createdAt);
    const rightAt = Date.parse(right.createdAt);
    // An unparseable timestamp sorts last rather than to 1970, where it would
    // claim to be the oldest thing in the thread.
    if (Number.isNaN(leftAt)) return Number.isNaN(rightAt) ? 0 : 1;
    if (Number.isNaN(rightAt)) return -1;
    return leftAt - rightAt;
  });

  return { comments: merged, commits: decodeCommits(parsed.commits) };
}

// ---------------------------------------------------------------------------
// Review threads (GraphQL)
// ---------------------------------------------------------------------------

/**
 * Page size for review threads. One ordinary pull request fits in a single
 * page; a thread longer than ten comments is the rare case and is shown
 * truncated rather than followed, because following needs a second request
 * per long thread.
 */
const REVIEW_THREAD_PAGE = 50;

export const REVIEW_THREADS_GRAPHQL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: ${REVIEW_THREAD_PAGE}) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          diffSide
          comments(first: 10) {
            nodes { id author { login name avatarUrl } body createdAt url }
          }
        }
      }
    }
  }
}`;

export const REVIEW_THREAD_REPLY_GRAPHQL_MUTATION = `mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment { id }
  }
}`;

export const RESOLVE_REVIEW_THREAD_GRAPHQL_MUTATION = `mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } }
}`;

export const UNRESOLVE_REVIEW_THREAD_GRAPHQL_MUTATION = `mutation($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } }
}`;

const REVIEW_EVENT_BY_VERDICT: Record<PullRequestReviewVerdict, string> = {
  comment: 'COMMENT',
  approve: 'APPROVE',
  'request-changes': 'REQUEST_CHANGES'
};

/**
 * The whole review as one REST body, which is how GitHub keeps it invisible
 * until the verdict is sent. Inline comments ride along with the verdict so
 * a half-written review never shows up on the host.
 */
export function buildReviewSubmissionJson(input: {
  verdict: PullRequestReviewVerdict;
  body: string;
  comments: readonly PullRequestInlineCommentDraft[];
}): string {
  return JSON.stringify({
    event: REVIEW_EVENT_BY_VERDICT[input.verdict],
    body: input.body,
    comments: input.comments.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: comment.side,
      body: comment.body
    }))
  });
}

function decodeThreadComment(value: unknown): PullRequestThreadComment | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  if (!id) return null;

  return {
    id,
    author: decodeActor(value.author),
    body: stringOr(value.body, ''),
    createdAt: stringOr(value.createdAt, ''),
    url: nullableString(value.url)
  };
}

/**
 * Review threads from the GraphQL payload `gh api graphql` prints.
 *
 * A thread with no readable id is dropped rather than failing the page: one
 * unparseable conversation is not a reason to hide the rest of the review.
 */
export function decodeReviewThreads(raw: string): PullRequestReviewThread[] {
  const parsed = parseJson(raw, 'the pull request review threads');
  if (!isRecord(parsed)) return [];

  const data = isRecord(parsed.data) ? parsed.data : parsed;
  const repository = isRecord(data.repository) ? data.repository : null;
  const pullRequest = repository && isRecord(repository.pullRequest) ? repository.pullRequest : null;
  const reviewThreads = pullRequest && isRecord(pullRequest.reviewThreads) ? pullRequest.reviewThreads : null;
  const nodes = reviewThreads && Array.isArray(reviewThreads.nodes) ? reviewThreads.nodes : [];

  const threads: PullRequestReviewThread[] = [];

  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const id = nullableString(node.id);
    if (!id) continue;

    const commentsNode = isRecord(node.comments) && Array.isArray(node.comments.nodes) ? node.comments.nodes : [];
    const comments: PullRequestThreadComment[] = [];
    for (const entry of commentsNode) {
      const comment = decodeThreadComment(entry);
      if (comment) comments.push(comment);
    }

    const side = stringOr(node.diffSide, 'RIGHT').toUpperCase();
    threads.push({
      id,
      path: stringOr(node.path, ''),
      line: typeof node.line === 'number' && Number.isFinite(node.line) ? node.line : null,
      side: side === 'LEFT' ? 'LEFT' : 'RIGHT',
      isResolved: node.isResolved === true,
      isOutdated: node.isOutdated === true,
      comments
    });
  }

  return threads;
}

/** Collaborators who may be asked for a review, with whether they already are. */
export function decodeReviewerCandidates(
  raw: string,
  requestedLogins: readonly string[]
): PullRequestReviewerCandidate[] {
  const parsed = parseJson(raw, 'the repository collaborators');
  if (!Array.isArray(parsed)) return [];

  const requested = new Set(requestedLogins.map((login) => login.toLowerCase()));
  const candidates: PullRequestReviewerCandidate[] = [];

  for (const entry of parsed) {
    if (!isRecord(entry)) continue;
    const login = nullableString(entry.login);
    if (!login) continue;

    candidates.push({
      login,
      name: nullableString(entry.name),
      avatarUrl: nullableString(entry.avatar_url) ?? nullableString(entry.avatarUrl),
      isRequested: requested.has(login.toLowerCase())
    });
  }

  candidates.sort((left, right) => left.login.localeCompare(right.login));
  return candidates;
}

/** Repository labels, with whether this pull request already wears them. */
export function decodeLabelCandidates(
  raw: string,
  applied: readonly PullRequestLabel[]
): PullRequestLabelCandidate[] {
  const parsed = parseJson(raw, 'the repository labels');
  if (!Array.isArray(parsed)) return [];

  const appliedNames = new Set(applied.map((label) => label.name.toLowerCase()));
  const candidates: PullRequestLabelCandidate[] = [];

  for (const entry of parsed) {
    if (!isRecord(entry)) continue;
    const name = nullableString(entry.name);
    if (!name) continue;

    candidates.push({
      name,
      color: nullableString(entry.color),
      description: nullableString(entry.description),
      isApplied: appliedNames.has(name.toLowerCase())
    });
  }

  candidates.sort((left, right) => left.name.localeCompare(right.name));
  return candidates;
}
