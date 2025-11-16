# JPEG Encoder WASM Examples

This directory contains examples demonstrating how to use the JPEG encoder WebAssembly module.

## Running the Examples

### Basic Encoding Example

The `encode.js` script demonstrates basic usage of the JPEG encoder:

```bash
npm run example
```

This will:
- Create a 256x256 test image with a gradient pattern
- Encode it at three different quality levels (50, 85, 95)
- Save the outputs as `output-q50.jpg`, `output-q85.jpg`, and `output-q95.jpg`

## Usage

### Basic Usage

```javascript
import { StreamingJpegEncoder, WasmColorType } from '../pkg/jpeg_encoder.js';

// Create RGB pixel data (width * height * 3 bytes)
const width = 256;
const height = 256;
const pixels = new Uint8Array(width * height * 3);
// ... fill pixels with RGB data ...

// Create encoder
const encoder = new StreamingJpegEncoder(
    width,
    height,
    WasmColorType.Rgb,
    85  // quality (1-100)
);

// Encode and collect output chunks
const chunk1 = encoder.encode_strip(pixels);
const chunk2 = encoder.finish();

// Concatenate chunks to get final JPEG
const jpegData = concatUint8Arrays(chunk1, chunk2);
```

### Supported Color Types

- `WasmColorType.Luma` - Grayscale (1 byte per pixel)
- `WasmColorType.Rgb` - RGB (3 bytes per pixel)
- `WasmColorType.Rgba` - RGBA (4 bytes per pixel)
- `WasmColorType.Bgr` - BGR (3 bytes per pixel)
- `WasmColorType.Bgra` - BGRA (4 bytes per pixel)
- `WasmColorType.Ycbcr` - YCbCr (3 bytes per pixel)
- `WasmColorType.Cmyk` - CMYK (4 bytes per pixel)
- `WasmColorType.CmykAsYcck` - CMYK as YCCK (4 bytes per pixel)
- `WasmColorType.Ycck` - YCCK (4 bytes per pixel)

### Streaming Encoding

For large images, you can encode in strips to reduce memory usage:

```javascript
const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 85);

const chunks = [];
const stripHeight = 64;

for (let y = 0; y < height; y += stripHeight) {
    const strip = getImageStrip(y, stripHeight); // Your function to get strip data
    const chunk = encoder.encode_strip(strip);
    chunks.push(chunk);
}

const finalChunk = encoder.finish();
chunks.push(finalChunk);

const jpegData = concatUint8Arrays(...chunks);
```

## Helper Functions

### Concatenating Uint8Arrays

```javascript
function concatUint8Arrays(...arrays) {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}
```
