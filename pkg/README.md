# jpeg-encoder-wasm

This package provides a WebAssembly-powered JPEG encoder that can be used from JavaScript.
The curated entrypoint exports only the encoder wrapper and color type enum to keep the API small and focused.

## Installation

The package is published as `jpeg-encoder-wasm`.
After installing, the WebAssembly module bundled in the `pkg/` directory will be loaded automatically.

```bash
npm install jpeg-encoder-wasm
```

## Usage

### Node.js

```js
import init, { StreamingJpegEncoder, WasmColorType } from "jpeg-encoder-wasm/pkg/index.js";

async function encode() {
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

    // Fill the strip with a simple gradient.
    for (let row = 0; row < h; row++) {
      for (let x = 0; x < width; x++) {
        const idx = (row * width + x) * 3;
        strip[idx] = (x / width) * 255; // R ramp left → right
        strip[idx + 1] = (y / height) * 255; // G ramp top → bottom
        strip[idx + 2] = 180; // constant blue
      }
    }

    const flushed = encoder.encode_strip(strip);
    if (flushed.length) chunks.push(flushed);
  }

  chunks.push(encoder.finish());

  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

encode().then((buffer) => {
  console.log("Wrote JPEG", buffer.length, "bytes");
});
```

### Web

The default `init()` loader works in browsers as long as the wasm file sits next to `index.js`.
Serve the `pkg/` directory over HTTP (fetching wasm from `file://` URLs is blocked by many browsers) and import the module normally:

```html
<!doctype html>
<html>
  <body>
    <img id="preview" alt="JPEG preview" />
    <script type="module">
      import init, { StreamingJpegEncoder, WasmColorType } from "./index.js";

      async function render() {
        await init();

        const width = 320;
        const height = 240;
        const stripHeight = 16; // multiple of the encoder's 8-row MCU height for RGB/YCbCr
        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 90);

        const chunks = [];
        for (let y = 0; y < height; y += stripHeight) {
          const h = Math.min(stripHeight, height - y);
          const strip = new Uint8Array(width * h * 3);

          for (let row = 0; row < h; row++) {
            for (let x = 0; x < width; x++) {
              const idx = (row * width + x) * 3;
              strip[idx] = (x / width) * 255;
              strip[idx + 1] = ((y + row) / height) * 255;
              strip[idx + 2] = 200;
            }
          }

          const chunk = encoder.encode_strip(strip);
          if (chunk.length) chunks.push(chunk);
        }

        const jpegBytes = encoder.finish();
        chunks.push(jpegBytes);

        const merged = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        const blobUrl = URL.createObjectURL(new Blob([merged], { type: "image/jpeg" }));
        document.getElementById("preview").src = blobUrl;
      }

      render().catch(console.error);
    </script>
  </body>
</html>
```

## API

- `init(module?)`: load the WebAssembly module. Call this once before constructing an encoder. The optional `module` argument is forwarded to the underlying wasm-bindgen loader. A default export is also provided for compatibility with the original wasm-bindgen entrypoint.
- `StreamingJpegEncoder`: create an encoder with `(width, height, colorType, quality)`, feed image data with `encode_strip`, and finish with `finish`. Static helpers like `header_bytes` or `footer_bytes` are intentionally hidden in this wrapper.
  - `encode_strip(data)` writes one or more complete rows (the data length must be a multiple of `width * bytesPerPixel`) and returns any newly produced JPEG bytes while clearing the internal buffer.
  - `finish()` finalizes the file, validates that all rows were provided, frees the wasm allocations, and returns the remaining JPEG bytes. No extra `free()` call is required after this.
  - `free()` releases the underlying wasm allocations early if you abort before calling `finish()`.
- `WasmColorType`: enum describing the pixel format of the input data.

When streaming, keep strip heights aligned to the encoder's MCU height so that rows are flushed efficiently. The encoder processes rows in groups of `8 * maxVerticalSampling` (8 rows for grayscale/RGB data, 16 rows when chroma subsampling doubles the vertical sampling), so using multiples of 8–16 rows per strip avoids extra padding while keeping memory bounded. Each strip can be any height up to the remaining rows as long as its byte length is a multiple of the row stride.

## Example scripts

- [`pkg/example.js`](./example.js): runnable Node.js example that writes an output JPEG to disk (`node pkg/example.js`).
- [`pkg/example-web.html`](./example-web.html): browser example. Serve the `pkg/` directory (for example, `npx serve pkg`) and open the HTML file in your browser.
