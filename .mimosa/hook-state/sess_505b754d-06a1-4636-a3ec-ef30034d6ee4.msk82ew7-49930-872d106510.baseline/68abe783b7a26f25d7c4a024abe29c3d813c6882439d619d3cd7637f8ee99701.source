import { execFile } from 'node:child_process';
import { readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * An application's real icon, read out of its bundle.
 *
 * Electron's `app.getFileIcon` is the obvious tool here and it does not work:
 * on macOS it answers with the generic application badge for every bundle
 * regardless of `size` (`large` is not even a supported size on that platform),
 * so a menu of seven editors came back as seven identical grey squares. Going
 * to the bundle directly gets the actual mark, which is the entire point of
 * showing an icon rather than a label.
 *
 * macOS only. Every other platform still has `getFileIcon`.
 */

/** `CFBundleIconFile` is stored with or without its extension, depending on the app. */
export function normalizeIcnsName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.toLowerCase().endsWith('.icns') ? trimmed : `${trimmed}.icns`;
}

/**
 * Which `.icns` in `Contents/Resources` is the application's own.
 *
 * `Info.plist` is the authority, but plenty of bundles ship a dozen document
 * icons beside the app icon, so the fallback matches the bundle's own name
 * before it settles for whatever is first alphabetically.
 */
export async function resolveIcnsPath(bundlePath: string): Promise<string | null> {
  const resources = join(bundlePath, 'Contents', 'Resources');

  let declared = '';
  try {
    const { stdout } = await run('plutil', [
      '-extract',
      'CFBundleIconFile',
      'raw',
      '-o',
      '-',
      join(bundlePath, 'Contents', 'Info.plist')
    ]);
    declared = normalizeIcnsName(stdout);
  } catch {
    // No such key, or an unreadable plist: fall through to the directory scan.
  }

  let entries: string[];
  try {
    entries = await readdir(resources);
  } catch {
    return null;
  }

  const icns = entries.filter((entry) => entry.toLowerCase().endsWith('.icns'));
  if (icns.length === 0) return null;

  if (declared && icns.includes(declared)) {
    return join(resources, declared);
  }

  const bundleName = normalizeIcnsName(basename(bundlePath, '.app'));
  const byName = icns.find((entry) => entry.toLowerCase() === bundleName.toLowerCase());

  return join(resources, byName ?? icns.sort()[0]!);
}

let conversionCounter = 0;

/**
 * `.icns` → a PNG `data:` URL.
 *
 * `sips` is the converter because it ships with macOS and reads the format
 * natively; `nativeImage` cannot open `.icns` at all. 64px is twice the size the
 * menu draws, so it stays sharp on a 2x display without carrying a 1024px
 * master through IPC.
 */
export async function readAppIcon(bundlePath: string): Promise<string | null> {
  if (process.platform !== 'darwin') return null;

  const icnsPath = await resolveIcnsPath(bundlePath);
  if (!icnsPath) return null;

  conversionCounter += 1;
  const outPath = join(tmpdir(), `atlas-appicon-${process.pid}-${conversionCounter}.png`);

  try {
    await run('sips', ['-s', 'format', 'png', '-Z', '64', icnsPath, '--out', outPath]);
    const png = await readFile(outPath);
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  } finally {
    await rm(outPath, { force: true }).catch(() => undefined);
  }
}
