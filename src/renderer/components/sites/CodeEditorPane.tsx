import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  CheckIcon,
  CopyIcon,
  FileTextIcon,
} from '@radix-ui/react-icons';
import { Loader2 } from 'lucide-react';

export interface CodeEditorPaneProps {
  filePath: string | null;
  contents: string | null;
  dirty: boolean;
  isBusy: boolean;
  onContentsChange: (contents: string) => void;
  onSave: () => Promise<void>;
  className?: string;
  autoFocus?: boolean;
}

export const CodeEditorPane: React.FC<CodeEditorPaneProps> = ({
  filePath,
  contents,
  dirty,
  isBusy,
  onContentsChange,
  onSave,
  className = '',
  autoFocus = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // Line numbers calculation
  const lines = (contents ?? '').split('\n');
  const lineCount = lines.length;

  // Handle Tab indentation and Cmd+S keyboard shortcut
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void performSave();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;

      const nextVal = val.substring(0, start) + '  ' + val.substring(end);
      onContentsChange(nextVal);

      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
        }
      });
    }
  };

  // Perform save with local state tracking
  const performSave = useCallback(async () => {
    if (isSaving || !dirty) return;
    setIsSaving(true);
    try {
      await onSave();
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, dirty, onSave]);

  // Debounced auto-save (1.2s idle)
  useEffect(() => {
    if (!dirty || !autoSaveEnabled || isSaving) return;

    const timer = setTimeout(() => {
      void performSave();
    }, 1200);

    return () => clearTimeout(timer);
  }, [contents, dirty, autoSaveEnabled, isSaving, performSave]);

  // Sync line numbers scroll with textarea scroll
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // 1-click copy code
  const handleCopy = async () => {
    if (!contents) return;
    try {
      await navigator.clipboard.writeText(contents);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

  if (!filePath || contents == null) {
    return (
      <div className={`flex flex-col items-center justify-center h-full text-center p-8 bg-bg-surface ${className}`}>
        <FileTextIcon className="w-8 h-8 text-text-muted mb-2 opacity-50" />
        <p className="text-xs text-text-muted">Select a file from the explorer to view or edit</p>
      </div>
    );
  }

  const fileExt = filePath.split('.').pop()?.toUpperCase() ?? 'TEXT';

  return (
    <div className={`flex flex-col h-full bg-bg-surface overflow-hidden ${className}`}>
      {/* Editor Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle bg-bg-surface shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileTextIcon className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
          <span className="text-xs font-mono text-text-primary font-medium truncate">
            {filePath}
          </span>

          {/* Status Indicator */}
          {isSaving ? (
            <span className="inline-flex items-center gap-1 text-3xs font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              Saving…
            </span>
          ) : dirty ? (
            <span className="inline-flex items-center gap-1 text-3xs font-mono text-warning bg-warning/10 px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-warning" />
              Unsaved
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-3xs font-mono text-success bg-success/10 px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Saved
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Auto-save toggle */}
          <label className="flex items-center gap-1.5 text-3xs text-text-tertiary hover:text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoSaveEnabled}
              onChange={(e) => setAutoSaveEnabled(e.target.checked)}
              className="w-3 h-3 rounded border-border-subtle text-accent focus:ring-0 cursor-pointer"
            />
            <span>Auto-save</span>
          </label>

          {/* Copy Button */}
          <button
            type="button"
            onClick={handleCopy}
            title="Copy code"
            className="flex items-center gap-1 h-6 px-2 text-3xs rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition border border-border-subtle"
          >
            {copied ? (
              <>
                <CheckIcon className="w-3 h-3 text-success" />
                <span className="text-success">Copied</span>
              </>
            ) : (
              <>
                <CopyIcon className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>

          {/* Manual Save Button */}
          <button
            type="button"
            onClick={() => void performSave()}
            disabled={!dirty || isBusy || isSaving}
            className={`flex items-center gap-1 h-6 px-2.5 text-3xs font-medium rounded transition ${
              dirty && !isBusy && !isSaving
                ? 'bg-accent text-accent-foreground hover:opacity-90 shadow-xs'
                : 'bg-bg-hover text-text-muted cursor-not-allowed border border-border-subtle'
            }`}
          >
            Save
            <kbd className="hidden sm:inline-block font-mono text-[9px] opacity-75">⌘S</kbd>
          </button>
        </div>
      </div>

      {/* Editor Body: Line Numbers + Textarea */}
      <div className="flex-1 flex min-h-0 relative bg-bg-surface overflow-hidden">
        {/* Line Numbers Gutter */}
        <div
          ref={lineNumbersRef}
          aria-hidden="true"
          className="w-10 py-2.5 select-none text-right pr-2.5 bg-bg-surface border-r border-border-subtle font-mono text-xs text-text-muted opacity-40 overflow-hidden shrink-0"
        >
          {lines.map((_, i) => (
            <div key={i} className="leading-5 h-5 text-3xs">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Textarea Input */}
        <textarea
          ref={textareaRef}
          value={contents}
          onChange={(e) => onContentsChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          autoFocus={autoFocus}
          spellCheck={false}
          className="flex-1 h-full w-full resize-none p-2.5 font-mono text-xs text-text-primary bg-bg-surface border-0 focus:outline-none focus:ring-0 leading-5 whitespace-pre tab-[2] overflow-auto selection:bg-accent/20"
        />
      </div>

      {/* Editor Footer Status Bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-border-subtle bg-bg-surface text-3xs font-mono text-text-tertiary select-none shrink-0">
        <div className="flex items-center gap-3">
          <span>{fileExt}</span>
          <span>{lineCount} lines</span>
          <span>{contents.length} chars</span>
        </div>
        <div className="flex items-center gap-2">
          <span>UTF-8</span>
          <span>2 spaces</span>
        </div>
      </div>
    </div>
  );
};
