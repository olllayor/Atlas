import { useEffect, useReducer, useRef, useState } from 'react';

import { MESSAGE_SEARCH_MATCH_CLOSE, MESSAGE_SEARCH_MATCH_OPEN } from '../../shared/contracts';
import type { MessageSearchHit } from '../../shared/contracts';

/**
 * Full-text search over message bodies, for the command palette.
 *
 * The palette has always "searched chats", but only by title, and only against
 * the list already in memory. Remembering a phrase you typed three weeks ago
 * found nothing unless it happened to be in the title. This hook is the other
 * half: it asks the main process, which owns the FTS index.
 *
 * Results are deliberately not in the zustand store. They are transient — one
 * query's worth of rows, dead the moment the next keystroke lands — and putting
 * them in global state would mean every store subscriber re-renders per
 * keystroke for data only one dialog can see.
 */

/**
 * Long enough that a burst of typing is one request, short enough that pausing
 * to think feels instant. 150ms sits under the ~200ms that reads as lag, and a
 * touch-typist at 60wpm (~200ms/char) still coalesces mid-word runs.
 */
export const MESSAGE_SEARCH_DEBOUNCE_MS = 150;

/**
 * One character matches most of the history and ranks it by noise. Two is the
 * shortest query that says anything, and it keeps the index off the hot path
 * while someone is still deciding what to look for.
 */
export const MESSAGE_SEARCH_MIN_QUERY_LENGTH = 2;

/**
 * A local SQLite query usually answers in tens of milliseconds. Showing a
 * "searching…" line for that is a flash of noise, not feedback, so the label
 * only appears for requests slow enough to be worth mentioning.
 */
export const MESSAGE_SEARCH_LOADING_DELAY_MS = 200;

/**
 * The palette shows a handful of rows under everything else; asking for the
 * backend's default 50 would just pay for scrolling nobody does.
 */
export const MESSAGE_SEARCH_LIMIT = 12;

export type MessageSearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export type MessageSearchState = {
  status: MessageSearchStatus;
  /** The query `hits` actually belongs to — not necessarily what is typed now. */
  query: string;
  hits: MessageSearchHit[];
  /** Sequence number of the newest dispatched request. */
  requestId: number;
};

export type MessageSearchAction =
  | { type: 'reset'; requestId: number }
  | { type: 'request'; query: string; requestId: number }
  | { type: 'resolve'; requestId: number; hits: MessageSearchHit[] }
  | { type: 'reject'; requestId: number };

export const INITIAL_MESSAGE_SEARCH_STATE: MessageSearchState = {
  status: 'idle',
  query: '',
  hits: [],
  requestId: 0,
};

/** Nothing to ask about: empty, whitespace-only, or still too short to mean anything. */
export function shouldSearchMessages(
  rawQuery: string,
  minLength: number = MESSAGE_SEARCH_MIN_QUERY_LENGTH
): boolean {
  return rawQuery.trim().length >= minLength;
}

/**
 * Typing forward ("mig" → "migra") narrows a result set the user is already
 * reading, so the old rows stay put until the new ones land — clearing them
 * would make the list blink on every character. Any other edit (a paste, a
 * backspace to a different word) is a different question, and answering it with
 * the previous question's rows is worse than showing nothing.
 */
function isRefinementOf(previousQuery: string, nextQuery: string): boolean {
  return previousQuery.length > 0 && nextQuery.startsWith(previousQuery);
}

/**
 * The stale-response guard lives here rather than in the effect.
 *
 * There is no `AbortController` on this path — the call is an IPC round trip
 * through the preload bridge, not `fetch` — so in-flight requests cannot be
 * cancelled, only ignored. A fast typist has several outstanding at once and
 * SQLite is free to finish them out of order, so every settle carries the
 * sequence number it was issued with and anything that is not the newest is
 * dropped on the floor. Without this, a slow two-character query can land after
 * the six-character one and silently replace correct results with garbage.
 */
export function messageSearchReducer(
  state: MessageSearchState,
  action: MessageSearchAction
): MessageSearchState {
  switch (action.type) {
    case 'reset':
      // Reset burns a sequence number rather than rewinding to zero: clearing
      // the input does not cancel the request already in flight, and its late
      // answer must not repopulate a section the user emptied.
      return {
        ...INITIAL_MESSAGE_SEARCH_STATE,
        requestId: Math.max(state.requestId, action.requestId),
      };

    case 'request': {
      if (action.requestId <= state.requestId) {
        return state;
      }

      return {
        status: 'loading',
        query: action.query,
        hits: isRefinementOf(state.query, action.query) ? state.hits : [],
        requestId: action.requestId,
      };
    }

    case 'resolve': {
      if (action.requestId !== state.requestId) {
        return state;
      }

      return { ...state, status: 'ready', hits: action.hits };
    }

    case 'reject': {
      if (action.requestId !== state.requestId) {
        return state;
      }

      // No hits, no toast. The palette keeps working on titles and commands.
      return { ...state, status: 'error', hits: [] };
    }

    default:
      return state;
  }
}

/**
 * Marks a cmdk row as a server-side hit. Chat rows use `chat:`, commands use
 * their bare title, so the namespaces cannot collide.
 */
export const MESSAGE_HIT_VALUE_PREFIX = 'message-hit:';

export function messageHitValue(conversationId: string, messageId: string): string {
  return `${MESSAGE_HIT_VALUE_PREFIX}${conversationId}:${messageId}`;
}

/**
 * The score handed to message rows: positive, so cmdk renders them, but far
 * below anything `commandScore` produces for a real match, so they sort — and
 * their group sorts — below the commands and titles that did match.
 */
