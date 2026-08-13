import { CodeBlock } from '@/components/CodeBlock';
import { cn } from '@/lib/utils';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import type { ComponentProps } from 'react';
import { Streamdown, defaultRemarkPlugins, type Components, type CustomRenderer } from 'streamdown';

import { parseFileRef } from '../../../shared/fileRef';
import { streamdownCodeLanguages } from './codeLanguages';
import { FileRefChip } from './file-ref';
import { markdownTableComponents } from './markdown-table';

export type MessageResponseInnerProps = ComponentProps<typeof Streamdown>;

const streamdownRenderers: CustomRenderer[] = [
  {
    language: streamdownCodeLanguages,
    component: CodeBlock
  }
];

type MdastNode = { type?: string; lang?: string | null; children?: MdastNode[] };

/**
 * Tag untagged fences as `text`.
 *
 * Streamdown only consults the custom-renderer table when the fence carries
 * a language (`renderers.find(...)` is guarded on a truthy language), so a
 * bare ``` block would fall through to Streamdown's own `<pre>` — different
 * chrome, no copy button, no rounded corners. Naming the language `text`
 * routes it to our `CodeBlock` like every other fence, which is the whole
 * point of having one code block in the transcript.
 */
function remarkTagUntaggedCode() {
  return (tree: MdastNode) => {
    const walk = (node: MdastNode) => {
      if (node.type === 'code' && !node.lang) {
        node.lang = 'text';
      }
      if (node.children) {
        for (const child of node.children) walk(child);
      }
    };
    walk(tree);
  };
}

// `remarkPlugins` replaces Streamdown's defaults rather than extending
// them, so the defaults have to be re-listed explicitly.
const streamdownRemarkPlugins = [
  ...Object.values(defaultRemarkPlugins),
  remarkTagUntaggedCode,
];

/**
 * Links, split by what they point at.
 *
 * A link to `src/main/index.ts` is the model naming a place in the project,
 * not a destination — the app has no browser to send it to, and rendering it
 * as an underlined URL both promises navigation that will not happen and
 * hides the filename in a run of blue text. Those become file chips; anything
 * that is actually a URL keeps the link styling the wrapper below defines.
 */
function MarkdownAnchor({
  href,
  children,
  // The mdast node rides along with every element Streamdown renders and is
  // not an attribute; forwarding it puts `node="[object Object]"` in the DOM.
  node: _node,
  ...props
}: ComponentProps<'a'> & { node?: unknown }) {
  if (href && parseFileRef(href)) {
    return <FileRefChip href={href}>{children}</FileRefChip>;
  }

  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

const streamdownPlugins = { cjk, code, math, mermaid, renderers: streamdownRenderers };
// `table: false` is belt-and-braces — `markdownTableComponents` replaces the
// wrapper that hosts the copy/download/fullscreen toolbar outright.
const streamdownControls = { code: false, table: false } as const;
const streamdownComponents = {
  ...markdownTableComponents,
  a: MarkdownAnchor,
} as Components;

export default function MessageResponseContent({ className, ...props }: MessageResponseInnerProps) {
  return (
    <Streamdown
      className={cn(
        "w-full break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:text-text-secondary [&_a]:underline [&_a]:decoration-border-strong [&_a]:underline-offset-2 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border-medium [&_blockquote]:pl-4 [&_blockquote]:text-text-secondary [&_hr]:my-4 [&_hr]:border-border-subtle [&_li]:my-1 [&_ol]:my-2.5 [&_p]:my-1.5 [&_p+_p]:mt-2 [&_p:empty]:hidden [&_ul]:my-2.5 [&_[data-streamdown='inline-code']]:rounded-md [&_[data-streamdown='inline-code']]:border [&_[data-streamdown='inline-code']]:border-border-subtle [&_[data-streamdown='inline-code']]:bg-bg-hover [&_[data-streamdown='inline-code']]:px-1.5 [&_[data-streamdown='inline-code']]:py-0.5 [&_[data-streamdown='inline-code']]:font-mono [&_[data-streamdown='inline-code']]:text-[0.925em]",
        className
      )}
      components={streamdownComponents}
      controls={streamdownControls}
      plugins={streamdownPlugins}
      remarkPlugins={streamdownRemarkPlugins}
      {...props}
    />
  );
}
