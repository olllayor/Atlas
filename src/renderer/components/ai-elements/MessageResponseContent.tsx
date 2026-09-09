import { CodeBlock } from '@/components/CodeBlock';
import { cn } from '@/lib/utils';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { mermaid } from '@streamdown/mermaid';
import type { ComponentProps } from 'react';
import { Streamdown, defaultRehypePlugins, defaultRemarkPlugins, type Components, type CustomRenderer, type MathPlugin } from 'streamdown';

import { streamdownCodeLanguages } from './codeLanguages';
import { markdownTableComponents } from './markdown-table';
import { ChatMarkdownImage, rehypeMarkStandaloneImages } from './chat-markdown-image';
import { MarkdownAnchor } from './chat-markdown-link';
import { MarkdownMath } from '../MarkdownMath';
import { rehypeMathSource, remarkMath } from '../../../shared/markdownMath.js';
import { remarkRewriteFileRefLinks } from '../../../shared/fileRefLinks';

export type MessageResponseInnerProps = ComponentProps<typeof Streamdown>;

const streamdownRenderers: CustomRenderer[] = [
  {
    language: streamdownCodeLanguages,
    component: CodeBlock
  }
];

type MdastNode = { type?: string; lang?: string | null; children?: MdastNode[] };

type HastNode = { properties?: Record<string, unknown> };

/**
 * Math rendering (port of t3code PR #10698, adapted to Streamdown).
 *
 * Streamdown's bundled `@streamdown/math` only parses `$$` display math
 * (single-dollar inline is off) and renders failures as red error text with
 * no way to copy the TeX. The shared `remarkMath` grammar recognizes
 * `$…$`, `$$…$$`, `\(…\)`, `\[…\]` with Pandoc-style currency guards, and
 * `MarkdownMath` renders via lazily-loaded KaTeX with Copy TeX + source
 * toggle, falling back to readable mono source.
 */
const atlasMathPlugin: MathPlugin = {
  name: 'katex',
  type: 'math',
  remarkPlugin: remarkMath,
  // Runs after sanitize (Streamdown appends the math rehype plugin last)
  // and restores sources the sanitizer stripped.
  rehypePlugin: rehypeMathSource,
};

/** Keep the math source attribute through sanitization (mirrors upstream). */
const mathAllowedTags = { span: ['dataMathSource'] };

function MarkdownSpan({ node, children, ...props }: ComponentProps<'span'> & { node?: unknown }) {
  const source = (node as HastNode | undefined)?.properties?.dataMathSource;
  if (typeof source === 'string') {
    return <MarkdownMath source={source} />;
  }
  return <span {...props}>{children}</span>;
}

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
  // File-ref hrefs (`[Name](src/…)`) must be rewritten before rehype-harden:
  // the sanitizer blocks bare-relative links with a `[blocked]` suffix before
  // the anchor component can turn them into chips.
  remarkRewriteFileRefLinks,
];

const streamdownRehypePlugins = [
  ...Object.values(defaultRehypePlugins),
  rehypeMarkStandaloneImages,
];

const streamdownPlugins = { cjk, code, math: atlasMathPlugin, mermaid, renderers: streamdownRenderers };
// `table: false` is belt-and-braces — `markdownTableComponents` replaces the
// wrapper that hosts the copy/download/fullscreen toolbar outright.
const streamdownControls = { code: false, table: false } as const;
const streamdownComponents = {
  ...markdownTableComponents,
  a: MarkdownAnchor,
  img: ChatMarkdownImage,
  span: MarkdownSpan,
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
      allowedTags={mathAllowedTags}
      remarkPlugins={streamdownRemarkPlugins}
      rehypePlugins={streamdownRehypePlugins}
      {...props}
    />
  );
}
