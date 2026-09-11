// Bundles each plugin's src/index.ts into a single self-contained dist/index.js (ESM).
// The shared @mm/hb-core package is inlined, so a published plugin has zero runtime deps
// beyond Node itself and the `homebridge` host, which stays external.
import { build } from 'esbuild';
import { readdirSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgsDir = join(root, 'packages');
const only = process.argv.slice(2);

const targets = readdirSync(pkgsDir).filter((name) => {
  if (name === 'core') return false;
  if (only.length && !only.includes(name)) return false;
  return existsSync(join(pkgsDir, name, 'src', 'index.ts'));
});

for (const name of targets) {
  const dir = join(pkgsDir, name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  await build({
    entryPoints: [join(dir, 'src', 'index.ts')],
    outfile: join(dir, 'dist', 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: true,
    external: ['homebridge', '@homebridge/hap-nodejs'],
    banner: { js: `// ${pkg.name} v${pkg.version} — built ${new Date().toISOString()}` },
    logLevel: 'info',
  });
  // homebridge-ui assets (if any) are copied verbatim.
  const ui = join(dir, 'homebridge-ui');
  if (existsSync(ui)) {
    mkdirSync(join(dir, 'dist', 'homebridge-ui'), { recursive: true });
    for (const f of readdirSync(ui)) copyFileSync(join(ui, f), join(dir, 'dist', 'homebridge-ui', f));
  }
  console.log(`built ${pkg.name} → packages/${name}/dist/index.js`);
}
