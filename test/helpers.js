// Shared helpers for the ESM and browser tests.

/** Gradient test image; `bpp` bytes per pixel */
export function makeImage(width, height, bpp) {
  const data = new Uint8Array(width * height * bpp);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * bpp;
      for (let c = 0; c < bpp; c++) {
        data[i + c] = c === 3 ? 255 : Math.round(((x + y * (c + 1)) / (width + height * (c + 1))) * 255);
      }
    }
  }
  return data;
}

export function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Encode `data` passing `stripRows` rows per encode_strip() call */
export function encodeInStrips(StreamingJpegEncoder, data, width, height, bpp, colorType, quality, stripRows, samplingFactor) {
  const encoder = new StreamingJpegEncoder(width, height, colorType, quality, samplingFactor);
  const chunks = [];
  const rowBytes = width * bpp;
  for (let y = 0; y < height; y += stripRows) {
    const rows = Math.min(stripRows, height - y);
    chunks.push(encoder.encode_strip(data.subarray(y * rowBytes, (y + rows) * rowBytes)));
  }
  chunks.push(encoder.finish());
  return concat(chunks);
}
