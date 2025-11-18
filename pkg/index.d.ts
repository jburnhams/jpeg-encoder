import type { InitInput } from './esm/jpeg_encoder.js';

/**
 * Initialize the underlying WebAssembly module.
 *
 * This must be awaited before constructing a {@link StreamingJpegEncoder}.
 * By default it loads the bundled `jpeg_encoder_bg.wasm` next to this file.
 */
export function init(module?: InitInput | Promise<InitInput>): Promise<void>;
export default init;

/**
 * Color type for the JPEG encoder.
 */
export enum WasmColorType {
  Rgb = 0,
  Luma = 1,
  Rgba = 2,
  Cmyk = 3,
}

/**
 * Thin wrapper around the wasm-bindgen generated encoder that hides
 * implementation details and static helpers that consumers should not call.
 */
export class StreamingJpegEncoder {
  constructor(width: number, height: number, color_type: WasmColorType, quality: number);

  /**
   * Encode one or more complete rows. The return value contains any newly
   * produced JPEG bytes and clears the internal buffer.
   */
  encode_strip(data: Uint8Array): Uint8Array;

  /**
   * Finalize the JPEG, free the underlying wasm allocations, and return any
   * remaining bytes. All rows must have been provided before calling this.
   */
  finish(): Uint8Array;

  /**
   * Free the underlying wasm allocations. Calling this after `finish()` is
   * unnecessary because `finish()` already releases the resources.
   */
  free(): void;

  /**
   * Get JPEG header bytes without creating an encoder instance.
   * This is a static method for advanced use cases.
   */
  static header_bytes(width: number, height: number, color_type: WasmColorType, quality: number): Uint8Array;

  /**
   * Get JPEG footer bytes.
   * This is a static method for advanced use cases.
   */
  static footer_bytes(): Uint8Array;
}

export { WasmColorType };
