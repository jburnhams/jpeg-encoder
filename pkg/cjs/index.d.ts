// Re-export types from the generated bindings
export { WasmColorType, StreamingJpegEncoder } from './jpeg_encoder.js';

/**
 * Initialize the underlying WebAssembly module.
 *
 * For the CommonJS build using nodejs target, the WASM module is automatically
 * loaded. This function exists for API compatibility with the ESM build.
 *
 * @param wasmBytes - Optional WASM bytes (unused in nodejs target)
 * @returns Promise that resolves when initialization is complete
 */
export function init(wasmBytes?: Buffer | Uint8Array): Promise<void>;
export default init;
