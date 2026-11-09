// Compile-only check of the published type definitions (npm run test:types)
import init, {
  encodeJpeg,
  StreamingJpegEncoder,
  WasmColorType,
  WasmDensityUnit,
  WasmQuantizationTable,
  WasmSamplingFactor,
} from 'jpeg-encoder-wasm';

export async function encode(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): Promise<Uint8Array> {
  await init();

  const encoder = new StreamingJpegEncoder(
    width,
    height,
    WasmColorType.Rgba,
    85,
    WasmSamplingFactor.F_1_1
  );
  const chunks: Uint8Array[] = [encoder.take_output()];
  const remaining: number = encoder.rows_remaining;
  chunks.push(encoder.encode_strip(pixels));
  chunks.push(encoder.finish());
  encoder.free();
  void remaining;

  return encodeJpeg(pixels, width, height);
}

export function withOptions(pixels: Uint8Array): Uint8Array {
  const encoder = new StreamingJpegEncoder(10, 10, WasmColorType.Rgb, {
    quality: 90,
    samplingFactor: WasmSamplingFactor.F_2_2,
    chromaSubsampling: 'average',
    dpi: { x: 300, y: 300 },
    density: { x: 1, y: 1, unit: WasmDensityUnit.AspectRatio },
    quantizationTable: WasmQuantizationTable.ImageMagick,
    restartInterval: 4,
    exif: new Uint8Array(8),
    iccProfile: new Uint8Array(128),
  });
  encoder.free();
  return encodeJpeg(pixels, 10, 10, WasmColorType.Rgb, { quality: 50 });
}
