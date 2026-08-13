/**
 * Node box geometry for the interactive diagram.
 *
 * Lives outside the component because it is the one part of the layout that
 * has to agree with the *browser* — dagre reserves the lane, the DOM wraps
 * the text, and if the two disagree the label spills over its border into
 * the rank below. Pure functions, so the agreement can be tested.
 */

export const NODE_WIDTH = 200;
export const NODE_MIN_HEIGHT = 56;
export const NODE_PADDING_Y = 12;
export const NODE_LINE_HEIGHT = 18;
/** 200px wide minus 32px horizontal padding at 13px ≈ 22 characters. */
export const NODE_CHARS_PER_LINE = 22;

/**
 * Count the lines a label actually wraps to.
 *
 * The old version divided the whole string by the characters-per-line, which
 * assumes text breaks mid-word. It does not: `"Deployment configuration
 * validation"` is 35 characters — two lines by division — but three words
 * that each nearly fill the measure waste most of a line apiece and the
 * browser breaks it into three. A label like that was handed to dagre one
 * line short, so the node's real box was 18px taller than the lane reserved
 * for it and the text pushed past its own border into the rank below.
 */
export function estimateLabelLines(label: string, charsPerLine = NODE_CHARS_PER_LINE): number {
  let lines = 0;

  for (const paragraph of label.split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines += 1;
      continue;
    }

    let column = 0;
    for (const word of words) {
      // A single word wider than the node breaks inside itself
      // (`overflow-wrap: anywhere` in the node's style).
      if (word.length > charsPerLine) {
        if (column > 0) lines += 1;
        const wrapped = Math.ceil(word.length / charsPerLine);
        lines += wrapped - 1;
        column = word.length - (wrapped - 1) * charsPerLine;
        continue;
      }

      const next = column === 0 ? word.length : column + 1 + word.length;
      if (next > charsPerLine) {
        lines += 1;
        column = word.length;
      } else {
        column = next;
      }
    }

    if (column > 0) lines += 1;
  }

  return Math.max(1, lines);
}

/**
 * Estimate a node's rendered height and *commit to it*.
 *
 * dagre was told every node is 200×56 while the DOM gave nodes an
 * unconstrained height, so any label that wrapped to two or three lines
 * overflowed its lane and overlapped the rank below it. Deriving the height
 * from the label and then pinning it in the node's style keeps the layout
 * engine and the renderer describing the same box.
 */
export function estimateNodeHeight(label: string): number {
  const lines = estimateLabelLines(label);
  return Math.max(NODE_MIN_HEIGHT, lines * NODE_LINE_HEIGHT + NODE_PADDING_Y * 2);
}
