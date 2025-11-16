import init, { StreamingJpegEncoder, WasmColorType } from '../pkg/jpeg_encoder.js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Initialize WASM module (required for web target)
// In Node, we need to pass the WASM bytes directly since fetch() doesn't work with file:// URLs
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const wasmBytes = readFileSync(join(__dirname, '../pkg/jpeg_encoder_bg.wasm'));
await init(wasmBytes);

/**
 * Creates a simple test image with RGB gradient
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array} RGB pixel data
 */
function createTestImage(width, height) {
    const pixels = new Uint8Array(width * height * 3);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 3;
            // Create a gradient pattern
            pixels[idx] = (x / width) * 255;     // R
            pixels[idx + 1] = (y / height) * 255; // G
            pixels[idx + 2] = 128;                // B
        }
    }

    return pixels;
}

/**
 * Concatenates multiple Uint8Arrays
 */
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

/**
 * Encodes RGB image data to JPEG
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} pixels
 * @param {number} quality
 * @returns {Uint8Array} JPEG encoded data
 */
function encodeJpeg(width, height, pixels, quality = 85) {
    console.log(`Encoding ${width}x${height} image at quality ${quality}...`);

    const encoder = new StreamingJpegEncoder(
        width,
        height,
        WasmColorType.Rgb,
        quality
    );

    // Encode the entire image in one strip and collect output chunks
    const chunk1 = encoder.encode_strip(pixels);
    const chunk2 = encoder.finish();

    // Concatenate all chunks to get the final JPEG
    const jpegData = concatUint8Arrays(chunk1, chunk2);

    console.log(`JPEG encoded, output size: ${jpegData.length} bytes`);

    return jpegData;
}

function main() {
    console.log('JPEG Encoder WASM Demo');
    console.log('======================\n');

    // Create a 256x256 test image
    const width = 256;
    const height = 256;

    console.log('Creating test image...');
    const pixels = createTestImage(width, height);
    console.log(`Created ${width}x${height} RGB image (${pixels.length} bytes)\n`);

    // Encode at different quality levels
    const qualities = [50, 85, 95];

    for (const quality of qualities) {
        const jpegData = encodeJpeg(width, height, pixels, quality);
        const filename = `output-q${quality}.jpg`;
        writeFileSync(filename, jpegData);
        console.log(`Saved to ${filename}\n`);
    }

    console.log('Demo completed successfully!');
}

main();
