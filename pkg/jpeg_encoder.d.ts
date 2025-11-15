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
  constructor(width: number, height: number, color_type: WasmColorType, quality: number);
  encode_strip(data: Uint8Array): Uint8Array;
  finish(): Uint8Array;
  take_output(): Uint8Array;
  static header_bytes(width: number, height: number, color_type: WasmColorType, quality: number): Uint8Array;
  static footer_bytes(): Uint8Array;
}
