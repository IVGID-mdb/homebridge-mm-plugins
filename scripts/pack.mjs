// Builds every plugin and produces installable tarballs in ./release.
// Install on a Homebridge host with:  hb-service add /path/to/homebridge-mm-bond-0.1.0.tgz
// or                                   npm install --prefix /var/lib/homebridge <tarball>
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'release');
mkdirSync(out, { recursive: true });
execSync('node scripts/build.mjs', { cwd: root, stdio: 'inherit' });
for (const name of readdirSync(join(root, 'packages'))) {
  if (name === 'core') continue;
  const dir = join(root, 'packages', name);
  if (!existsSync(join(dir, 'dist', 'index.js'))) continue;
  execSync(`npm pack --pack-destination "${out}"`, { cwd: dir, stdio: 'inherit' });
}
console.log(`tarballs in ${out}`);
