import React, { useState, useRef, useCallback } from 'react';
import { Download, Plus, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { parseThemeFile, type ThemeDefinition } from '../../../shared/themePalettes';
import { saveCustomTheme, getCustomThemes } from '../../lib/themePalette';

export function ThemeImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (theme: ThemeDefinition) => void;
}) {
  const [json, setJson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.json')) {
      setError('Please upload a JSON file.');
      return;
    }
    setIsReading(true);
    setError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      setIsReading(false);
      const text = e.target?.result;
      if (typeof text === 'string') {
        setJson(text);
      }
    };
    reader.onerror = () => {
      setIsReading(false);
      setError('Failed to read file.');
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDropTarget(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleSubmit = useCallback(() => {
    if (!json.trim()) return;
    try {
      const parsed = JSON.parse(json);
      const theme = parseThemeFile(parsed);

      // Check for collision or assign unique id if needed
      const existing = getCustomThemes();
      let uniqueId = theme.id;
      let counter = 1;
      while (existing.some((t) => t.id === uniqueId)) {
        uniqueId = `${theme.id}-${counter++}`;
      }

      const finalTheme: ThemeDefinition = {
        ...theme,
        id: uniqueId,
      };

      saveCustomTheme(finalTheme);
      onImported(finalTheme);
      onOpenChange(false);
      setJson('');
      setFileName(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid theme format');
    }
  }, [json, onImported, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setError(null);
          setFileName(null);
        }
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="max-w-xl bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-primary)]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-[var(--text-primary)]">
            Add a theme
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--text-muted)]">
            Import a theme JSON file or paste its definition below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* File Dropzone */}
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              setIsDropTarget(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDropTarget(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDropTarget(false);
            }}
            onDrop={handleDrop}
            className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-3 transition-colors ${
              isDropTarget
                ? 'border-[var(--ring)] bg-[var(--accent-surface)]'
                : 'border-[var(--border-default)] bg-[var(--bg-base)]'
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-[var(--text-primary)]">Theme file</p>
              <p className="truncate text-[11px] text-[var(--text-muted)]">
                {fileName ?? 'Drop a .json theme file here'}
              </p>
            </div>
            <Button
              disabled={isReading}
              size="sm"
              variant="outline"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-7 text-xs border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)]"
            >
              <Download className="mr-1 size-3.5" />
              {isReading ? 'Reading…' : 'Choose file'}
            </Button>
            <input
              ref={fileInputRef}
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
              type="file"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-[var(--border-subtle)]" />
            <span className="text-[10px] font-medium tracking-wider uppercase text-[var(--text-muted)]">
              or paste theme json
            </span>
            <div className="h-px flex-1 bg-[var(--border-subtle)]" />
          </div>

          {/* JSON Textarea */}
          <div className="space-y-1.5">
            <textarea
              id="theme-json-editor"
              rows={8}
              value={json}
              onChange={(e) => {
                setJson(e.target.value);
                if (error) setError(null);
              }}
              placeholder={`{\n  "label": "My Custom Theme",\n  "appearance": "dark",\n  "colors": {\n    "canvas": "#0f172a",\n    "accent": "#38bdf8"\n  }\n}`}
              className="w-full resize-none rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-2.5 font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--ring)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--error-surface)] bg-[var(--error-surface)] p-2 text-xs text-[var(--error)]">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => onOpenChange(false)}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!json.trim() || isReading}
              onClick={handleSubmit}
              className="text-xs bg-[var(--bg-button)] text-[var(--text-inverse)] hover:bg-[var(--bg-button-hover)]"
            >
              <Plus className="mr-1 size-3.5" />
              Add theme
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
