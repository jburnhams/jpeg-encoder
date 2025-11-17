import { writeFile } from "node:fs/promises";
import init, { StreamingJpegEncoder, WasmColorType } from "./index.js";

async function main() {
  await init();

  const width = 320;
  const height = 240;
  const quality = 90;
  const stripHeight = 16; // multiple of the 8-row MCU height used for RGB/YCbCr data

  const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, quality);
  const chunks = [];

  for (let y = 0; y < height; y += stripHeight) {
    const h = Math.min(stripHeight, height - y);
    const strip = new Uint8Array(width * h * 3);

    for (let row = 0; row < h; row++) {
      for (let x = 0; x < width; x++) {
        const idx = (row * width + x) * 3;
        strip[idx] = (x / width) * 255;
        strip[idx + 1] = (y / height) * 255;
        strip[idx + 2] = 180;
      }
    }

    const flushed = encoder.encode_strip(strip);
    if (flushed.length) chunks.push(flushed);
  }

  chunks.push(encoder.finish());

  const jpegBytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  await writeFile("./example-output.jpg", jpegBytes);

  console.log("Wrote example-output.jpg (", jpegBytes.length, "bytes)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
