#!/usr/bin/env node

/**
 * Turns the compiled wasm-bindings crate into the npm package layout in pkg/:
 *
 *   pkg/esm/  wasm-bindgen --target web    + js/index.js  + js/encoder.js (import, browsers and Node)
 *   pkg/cjs/  wasm-bindgen --target nodejs + js/index.cjs + encoder.cjs   (require, Node)
 *   pkg/index.d.ts                         types for both entry points
 *
 * Run `npm run build:wasm` first. wasm-opt (from the binaryen dev dependency)
 * shrinks each .wasm file when it's available.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(rootDir, 'pkg');
const jsDir = join(rootDir, 'js');
const wasmPath = join(rootDir, 'target/wasm32-unknown-unknown/wasm-release/jpeg_encoder_wasm.wasm');

if (!existsSync(wasmPath)) {
  console.error(`Missing ${wasmPath}. Run "npm run build:wasm" first.`);
  process.exit(1);
}

function findWasmOpt() {
  const local = join(rootDir, 'node_modules/.bin/wasm-opt');
  if (existsSync(local)) return local;
  try {
    execFileSync('wasm-opt', ['--version'], { stdio: 'ignore' });
    return 'wasm-opt';
  } catch {
    return null;
  }
}

const wasmOpt = findWasmOpt();
if (!wasmOpt) {
  console.warn('wasm-opt not found, the .wasm files will not be size-optimized');
}

rmSync(pkgDir, { recursive: true, force: true });

// js/encoder.js is shared by both entry points; the CommonJS copy only differs in its export
const sharedEsm = readFileSync(join(jsDir, 'encoder.js'), 'utf8');
const exportLine = 'export { createEncoderClass };';
if (!sharedEsm.includes(exportLine)) {
  throw new Error(`js/encoder.js must end with "${exportLine}"`);
}
const shared = {
  esm: ['encoder.js', sharedEsm],
  cjs: ['encoder.cjs', '"use strict";\n' + sharedEsm.replace(exportLine, 'module.exports = { createEncoderClass };')],
};

for (const [dir, target, entry, entryName, type] of [
  ['esm', 'web', 'index.js', 'index.js', 'module'],
  ['cjs', 'nodejs', 'index.cjs', 'index.cjs', 'commonjs'],
]) {
  const outDir = join(pkgDir, dir);
  mkdirSync(outDir, { recursive: true });

  console.log(`Generating ${dir} bindings (--target ${target})...`);
  execFileSync(
    'wasm-bindgen',
    [wasmPath, '--out-dir', outDir, '--target', target, '--typescript', '--out-name', 'jpeg_encoder'],
    { stdio: 'inherit' },
  );

  const wasmFile = join(outDir, 'jpeg_encoder_bg.wasm');
  if (wasmOpt) {
    execFileSync(
      wasmOpt,
      ['-Oz', wasmFile, '-o', wasmFile],
      { stdio: 'inherit' },
    );
  }
  console.log(`  ${dir}/jpeg_encoder_bg.wasm: ${(statSync(wasmFile).size / 1024).toFixed(1)} KiB`);

  copyFileSync(join(jsDir, entry), join(outDir, entryName));
  writeFileSync(join(outDir, shared[dir][0]), shared[dir][1]);
  copyFileSync(join(jsDir, 'index.d.ts'), join(outDir, 'index.d.ts'));
  writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type }, null, 2) + '\n');
}

copyFileSync(join(jsDir, 'index.d.ts'), join(pkgDir, 'index.d.ts'));

console.log('Build complete: pkg/esm (import) and pkg/cjs (require)');
