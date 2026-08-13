/**
 * Decides whether a turn is allowed to produce an inline visual.
 *
 * The visual instructions are ~2k tokens and they push hard ("you MUST emit
 * exactly one block"), so shipping them on every request made the assistant
 * draw a diagram for questions nobody wanted a diagram for — and paid for the
 * privilege on every single turn. Visuals are now opt-in per turn: the spec is
 * only attached when the user actually asked for something visual, and the
 * stream parser only looks for visual markup when the spec was attached.
 *
 * Detection runs on the user's own words, in the main process, so the renderer
 * cannot widen the gate.
 */

export const VISUAL_MODES = ['auto', 'always', 'off'] as const;

/**
 * - `auto` — attach the visual spec only when the turn asks for a visual.
 * - `always` — attach it on every turn (the pre-gate behaviour).
 * - `off` — never attach it, and never parse visual markup out of a reply.
 */
export type VisualMode = (typeof VISUAL_MODES)[number];

export const DEFAULT_VISUAL_MODE: VisualMode = 'auto';

export function isVisualMode(value: unknown): value is VisualMode {
  return typeof value === 'string' && (VISUAL_MODES as readonly string[]).includes(value);
}

/**
 * Pasted code is evidence about the question, not a request about its shape.
 * "What does this `<svg>` do?" must not read as "draw me an SVG", so fenced
 * blocks and inline spans are removed before any pattern is tried.
 */
function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<[^>]{0,400}>/g, ' ');
}

/** Product names that contain a trigger word but say nothing about visuals. */
function stripKnownFalseFriends(text: string): string {
  return text
    .replace(/visual\s+studio(\s+code)?/gi, ' ')
    .replace(/visual\s+basic/gi, ' ')
    .replace(/graph\s?ql/gi, ' ');
}

/** Scanning an entire pasted document buys nothing; the ask lives in the prose. */
const MAX_SCAN_CHARS = 8000;

function normalize(text: string): string {
  return stripKnownFalseFriends(stripCode(text)).slice(0, MAX_SCAN_CHARS).toLowerCase();
}

/**
 * An explicit "no pictures" always wins, including over `always` mode: the
 * user asking for prose and getting a chart anyway is the exact failure this
 * module exists to stop.
 */
const OPT_OUT_PATTERNS: RegExp[] = [
  /\b(?:no|without|skip|avoid|don'?t|do not|no need for)\s+(?:a\s+|an\s+|any\s+|the\s+)?(?:diagram|diagrams|chart|charts|graph|graphs|visual|visuals|visualization|visualisation|picture|pictures|image|images|drawing)\b/,
  /\b(?:text|words)[\s-]?only\b/,
  /\bplain\s+text\b/,
  /\bjust\s+(?:explain|tell|describe|answer)\b.*\bin\s+(?:text|words)\b/,
];

/**
 * Phrasings that ask for something drawn.
 *
 * Deliberately narrow at the edges: `\bgraph\b` excludes "graph theory" and
 * "graph database", `plot` only counts as a chart when it is qualified or used
 * as a verb, and "draw a conclusion" is not a drawing request. A missed
 * request costs one follow-up message; a false positive costs a diagram in
 * every answer, which is the complaint.
 */
const REQUEST_PATTERNS: RegExp[] = [
  // Named artefacts — these words have essentially no non-visual reading.
  /\b(?:diagram|diagrams|flow\s?chart|flow\s?charts|mind\s?map|mind\s?maps|org\s?chart|infographic|wireframe|schematic|storyboard|swimlane)\b/,
  /\b(?:sequence|architecture|entity[\s-]relationship|state|class|network|dependency|gantt|venn)\s+(?:diagram|chart|graph|map)\b/,
  /\b(?:bar|line|pie|donut|doughnut|scatter|radar|bubble|area|stacked|polar)\s+(?:chart|graph|plot)\b/,
  /\b(?:tree|node)\s?(?:graph|diagram|map)\b/,
  // Generic artefacts, guarded against their non-visual homographs.
  /\bcharts?\b/,
  /\bgraphs?\b(?!\s*(?:theory|database|db|api|traversal|neural|isomorph))/,
  /\b(?:scatter|box|line|bar|density|violin)\s+plots?\b/,
  /\bplots?\s+(?:the|a|an|this|these|those|it|out)\b/,
  // "a timeline of the release" asks for a graphic; "what is our timeline?"
  // asks about a schedule.
  /\btimelines?\s+(?:of|for)\b/,
  /\btimeline\s+(?:diagram|chart|view|graphic)\b/,
  // Explicit "make it visual" phrasings.
  /\bvisuali[sz](?:e|ed|es|ing|ation|ations|sation|sations)\b/,
  /\bvisually\b/,
  /\bvisuals?\b/,
  /\b(?:as|in|with|using)\s+(?:a\s+|an\s+|the\s+)?(?:diagram|chart|graph|picture|image|drawing|visual)\b/,
  // Drawing verbs.
  /\b(?:draw|drawing)\b(?!\s+(?:a\s+|an\s+|the\s+)?(?:conclusion|comparison|distinction|parallel|attention))/,
  /\b(?:sketch|illustrate|diagram|chart)\s+(?:me\s+|us\s+|out\s+|it\s+|this\s+|that\s+|the\s+|a\s+|an\s+)/,
  /\bmaps?\s+(?:it|this|that|these|them)?\s*out\b/,
  /\bshow\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:picture|image|diagram|chart|graph|visual|drawing)\b/,
  /\bpicture\s+(?:this|it)\b/,
  // Russian.
  /(?:диаграмм|график|схем[ауые]|визуализ|визуально|нарисуй|изобрази|блок-схем)/,
  // Uzbek.
  /(?:diagramma|sxema|chizma|chizib|vizual|grafik)/,
];

