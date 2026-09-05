/**
 * Does this visual's source describe a Rive animation?
 *
 * Lives apart from `rive-visual.tsx` so callers can ask the question without
 * pulling in the Rive WebGL2 runtime. The gallery labels every saved visual
 * with it, and the transcript uses it to decide which renderer to load, so a
 * shared module would otherwise drag megabytes of runtime into both.
 */
export function detectRiveContent(content: string): boolean {
  const trimmed = content.trim().toLowerCase();
  if (trimmed.includes('.riv') || trimmed.includes('rive')) return true;
  if (trimmed.includes('"src"') && (trimmed.includes('.riv') || trimmed.includes('data:'))) return true;
  return false;
}
