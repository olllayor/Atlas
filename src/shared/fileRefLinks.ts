/**
 * Remark plugin: carry file-reference links through the link sanitizer.
 *
 * The model writes `[Name](src/…)` links (see `builtInTools`), and the
 * transcript renders those as file chips — but Streamdown's bundled
 * `rehype-harden` blocks bare-relative hrefs before the anchor component
 * runs, replacing them with `text [blocked]`. Hash-only URLs pass hardening
 * untouched, so this rewrites file-ref destinations (including `file://`
 * wraps) into `#atlas-file:…` fragments that `MarkdownAnchor` decodes back
 * into chips. Everything else — citations, external links, page anchors —
 * is left alone.
 *
 * Pure mdast walk, no DOM: same shape as the untagged-fence tagger in
 * `MessageResponseContent`, tested with plain objects.
 */

import { rewriteFileRefHref } from './fileRef';

type MdastLinkNode = {
  type: string;
  url?: unknown;
};

type MdastParent = {
  children?: unknown;
};

/** Remark plugin (used uninvoked in the plugins array, like its sibling). */
export function remarkRewriteFileRefLinks() {
  return (tree: unknown) => {
    walk(tree);
  };
}

function walk(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  const record = node as MdastLinkNode & MdastParent;
  if ((record.type === 'link' || record.type === 'definition') && typeof record.url === 'string') {
    const rewritten = rewriteFileRefHref(record.url);
    if (rewritten) record.url = rewritten;
  }
  const children = (node as MdastParent).children;
  if (Array.isArray(children)) {
    for (const child of children) walk(child);
  }
}