export const MESSAGE_HIT_SCORE = 1e-6;

/**
 * cmdk filters client-side by default, and it would eat every one of these rows.
 *
 * Its matcher scores each item's `value` against the typed text; a snippet
 * pulled from the middle of a message frequently scores 0 ("sqlite" against
 * "…rebuilt the index after…" is not a subsequence), and a 0 means the row is
 * never mounted. The server already decided these rows match — re-judging them
 * in the renderer with a fuzzy string matcher is both wrong and redundant.
 *
 * Turning filtering off entirely (`shouldFilter={false}`) would fix that and
 * break the command list, which relies on the fuzzy match for everything else.
 * So the filter is replaced rather than disabled: message rows short-circuit to
 * a fixed score, and every other row falls through to cmdk's own `defaultFilter`
 * — the exact function that was running before, so command and title matching is
 * bit-for-bit what it was.
 */
export function createPaletteFilter(
  fallback: (value: string, search: string, keywords?: string[]) => number
): (value: string, search: string, keywords?: string[]) => number {
  return (value, search, keywords) =>
    value.startsWith(MESSAGE_HIT_VALUE_PREFIX) ? MESSAGE_HIT_SCORE : fallback(value, search, keywords);
}

export type SnippetSegment = {
  text: string;
  /** True for the spans the index matched, which the row emphasises. */
  match: boolean;
};

/**
 * Splits a snippet on the Private Use Area markers into plain React-renderable
 * pieces.
 *
 * The markers exist precisely so this never becomes an HTML injection: the
 * snippet is verbatim user and model text, and a message containing `<mark>` or
 * `<img onerror=…>` has to render as characters. Nothing here produces markup —
 * the caller maps segments to elements, and `dangerouslySetInnerHTML` must
 * never appear anywhere near this data.
 *
 * Newlines are collapsed because a snippet is drawn on one or two lines: raw
 * `\n` in a clamped row just eats the width with a blank.
 */
export function splitSnippetSegments(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let index = 0;
  let matching = false;

  while (index < snippet.length) {
    const marker = matching ? MESSAGE_SEARCH_MATCH_CLOSE : MESSAGE_SEARCH_MATCH_OPEN;
    const next = snippet.indexOf(marker, index);
    const end = next === -1 ? snippet.length : next;
    const text = snippet.slice(index, end).replace(/\s+/g, ' ');

    if (text.length > 0) {
      segments.push({ text, match: matching });
    }

    if (next === -1) {
      break;
    }

    index = end + marker.length;
    matching = !matching;
  }

  // A stray marker of the opposite kind would otherwise survive into the DOM as
  // a tofu box; the alternating scan above already dropped the ones it used.
  return segments
    .map((segment) => ({
      ...segment,
      text: segment.text
        .split(MESSAGE_SEARCH_MATCH_OPEN)
        .join('')
        .split(MESSAGE_SEARCH_MATCH_CLOSE)
        .join(''),
    }))
    .filter((segment) => segment.text.length > 0);
}

/**
 * Which rows may be drawn under the query as it is typed *right now*.
 *
 * `state.hits` always lags the input by at least the debounce, so a row is only
 * shown while the query it answers is still a prefix of what is typed — the
 * rows for "migra" are a reasonable stand-in for "migrat" mid-request, but the
 * rows for "migrate" are not an answer to "sqlite".
 */
export function visibleHits(state: MessageSearchState, query: string): MessageSearchHit[] {
  if (state.query.length === 0 || !query.startsWith(state.query)) {
    return [];
  }

  return state.hits;
}

export type MessageSearchResult = {
  status: MessageSearchStatus;
  hits: MessageSearchHit[];
  /** The query the hits answer, so a row can be trusted not to lag the input. */
  query: string;
  /** Loading worth telling the user about — see `MESSAGE_SEARCH_LOADING_DELAY_MS`. */
  showLoading: boolean;
};

export function useMessageSearch(rawQuery: string, enabled: boolean): MessageSearchResult {
  const [state, dispatch] = useReducer(messageSearchReducer, INITIAL_MESSAGE_SEARCH_STATE);
  const [showLoading, setShowLoading] = useState(false);
  const requestIdRef = useRef(0);

  const query = rawQuery.trim();
  const active = enabled && shouldSearchMessages(query);

  useEffect(() => {
    if (!active) {
      setShowLoading(false);
      requestIdRef.current += 1;
      dispatch({ type: 'reset', requestId: requestIdRef.current });
      return;
    }

    let loadingTimer: ReturnType<typeof setTimeout> | null = null;

    const debounceTimer = setTimeout(() => {
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      dispatch({ type: 'request', query, requestId });

      loadingTimer = setTimeout(() => setShowLoading(true), MESSAGE_SEARCH_LOADING_DELAY_MS);
      const settle = () => {
        if (loadingTimer) {
          clearTimeout(loadingTimer);
        }

        // Only the newest request may clear the label; an older one settling
        // late must not hide it for a query that is still in flight.
        if (requestIdRef.current === requestId) {
          setShowLoading(false);
        }
      };

      void window.atlasChat.conversations
        .searchMessages({ query, limit: MESSAGE_SEARCH_LIMIT })
        .then((hits) => {
          settle();
          dispatch({ type: 'resolve', requestId, hits });
        })
        .catch(() => {
          settle();
          dispatch({ type: 'reject', requestId });
        });
    }, MESSAGE_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(debounceTimer);
      if (loadingTimer) {
        clearTimeout(loadingTimer);
      }
    };
  }, [active, query]);

  return {
    status: state.status,
    hits: visibleHits(state, query),
    query: state.query,
    showLoading: showLoading && state.status === 'loading',
  };
}
