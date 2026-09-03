import { ArrowUp, ImagePlus, Paperclip, Plus, Square } from 'lucide-react';
import { nanoid } from 'nanoid';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import {
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_SIZE_BYTES,
  getAttachmentCapabilityError,
  normalizeAttachmentMediaType,
} from '../../shared/attachments';
import type { ReasoningEffort, ToolPermissionMode } from '../../shared/chatParameters';
import { planImageDownscale } from '../../shared/imageDownscale';
import { cn } from '../lib/utils';
import { parseStandaloneSlashCommand, parseStandaloneCommandWithArgs } from '../lib/slashCommands';
import { CitationStrip } from './CitationStrip';
import { AtlasLoader } from './ui/atlas-loader';
import { useAppStore } from '../stores/useAppStore';
import type {
  CustomProvider,
  ModelSummary,
  ProviderCredentialSummary,
} from '../../shared/contracts';
import type { WorkspaceMode } from '../../shared/workspaceModes';
import type { PermissionPreset } from '../../shared/permissionPresets';
import { ModelSelector } from './ModelSelector';
import { WorkspaceAccessChip } from './workspace/WorkspaceModeSwitch';
import {
  Attachment,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  getAttachmentLabel,
  getMediaCategory,
  type AttachmentData,
} from './ai-elements/attachments';
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger,
} from './ai-elements/context';
import { ImageLightbox } from './ai-elements/image-lightbox';
import { useContextUsage } from '../hooks/useContextUsage';
import { CommandAutocompleteList, useCommandAutocomplete } from './CommandAutocomplete';
import type { PluginMentionEntry } from '../../shared/pluginMentions';
import { MentionAutocompleteList, useMentionAutocomplete } from './MentionAutocomplete';
import {
  PluginMentionAutocompleteList,
  toPluginMentionCatalog,
  usePluginMentionAutocomplete
} from './PluginMentionAutocomplete';
import type { DraftStateLike } from './types';

/**
 * A pending attachment in the composer. Structurally a `ChatInputFilePart`
 * plus a client-side id, so the array can flow straight into `sendMessage`.
 */
export type ComposerAttachment = {
  id: string;
  type: 'file';
  mediaType: string;
  url: string;
  filename?: string;
  sizeBytes?: number;
};

export type ComposerMessage = {
  text: string;
  files: ComposerAttachment[];
};

export type ComposerProps = {
  value: string;
  disabled: boolean;
  isStreaming: boolean;
  models: ModelSummary[];
  selectedModelId: string | null;
  selectedProviderId?: string | null;
  modelPickerOpen: boolean;
  composerFocusNonce: number;
  /**
   * The open conversation, by id. The composer only ever needed the id off the
   * page object, and the page is replaced on every stream flush — taking the id
   * keeps the composer off the token path.
   */
  conversationId: string | null;
  /**
   * Turn identity of the in-flight request, or null when nothing is streaming.
   * Together these are the whole of what the composer read from the live draft:
   * the meter keys off the turn, never off its tokens.
   */
  draftRequestId: string | null;
  draftStatus: DraftStateLike['status'] | null;
  /** Staged files for the *current* conversation; owned by the store. */
  attachments: ComposerAttachment[];
  onAttachmentsChange: (updater: (previous: ComposerAttachment[]) => ComposerAttachment[]) => void;
  onChange: (value: string) => void;
  onSend: (message: ComposerMessage) => Promise<void> | void;
  onAbort: () => void;
  onSelectModel: (modelId: string, providerId?: string) => void;
  onModelPickerOpenChange: (open: boolean) => void;
  onComposerFocusChange: (focused: boolean) => void;
  onRefreshModels?: () => void;
  isRefreshingModels?: boolean;
  customProviders?: CustomProvider[];
  credentials?: ProviderCredentialSummary[];
  defaultFreeOnly?: boolean;
  onManageProviders?: () => void;
  reasoningEffort: ReasoningEffort;
  toolPermissionMode: ToolPermissionMode;
  /**
   * The other half of the access chip. The composer does not own the mode — the
   * sidebar heading is its canonical home — but that heading disappears with a
   * collapsed rail, so both axes have to be reachable from here too.
   */
  workspaceMode: WorkspaceMode;
  workspaceReady: boolean;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
  /** Opens the folder picker from the chip's menu while Code has no usable folder. */
  onRequestProject?: () => void;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
  onToolPermissionModeChange: (value: ToolPermissionMode) => void;
  /** One-click posture from the chip's menu: writes both access axes at once. */
  onPermissionPresetSelect?: (preset: PermissionPreset) => void;
  /**
   * Receives built-in slash command names (`compact`, `review`…). A draft that
   * is exactly one of them is consumed as an action instead of sent.
   */
  onSlashAction?: (name: string, args?: string) => void;
  onOpenGallery: () => void;
  /**
   * How many follow-ups are waiting to run in this conversation. Drives the
   * placeholder: while a turn is live, the empty composer should teach the
   * queue rather than sit silent about where the next message will land.
   */
  queuedCount?: number;
};

// ---------------------------------------------------------------------------
// Attachment plumbing (formerly vendored in ai-elements/prompt-input.tsx)
// ---------------------------------------------------------------------------

const ACCEPT_PATTERNS = ATTACHMENT_ACCEPT_ATTRIBUTE.split(',')
  .map((pattern) => pattern.trim())
  .filter(Boolean);

const MAX_ATTACHMENT_SIZE_MB = Math.round(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024));