/**
 * A refinement of a visual that already exists ("make it wider", "add a node").
 *
 * These read as ordinary chat on their own, so they only count when the last
 * assistant turn actually rendered something — otherwise "make it shorter"
 * about a paragraph would summon a diagram.
 */
const FOLLOW_UP_PATTERNS: RegExp[] = [
  /\b(?:make|redo|redraw|regenerate|rebuild|update|change|adjust|tweak|fix|revise)\s+(?:it|this|that|the|them)\b/,
  /\b(?:bigger|smaller|wider|taller|larger|horizontal|vertical|left\s+to\s+right|top\s+to\s+bottom)\b/,
  /\b(?:add|remove|drop|rename|highlight|split|merge)\s+(?:a\s+|an\s+|the\s+)?(?:node|nodes|box|boxes|edge|edges|arrow|arrows|step|steps|label|labels|colou?rs?|series|axis|legend)\b/,
  /\b(?:colou?r|palette|legend|axis|labels?)\b/,
  /\b(?:same|again|instead)\b.*\b(?:but|with|without)\b/,
  /\b(?:more|less)\s+(?:detail|detailed|compact|granular)\b/,
  /\b(?:simplify|expand)\s+(?:it|this|that)\b/,
];

/** A follow-up is a short aside; a fresh long question is a fresh question. */
const FOLLOW_UP_MAX_CHARS = 240;

export function detectVisualOptOut(text: string): boolean {
  const normalized = normalize(text);
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** True when the text explicitly asks for something drawn. */
export function detectVisualRequest(text: string): boolean {
  const normalized = normalize(text);
  if (OPT_OUT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  return REQUEST_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** True when the text reads as an edit to a visual that is already on screen. */
export function detectVisualFollowUp(text: string): boolean {
  const normalized = normalize(text).trim();
  if (normalized.length === 0 || normalized.length > FOLLOW_UP_MAX_CHARS) {
    return false;
  }
  if (OPT_OUT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  return FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(normalized));
}

export type VisualGateInput = {
  mode: VisualMode;
  /** The user's message for this turn. */
  userText: string;
  /** Whether the conversation's most recent assistant turn rendered a visual. */
  hadRecentVisual?: boolean;
};

export type VisualGateDecision = {
  enabled: boolean;
  /** Why, for the turn log — this is the first thing to check when the gate misfires. */
  reason: 'mode-off' | 'mode-always' | 'opted-out' | 'requested' | 'follow-up' | 'not-requested';
};

export function resolveVisualGate({ mode, userText, hadRecentVisual = false }: VisualGateInput): VisualGateDecision {
  if (mode === 'off') {
    return { enabled: false, reason: 'mode-off' };
  }

  // The opt-out is checked before `always` so "no diagrams please" is honoured
  // even by a user who left visuals pinned on.
  if (detectVisualOptOut(userText)) {
    return { enabled: false, reason: 'opted-out' };
  }

  if (mode === 'always') {
    return { enabled: true, reason: 'mode-always' };
  }

  if (detectVisualRequest(userText)) {
    return { enabled: true, reason: 'requested' };
  }

  if (hadRecentVisual && detectVisualFollowUp(userText)) {
    return { enabled: true, reason: 'follow-up' };
  }

  return { enabled: false, reason: 'not-requested' };
}
