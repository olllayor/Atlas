import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_INTERFACE_FONT_SIZE,
  DEFAULT_PANEL_ANIMATION_DURATION_MS,
  DEFAULT_PROMPT_FONT_SIZE,
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MAX_PANEL_ANIMATION_DURATION_MS,
  MAX_PROMPT_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
  MIN_PANEL_ANIMATION_DURATION_MS,
  MIN_PROMPT_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  DEFAULT_SETTINGS_APPEARANCE,
} from "../src/shared/contracts";
import {
  areFontAdvancesMonospace,
  cssFontFamilies,
  applyAppearanceFontVariables,
} from "../src/renderer/lib/appearanceFonts";

test("cssFontFamilies quotes names with spaces and formats list", () => {
  assert.equal(cssFontFamilies("Instrument Sans"), '"Instrument Sans"');
  assert.equal(cssFontFamilies("Geist Mono, Menlo, monospace"), '"Geist Mono", Menlo, monospace');
  assert.equal(cssFontFamilies(""), null);
});

test("areFontAdvancesMonospace detects monospace advances within tolerance", () => {
  assert.equal(areFontAdvancesMonospace([10, 10, 10, 10]), true);
  assert.equal(areFontAdvancesMonospace([10, 10.005, 10]), true);
  assert.equal(areFontAdvancesMonospace([10, 12, 10]), false);
});

test("applyAppearanceFontVariables stamps CSS custom properties on root element", () => {
  const styles: Record<string, string> = {};
  const mockRoot = {
    style: {
      setProperty: (k: string, v: string) => {
        styles[k] = v;
      },
      removeProperty: (k: string) => {
        delete styles[k];
      },
    },
  } as unknown as HTMLElement;

  applyAppearanceFontVariables(mockRoot, {
    panelAnimationDurationMs: 150,
    fontFamilySans: "Instrument Sans",
    fontSizeInterface: 17,
    fontFamilyComposer: "Geist Mono",
    fontSizePrompt: 16,
    fontFamilyCode: "SF Mono",
    fontSizeCode: 14,
    fontFamilyTerminal: "Menlo",
    fontSizeTerminal: 13,
    fontSmoothing: true,
  });

  assert.equal(styles["--panel-animation-duration"], "150ms");
  assert.equal(styles["--ui-font-size"], "17px");
  assert.equal(styles["--font-size-prompt"], "16px");
  assert.equal(styles["--code-font-size"], "14px");
  assert.equal(styles["--font-size-terminal"], "13px");
  assert.equal(styles["-webkit-font-smoothing"], "antialiased");
  assert.ok(styles["--font-sans"].includes('"Instrument Sans"'));
  assert.ok(styles["--font-composer"].includes('"Geist Mono"'));
  assert.ok(styles["--font-mono"].includes('"SF Mono"'));
  assert.ok(styles["--font-terminal"].includes('Menlo'));
});

test("DEFAULT_SETTINGS_APPEARANCE has accurate T3-aligned defaults", () => {
  assert.equal(DEFAULT_SETTINGS_APPEARANCE.panelAnimationDurationMs, DEFAULT_PANEL_ANIMATION_DURATION_MS);
  assert.equal(DEFAULT_SETTINGS_APPEARANCE.fontSizeInterface, DEFAULT_INTERFACE_FONT_SIZE);
  assert.equal(DEFAULT_SETTINGS_APPEARANCE.fontSizePrompt, DEFAULT_PROMPT_FONT_SIZE);
  assert.equal(DEFAULT_SETTINGS_APPEARANCE.fontSizeCode, DEFAULT_CODE_FONT_SIZE);
  assert.equal(DEFAULT_SETTINGS_APPEARANCE.fontSizeTerminal, DEFAULT_TERMINAL_FONT_SIZE);
  assert.equal(DEFAULT_SETTINGS_APPEARANCE.fontSmoothing, true);
});
