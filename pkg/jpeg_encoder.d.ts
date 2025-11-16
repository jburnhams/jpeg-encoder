/* tslint:disable */
/* eslint-disable */
export enum WasmColorType {
  Luma = 0,
  Rgb = 1,
  Rgba = 2,
  Bgr = 3,
  Bgra = 4,
  Ycbcr = 5,
  Cmyk = 6,
  CmykAsYcck = 7,
  Ycck = 8,
}
export class StreamingJpegEncoder {
  free(): void;
  [Symbol.dispose](): void;
  take_output(): Uint8Array;
  encode_strip(data: Uint8Array): Uint8Array;
  static footer_bytes(): Uint8Array;
  static header_bytes(width: number, height: number, color_type: WasmColorType, quality: number): Uint8Array;
  constructor(width: number, height: number, color_type: WasmColorType, quality: number);
  finish(): Uint8Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_streamingjpegencoder_free: (a: number, b: number) => void;
  readonly streamingjpegencoder_encode_strip: (a: number, b: number, c: number) => [number, number, number];
  readonly streamingjpegencoder_finish: (a: number) => [number, number, number];
  readonly streamingjpegencoder_footer_bytes: () => any;
  readonly streamingjpegencoder_header_bytes: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly streamingjpegencoder_new: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly streamingjpegencoder_take_output: (a: number) => any;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
