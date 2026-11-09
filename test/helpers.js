// Shared helpers for the ESM and browser tests.

/** Gradient test image; `bpp` bytes per pixel */
export function makeImage(width, height, bpp) {
  const data = new Uint8Array(width * height * bpp);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * bpp;
      for (let c = 0; c < bpp; c++) {
        data[i + c] =
          c === 3 ? 255 : Math.round(((x + y * (c + 1)) / (width + height * (c + 1))) * 255);
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
export function encodeInStrips(
  StreamingJpegEncoder,
  data,
  width,
  height,
  bpp,
  colorType,
  quality,
  stripRows,
  samplingFactor
) {
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

/**
 * Deterministic RGBA test image with the features JPEG artefacts show up on:
 * smooth gradients, hard colour edges, fine stripes, a colour checker, a
 * thin-line grid and mild noise.
 */
export function makeTestPattern(width, height) {
  const data = new Uint8Array(width * height * 4);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const checker = [
    [115, 82, 68],
    [194, 150, 130],
    [98, 122, 157],
    [87, 108, 67],
    [133, 128, 177],
    [103, 189, 170],
    [214, 126, 44],
    [80, 91, 166],
    [193, 90, 99],
    [94, 60, 108],
    [157, 188, 64],
    [224, 163, 46],
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      let r;
      let g;
      let b;
      if (v < 0.25) {
        // smooth gradients
        r = 255 * u;
        g = 255 * (1 - u) * (0.5 + v * 2);
        b = 128 + 127 * Math.sin(u * Math.PI * 2);
      } else if (v < 0.5) {
        // colour checker with hard edges
        const cell = checker[Math.floor(u * 6) + (v < 0.375 ? 0 : 6)];
        [r, g, b] = cell;
      } else if (v < 0.75) {
        // fine stripes: luma on the left, red/cyan chroma on the right
        const on = (x >> (u < 0.5 ? 0 : 1)) & 1;
        if (u < 0.5) r = g = b = on ? 230 : 25;
        else [r, g, b] = on ? [220, 40, 40] : [40, 200, 220];
      } else {
        // grid of 1px lines over a noisy mid-grey
        const line = x % 16 === 0 || y % 16 === 0;
        const n = (rand() - 0.5) * 30;
        r = g = b = line ? 20 : 150 + n;
        g += 20 * u;
      }
      const i = (y * width + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(r)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Convert RGBA to RGB */
export function rgbaToRgb(rgba) {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    out[j] = rgba[i];
    out[j + 1] = rgba[i + 1];
    out[j + 2] = rgba[i + 2];
  }
  return out;
}

/**
 * PSNR in dB between two RGBA buffers: per channel (r, g, b), luma (Y) and
 * overall RGB
 */
export function psnr(a, b) {
  const sums = [0, 0, 0, 0];
  const pixels = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a[i + c] - b[i + c];
      sums[c] += d * d;
    }
    const ya = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const yb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
    sums[3] += (ya - yb) ** 2;
  }
  const db = (sum) => (sum === 0 ? Infinity : 10 * Math.log10((255 * 255) / (sum / pixels)));
  return {
    r: db(sums[0]),
    g: db(sums[1]),
    b: db(sums[2]),
    y: db(sums[3]),
    rgb: db(sums[0] + sums[1] + sums[2]) + 10 * Math.log10(3),
  };
}
