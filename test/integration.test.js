import { StreamingJpegEncoder, WasmColorType } from '../pkg/jpeg_encoder.js';
import { strict as assert } from 'assert';

/**
 * Creates a simple solid color image
 */
function createSolidImage(width, height, r, g, b) {
    const pixels = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
        pixels[i * 3] = r;
        pixels[i * 3 + 1] = g;
        pixels[i * 3 + 2] = b;
    }
    return pixels;
}

/**
 * Creates a grayscale image
 */
function createGrayscaleImage(width, height, value) {
    const pixels = new Uint8Array(width * height);
    pixels.fill(value);
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
 * Validates that the output is a valid JPEG
 */
function validateJpeg(data) {
    // Check JPEG magic bytes (SOI marker: 0xFF 0xD8)
    assert.equal(data[0], 0xFF, 'First byte should be 0xFF');
    assert.equal(data[1], 0xD8, 'Second byte should be 0xD8 (SOI marker)');

    // Check EOI marker at the end (0xFF 0xD9)
    assert.equal(data[data.length - 2], 0xFF, 'Second-to-last byte should be 0xFF');
    assert.equal(data[data.length - 1], 0xD9, 'Last byte should be 0xD9 (EOI marker)');

    return true;
}

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        return true;
    } catch (error) {
        console.error(`✗ ${name}`);
        console.error(`  ${error.message}`);
        if (error.stack) {
            console.error(`  ${error.stack}`);
        }
        return false;
    }
}

