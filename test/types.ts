// Compile-only check of the published type definitions (npm run test:types)
import init, {
  encodeJpeg,
  StreamingJpegEncoder,
  WasmColorType,
  WasmSamplingFactor,
} from 'jpeg-encoder-wasm';

export async function encode(pixels: Uint8ClampedArray, width: number, height: number): Promise<Uint8Array> {
  await init();

  const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgba, 85, WasmSamplingFactor.F_1_1);
  const chunks: Uint8Array[] = [encoder.take_output()];
  const remaining: number = encoder.rows_remaining;
  chunks.push(encoder.encode_strip(pixels));
  chunks.push(encoder.finish());
  encoder.free();
  void remaining;

  return encodeJpeg(pixels, width, height);
}
