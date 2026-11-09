// ESM entry point of the npm package. Copied to pkg/esm/index.js by scripts/build-bindings.js.
import initWasm, {
  EncoderSettings,
  StreamingJpegEncoder as RawStreamingJpegEncoder,
  WasmColorType,
  WasmDensityUnit,
  WasmQuantizationTable,
  WasmSamplingFactor,
} from './jpeg_encoder.js';
import { createEncoderClass } from './encoder.js';

export { WasmColorType, WasmDensityUnit, WasmQuantizationTable, WasmSamplingFactor };

let ready;

const isNode =
  typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

async function loadDefaultModule() {
  const url = new URL('./jpeg_encoder_bg.wasm', import.meta.url);
  if (isNode && url.protocol === 'file:') {
    // fetch() can't read file:// URLs in Node, so read the bundled file directly.
    // The specifier is hidden from bundlers, which never take this branch.
    const fs = 'node:fs/promises';
    const { readFile } = await import(/* webpackIgnore: true */ /* @vite-ignore */ fs);
    return readFile(url);
  }
  return url;
}

/**
 * Load the WebAssembly module. Must be awaited once before creating encoders;
 * later calls return the same promise.
 *
 * With no argument the bundled `jpeg_encoder_bg.wasm` is loaded, in Node and
 * in browsers. Pass a URL, Response, bytes or `WebAssembly.Module` to load it
 * from somewhere else.
 */
export function init(module) {
  if (!ready) {
    ready = (async () => {
      const source = module ?? (await loadDefaultModule());
      await initWasm({ module_or_path: source });
    })();
    ready.catch(() => {
      ready = undefined;
    });
  }
  return ready;
}

export default init;

export const { StreamingJpegEncoder, encodeJpeg } = createEncoderClass(
  RawStreamingJpegEncoder,
  EncoderSettings,
  WasmColorType,
  WasmDensityUnit
);
