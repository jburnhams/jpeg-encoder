// Type definitions for both the ESM and CommonJS entry points.

/** Pixel layout of the data passed to `encode_strip()` */
export enum WasmColorType {
  /** Grayscale, 1 byte per pixel */
  Luma = 0,
  /** RGB, 3 bytes per pixel */
  Rgb = 1,
  /** RGBA, 4 bytes per pixel (alpha is ignored) */
  Rgba = 2,
  /** BGR, 3 bytes per pixel */
  Bgr = 3,
  /** BGRA, 4 bytes per pixel (alpha is ignored) */
  Bgra = 4,
  /** YCbCr, 3 bytes per pixel */
  Ycbcr = 5,
  /** CMYK, 4 bytes per pixel */
  Cmyk = 6,
  /** CMYK, 4 bytes per pixel, stored as YCCK */
  CmykAsYcck = 7,
  /** YCCK, 4 bytes per pixel */
  Ycck = 8,
}

/**
 * Chroma subsampling. `F_2_2` is 4:2:0 and `F_1_1` is 4:4:4 (full colour detail).
 * When not given, quality below 90 uses `F_2_2` and quality 90 or above uses `F_1_1`.
 */
export enum WasmSamplingFactor {
  F_1_1 = 0,
  F_2_1 = 1,
  F_1_2 = 2,
  F_2_2 = 3,
}

export type InitInput =
  | string
  | URL
  | Response
  | ArrayBuffer
  | ArrayBufferView
  | WebAssembly.Module;

/**
 * Load the WebAssembly module. Must be awaited once before creating encoders;
 * later calls return the same promise. With no argument the bundled
 * `jpeg_encoder_bg.wasm` is loaded (in Node and in browsers). In the CommonJS
 * build the module is loaded on `require()` and this is a no-op.
 */
export function init(module?: InitInput | Promise<InitInput>): Promise<void>;
export default init;

/**
 * Streaming JPEG encoder. Feed rows with `encode_strip()`, collect the bytes
 * each call returns, then call `finish()` for the rest.
 */
export class StreamingJpegEncoder {
  /**
   * @param width Image width in pixels (1 to 65535)
   * @param height Image height in pixels (1 to 65535)
   * @param colorType Pixel layout of the input rows
   * @param quality JPEG quality, 1 to 100
   * @param samplingFactor Chroma subsampling; by default `F_2_2` below quality 90, `F_1_1` from 90
   */
  constructor(
    width: number,
    height: number,
    colorType: WasmColorType,
    quality: number,
    samplingFactor?: WasmSamplingFactor,
  );

  /**
   * Encode one or more complete rows (`width * bytes per pixel` bytes each)
   * and return the JPEG bytes produced so far. The first call also returns
   * the headers. Strips can have any height; bytes for a row of MCUs (8 rows,
   * or 16 with vertical chroma subsampling) are produced once it's complete.
   */
  encode_strip(data: Uint8Array | Uint8ClampedArray): Uint8Array;

  /** Return bytes produced so far (the headers, right after construction) without encoding. */
  take_output(): Uint8Array;

  /** Number of rows still to be passed to `encode_strip()` */
  readonly rows_remaining: number;

  /**
   * Write the end of the image, free the WebAssembly memory and return the
   * remaining bytes. Throws, and keeps the encoder usable, if rows are missing.
   */
  finish(): Uint8Array;

  /** Free the WebAssembly memory without finishing. Safe to call more than once. */
  free(): void;
}

/** Encode a whole image in one call. In the ESM build `init()` must have been awaited. */
export function encodeJpeg(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  colorType?: WasmColorType,
  quality?: number,
  samplingFactor?: WasmSamplingFactor,
): Uint8Array;
