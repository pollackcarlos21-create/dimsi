import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outfile = path.join(root, 'cloudfunctions/api/index.js');

await mkdir(path.dirname(outfile), { recursive: true });
await rm(outfile, { force: true });

await build({
  entryPoints: [path.join(root, 'cloudfunctions/api/src/index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['wx-server-sdk'],
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
});

console.log(`[build:cloud] wrote ${path.relative(root, outfile)}`);
