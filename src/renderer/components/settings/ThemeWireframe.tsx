import type { ThemePreviewRole } from '../../../shared/themePalettes';

export type ThemeWireframeColors = Readonly<Record<ThemePreviewRole, string>>;

function isLightBg(color: string): boolean {
  if (!color) return false;
  const trimmed = color.trim().toLowerCase();
  if (trimmed === '#fff' || trimmed === '#ffffff' || trimmed === 'white') return true;
  if (trimmed === '#000' || trimmed === '#000000' || trimmed === 'black') return false;
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    const num = parseInt(hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex, 16);
    if (!Number.isNaN(num)) {
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
    }
  }
  if (trimmed.includes('oklch')) {
    const match = trimmed.match(/oklch\(\s*([\d.]+)/);
    if (match && match[1]) {
      return parseFloat(match[1]) > 0.6;
    }
  }
  return false;
}

export function ThemeWireframePane({
  colors,
  clip,
}: {
  colors: ThemeWireframeColors;
  clip?: 'left' | 'right' | undefined;
}) {
  const isLight = isLightBg(colors.canvas);
  const line = isLight ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.08)';
  const pillBg = isLight ? '#f4f4f5' : 'rgba(255, 255, 255, 0.08)';
  const textLine = isLight ? '#e4e4e7' : 'rgba(255, 255, 255, 0.14)';
  const cardBg = isLight ? '#ffffff' : (colors.surface || '#18181b');
  const accentDot = colors.accent || '#6366f1';

  return (
    <span
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={
        clip === undefined
          ? undefined
          : {
              clipPath:
                clip === 'left'
                  ? 'polygon(0 0, 50% 0, 50% 100%, 0 100%)'
                  : 'polygon(50% 0, 100% 0, 100% 100%, 50% 100%)',
            }
      }
    >
      {/* Canvas */}
      <span className="absolute inset-0" style={{ backgroundColor: colors.canvas }} />

      {/* Sidebar */}
      <span
        className="absolute inset-y-0 left-0 w-[24%]"
        style={{
          backgroundColor: colors.sidebar,
          boxShadow: `inset -1px 0 0 ${line}`,
        }}
      />

      {/* Sidebar: search pill & thread rows */}
      <span
        className="absolute left-[3%] top-[8%] h-[8%] w-[18%] rounded-md"
        style={{
          backgroundColor: isLight ? '#ffffff' : pillBg,
          boxShadow: `inset 0 0 0 1px ${line}`,
        }}
      />
      <span
        className="absolute left-[3%] top-[22%] h-[7%] w-[18%] rounded-md"
        style={{ backgroundColor: colors.accentSurface || pillBg }}
      />
      <span
        className="absolute left-[3%] top-[32%] h-[7%] w-[18%] rounded-md"
        style={{ backgroundColor: pillBg }}
      />
      <span
        className="absolute left-[3%] top-[42%] h-[7%] w-[18%] rounded-md"
        style={{ backgroundColor: pillBg, opacity: 0.7 }}
      />

      {/* Conversation message bubble & lines */}
      <span
        className="absolute left-[29%] top-[10%] h-[9%] w-[28%] rounded-lg"
        style={{ backgroundColor: pillBg }}
      />
      <span
        className="absolute left-[29%] top-[26%] h-[5%] w-[38%] rounded-sm"
        style={{ backgroundColor: textLine }}
      />
      <span
        className="absolute left-[29%] top-[36%] h-[5%] w-[26%] rounded-sm"
        style={{ backgroundColor: textLine }}
      />

      {/* Floating assistant island */}
      <span
        className="absolute right-[5%] top-[8%] h-[46%] w-[21%] rounded-lg"
        style={{
          backgroundColor: cardBg,
          boxShadow: isLight
            ? '0 3px 10px rgba(0, 0, 0, 0.07), inset 0 0 0 1px rgba(0, 0, 0, 0.06)'
            : '0 3px 10px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
        }}
      >
        {[0, 1, 2].map((row) => (
          <span
            className="absolute left-[11%] right-[11%] flex items-center gap-[6%]"
            key={row}
            style={{ top: `${12 + row * 28}%`, height: '20%' }}
          >
            <span
              className="block aspect-square h-[26%] rounded-full shrink-0"
              style={{
                backgroundColor:
                  row === 0 ? '#10b981' : row === 1 ? accentDot : '#f59e0b',
              }}
            />
            <span
              className="block h-[28%] w-[54%] rounded-sm"
              style={{ backgroundColor: textLine }}
            />
          </span>
        ))}
      </span>

      {/* Composer bar */}
      <span
        className="absolute bottom-[8%] left-[29%] right-[6%] flex h-[15%] items-center justify-between rounded-md px-[2.5%]"
        style={{
          backgroundColor: isLight ? '#ffffff' : pillBg,
          boxShadow: `inset 0 0 0 1px ${line}`,
        }}
      >
        <span
          className="block h-[24%] w-[34%] rounded-full"
          style={{ backgroundColor: textLine }}
        />
        <span
          className="block aspect-square h-[56%] rounded-full"
          style={{ backgroundColor: accentDot }}
        />
      </span>
    </span>
  );
}

export function ThemeWireframe({
  light,
  dark,
  active,
}: {
  light: ThemeWireframeColors;
  dark: ThemeWireframeColors;
  active: 'system' | 'light' | 'dark';
}) {
  return (
    <span
      className="relative block aspect-[16/10] w-full overflow-hidden rounded-md border border-[var(--border-subtle)]"
      aria-hidden
    >
      {active === 'light' ? (
        <ThemeWireframePane colors={light} />
      ) : active === 'dark' ? (
        <ThemeWireframePane colors={dark} />
      ) : (
        <>
          <ThemeWireframePane colors={light} clip="left" />
          <span
            className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--border-subtle)] opacity-80 z-10"
            aria-hidden
          />
          <ThemeWireframePane colors={dark} clip="right" />
        </>
      )}
    </span>
  );
}
