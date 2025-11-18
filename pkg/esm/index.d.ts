// Re-export everything from the generated bindings
export { WasmColorType, StreamingJpegEncoder } from './jpeg_encoder.js';
export type { InitInput, InitOutput } from './jpeg_encoder.js';

/**
 * Initialize the underlying WebAssembly module.
 *
 * This must be awaited before constructing a {@link StreamingJpegEncoder}.
 * By default it loads the bundled `jpeg_encoder_bg.wasm` next to this file.
 *
 * @param module - Optional WebAssembly module or bytes to initialize with
 * @returns Promise that resolves when initialization is complete
 */
export function init(module?: import('./jpeg_encoder.js').InitInput | Promise<import('./jpeg_encoder.js').InitInput>): Promise<void>;
export default init;
