import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';

export type ModelSelectorProps = ComponentProps<typeof Dialog>;

export const ModelSelector = (props: ModelSelectorProps) => <Dialog {...props} />;

export type ModelSelectorTriggerProps = ComponentProps<typeof DialogTrigger>;

export const ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => <DialogTrigger {...props} />;

export type ModelSelectorContentProps = ComponentProps<typeof DialogContent> & {
  title?: ReactNode;
};

export const ModelSelectorContent = ({
  className,
  children,
  title = 'Model Selector',
  ...props
}: ModelSelectorContentProps) => (
  <DialogContent
    aria-describedby={undefined}
    className={cn('outline! border-none! p-0 outline-border! outline-solid!', className)}
    {...props}
  >
    <DialogTitle className="sr-only">{title}</DialogTitle>
    <Command className="**:data-[slot=command-input-wrapper]:h-auto">{children}</Command>
  </DialogContent>
);

export type ModelSelectorDialogProps = ComponentProps<typeof CommandDialog>;

export const ModelSelectorDialog = (props: ModelSelectorDialogProps) => <CommandDialog {...props} />;

export type ModelSelectorInputProps = ComponentProps<typeof CommandInput>;

export const ModelSelectorInput = ({ className, ...props }: ModelSelectorInputProps) => (
  <CommandInput className={cn('h-auto py-3.5', className)} {...props} />
);

export type ModelSelectorListProps = ComponentProps<typeof CommandList>;

export const ModelSelectorList = (props: ModelSelectorListProps) => <CommandList {...props} />;

export type ModelSelectorEmptyProps = ComponentProps<typeof CommandEmpty>;

export const ModelSelectorEmpty = (props: ModelSelectorEmptyProps) => <CommandEmpty {...props} />;

export type ModelSelectorGroupProps = ComponentProps<typeof CommandGroup>;

export const ModelSelectorGroup = (props: ModelSelectorGroupProps) => <CommandGroup {...props} />;

export type ModelSelectorItemProps = ComponentProps<typeof CommandItem>;

export const ModelSelectorItem = (props: ModelSelectorItemProps) => <CommandItem {...props} />;

export type ModelSelectorShortcutProps = ComponentProps<typeof CommandShortcut>;

export const ModelSelectorShortcut = (props: ModelSelectorShortcutProps) => <CommandShortcut {...props} />;

export type ModelSelectorSeparatorProps = ComponentProps<typeof CommandSeparator>;

export const ModelSelectorSeparator = (props: ModelSelectorSeparatorProps) => <CommandSeparator {...props} />;

export type ModelSelectorLogoProps = Omit<ComponentProps<'img'>, 'src' | 'alt'> & {
  provider:
    | 'moonshotai-cn'
    | 'lucidquery'
    | 'moonshotai'
    | 'zai-coding-plan'
    | 'alibaba'
    | 'xai'
    | 'vultr'
    | 'nvidia'
    | 'upstage'
    | 'groq'
    | 'github-copilot'
    | 'mistral'
    | 'vercel'
    | 'nebius'
    | 'deepseek'
    | 'alibaba-cn'
    | 'google-vertex-anthropic'
    | 'venice'
    | 'chutes'
    | 'cortecs'
    | 'github-models'
    | 'togetherai'
    | 'azure'
    | 'baseten'
    | 'huggingface'
    | 'opencode'
    | 'fastrouter'
    | 'google'
    | 'google-vertex'
    | 'cloudflare-workers-ai'
    | 'inception'
    | 'wandb'
    | 'openai'
    | 'zhipuai-coding-plan'
    | 'perplexity'
    | 'openrouter'
    | 'zenmux'
    | 'v0'
    | 'iflowcn'
    | 'synthetic'
    | 'deepinfra'
    | 'zhipuai'
    | 'submodel'
    | 'zai'
    | 'inference'
    | 'requesty'
    | 'morph'
    | 'lmstudio'
    | 'anthropic'
    | 'aihubmix'
    | 'fireworks-ai'
    | 'modelscope'
    | 'llama'
    | 'scaleway'
    | 'amazon-bedrock'
    | 'cerebras'
    // oxlint-disable-next-line typescript-eslint(ban-types) -- intentional pattern for autocomplete-friendly string union
    | (string & {});
};

export const ModelSelectorLogo = ({ provider, className, ...props }: ModelSelectorLogoProps) => {
  const [failed, setFailed] = useState(false);
  const normalizedProvider = provider.trim().toLowerCase();
  const resolvedProvider = resolveLogoProvider(normalizedProvider);

  useEffect(() => {
    setFailed(false);
  }, [resolvedProvider]);

  if (failed) {
    const initials = getProviderInitials(normalizedProvider);
    const fallbackStyle = getProviderFallbackStyle(normalizedProvider);

    return (
      <span
        aria-label={`${provider} logo fallback`}
        className={cn(
          'flex size-[22px] shrink-0 items-center justify-center rounded-[6px] border border-white/10 text-[8px] font-semibold uppercase tracking-[0.08em] text-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
          className,
        )}
        style={fallbackStyle}
        title={provider}
      >
        {initials}
      </span>
    );
  }

  return (
    <img
      {...props}
      alt={`${provider} logo`}
      className={cn(
        'size-[22px] shrink-0 rounded-[6px] border border-white/10 bg-white/92 p-[1.5px] shadow-[0_1px_0_rgba(255,255,255,0.04),inset_0_1px_0_rgba(255,255,255,0.16)]',
        className,
      )}
      height={22}
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
      src={`https://models.dev/logos/${resolvedProvider}.svg`}
      width={22}
    />
  );
};

const PROVIDER_LOGO_ALIASES: Record<string, string> = {
  '01-ai': 'openrouter',
  'azure-openai': 'azure',
  bedrock: 'amazon-bedrock',
  'google-ai-studio': 'google',
  'google-gemini': 'google',
  glm: 'zai',
  meta: 'llama',
  'meta-llama': 'llama',
  mistralai: 'mistral',
  moonshot: 'moonshotai',
  'openai-community': 'openai',
  qwen: 'alibaba',
  'x-ai': 'xai',
};

function resolveLogoProvider(provider: string) {
  return PROVIDER_LOGO_ALIASES[provider] ?? provider;
}

function getProviderInitials(provider: string) {
  const cleaned = provider.replace(/[^a-z0-9]+/gi, ' ').trim();
  if (!cleaned) {
    return '?';
  }

  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 1);
  }

  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`;
}

function getProviderFallbackStyle(provider: string): CSSProperties {
  const hue = Array.from(provider).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;

  return {
    background: `linear-gradient(180deg, hsla(${hue}, 58%, 60%, 0.22), hsla(${(hue + 24) % 360}, 48%, 24%, 0.16))`,
  };
}

export type ModelSelectorLogoGroupProps = ComponentProps<'div'>;

export const ModelSelectorLogoGroup = ({ className, ...props }: ModelSelectorLogoGroupProps) => (
  <div
    className={cn(
      'flex shrink-0 items-center -space-x-1 [&>img]:rounded-full [&>img]:bg-background [&>img]:p-px [&>img]:ring-1 dark:[&>img]:bg-foreground',
      className,
    )}
    {...props}
  />
);

export type ModelSelectorNameProps = ComponentProps<'span'>;

export const ModelSelectorName = ({ className, ...props }: ModelSelectorNameProps) => (
  <span className={cn('flex-1 truncate text-left', className)} {...props} />
);
