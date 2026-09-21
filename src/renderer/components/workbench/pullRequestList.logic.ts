/**
 * The pull request list's pure half: what a typed query means, and which rows
 * survive it.
 *
 * Ported from t3code's `pullRequestList.logic.ts`, with its central idea kept
 * intact — the filter box is not a text search with a few checkboxes bolted on,
 * it is *one* string that carries both. `author:me is:draft router` narrows
 * three ways, and every narrowing is undone by deleting the word that caused
 * it. That is the property a row of dropdowns cannot offer.
 *
 * Everything here is pure so the tests can exercise it without a panel.
 */

import type {
  PullRequestChecksState,
  PullRequestListEntry,
  PullRequestReviewDecision
} from '../../../shared/contracts';

/**
 * Narrowings a query can express, beyond its free text.
 *
 * Each is optional and absent means "do not narrow on this", which is why they
 * are undefined rather than a sentinel: `draft: undefined` is every row, and
 * there is no value of `'only' | 'hide'` that means the same.
 */
export type PullRequestFilters = {
  /** Matched case-insensitively against the author's login. */
  author?: string;
  /** Every group must be satisfied by some label on the row, so `a,b` is OR and two `label:` are AND. */
  labels?: string[][];
  excludedLabels?: string[];
  draft?: 'only' | 'hide';
  /** `none` is the absence of a verdict, which is not one of the verdicts. */
  review?: PullRequestReviewDecision | 'none';
  checks?: PullRequestChecksState;
};

export type ParsedPullRequestQuery = {
  /** What is left once the qualifiers are taken out. Matched against the title. */
  text: string;
  filters: PullRequestFilters;
};

/**
 * One token of a typed query: a run of non-space characters in which a quoted
 * stretch counts as part of the token, so `label:"needs design"` stays whole.
 * An unbalanced quote is dropped rather than swallowing the rest of the line.
 */
