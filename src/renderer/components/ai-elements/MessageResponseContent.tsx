import { CodeBlock, streamdownCodeLanguages } from '@/components/CodeBlock';
import { cn } from '@/lib/utils';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import type { ComponentProps } from 'react';
import { Streamdown, type CustomRenderer } from 'streamdown';

export type MessageResponseInnerProps = ComponentProps<typeof Streamdown>;

const streamdownRenderers: CustomRenderer[] = [
  {
    language: streamdownCodeLanguages,
    component: CodeBlock
  }
];

const streamdownPlugins = { cjk, code, math, mermaid, renderers: streamdownRenderers };
const streamdownControls = { code: false } as const;

export default function MessageResponseContent({ className, ...props }: MessageResponseInnerProps) {
  return (
    <Streamdown
      className={cn(
        "w-full break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:text-text-secondary [&_a]:underline [&_a]:decoration-border-strong [&_a]:underline-offset-2 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border-medium [&_blockquote]:pl-4 [&_blockquote]:text-text-secondary [&_hr]:my-4 [&_hr]:border-border-subtle [&_li]:my-1 [&_ol]:my-2.5 [&_p]:my-1.5 [&_p+_p]:mt-2 [&_p:empty]:hidden [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border-subtle [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-border-subtle [&_th]:bg-bg-hover [&_th]:px-3 [&_th]:py-2 [&_ul]:my-2.5 [&_[data-streamdown='inline-code']]:rounded-md [&_[data-streamdown='inline-code']]:border [&_[data-streamdown='inline-code']]:border-border-subtle [&_[data-streamdown='inline-code']]:bg-bg-hover [&_[data-streamdown='inline-code']]:px-1.5 [&_[data-streamdown='inline-code']]:py-0.5 [&_[data-streamdown='inline-code']]:font-mono [&_[data-streamdown='inline-code']]:text-[0.925em]",
        className
      )}
      controls={streamdownControls}
      plugins={streamdownPlugins}
      {...props}
    />
  );
}