const matchesAccept = (file: File): boolean => {
  const mediaType = normalizeAttachmentMediaType(file.type, file.name);
  return ACCEPT_PATTERNS.some((pattern) =>
    pattern.endsWith('/*') ? mediaType.startsWith(pattern.slice(0, -1)) : mediaType === pattern,
  );
};

const revokeIfBlobUrl = (url: string) => {
  if (url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
};

/** Quality for the re-encode. High enough that text in a screenshot stays sharp. */
const DOWNSCALED_IMAGE_QUALITY = 0.85;

/**
 * Shrink an oversized image before it is staged.
 *
 * The model sees the same thing either way — vision APIs resize past ~1568px
 * themselves — but the request stops carrying megabytes of base64 that no
 * gateway is in a hurry to accept. Anything that fails, or that does not come
 * out smaller, keeps the original file: this is an optimisation, and it is
 * never allowed to be the reason an attachment changed.
 */
const downscaleImageFile = async (file: File): Promise<File> => {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') {
    return file;
  }

  let bitmap: ImageBitmap | null = null;

  try {
    bitmap = await createImageBitmap(file);
    const plan = planImageDownscale({
      width: bitmap.width,
      height: bitmap.height,
      bytes: file.size,
    });

    if (!plan) {
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;

    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }

    context.drawImage(bitmap, 0, 0, plan.width, plan.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', DOWNSCALED_IMAGE_QUALITY);
    });

    if (!blob || blob.size >= file.size) {
      return file;
    }

    // `.jpg`, because the bytes are now JPEG whatever the original said — a
    // name that disagrees with its content confuses every downstream sniff.
    const name = file.name.replace(/\.[^./\\]+$/, '') || 'image';

    return new File([blob], `${name}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
};

const convertBlobUrlToDataUrl = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    // FileReader is callback-based; wrapping in a Promise is unavoidable.
    // oxlint-disable-next-line eslint-plugin-promise(avoid-new)
    return await new Promise((resolve) => {
      const reader = new FileReader();
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      reader.onloadend = () => resolve(reader.result as string);
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

/**
 * Validation (accept list, per-file size, count cap) and blob-URL lifecycle for
 * the composer's staged files.
 *
 * The array itself lives in the store keyed by conversation, so nothing here
 * revokes on unmount: a staged file has to survive switching threads.
 */
function useComposerAttachments(
  files: ComposerAttachment[],
  setFiles: (updater: (previous: ComposerAttachment[]) => ComposerAttachment[]) => void,
  onError: (message: string | null) => void,
  /**
   * Why the selected model cannot take this file, or null when it can.
   *
   * Every path in — the file dialog, drag-and-drop, paste — lands here, so this
   * is the one place that can refuse a file at the moment it arrives. It used
   * to be staged regardless and only rejected at send time, as a disabled
   * button with a sentence under it, which reads as the composer being broken
   * rather than as the file being wrong for this model.
   */
  getRejectionReason: (file: File) => string | null,
) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef(files);
  const rejectionRef = useRef(getRejectionReason);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    rejectionRef.current = getRejectionReason;
  }, [getRejectionReason]);

  const add = useCallback(
    async (incoming: File[] | FileList) => {
      const list = [...incoming];
      if (list.length === 0) {
        return;
      }
      // A fresh attempt invalidates whatever the last one complained about.
      onError(null);

      const accepted = list.filter(matchesAccept);
      if (accepted.length === 0) {
        onError('No files match the accepted types.');
        return;
      }

      const firstRejection = accepted.map((file) => rejectionRef.current(file)).find(Boolean);
      if (firstRejection) {
        onError(firstRejection);
        return;
      }

      const sized = accepted.filter((file) => file.size <= MAX_ATTACHMENT_SIZE_BYTES);
      if (sized.length === 0) {
        onError(`Files must be ${MAX_ATTACHMENT_SIZE_MB} MB or smaller.`);
        return;
      }
      const capacity = Math.max(0, MAX_ATTACHMENT_COUNT - filesRef.current.length);
      const capped = sized.slice(0, capacity);
      if (sized.length > capped.length) {
        onError(`Up to ${MAX_ATTACHMENT_COUNT} files. Some were not added.`);
      }
      if (capped.length === 0) {
        return;
      }

      // Re-encode before the blob URL is minted, so the staged chip, the
      // thumbnail and the bytes that get sent are all the same image.
      const prepared = await Promise.all(capped.map((file) => downscaleImageFile(file)));

      setFiles((previous) => [
        ...previous,
        ...prepared.map((file) => ({
          filename: file.name,
          id: nanoid(),
          mediaType: normalizeAttachmentMediaType(file.type, file.name),
          sizeBytes: file.size,
          type: 'file' as const,
          url: URL.createObjectURL(file),
        })),
      ]);
    },
    [onError, setFiles],
  );

  const remove = useCallback(
    (id: string) => {
      setFiles((previous) => {
        const found = previous.find((file) => file.id === id);
        if (!found) {
          return previous;
        }
        revokeIfBlobUrl(found.url);
        return previous.filter((file) => file.id !== id);
      });
    },
    [setFiles],
  );

  const clear = useCallback(() => {
    setFiles((previous) => {
      if (previous.length === 0) {
        return previous;
      }
      for (const file of previous) {
        revokeIfBlobUrl(file.url);
      }
      return [];
    });
  }, [setFiles]);

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return { add, clear, fileInputRef, files, openFileDialog, remove };
}

// ---------------------------------------------------------------------------
// Attachment chips
// ---------------------------------------------------------------------------

const ComposerAttachmentItem = memo(
  ({
    attachment,
    pendingDelete,
    onRemove,
  }: {
    attachment: AttachmentData;
    /** Armed by the first Backspace on an empty composer. */
    pendingDelete: boolean;
    onRemove: (id: string) => void;
  }) => {
    const handleRemove = useCallback(() => onRemove(attachment.id), [attachment.id, onRemove]);
    const mediaCategory = getMediaCategory(attachment);
    const label = getAttachmentLabel(attachment);
    const isImage = mediaCategory === 'image';
    const [thumbnailFailed, setThumbnailFailed] = useState(false);
    const imageUrl =
      isImage && attachment.type === 'file' && attachment.url && !thumbnailFailed ? attachment.url : null;
    const [lightboxOpen, setLightboxOpen] = useState(false);

    /*
      A thumbnail tile, not a filename chip. An attached image is recognised by
      looking at it; `IMG_4471.HEIC` in a 200px-wide chip told you nothing the
      picture says instantly. Non-images keep their name — an icon alone would
      be unidentifiable — but wear the same tile so one row never mixes two
      shapes.
    */
    const tile = (
      <Attachment
            aria-label={imageUrl ? `Attachment ${label} — open` : `Attachment ${label}`}
            className={`size-20 overflow-hidden rounded-lg border bg-bg-base text-text-secondary transition-colors ${
              imageUrl ? 'cursor-zoom-in' : ''
            } ${pendingDelete ? 'border-error ring-1 ring-error' : 'border-border-subtle'}`}
            data={attachment}
            onRemove={handleRemove}
            role={imageUrl ? 'button' : undefined}
            tabIndex={0}
            onClick={imageUrl ? () => setLightboxOpen(true) : undefined}
            onKeyDown={
              imageUrl
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setLightboxOpen(true);
                    }
                  }
                : undefined
            }
          >
            {imageUrl ? (
              <img
                alt=""
                className="size-full object-cover"
                height={80}
                onError={() => setThumbnailFailed(true)}
                src={imageUrl}
                width={80}
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-1 bg-bg-subtle px-1.5">
                <AttachmentPreview className="size-auto bg-transparent [&>svg]:size-5" />
                <span className="line-clamp-2 w-full break-all text-center text-3xs leading-tight text-text-tertiary">
                  {label}
                </span>
              </div>
            )}

            {/*
              Always visible, not hover-only: the tile is small enough that a
              hidden control is a control you have to go hunting for, and it
              has to work on a trackpad tap and a keyboard alike.
            */}
            <AttachmentRemove className="!absolute !right-1 !top-1 !size-5 !p-0 !opacity-100 rounded-full bg-bg-button text-bg-base hover:bg-bg-button-hover [&>svg]:size-3" />
      </Attachment>
    );

    /*
      Images open a real viewer on click, so the hover preview would be a
      second, worse answer to the same question. Everything else keeps the
      hover card, which is the only place its full filename fits.
    */
    if (imageUrl) {
      return (
        <>
          {tile}
          <ImageLightbox
            open={lightboxOpen}
            onOpenChange={setLightboxOpen}
            src={imageUrl}
            filename={label}
          />
        </>
      );
    }

    return (
      <AttachmentHoverCard openDelay={200}>
        <AttachmentHoverCardTrigger asChild>{tile}</AttachmentHoverCardTrigger>
        <AttachmentHoverCardContent
          className="w-auto max-w-[264px] rounded-lg border border-border-default bg-bg-overlay p-2 text-xs font-normal text-text-primary"
          side="top"
          sideOffset={6}
        >
          <div className="max-w-[240px] break-all">{label}</div>
        </AttachmentHoverCardContent>
      </AttachmentHoverCard>
    );
  },
);

ComposerAttachmentItem.displayName = 'ComposerAttachmentItem';

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export function Composer({
  value,
  disabled,
  isStreaming,
  models,
  selectedModelId,
  modelPickerOpen,
  composerFocusNonce,
  conversationId,
  draftRequestId,
  draftStatus,
  attachments: stagedAttachments,
  onAttachmentsChange,
  onChange,
  onSend,
  onAbort,
  onSelectModel,
  onModelPickerOpenChange,
  onComposerFocusChange,
  onRefreshModels,
  isRefreshingModels,
  customProviders,
  credentials,
  defaultFreeOnly,
  onManageProviders,
  reasoningEffort,
  toolPermissionMode,
  workspaceMode,
  workspaceReady,
  onWorkspaceModeChange,
  onRequestProject,
  onReasoningEffortChange,
  onToolPermissionModeChange,
  onPermissionPresetSelect,
  onSlashAction,
  onOpenGallery,
  selectedProviderId,
  queuedCount = 0,
}: ComposerProps) {
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [showStopHint, setShowStopHint] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [scrollEdges, setScrollEdges] = useState({ bottom: false, top: false });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const selectedModel = useMemo(() => {
    if (!selectedModelId) return null;
    if (selectedProviderId) {
      const exact = models.find((m) => !m.archived && m.id === selectedModelId && m.providerId === selectedProviderId);
      if (exact) return exact;
    }
    const cands = models.filter((m) => m.id === selectedModelId);
    if (cands.length === 0) return null;
    const active = cands.filter((m) => !m.archived);
    const pool = active.length > 0 ? active : cands;
    let best = pool[0];
    for (let i = 1; i < pool.length; i++) if (pool[i].providerId < best.providerId) best = pool[i];
    return best;
  }, [models, selectedModelId, selectedProviderId]);

  // The same capability check the send path runs, applied to a single incoming
  // file so it can be refused before it is ever staged.
  const getAttachmentRejectionReason = useCallback(
    (file: File) => {
      // With no model chosen there is nothing to check against, and refusing
      // the file would be the composer blocking a drop for a reason the user
      // cannot see. The send path still requires a model.
      if (!selectedModel) {
        return null;
      }

      return getAttachmentCapabilityError(selectedModel, [
        { filename: file.name, mediaType: normalizeAttachmentMediaType(file.type, file.name) },
      ]);
    },
    [selectedModel],
  );

  const attachments = useComposerAttachments(
    stagedAttachments,
    onAttachmentsChange,
    setAttachmentError,
    getAttachmentRejectionReason,
  );
  // The installed set, for the `@plugin` picker. Fetched once per mount: the
  // plugins page invalidates on its own, and re-reading on every keystroke
  // would put an IPC round trip in the typing path.
  const [pluginCatalog, setPluginCatalog] = useState<PluginMentionEntry[]>([]);

  useEffect(() => {
    let mounted = true;

    void window.atlasChat.plugins
      .list()
      .then((view) => {
        if (mounted) setPluginCatalog(toPluginMentionCatalog(view.plugins));
      })
      // An unreadable plugins directory costs the picker, never the composer.
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  const plugins = usePluginMentionAutocomplete({
    value,
    onChange,
    textareaRef,
    catalog: pluginCatalog,
    disabled
  });
  const mentions = useMentionAutocomplete({
    value,
    onChange,
    textareaRef,
    // Both trigger on `@`. The plugin picker wins while it has something to
    // offer, because it is the more specific answer: `@github` names an
    // installed bundle, and the built-in list has one fixed entry.
    disabled: disabled || plugins.isOpen
  });
  // The two pickers cannot both be open: a mention needs an `@` and a command
  // only ever triggers on a `/` in the first column.
  const commands = useCommandAutocomplete({
    value,
    onChange,
    textareaRef,
    disabled,
    onBuiltinCommand: onSlashAction,
  });

  const syncPickerCarets = useCallback(() => {
    mentions.syncCaret();
    commands.syncCaret();
    plugins.syncCaret();
  }, [commands, mentions, plugins]);

  // -- textarea auto-grow ---------------------------------------------------
  // Layout effect (not effect) so a paste never paints at the old height, and
  // the ceiling comes from `--composer-max-height` so it tracks the font size.
  const syncScrollEdges = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    const canScroll = element.scrollHeight > element.clientHeight + 1;
    setScrollEdges({
      bottom: canScroll && element.scrollTop + element.clientHeight < element.scrollHeight - 2,
      top: canScroll && element.scrollTop > 2,
    });
  }, []);

  const syncTextareaHeight = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    const maxHeight = Number.parseFloat(globalThis.getComputedStyle(element).maxHeight);
    const height = Number.isFinite(maxHeight) ? Math.min(element.scrollHeight, maxHeight) : element.scrollHeight;
    element.style.height = `${height}px`;
    syncScrollEdges();
  }, [syncScrollEdges]);

  useLayoutEffect(() => {
    syncTextareaHeight();
  }, [syncTextareaHeight, value]);

  useEffect(() => {
    // Width changes (sidebar resize, workbench toggle) re-wrap the text, which
    // a value-keyed effect would never notice. Observe the wrapper, not the
    // textarea itself — we mutate the textarea's height inside the callback.
    const element = fieldRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => syncTextareaHeight());
    observer.observe(element);
    return () => observer.disconnect();
  }, [syncTextareaHeight]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [composerFocusNonce]);

  // Clearing the composer clears the armed delete.
  useEffect(() => {
    if (pendingDeleteId && !stagedAttachments.some((file) => file.id === pendingDeleteId)) {
      setPendingDeleteId(null);
    }
  }, [pendingDeleteId, stagedAttachments]);

  // -- drag and drop --------------------------------------------------------
  const canAttach = !disabled && !isStreaming;
  const addRef = useRef(attachments.add);
  const canAttachRef = useRef(canAttach);
  useEffect(() => {
    addRef.current = attachments.add;
    canAttachRef.current = canAttach;
  }, [attachments.add, canAttach]);

  useEffect(() => {
    // dragenter/dragleave fire per element, so a plain boolean flickers as the
    // pointer crosses children. Count depth instead.
    let depth = 0;
    const carriesFiles = (event: DragEvent) => Boolean(event.dataTransfer?.types?.includes('Files'));

    const onDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth += 1;
      if (canAttachRef.current) {
        setIsDropTarget(true);
      }
    };
    const onDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        setIsDropTarget(false);
      }
    };
    const onDragOver = (event: DragEvent) => {
      if (carriesFiles(event)) {
        event.preventDefault();
      }
    };
    const onDrop = (event: DragEvent) => {
      depth = 0;
      setIsDropTarget(false);
      if (!carriesFiles(event)) return;
      event.preventDefault();
      // The old handler bypassed both guards: files landed in a disabled or
      // mid-stream composer.
      if (!canAttachRef.current) return;
      if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
        void addRef.current(event.dataTransfer.files);
      }
    };

    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, []);

  // -- send -----------------------------------------------------------------
  const unsupportedReason = getAttachmentCapabilityError(selectedModel, attachments.files);
  const footerMessage = attachmentError ?? unsupportedReason;

  /**
   * A model that could take what is currently staged, or null.
   *
   * Prefers one already known to handle it over one that merely has not been
   * ruled out, so the offer is a fix rather than a second guess.
   */
  const capableModelSwitch = useMemo(() => {
    if (!unsupportedReason || attachments.files.length === 0) {
      return null;
    }

    const candidates = models.filter(
      (model) =>
        !(model.id === selectedModelId && model.providerId === selectedProviderId) &&
        !model.archived &&
        !getAttachmentCapabilityError(model, attachments.files),
    );

    return candidates.find((model) => model.supportsVision === true) ?? candidates[0] ?? null;
  }, [attachments.files, models, selectedModelId, selectedProviderId, unsupportedReason]);
  const hasSubmittableContent = Boolean(value.trim()) || attachments.files.length > 0;
  const canSend = hasSubmittableContent && !disabled && !unsupportedReason && !isSubmitting;

  const submit = useCallback(async () => {
    // `isSubmitting` closes the window between the first Enter and the awaited
    // blob→dataURL conversion, which used to accept a second Enter.
    if (!canSend || isStreaming || isSubmitting) {
      return;
    }

    /*
      A draft that is exactly a built-in command (`/compact`, `/review`…) is a
      control action, not a message (t3code's standalone-command parse). It is
      consumed here — cleared, executed, never sent — while plugin templates
      keep their insert-as-text behavior.
    */
    if (!attachments.files.length && onSlashAction) {
      // Arg-taking commands (/goal <objective>) parse first; the rest keep
      // the exact-invocation grammar so trailing text fails loudly.
      const invocation = parseStandaloneCommandWithArgs(value);
      if (invocation) {
        onChange('');
        onSlashAction(invocation.name, invocation.args || undefined);
        return;
      }
      const builtin = parseStandaloneSlashCommand(value);
      if (builtin) {
        onChange('');
        onSlashAction(builtin.name);
        return;
      }
    }

    setIsSubmitting(true);
    setAttachmentError(null);

    try {
      // Blob URLs die with the renderer; persist attachments as data URLs.
      const files: ComposerAttachment[] = await Promise.all(
        attachments.files.map(async (file) => {
          if (file.url.startsWith('blob:')) {
            const dataUrl = await convertBlobUrlToDataUrl(file.url);
            return { ...file, url: dataUrl ?? file.url };
          }
          return file;
        }),
      );

      // A conversion that failed used to fall back to the blob URL and send it
      // anyway, which the main process rejected as "Attachments must be sent as
      // data URLs" — a sentence about our own wire format, thrown at the user,
      // naming neither the file nor anything they could do. Fail here instead,
      // where the file still has a name and the message can say so.
      const unreadable = files.filter((file) => !file.url.startsWith('data:'));
      if (unreadable.length > 0) {
        const names = unreadable.map((file) => file.filename ?? 'an attachment').join(', ');
        setAttachmentError(`Could not read ${names}. Remove ${unreadable.length === 1 ? 'it' : 'them'} and attach again.`);
        return;
      }

      // Clearing the draft is the caller's job: it knows which conversation
      // the send belonged to, which may no longer be the selected one.
      await onSend({ files, text: value });
    } catch {
      // Keep the input so the user can retry.
    } finally {
      setIsSubmitting(false);
    }
  }, [attachments, canSend, isStreaming, isSubmitting, onSend, onSlashAction, onChange, value]);

  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashStopHint = useCallback(() => {
    setShowStopHint(true);
    if (hintTimerRef.current) {
      clearTimeout(hintTimerRef.current);
    }
    hintTimerRef.current = setTimeout(() => setShowStopHint(false), 2400);
  }, []);
  useEffect(
    () => () => {
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isStreaming) {
      setShowStopHint(false);
    }
  }, [isStreaming]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Consumed keys must stop here so they neither submit nor move the caret,
    // and must not reach the app's global Escape handling.
    if (plugins.handleKeyDown(event) || mentions.handleKeyDown(event) || commands.handleKeyDown(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.key === 'Escape' && isStreaming) {
      event.preventDefault();
      event.stopPropagation();
      onAbort();
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      if (isComposing || event.nativeEvent.isComposing) {
        return;
      }
      event.preventDefault();
      if (isStreaming) {
        // Enter used to be silently swallowed while the button said Stop.
        flashStopHint();
        return;
      }
      void submit();
      return;
    }

    if (event.key === 'Backspace' && value === '' && attachments.files.length > 0) {
      event.preventDefault();
      const last = attachments.files.at(-1);
      if (!last) return;
      // Two-step: arm, then remove. A single Backspace used to delete silently.
      if (pendingDeleteId === last.id) {
        attachments.remove(last.id);
        setPendingDeleteId(null);
      } else {
        setPendingDeleteId(last.id);
      }
      return;
    }

    // Any other key means the user moved on from the armed chip.
    if (pendingDeleteId) {
      setPendingDeleteId(null);
    }
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) {
      return;
    }
    const files: File[] = [];
    let hasText = false;
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      } else if (item.kind === 'string' && item.type === 'text/plain') {
        hasText = true;
      }
    }
    if (files.length === 0) {
      return;
    }
    // Only swallow the paste when there is nothing else to insert; a mixed
    // text+image paste has to do both.
    if (!hasText) {
      event.preventDefault();
    }
    void attachments.add(files);
  };

  /**
   * Every model here belongs to a user-configured endpoint, so its id is a
   * gateway's own spelling (`Tokenrouter/kimi-k3-free`). tokenlens keys on
   * `provider:model` from its own registry, and a gateway name it has never
   * heard of yields no pricing at all — which is why cost used to be blank for
   * every model in the app. Only the vendor segment is worth handing over.
   */
  const tokenLensModelId = useMemo(() => {
    if (!selectedModel) {
      return undefined;
    }

    const segments = selectedModel.id.split('/');
    const bare = (segments.length > 1 ? segments.slice(1).join('/') : segments[0] ?? '').replace(
      /[:@](free|beta|preview|latest)$/i,
      '',
    );

    return bare || undefined;
  }, [selectedModel]);


  // Dimensions are unknown until the image is decoded, so the estimator falls
  // back to its typical-screenshot allowance rather than guessing from bytes.
  const pendingAttachments = useMemo(
    () => attachments.files.map((file) => ({ mediaType: file.mediaType ?? null })),
    [attachments.files],
  );

  /**
   * A turn boundary, not a token. Streaming deltas leave this alone (the
   * in-flight request's prompt is already fixed); it changes when a request
   * starts or finishes, which is exactly when history has grown.
   */
  const turnKey = `${draftRequestId ?? 'idle'}:${draftStatus ?? 'none'}`;
  const settingsThreshold = useAppStore((state) => state.settings?.chat.compactionThresholdPercent ?? 85);
  const updatePreferences = useAppStore((state) => state.updatePreferences);
  const [compactNonce, setCompactNonce] = useState(0);
  const contextTurnKey = `${turnKey}:${compactNonce}:${settingsThreshold}`;

  const contextUsage = useContextUsage({
    conversationId,
    modelId: selectedModel?.id ?? null,
    providerId: selectedModel?.providerId ?? selectedProviderId ?? null,
    enableTools: selectedModel != null && selectedModel.supportsTools !== false,
    toolPermissionMode,
    // What is typed but unsent counts toward the next prompt; what is streaming
    // back does not, since the request that produced it is already sent.
    pendingText: draftStatus ? '' : value,
    pendingAttachments,
    turnKey: contextTurnKey,
  });

  const contextStats = useMemo(() => {
    if (!contextUsage || contextUsage.maxTokens == null) {
      return null;
    }

    return {
      maxTokens: contextUsage.maxTokens,
      modelId: tokenLensModelId,
      // Conversation tokens, not the whole prompt: the system prompt and tool
      // schemas are a fixed cost of talking to the model at all, and charging
      // them to the ring made an untouched chat open at a third full.
      usedTokens: contextUsage.conversationTokens,
      usage: {
        inputTokens: contextUsage.lastTurn?.inputTokens ?? undefined,
        outputTokens: contextUsage.lastTurn?.outputTokens ?? undefined,
        reasoningTokens: contextUsage.lastTurn?.reasoningTokens ?? undefined,
        cachedInputTokens: contextUsage.lastTurn?.cachedInputTokens ?? undefined,
      },
      breakdown: contextUsage,
      compactionThresholdPercent: settingsThreshold ?? contextUsage.compactionThresholdPercent ?? 85,
      compactionThresholdTokens: contextUsage.compactionThresholdTokens ?? null,
    };
  }, [contextUsage, settingsThreshold, tokenLensModelId]);

  const handleCompactionThresholdChange = useCallback(
    (next: number) => {
      void updatePreferences({ chat: { compactionThresholdPercent: next } });
    },
    [updatePreferences]
  );

  const handleCompactNow = useCallback(() => {
    if (!conversationId) return;
    void window.atlasChat.chat
      .compact(conversationId)
      .then(() => {
        // Refresh meter immediately so the forced compaction's sticky boundary is visible.
        setCompactNonce((nonce) => nonce + 1);
      })
      .catch(() => undefined);
  }, [conversationId]);

  const sendTooltip = isStreaming
    ? 'Stop generating · Esc'
    : isSubmitting
      ? 'Sending…'
      : unsupportedReason
        ? unsupportedReason
        : hasSubmittableContent
          ? 'Send · Enter'
          : 'Write a message first';

  const textareaMask =
    scrollEdges.top || scrollEdges.bottom
      ? `linear-gradient(to bottom, ${scrollEdges.top ? 'transparent 0, #000 14px' : '#000 0'}, ${
          scrollEdges.bottom ? '#000 calc(100% - 14px), transparent 100%' : '#000 100%'
        })`
      : undefined;

  return (
    /*
      The composer floats over the transcript's scroller, which permanently
      reserves a 6px scrollbar rail (`scrollbar-gutter: stable` on
      `.scrollbar-auto-hide`). Matching that rail here keeps the two centred
      columns on the same axis; without it they land 3px apart, which reads as
      a wobble between the last message and the input.
    */
    <div className="pr-[6px]">
      {/*
        No padding above the slab.

        The transcript reserves this dock's *whole* height, so anything above
        the slab becomes clear space between the last message and the input —
        the gap this layout exists to remove. With none, the slab's own top
        edge is where the transcript stops, and a message scrolling past it
        goes behind the slab rather than halting short of it.

        Below it is the opposite case: the slab sits off the window edge so it
        reads as an object resting on the page rather than a strip welded to
        the frame. The transcript reserves that space along with the rest of
        the dock, so the gap costs nothing at the top.
      */}
      <div className="px-5 pb-7 lg:px-6">
        <div className="mx-auto max-w-composer">
          <input
            accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
            aria-label="Upload files"
            className="hidden"
            multiple
            onChange={(event) => {
              if (event.currentTarget.files) {
                void attachments.add(event.currentTarget.files);
              }
              // Reset so re-picking a previously removed file fires change again.
              event.currentTarget.value = '';
            }}
            ref={attachments.fileInputRef}
            type="file"
          />

          {/* The Codex slab: opaque, superellipse-rounded, borderless, shadowless. */}
          <div className="composer-slab @container relative rounded-composer bg-bg-composer px-3.5 pb-3 pt-4">
            {isDropTarget ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-composer border border-dashed border-border-strong bg-bg-composer/95 text-sm text-text-secondary"
              >
                Drop files to attach
              </div>
            ) : null}

            {attachments.files.length > 0 ? (
              // Caps at two rows of tiles; more than that scrolls instead of
              // pushing the transcript off screen.
              <div className="scrollbar-auto-hide max-h-[11rem] overflow-y-auto overscroll-contain px-1 pb-2 pt-1">
                {/* `!ml-0`: the grid variant right-aligns itself for the
                    transcript, but staged files read left-to-right from the
                    composer's own edge. */}
                <Attachments variant="grid" className="!ml-0 max-w-full gap-2">
                  {attachments.files.map((attachment) => (
                    <ComposerAttachmentItem
                      attachment={attachment}
                      key={attachment.id}
                      onRemove={attachments.remove}
                      pendingDelete={pendingDeleteId === attachment.id}
                    />
                  ))}
                </Attachments>
              </div>
            ) : null}

            {/* Cited quotes live in the draft as serialized links; the strip
                keeps them readable until the phase-2 composer renders them
                inline. Removing a chip deletes its link bytes. */}
            <CitationStrip
              value={value}
              onRemove={(source) => onChange(value.replace(source, ''))}
            />

            {footerMessage ? (
              <div
                aria-live="polite"
                className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pb-1 text-2xs leading-5 text-warning-text"
                role="status"
              >
                <span>{footerMessage}</span>
                {/*
                  Only reachable when files were staged and the model changed
                  underneath them — the attach paths refuse an unusable file
                  outright now. Removing the attachments is the obvious way out
                  and is already one click away on each chip; naming a model
                  that can read them is the one the user cannot work out alone.
                */}
                {capableModelSwitch ? (
                  <button
                    type="button"
                    onClick={() => onSelectModel(capableModelSwitch.id, capableModelSwitch.providerId)}
                    className="cursor-pointer rounded-sm underline decoration-dotted underline-offset-2 transition hover:text-text-primary"
                  >
                    Switch to {capableModelSwitch.label}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="relative px-1 pt-0.5" ref={fieldRef}>
              {plugins.isOpen ? (
                <PluginMentionAutocompleteList
                  activeIndex={plugins.activeIndex}
                  listboxId={plugins.listboxId}
                  onHover={plugins.setActiveIndex}
                  onSelect={plugins.select}
                  suggestions={plugins.suggestions}
                />
              ) : null}
              {mentions.isOpen ? (
                <MentionAutocompleteList
                  activeIndex={mentions.activeIndex}
                  anchorRef={fieldRef}
                  listboxId={mentions.listboxId}
                  onHover={mentions.setActiveIndex}
                  onSelect={mentions.select}
                  suggestions={mentions.suggestions}
                />
              ) : null}
              {commands.isOpen ? (
                <CommandAutocompleteList
                  activeIndex={commands.activeIndex}
                  anchorRef={fieldRef}
                  listboxId={commands.listboxId}
                  onHover={commands.setActiveIndex}
                  onSelect={commands.select}
                  suggestions={commands.suggestions}
                />
              ) : null}
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => {
                  onChange(e.target.value);
                  syncPickerCarets();
                  if (pendingDeleteId) {
                    setPendingDeleteId(null);
                  }
                }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onScroll={syncScrollEdges}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                onSelect={syncPickerCarets}
                onClick={syncPickerCarets}
                onBlur={() => {
                  onComposerFocusChange(false);
                  mentions.dismiss();
                  commands.dismiss();
                }}
                onFocus={() => {
                  onComposerFocusChange(true);
                  // Blur used to permanently disarm completion.
                  mentions.rearm();
                }}
                disabled={disabled}
                rows={1}
                aria-label="Message"
                role="combobox"
                aria-expanded={mentions.isOpen || commands.isOpen}
                aria-controls={
                  mentions.isOpen
                    ? mentions.listboxId
                    : commands.isOpen
                      ? commands.listboxId
                      : undefined
                }
                aria-activedescendant={mentions.activeOptionId ?? commands.activeOptionId}
                aria-autocomplete="list"
                // "Do anything", not "Message…": the composer drives tools and
                // file edits, not just chat, and the reference names the
                // capability rather than the widget. While a turn is live the
                // placeholder becomes the one sentence this state needs — the
                // next message will not start a second stream, it will queue.
                placeholder={
                  disabled
                    ? 'Select or start a conversation'
                    : isStreaming
                      ? queuedCount > 0
                        ? 'Queued — add another, or Esc to stop'
                        : 'Atlas is replying — your message will queue'
                      : 'Do anything'
                }
                // Bare textarea per spec §4: no inner bg, border, or focus ring —
                // the slab itself is the only chrome.
                className="max-h-composer-max-height min-h-12 w-full resize-none border-0 bg-transparent px-0 py-1 text-md leading-6 text-text-primary shadow-none outline-none ring-0 placeholder:text-text-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                style={textareaMask ? { maskImage: textareaMask, WebkitMaskImage: textareaMask } : undefined}
                name="message"
              />
            </div>

            {/* Control row: plain glyph buttons left, model chip + send right.
                `-mx-1` pulls the 32px round buttons out so their glyphs land on
                the same 18px inset as the text above them. */}
            <div className="-mx-1 flex items-center gap-0.5 pt-1.5">
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild disabled={!canAttach}>
                      <button
                        type="button"
                        aria-label="Add to message"
                        className="group flex size-8 shrink-0 items-center justify-center rounded-full text-text-secondary transition hover:bg-bg-hover hover:text-text-primary data-[state=open]:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Plus className="size-4" strokeWidth={1.75} />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Attach files or a visual — up to {MAX_ATTACHMENT_COUNT} files, {MAX_ATTACHMENT_SIZE_MB} MB each
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent
                  align="start"
                  side="top"
                  sideOffset={6}
                  className="w-[220px] rounded-lg border border-border-default bg-bg-overlay p-1"
                >
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 px-2.5 py-2 text-sm"
                    onSelect={attachments.openFileDialog}
                  >
                    <Paperclip className="size-4" strokeWidth={1.75} />
                    Attach files
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 px-2.5 py-2 text-sm"
                    onSelect={onOpenGallery}
                  >
                    <ImagePlus className="size-4" strokeWidth={1.75} />
                    Visual gallery
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* One chip, one menu — the mode and the permission ladder are
                  the same decision made twice, so they share a surface with
                  the sidebar heading rather than each owning a picker. */}
              <WorkspaceAccessChip
                mode={workspaceMode}
                ready={workspaceReady}
                permissionMode={toolPermissionMode}
                disabled={isStreaming || selectedModel?.supportsTools === false}
                onModeChange={onWorkspaceModeChange}
                onPermissionModeChange={onToolPermissionModeChange}
                onPresetSelect={onPermissionPresetSelect}
                onRequestProject={onRequestProject}
              />

              {showStopHint ? (
                <span
                  aria-live="polite"
                  className="ml-1 min-w-0 truncate text-2xs text-text-tertiary"
                  role="status"
                >
                  Esc to stop
                </span>
              ) : null}

              <div className="ml-auto flex min-w-0 items-center gap-0.5">
                {/* An untouched conversation has nothing to report, and the
                    ring drew an empty grey circle beside the model name — a
                    control that looks broken rather than idle. It appears with
                    the first token spent. */}
                {contextStats && contextStats.usedTokens > 0 ? (
                  <Context
                    maxTokens={contextStats.maxTokens}
                    usedTokens={contextStats.usedTokens}
                    breakdown={contextStats.breakdown}
                    usage={contextStats.usage}
                    modelId={contextStats.modelId}
                    compactionThresholdPercent={contextStats.compactionThresholdPercent}
                    compactionThresholdTokens={contextStats.compactionThresholdTokens}
                    onCompactionThresholdChange={handleCompactionThresholdChange}
                    onCompactNow={handleCompactNow}
                  >
                    <ContextTrigger />
                    <ContextContent>
                      <ContextContentHeader />
                      <ContextContentBody />
                      <ContextContentFooter />
                    </ContextContent>
                  </Context>
                ) : null}

                {/* One chip, one chevron, one menu — reasoning effort now lives
                    inside that menu instead of as a second word beside it. */}
                <ModelSelector
                  models={models}
                  selectedModelId={selectedModelId}
                  selectedProviderId={selectedProviderId}
                  disabled={isStreaming}
                  open={modelPickerOpen}
                  onOpenChange={onModelPickerOpenChange}
                  onSelect={(modelId, providerId) => {
                    onModelPickerOpenChange(false);
                    onSelectModel(modelId, providerId);
                  }}
                  onRefresh={onRefreshModels}
                  isRefreshing={isRefreshingModels}
                  customProviders={customProviders}
                  credentials={credentials}
                  defaultFreeOnly={defaultFreeOnly}
                  onManageProviders={onManageProviders}
                  reasoningEffort={reasoningEffort}
                  reasoningSupported={Boolean(selectedModel?.supportsReasoning)}
                  onReasoningEffortChange={onReasoningEffortChange}
                />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={isStreaming ? 'Stop generating' : 'Send message'}
                      // `aria-disabled` rather than `disabled`: a disabled button
                      // swallows pointer events, so its tooltip — the only place
                      // the block is explained — would never open.
                      aria-disabled={isStreaming ? false : !canSend}
                      onClick={() => {
                        if (isStreaming) {
                          onAbort();
                          return;
                        }
                        if (!canSend) return;
                        void submit();
                      }}
                      className={cn(
                        'ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-bg-button text-text-inverse shadow-sm transition-all duration-150 ease-out hover:bg-bg-button-hover motion-reduce:transition-colors',
                        // Press physics only when the button can actually act.
                        // It uses aria-disabled rather than `disabled` so its
                        // tooltip stays reachable, which means the `enabled:`
                        // variant is always on — the gate has to be canSend.
                        canSend
                          ? 'hover:scale-105 active:scale-95 active:shadow-none'
                          : 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50'
                      )}
                    >
                      {isStreaming ? (
                        <Square className="size-3 fill-current" />
                      ) : isSubmitting ? (
                        <AtlasLoader size="sm" className="size-4 text-text-inverse" />
                      ) : (
                        <ArrowUp className="size-4" strokeWidth={2.25} />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{sendTooltip}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
