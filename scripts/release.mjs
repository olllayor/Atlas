import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const bump = process.argv[2] || 'patch';
const pkgPath = join(process.cwd(), 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const current = pkg.version.split('.').map(Number);
let [major, minor, patch] = current;

if (bump === 'major') {
  major++;
  minor = 0;
  patch = 0;
} else if (bump === 'minor') {
  minor++;
  patch = 0;
} else {
  patch++;
}

const next = `${major}.${minor}.${patch}`;
pkg.version = next;

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

execSync(`git add package.json`, { stdio: 'inherit' });
execSync(`git commit -m "chore: bump version to ${next}"`, { stdio: 'inherit' });
execSync(`git tag -a v${next} -m "v${next}"`, { stdio: 'inherit' });

console.log(`\nCreated v${next}. Push with: git push && git push --tags`);
