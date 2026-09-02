import { cn } from '../../lib/utils';
import { AtlasMark } from './atlas-mark';

type AtlasLoaderProps = {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  variant?: 'solid' | 'outline';
  /** Use the real 3D keycap PNG (sharp at 48px+). Flat geometry stays for ≤24px. */
  real?: boolean;
};

/**
 * Branded loader. Replaces generic ring spinners where the state belongs to
 * Atlas itself (conversation load, history pagination) rather than to a
 * third-party operation (model refresh, plugin health). The mark breathes
 * instead of spinning - the square keycap reads badly at rotation and the
 * pulse matches the transcript's shimmer phase (2s).
 *
 * Pass `real` for the centred empty state (≥40px). The 256px PNG is still
 * crisp at 88px and carries the lighting the flat SVG flattens away.
 */
export function AtlasLoader({ size = 'md', className, variant = 'outline', real }: AtlasLoaderProps) {
  const sizeClasses = {
    sm: 'h-3.5 w-3.5',
    md: 'h-8 w-8',
    lg: 'h-10 w-10',
  }[size];

    // Transparent keycap for the centred loader. The dock icon keeps its baked
  // grey backdrop, but inside the window it has to float. `icon-transparent`
  // is the same 1024 render with the backdrop flood-filled to 0 via the
  // GrokBot contour trick (thr 12).
  if (real) {
    const iconUrl = new URL('../../assets/icon-transparent.png', import.meta.url).href;
    return (
      <img
        src={iconUrl}
        alt=""
        aria-hidden
        draggable={false}
        className={cn(sizeClasses, 'motion-logo-breathe select-none', className)}
        style={{ objectFit: 'contain', filter: 'drop-shadow(0 10px 22px rgba(0,0,0,0.45))' }}
      />
    );
  }

  return (
    <AtlasMark
      variant={variant}
      className={cn(sizeClasses, 'motion-logo-breathe text-text-tertiary', className)}
      aria-hidden
    />
  );
}

/**
 * Inline row used inside text (e.g. "Loading earlier messages").
 * Keeps baseline alignment with the label.
 */
export function AtlasLoaderRow({ label = 'Loading earlier messages', size = 'sm' }: { label?: string; size?: 'sm' | 'md' }) {
  return (
    <span className="inline-flex items-center gap-2 text-2xs text-text-faint">
      <AtlasLoader size={size} className="shrink-0" />
      {label}
    </span>
  );
}