function main() {
    console.log('JPEG Encoder WASM Integration Tests');
    console.log('====================================\n');

    let passed = 0;
    let failed = 0;

    // Test 1: Basic RGB encoding
    if (test('Basic RGB encoding (64x64)', () => {
        const width = 64;
        const height = 64;
        const pixels = createSolidImage(width, height, 255, 0, 0);

        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 85);
        const chunk1 = encoder.encode_strip(pixels);
        const chunk2 = encoder.finish();
        const jpegData = concatUint8Arrays(chunk1, chunk2);

        assert(jpegData.length > 0, 'JPEG data should not be empty');
        validateJpeg(jpegData);
    })) {
        passed++;
    } else {
        failed++;
    }

    // Test 2: Different quality levels
    if (test('Quality parameter affects output size', () => {
        const width = 128;
        const height = 128;
        const pixels = createSolidImage(width, height, 128, 128, 128);

        const encoder1 = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 50);
        const low1 = encoder1.encode_strip(pixels);
        const low2 = encoder1.finish();
        const lowQuality = concatUint8Arrays(low1, low2);

        const encoder2 = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 95);
        const high1 = encoder2.encode_strip(pixels);
        const high2 = encoder2.finish();
        const highQuality = concatUint8Arrays(high1, high2);

        validateJpeg(lowQuality);
        validateJpeg(highQuality);

        assert(lowQuality.length > 0, 'Low quality output should not be empty');
        assert(highQuality.length > 0, 'High quality output should not be empty');
    })) {
        passed++;
    } else {
        failed++;
    }

    // Test 3: Grayscale (Luma) encoding
    if (test('Grayscale (Luma) encoding', () => {
        const width = 64;
        const height = 64;
        const pixels = createGrayscaleImage(width, height, 128);

        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Luma, 85);
        const chunk1 = encoder.encode_strip(pixels);
        const chunk2 = encoder.finish();
        const jpegData = concatUint8Arrays(chunk1, chunk2);

        assert(jpegData.length > 0, 'JPEG data should not be empty');
        validateJpeg(jpegData);
    })) {
        passed++;
    } else {
        failed++;
    }

    // Test 4: Multiple strip encoding
    if (test('Multiple strip encoding', () => {
        const width = 64;
        const height = 64;
        const stripHeight = 16;

        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 85);

        const chunks = [];
        // Encode in 4 strips
        for (let i = 0; i < 4; i++) {
            const strip = createSolidImage(width, stripHeight, i * 64, 128, 255 - i * 64);
            const chunk = encoder.encode_strip(strip);
            chunks.push(chunk);
        }

        const finalChunk = encoder.finish();
        chunks.push(finalChunk);

        const jpegData = concatUint8Arrays(...chunks);

        assert(jpegData.length > 0, 'JPEG data should not be empty');
        validateJpeg(jpegData);
    })) {
        passed++;
    } else {
        failed++;
    }

    // Test 5: Small image (1x1)
    if (test('Minimum size image (1x1)', () => {
        const pixels = new Uint8Array([255, 0, 0]);

        const encoder = new StreamingJpegEncoder(1, 1, WasmColorType.Rgb, 85);
        const chunk1 = encoder.encode_strip(pixels);
        const chunk2 = encoder.finish();
        const jpegData = concatUint8Arrays(chunk1, chunk2);

        assert(jpegData.length > 0, 'JPEG data should not be empty');
        validateJpeg(jpegData);
    })) {
        passed++;
    } else {
        failed++;
    }

    // Test 6: Larger image
    if (test('Larger image encoding (512x512)', () => {
        const width = 512;
        const height = 512;
        const pixels = new Uint8Array(width * height * 3);

        // Create a pattern
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;
                pixels[idx] = (x / width) * 255;
                pixels[idx + 1] = (y / height) * 255;
                pixels[idx + 2] = ((x + y) / (width + height)) * 255;
            }
        }

        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 85);
        const chunk1 = encoder.encode_strip(pixels);
        const chunk2 = encoder.finish();
        const jpegData = concatUint8Arrays(chunk1, chunk2);

        assert(jpegData.length > 0, 'JPEG data should not be empty');
        validateJpeg(jpegData);
    })) {
        passed++;
    } else {
        failed++;
    }

    // Test 7: RGBA encoding (with alpha channel)
    if (test('RGBA encoding', () => {
        const width = 64;
        const height = 64;
        const pixels = new Uint8Array(width * height * 4);

        for (let i = 0; i < width * height; i++) {
            pixels[i * 4] = 255;     // R
            pixels[i * 4 + 1] = 128; // G
            pixels[i * 4 + 2] = 0;   // B
            pixels[i * 4 + 3] = 255; // A
        }

        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgba, 85);
        const chunk1 = encoder.encode_strip(pixels);
        const chunk2 = encoder.finish();
        const jpegData = concatUint8Arrays(chunk1, chunk2);

        assert(jpegData.length > 0, 'JPEG data should not be empty');
        validateJpeg(jpegData);
    })) {
        passed++;
    } else {
        failed++;
    }

    // Test 8: Header and footer bytes
    if (test('Static header and footer bytes methods', () => {
        const header = StreamingJpegEncoder.header_bytes(100, 100, WasmColorType.Rgb, 85);
        const footer = StreamingJpegEncoder.footer_bytes();

        assert(header.length > 0, 'Header should not be empty');
        assert(footer.length > 0, 'Footer should not be empty');

        // Check header starts with SOI marker
        assert.equal(header[0], 0xFF, 'Header should start with 0xFF');
        assert.equal(header[1], 0xD8, 'Header should start with SOI marker');

        // Check footer is EOI marker
        assert.equal(footer[0], 0xFF, 'Footer should be 0xFF');
        assert.equal(footer[1], 0xD9, 'Footer should be EOI marker');
    })) {
        passed++;
    } else {
        failed++;
    }

    // Test 9: Verify streaming behavior with incremental data collection
    if (test('Streaming encoder returns data incrementally', () => {
        const width = 32;
        const height = 32;
        const pixels = createSolidImage(width, height, 100, 150, 200);

        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 85);

        // The encoder returns data chunks that need to be concatenated
        const chunk1 = encoder.encode_strip(pixels);
        assert(chunk1.length > 0, 'First chunk should contain header and encoded data');

        const chunk2 = encoder.finish();
        assert(chunk2.length > 0, 'Final chunk should contain remaining encoded data');

        const jpegData = concatUint8Arrays(chunk1, chunk2);
        validateJpeg(jpegData);
    })) {
        passed++;
    } else {
        failed++;
    }

    // Test 10: Verify header only in first strip
    if (test('Header only appears in first strip', () => {
        const width = 64;
        const height = 64;
        const stripHeight = 16;

        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 85);

        const chunks = [];
        for (let i = 0; i < 4; i++) {
            const strip = createSolidImage(width, stripHeight, i * 60, 128, 255 - i * 60);
            const chunk = encoder.encode_strip(strip);
            chunks.push(chunk);

            // Check for JPEG SOI marker (0xFF 0xD8)
            const hasSOI = chunk[0] === 0xFF && chunk[1] === 0xD8;

            if (i === 0) {
                assert(hasSOI, 'First strip should contain JPEG header (SOI marker)');
                assert(chunk.length > 500, 'First strip should be large (contains headers)');
            } else {
                assert(!hasSOI, `Strip ${i + 1} should not contain JPEG header`);
                assert(chunk.length < 100, `Strip ${i + 1} should be small (no headers)`);
            }
        }

        const finalChunk = encoder.finish();
        chunks.push(finalChunk);

        // Verify EOI marker in final chunk
        assert.equal(finalChunk[finalChunk.length - 2], 0xFF, 'Final chunk should end with 0xFF');
        assert.equal(finalChunk[finalChunk.length - 1], 0xD9, 'Final chunk should end with EOI marker');

        const jpegData = concatUint8Arrays(...chunks);
        validateJpeg(jpegData);
    })) {
        passed++;
    } else {
        failed++;
    }

    console.log('\n====================================');
    console.log(`Tests passed: ${passed}`);
    console.log(`Tests failed: ${failed}`);
    console.log('====================================');

    if (failed > 0) {
        process.exit(1);
    }
}

main();
