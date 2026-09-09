/**
 * Math-aware selection text (port of t3code PR #10698 clipboard behavior).
 *
 * Rendered equations must copy as their original TeX source, never as
 * flattened KaTeX glyphs. Endpoints inside an equation expand past it so an
 * equation is copied whole or not at all; each equation then contributes its
 * `data-markdown-copy` source (see `MarkdownMath`). Everything else keeps
 * native selection semantics.
 */

const MATH_SELECTOR = '[data-markdown-math]';
const MATH_COPY_ATTR = 'data-markdown-copy';

function mathAncestor(node: Node | null): Element | null {
  const element =
    node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement ?? null;
  return element?.closest?.(MATH_SELECTOR) ?? null;
}

export function mathAwareSelectionText(selection: Selection | null): string {
  if (!selection || selection.rangeCount === 0) return '';
  const texts: string[] = [];
  const doc = selection.anchorNode?.ownerDocument;
  if (!doc) return selection.toString();

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index).cloneRange();
    if (range.collapsed) continue;
    const startMath = mathAncestor(range.startContainer);
    const endMath = mathAncestor(range.endContainer);
    if (startMath) range.setStartBefore(startMath);
    if (endMath) range.setEndAfter(endMath);

    const container = doc.createElement('div');
    container.appendChild(range.cloneContents());
    for (const math of container.querySelectorAll(MATH_SELECTOR)) {
      math.replaceWith(
        doc.createTextNode(math.getAttribute(MATH_COPY_ATTR) ?? math.textContent ?? '')
      );
    }
    texts.push(container.textContent ?? '');
  }

  return texts.join('');
}
