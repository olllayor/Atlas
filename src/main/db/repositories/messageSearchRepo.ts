import type { MessageSearchHit, MessageRole, SearchMessagesRequest } from '../../../shared/contracts';
import {
  MESSAGE_SEARCH_MATCH_CLOSE,
  MESSAGE_SEARCH_MATCH_OPEN,
  MESSAGE_SEARCH_MAX_LIMIT
} from '../../../shared/contracts';
import type { SqliteDatabase } from '../client';
import { MESSAGE_SEARCH_TABLE } from '../schema';

const DEFAULT_LIMIT = 50;

/** How much of the message the snippet may show, in tokens either side of the match. */
const SNIPPET_TOKENS = 16;

/** The same window, in characters, for the fallback — which has no tokenizer. */
const FALLBACK_SNIPPET_CHARS = 160;

/**
 * `snippet()` takes its markers as literal arguments, and the markers are a
 * contract the renderer splits on, so they are derived from the contract rather
 * than written out twice and left to drift apart.
 */
const OPEN_MARK_SQL = `char(${MESSAGE_SEARCH_MATCH_OPEN.codePointAt(0)})`;
const CLOSE_MARK_SQL = `char(${MESSAGE_SEARCH_MATCH_CLOSE.codePointAt(0)})`;
const ELLIPSIS_SQL = `char(8230)`;

type SearchRow = {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  role: MessageRole;
  createdAt: string;
  snippet: string;
  archivedAt: string | null;
};

/**
 * Everything that is not a letter, a digit or an underscore ends a term.
 *
 * That is the whole sanitizing strategy: the user's string never reaches FTS5
 * as an expression. `"`, `*`, `(`, `NEAR`, `AND` and an unbalanced quote are
 * all just characters that either split terms or become part of one, so no
 * keystroke can produce a syntax error — and none of them can smuggle in an
 * operator either.
 */
export function tokenizeSearchQuery(query: string): string[] {
  return query.match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/**
 * Turn user input into an FTS5 MATCH expression, or null when there is nothing
 * to search for.
 *
 * Every term is quoted, which makes it a phrase of exactly one token and takes
 * away any meaning FTS5 would otherwise read into it — a search for `NEAR`
 * finds the word "near". The last term gets a `*` so results appear while the
 * word is still being typed; a quoted phrase followed by `*` is a prefix query,
 * not the bare `*` that would be a syntax error on its own.
 */
export function toFtsMatchExpression(query: string): string | null {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) {
    return null;
  }

  return tokens
    .map((token, index) => {
      // A quote inside a quoted phrase is escaped by doubling it. Tokenizing
      // already dropped quotes, so this only guards the invariant.
      const quoted = `"${token.replaceAll('"', '""')}"`;
      return index === tokens.length - 1 ? `${quoted}*` : quoted;
    })
    .join(' AND ');
}

function clampLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(Math.floor(limit as number), MESSAGE_SEARCH_MAX_LIMIT));
}

function mapRow(row: SearchRow): MessageSearchHit {
  return {
    conversationId: row.conversationId,
    conversationTitle: row.conversationTitle,
    messageId: row.messageId,
    role: row.role,
    snippet: row.snippet,
    createdAt: row.createdAt,
    archived: row.archivedAt != null
  };
}