const QUERY_TOKEN = /(?:[^\s"]|"[^"]*")+/g;

/** Ceilings on a qualifier, so one pasted line cannot become a thousand comparisons. */
const MAX_QUALIFIER_VALUES = 10;
const MAX_QUALIFIER_LENGTH = 200;

const REVIEW_VALUES: Record<string, PullRequestFilters['review']> = {
  approved: 'approved',
  'changes-requested': 'changes-requested',
  changes_requested: 'changes-requested',
  required: 'review-required',
  none: 'none'
};

const CHECKS_VALUES: Record<string, PullRequestChecksState> = {
  passing: 'passing',
  success: 'passing',
  failing: 'failing',
  failure: 'failing',
  pending: 'pending'
};

function unquote(raw: string): string {
  return raw.replaceAll('"', '').trim();
}

/**
 * A qualifier's value as the list it may be.
 *
 * Quoting names one whole label however many commas it holds: `label:"needs,triage"`
 * asks for the label written that way, not for either half of it.
 */
function splitQualifierList(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) {
    const value = unquote(trimmed);
    return value ? [value] : [];
  }

  return trimmed
    .split(',')
    .map((part) => unquote(part))
    .filter((part) => part.length > 0);
}

function boundedNames(names: string[]): string[] {
  return names.slice(0, MAX_QUALIFIER_VALUES).map((name) => name.slice(0, MAX_QUALIFIER_LENGTH));
}

/**
 * A typed query as text plus narrowings.
 *
 * Quoting is the way back to plain text: `"is:draft"` is searched for as
 * written, which is what keeps a literal search for a colon possible. A known
 * key carrying a value it does not take is text too, so typing `review:` on the
 * way to `review:approved` narrows nothing rather than everything.
 */
export function parsePullRequestQuery(raw: string): ParsedPullRequestQuery {
  const text: string[] = [];
  const labels: string[][] = [];
  const excludedLabels: string[] = [];
  const filters: PullRequestFilters = {};

  for (const [token] of raw.matchAll(QUERY_TOKEN)) {
    const qualifier = /^(-?)([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(token);

    if (qualifier === null) {
      text.push(unquote(token));
      continue;
    }

    const negated = qualifier[1] === '-';
    const key = (qualifier[2] ?? '').toLowerCase();
    const rawValue = qualifier[3] ?? '';
    const value = unquote(rawValue);

    if (value.length === 0) {
      text.push(unquote(token));
      continue;
    }

    switch (key) {
      case 'label': {
        // GitHub's own OR: `label:a,b` is one qualifier satisfied by either
        // name. Negated, the comma excludes each — a row carrying any of them
        // goes.
        const names = boundedNames(splitQualifierList(rawValue));
        if (names.length === 0) break;
        if (negated) excludedLabels.push(...names);
        else labels.push(names);
        continue;
      }
      case 'author': {
        if (negated) break;
        filters.author = value.slice(0, MAX_QUALIFIER_LENGTH);
        continue;
      }
      case 'is':
      case 'draft': {
        const flag = value.toLowerCase();
        if (key === 'is' && flag !== 'draft') break;
        if (key === 'draft' && flag !== 'true' && flag !== 'false') break;
        const wants = key === 'is' ? !negated : flag === 'true';
        filters.draft = wants ? 'only' : 'hide';
        continue;
      }
      case 'review': {
        const decision = negated ? undefined : REVIEW_VALUES[value.toLowerCase()];
        if (decision === undefined) break;
        filters.review = decision;
        continue;
      }
      case 'status':
      case 'checks': {
        const state = negated ? undefined : CHECKS_VALUES[value.toLowerCase()];
        if (state === undefined) break;
        filters.checks = state;
        continue;
      }
      default:
        break;
    }

    // A key this does not take, read as the text it is. Reaching here from a
    // known key means the value was one it does not accept — which is what
    // half-typed input looks like, and searching for it beats narrowing to
    // nothing.
    text.push(unquote(token));
  }

  if (labels.length > 0) filters.labels = labels;
  if (excludedLabels.length > 0) filters.excludedLabels = excludedLabels;

  return { text: text.join(' ').trim(), filters };
}

/**
 * Whether a row survives the narrowings.
 *
 * `checks` compares against an absent state on purpose: a row with no checks
 * configured equals neither `passing` nor `failing`, and so fails both — the
 * same as a search would not have surfaced it for `status:success`.
 */
export function matchesPullRequestFilters(
  entry: PullRequestListEntry,
  filters: PullRequestFilters,
  viewer: string | null
): boolean {
  if (filters.draft !== undefined && entry.isDraft !== (filters.draft === 'only')) {
    return false;
  }

  if (filters.review !== undefined) {
    const matches =
      filters.review === 'none' ? entry.reviewDecision === null : entry.reviewDecision === filters.review;
    if (!matches) return false;
  }

  if (filters.checks !== undefined && entry.checksState !== filters.checks) {
    return false;
  }

  if (filters.author !== undefined) {
    // `author:me` is the one value that means something different to each
    // reader, so it is resolved here rather than sent to the host as itself.
    const wanted = resolveAuthorFilter(filters.author, viewer).toLowerCase();
    if ((entry.author?.login ?? '').toLowerCase() !== wanted) return false;
  }

  if (filters.labels !== undefined || filters.excludedLabels !== undefined) {
    const held = entry.labels.map((label) => label.name.trim().toLowerCase());
    const holds = (name: string) => held.includes(name.trim().toLowerCase());

    if (filters.labels !== undefined && !filters.labels.every((group) => group.some(holds))) {
      return false;
    }
    if (filters.excludedLabels !== undefined && filters.excludedLabels.some(holds)) {
      return false;
    }
  }

  return true;
}

/** `me` and `@me` both name the signed-in reader; anything else names itself. */
export function resolveAuthorFilter(author: string, viewer: string | null): string {
  const trimmed = author.trim();
  const lowered = trimmed.toLowerCase();
  return (lowered === 'me' || lowered === '@me') && viewer ? viewer : trimmed;
}

/**
 * Free text against the parts of a row the reader can see.
 *
 * Every word must match somewhere, but not all in the same field: "auth router"
 * finds a pull request titled "router" from the author "auth-bot". A search
 * that could only match one field would make the second word a way to find
 * nothing.
 */
export function matchesPullRequestQuery(entry: PullRequestListEntry, text: string): boolean {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = [
    entry.title,
    `#${entry.number}`,
    entry.author?.login ?? '',
    entry.headRefName,
    entry.baseRefName,
    ...entry.labels.map((label) => label.name)
  ]
    .join(' ')
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

/** Both halves of a query, applied. */
export function narrowPullRequests(
  entries: readonly PullRequestListEntry[],
  query: ParsedPullRequestQuery,
  viewer: string | null
): PullRequestListEntry[] {
  return entries.filter(
    (entry) =>
      matchesPullRequestFilters(entry, query.filters, viewer) &&
      matchesPullRequestQuery(entry, query.text)
  );
}

/**
 * Newest activity first, which is the order the panel reads in.
 *
 * The host is asked for this order too, but the list is re-sorted locally
 * because a filtered page is a subset of rows that arrived in it — and because
 * a row whose timestamp the host omitted must not float to the top. An
 * unparseable timestamp sorts last rather than to 1970.
 */
export function sortPullRequestsByUpdated(
  entries: readonly PullRequestListEntry[]
): PullRequestListEntry[] {
  return [...entries].sort((left, right) => {
    const leftAt = Date.parse(left.updatedAt);
    const rightAt = Date.parse(right.updatedAt);
    if (Number.isNaN(leftAt)) return Number.isNaN(rightAt) ? left.number - right.number : 1;
    if (Number.isNaN(rightAt)) return -1;
    return rightAt - leftAt;
  });
}

/**
 * A label's dot colour, or null for anything that is not six hex digits.
 *
 * Null rather than a fallback colour: the dot falls back to the muted
 * foreground in CSS, which stays legible on both themes. A parsed colour that
 * is not really one would not.
 */
export function pullRequestLabelColor(color: string | null): string | null {
  const hex = color?.trim().replace(/^#/, '') ?? '';
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : null;
}

export type PullRequestListSort =
  | 'ready'
  | 'updated'
  | 'newest'
  | 'oldest'
  | 'largest'
  | 'smallest';

/**
 * Merge readiness first: checks green and approved, then green alone, then
 * everything else still open. Drafts stay in that third tier because their
 * author has not made them mergeable yet. Finished work follows open work.
 * A known conflict is never ready, whatever its checks say, so it stays at
 * the bottom. Within each tier, smaller diffs come first, then recency.
 *
 * Ported from t3code's `rankPullRequestsByMergeReadiness`.
 */
export function rankPullRequestsByMergeReadiness(
  entries: readonly PullRequestListEntry[]
): PullRequestListEntry[] {
  const tier = (entry: PullRequestListEntry) => {
    if (entry.mergeability === 'conflicting') return 4;
    if (entry.state !== 'open') return 3;
    if (entry.isDraft) return 2;
    if (entry.checksState === 'passing' && entry.reviewDecision === 'approved') return 0;
    if (entry.checksState === 'passing') return 1;
    return 2;
  };

  return [...entries].sort((left, right) => {
    const byTier = tier(left) - tier(right);
    if (byTier !== 0) return byTier;
    const sized = left.additions + left.deletions - (right.additions + right.deletions);
    if (sized !== 0) return sized;
    return sortPullRequestsByUpdated([left, right])[0] === left ? -1 : 1;
  });
}

function timestampOf(entry: PullRequestListEntry): number {
  const updated = Date.parse(entry.updatedAt);
  if (!Number.isNaN(updated)) return updated;
  const created = Date.parse(entry.createdAt);
  return Number.isNaN(created) ? 0 : created;
}

export function sortPullRequests(
  entries: readonly PullRequestListEntry[],
  sort: PullRequestListSort
): PullRequestListEntry[] {
  if (sort === 'ready') return rankPullRequestsByMergeReadiness(entries);
  if (sort === 'updated') return sortPullRequestsByUpdated(entries);

  return [...entries].sort((left, right) => {
    if (sort === 'newest' || sort === 'oldest') {
      const leftCreated = Date.parse(left.createdAt);
      const rightCreated = Date.parse(right.createdAt);
      const delta =
        (Number.isNaN(leftCreated) ? 0 : leftCreated) -
        (Number.isNaN(rightCreated) ? 0 : rightCreated);
      return sort === 'newest' ? -delta : delta;
    }

    const sized = left.additions + left.deletions - (right.additions + right.deletions);
    if (sized !== 0) return sort === 'largest' ? -sized : sized;
    return timestampOf(right) - timestampOf(left);
  });
}
