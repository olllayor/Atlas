import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Source-level, because the thing under test is a bootstrap-time call into
 * Electron that a Node test cannot make. Both invariants below were once
 * broken, and the symptom was nowhere near the cause: six modules each called
 * `registerSchemesAsPrivileged`, Electron kept only the last declaration of
 * `secure`/`supportFetchAPI`/`corsEnabled`, and `atlas-attachment` silently
 * lost fetch support — stored images rendered but could not be copied or saved.
 */

const MAIN_DIR = join(import.meta.dirname, '..', 'src', 'main');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('privileged scheme registration', () => {
  it('registers every scheme in a single call', () => {
    const callSites = sourceFiles(MAIN_DIR).filter((path) =>
      readFileSync(path, 'utf8').includes('registerSchemesAsPrivileged(')
    );

    assert.deepEqual(
      callSites.map((path) => path.slice(MAIN_DIR.length + 1)),
      [join('bootstrap', 'privilegedSchemes.ts')],
      'A second registerSchemesAsPrivileged call overwrites the privileges of the first — declare the scheme in bootstrap/privilegedSchemes.ts instead.'
    );
  });

  it('includes every declared scheme in that call', () => {
    const registration = readFileSync(join(MAIN_DIR, 'bootstrap', 'privilegedSchemes.ts'), 'utf8');

    const declared = sourceFiles(MAIN_DIR).flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/export const (\w+_CUSTOM_SCHEME)\b/g)].map(
        (match) => match[1]
      )
    );

    assert.ok(declared.includes('ATTACHMENT_CUSTOM_SCHEME'), 'expected the attachment scheme to be declared');
    for (const name of declared) {
      assert.ok(registration.includes(name), `${name} is declared but never registered`);
    }
  });
});
