import { Undo2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_INTERFACE_FONT_SIZE,
  DEFAULT_PROMPT_FONT_SIZE,
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MAX_PROMPT_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
  MIN_PROMPT_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  type SettingsAppearanceSummary,
} from "../../../shared/contracts";
import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "../../lib/appearanceFonts";
import { Switch } from "../ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { FontFamilyPicker } from "./FontFamilyPicker";
import { CodeFontPreview, PromptFontPreview, TerminalFontPreview } from "./SettingsFontPreviews";

function SettingResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={"Reset " + label}
      title={"Reset " + label + " to default"}
      onClick={onClick}
      className="inline-flex size-4 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] cursor-pointer"
    >
      <Undo2 className="size-3" />
    </button>
  );
}

function FontSizeSelect({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (px: number) => void;
}) {
  const options = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  return (
    <Select value={String(value)} onValueChange={(val) => onChange(Number(val))}>
      <SelectTrigger size="sm" className="w-20 shrink-0 text-xs">
        <SelectValue>{value} px</SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="max-h-56">
        {options.map((px) => (
          <SelectItem key={px} value={String(px)} className="text-xs">
            {px} px
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TypographyRow({
  title,
  description,
  resetAction,
  control,
  children,
}: {
  title: string;
  description: string;
  resetAction?: ReactNode;
  control: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-[var(--text-primary)]">{title}</span>
            {resetAction}
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{description}</div>
        </div>
        <div className="shrink-0">{control}</div>
      </div>
      {children}
    </div>
  );
}

export function SettingsTypographySection({
  appearance,
  onAppearancePatch,
}: {
  appearance: SettingsAppearanceSummary;
  onAppearancePatch: (patch: Partial<SettingsAppearanceSummary>) => void;
}) {
  const [advanced, setAdvanced] = useState(() => {
    try {
      return localStorage.getItem(TYPOGRAPHY_ADVANCED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const handleToggleAdvanced = (checked: boolean) => {
    setAdvanced(checked);
    try {
      localStorage.setItem(TYPOGRAPHY_ADVANCED_STORAGE_KEY, String(checked));
    } catch {}
  };

  const sansFamily = appearance.fontFamilySans ?? "";
  const composerFamily = appearance.fontFamilyComposer ?? "";
  const codeFamily = appearance.fontFamilyCode ?? "";
  const terminalFamily = appearance.fontFamilyTerminal ?? "";

  const interfaceSize = appearance.fontSizeInterface ?? DEFAULT_INTERFACE_FONT_SIZE;
  const promptSize = appearance.fontSizePrompt ?? DEFAULT_PROMPT_FONT_SIZE;
  const codeSize = appearance.fontSizeCode ?? DEFAULT_CODE_FONT_SIZE;
  const terminalSize = appearance.fontSizeTerminal ?? DEFAULT_TERMINAL_FONT_SIZE;
  const fontSmoothing = appearance.fontSmoothing !== false;

  return (
    <section className="border-t border-[var(--border-subtle)] pt-6">
      {/* Header with Advanced switch */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-md font-semibold text-[var(--text-primary)]">Typography</h3>
          <p className="text-xs text-[var(--text-secondary)]">
            Configure interface, editor, code and terminal typefaces.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
          <span>Advanced</span>
          <Switch checked={advanced} onCheckedChange={handleToggleAdvanced} aria-label="Toggle advanced typography" />
        </label>
      </div>

      <div className="divide-y divide-[var(--border-subtle)]">
        {!advanced ? (
          /* Simple View: Interface font + Monospace font */
          <>
            <TypographyRow
              title="Interface font"
              description="Font for the user interface and prompt composer."
              resetAction={
                sansFamily !== "" || interfaceSize !== DEFAULT_INTERFACE_FONT_SIZE ? (
                  <SettingResetButton
                    label="interface font"
                    onClick={() =>
                      onAppearancePatch({
                        fontFamilySans: "",
                        fontSizeInterface: DEFAULT_INTERFACE_FONT_SIZE,
                        uiFontFamily: null,
                        uiFontSize: DEFAULT_INTERFACE_FONT_SIZE,
                      })
                    }
                  />
                ) : null
              }
              control={
                <div className="flex items-center gap-2">
                  <FontFamilyPicker
                    value={sansFamily}
                    placeholder="System sans"
                    onSelect={(fam) =>
                      onAppearancePatch({
                        fontFamilySans: fam,
                        uiFontFamily: fam || null,
                      })
                    }
                  />
                  <FontSizeSelect
                    value={interfaceSize}
                    min={MIN_INTERFACE_FONT_SIZE}
                    max={MAX_INTERFACE_FONT_SIZE}
                    onChange={(px) =>
                      onAppearancePatch({
                        fontSizeInterface: px,
                        uiFontSize: px,
                      })
                    }
                  />
                </div>
              }
            >
              <PromptFontPreview family={sansFamily} size={promptSize} />
            </TypographyRow>

            <TypographyRow
              title="Monospace font"
              description="Code blocks, diffs, file previews, and the terminal."
              resetAction={
                codeFamily !== "" || codeSize !== DEFAULT_CODE_FONT_SIZE ? (
                  <SettingResetButton
                    label="monospace font"
                    onClick={() =>
                      onAppearancePatch({
                        fontFamilyCode: "",
                        fontSizeCode: DEFAULT_CODE_FONT_SIZE,
                        codeFontFamily: null,
                        codeFontSize: DEFAULT_CODE_FONT_SIZE,
                      })
                    }
                  />
                ) : null
              }
              control={
                <div className="flex items-center gap-2">
                  <FontFamilyPicker
                    value={codeFamily}
                    placeholder="System mono"
                    requireMonospace
                    onSelect={(fam) =>
                      onAppearancePatch({
                        fontFamilyCode: fam,
                        codeFontFamily: fam || null,
                      })
                    }
                  />
                  <FontSizeSelect
                    value={codeSize}
                    min={MIN_CODE_FONT_SIZE}
                    max={MAX_CODE_FONT_SIZE}
                    onChange={(px) =>
                      onAppearancePatch({
                        fontSizeCode: px,
                        codeFontSize: px,
                      })
                    }
                  />
                </div>
              }
            >
              <CodeFontPreview family={codeFamily} size={codeSize} />
              <TerminalFontPreview family={codeFamily} size={codeSize} />
            </TypographyRow>

            <TypographyRow
              title="Font smoothing"
              description="Render text with thinner grayscale anti-aliasing instead of macOS&#39;s heavier default."
              resetAction={
                !fontSmoothing ? (
                  <SettingResetButton
                    label="font smoothing"
                    onClick={() => onAppearancePatch({ fontSmoothing: true })}
                  />
                ) : null
              }
              control={
                <Switch
                  checked={fontSmoothing}
                  onCheckedChange={(checked) => onAppearancePatch({ fontSmoothing: checked })}
                  aria-label="Toggle font smoothing"
                />
              }
            />
          </>
        ) : (
          /* Advanced View: Interface, Prompt, Code, Terminal, Font smoothing */
          <>
            <TypographyRow
              title="Interface font"
              description="Everything outside code blocks and the terminal."
              resetAction={
                sansFamily !== "" || interfaceSize !== DEFAULT_INTERFACE_FONT_SIZE ? (
                  <SettingResetButton
                    label="interface font"
                    onClick={() =>
                      onAppearancePatch({
                        fontFamilySans: "",
                        fontSizeInterface: DEFAULT_INTERFACE_FONT_SIZE,
                        uiFontFamily: null,
                        uiFontSize: DEFAULT_INTERFACE_FONT_SIZE,
                      })
                    }
                  />
                ) : null
              }
              control={
                <div className="flex items-center gap-2">
                  <FontFamilyPicker
                    value={sansFamily}
                    placeholder="System sans"
                    onSelect={(fam) =>
                      onAppearancePatch({
                        fontFamilySans: fam,
                        uiFontFamily: fam || null,
                      })
                    }
                  />
                  <FontSizeSelect
                    value={interfaceSize}
                    min={MIN_INTERFACE_FONT_SIZE}
                    max={MAX_INTERFACE_FONT_SIZE}
                    onChange={(px) =>
                      onAppearancePatch({
                        fontSizeInterface: px,
                        uiFontSize: px,
                      })
                    }
                  />
                </div>
              }
            />

            <TypographyRow
              title="Prompt font"
              description="Only the box you write prompts in. Mono works well here."
              resetAction={
                composerFamily !== "" || promptSize !== DEFAULT_PROMPT_FONT_SIZE ? (
                  <SettingResetButton
                    label="prompt font"
                    onClick={() =>
                      onAppearancePatch({
                        fontFamilyComposer: "",
                        fontSizePrompt: DEFAULT_PROMPT_FONT_SIZE,
                      })
                    }
                  />
                ) : null
              }
              control={
                <div className="flex items-center gap-2">
                  <FontFamilyPicker
                    value={composerFamily}
                    placeholder={sansFamily || "System sans"}
                    onSelect={(fam) =>
                      onAppearancePatch({
                        fontFamilyComposer: fam,
                      })
                    }
                  />
                  <FontSizeSelect
                    value={promptSize}
                    min={MIN_PROMPT_FONT_SIZE}
                    max={MAX_PROMPT_FONT_SIZE}
                    onChange={(px) =>
                      onAppearancePatch({
                        fontSizePrompt: px,
                      })
                    }
                  />
                </div>
              }
            >
              <PromptFontPreview family={composerFamily || sansFamily} size={promptSize} />
            </TypographyRow>

            <TypographyRow
              title="Code font"
              description="Code blocks, diffs, and file previews."
              resetAction={
                codeFamily !== "" || codeSize !== DEFAULT_CODE_FONT_SIZE ? (
                  <SettingResetButton
                    label="code font"
                    onClick={() =>
                      onAppearancePatch({
                        fontFamilyCode: "",
                        fontSizeCode: DEFAULT_CODE_FONT_SIZE,
                        codeFontFamily: null,
                        codeFontSize: DEFAULT_CODE_FONT_SIZE,
                      })
                    }
                  />
                ) : null
              }
              control={
                <div className="flex items-center gap-2">
                  <FontFamilyPicker
                    value={codeFamily}
                    placeholder="System mono"
                    requireMonospace
                    onSelect={(fam) =>
                      onAppearancePatch({
                        fontFamilyCode: fam,
                        codeFontFamily: fam || null,
                      })
                    }
                  />
                  <FontSizeSelect
                    value={codeSize}
                    min={MIN_CODE_FONT_SIZE}
                    max={MAX_CODE_FONT_SIZE}
                    onChange={(px) =>
                      onAppearancePatch({
                        fontSizeCode: px,
                        codeFontSize: px,
                      })
                    }
                  />
                </div>
              }
            >
              <CodeFontPreview family={codeFamily} size={codeSize} />
            </TypographyRow>

            <TypographyRow
              title="Terminal font"
              description="Terminal output, independent from code blocks and diffs."
              resetAction={
                terminalFamily !== "" || terminalSize !== DEFAULT_TERMINAL_FONT_SIZE ? (
                  <SettingResetButton
                    label="terminal font"
                    onClick={() =>
                      onAppearancePatch({
                        fontFamilyTerminal: "",
                        fontSizeTerminal: DEFAULT_TERMINAL_FONT_SIZE,
                      })
                    }
                  />
                ) : null
              }
              control={
                <div className="flex items-center gap-2">
                  <FontFamilyPicker
                    value={terminalFamily}
                    placeholder={codeFamily || "System mono"}
                    requireMonospace
                    onSelect={(fam) =>
                      onAppearancePatch({
                        fontFamilyTerminal: fam,
                      })
                    }
                  />
                  <FontSizeSelect
                    value={terminalSize}
                    min={MIN_TERMINAL_FONT_SIZE}
                    max={MAX_TERMINAL_FONT_SIZE}
                    onChange={(px) =>
                      onAppearancePatch({
                        fontSizeTerminal: px,
                      })
                    }
                  />
                </div>
              }
            >
              <TerminalFontPreview family={terminalFamily || codeFamily} size={terminalSize} />
            </TypographyRow>

            <TypographyRow
              title="Font smoothing"
              description="Render text with thinner grayscale anti-aliasing instead of macOS&#39;s heavier default."
              resetAction={
                !fontSmoothing ? (
                  <SettingResetButton
                    label="font smoothing"
                    onClick={() => onAppearancePatch({ fontSmoothing: true })}
                  />
                ) : null
              }
              control={
                <Switch
                  checked={fontSmoothing}
                  onCheckedChange={(checked) => onAppearancePatch({ fontSmoothing: checked })}
                  aria-label="Toggle font smoothing"
                />
              }
            />
          </>
        )}
      </div>
    </section>
  );
}