/** `%`, `_` and the escape character itself are wildcards to LIKE, not text. */
function escapeLikeTerm(term: string) {
  return term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

/**
 * The fallback's stand-in for `snippet()`: a window around the first term that
 * appears, with every term in that window marked up the same way FTS5 would.
 * The two paths return the same shape so a renderer cannot tell which one ran.
 */
export function buildFallbackSnippet(content: string, terms: string[]): string {
  const haystack = content.toLowerCase();
  let firstIndex = -1;

  for (const term of terms) {
    const index = haystack.indexOf(term.toLowerCase());
    if (index !== -1 && (firstIndex === -1 || index < firstIndex)) {
      firstIndex = index;
    }
  }

  const start = firstIndex === -1 ? 0 : Math.max(0, firstIndex - FALLBACK_SNIPPET_CHARS / 2);
  const end = Math.min(content.length, start + FALLBACK_SNIPPET_CHARS);
  const window = content.slice(start, end);

  const sorted = [...terms].sort((left, right) => right.length - left.length);
  const pattern = sorted
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter((term) => term.length > 0)
    .join('|');

  const marked = pattern
    ? window.replace(
        new RegExp(pattern, 'giu'),
        (match) => `${MESSAGE_SEARCH_MATCH_OPEN}${match}${MESSAGE_SEARCH_MATCH_CLOSE}`
      )
    : window;

  return `${start > 0 ? '…' : ''}${marked}${end < content.length ? '…' : ''}`;
}

/**
 * Full-text search over message bodies.
 *
 * Two implementations, one contract. `searchWithIndex` uses the FTS5 index the
 * schema builds; `searchWithLikeScan` is what runs when that index is not
 * there, because FTS5 is a compile-time option and an app that refuses to start
 * on a SQLite without it would be trading the entire product for a search box.
 * Both are public so the fallback can be exercised on its own — a fallback that
 * is only reachable on a machine nobody has is not a fallback.
 */
export class MessageSearchRepo {
  private indexAvailable: boolean | null = null;

  constructor(private readonly db: SqliteDatabase) {}

  search(request: SearchMessagesRequest): MessageSearchHit[] {
    if (this.hasSearchIndex()) {
      try {
        return this.searchWithIndex(request);
      } catch {
        // A corrupt or half-built index must degrade to slow results, not to an
        // error dialog on every keystroke.
        this.indexAvailable = false;
      }
    }

    return this.searchWithLikeScan(request);
  }

  /** Whether the FTS5 index exists. Probed once — the answer cannot change mid-session. */
  hasSearchIndex(): boolean {
    if (this.indexAvailable === null) {
      const row = this.db
        .prepare<[string], { present: number }>(
          `SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?`
        )
        .get(MESSAGE_SEARCH_TABLE);

      this.indexAvailable = Boolean(row);
    }

    return this.indexAvailable;
  }

  searchWithIndex(request: SearchMessagesRequest): MessageSearchHit[] {
    const match = toFtsMatchExpression(request.query);
    if (!match) {
      return [];
    }

    const rows = this.db
      .prepare<{ match: string; includeArchived: number; limit: number }, SearchRow>(
        `
          SELECT
            m.id AS messageId,
            m.conversation_id AS conversationId,
            c.title AS conversationTitle,
            m.role AS role,
            m.created_at AS createdAt,
            snippet(${MESSAGE_SEARCH_TABLE}, 0, ${OPEN_MARK_SQL}, ${CLOSE_MARK_SQL}, ${ELLIPSIS_SQL}, ${SNIPPET_TOKENS}) AS snippet,
            c.archived_at AS archivedAt
          FROM ${MESSAGE_SEARCH_TABLE}
          JOIN messages m ON m.rowid = ${MESSAGE_SEARCH_TABLE}.rowid
          JOIN conversations c ON c.id = m.conversation_id
          WHERE ${MESSAGE_SEARCH_TABLE} MATCH @match
            AND (@includeArchived = 1 OR c.archived_at IS NULL)
          ORDER BY rank
          LIMIT @limit
        `
      )
      .all({
        match,
        includeArchived: request.includeArchived ? 1 : 0,
        limit: clampLimit(request.limit)
      });

    return rows.map(mapRow);
  }

  /**
   * The no-index path: a substring scan, every term required, newest first.
   *
   * Relevance is the one thing that cannot be reproduced without the index, so
   * recency stands in for it rather than an invented score.
   */
  searchWithLikeScan(request: SearchMessagesRequest): MessageSearchHit[] {
    const terms = tokenizeSearchQuery(request.query);
    if (terms.length === 0) {
      return [];
    }

    const conditions = terms.map((_, index) => `m.content LIKE @term${index} ESCAPE '\\'`).join(' AND ');
    const parameters: Record<string, string | number> = {
      includeArchived: request.includeArchived ? 1 : 0,
      limit: clampLimit(request.limit)
    };

    terms.forEach((term, index) => {
      parameters[`term${index}`] = `%${escapeLikeTerm(term)}%`;
    });

    const rows = this.db
      .prepare<Record<string, string | number>, Omit<SearchRow, 'snippet'> & { content: string }>(
        `
          SELECT
            m.id AS messageId,
            m.conversation_id AS conversationId,
            c.title AS conversationTitle,
            m.role AS role,
            m.created_at AS createdAt,
            m.content AS content,
            c.archived_at AS archivedAt
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          WHERE ${conditions}
            AND (@includeArchived = 1 OR c.archived_at IS NULL)
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT @limit
        `
      )
      .all(parameters);

    return rows.map((row) => mapRow({ ...row, snippet: buildFallbackSnippet(row.content, terms) }));
  }
}
