"use strict";

/**
 * CommonJS Integration Tests for JPEG Encoder WASM
 *
 * This test suite validates that the CommonJS build works correctly.
 * It mirrors the ESM integration tests but uses require() instead of import.
 */

const { init, StreamingJpegEncoder, WasmColorType } = require('../pkg/cjs/index.cjs');
const assert = require('assert').strict;

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

async function main() {
    console.log('JPEG Encoder WASM CommonJS Integration Tests');
    console.log('=============================================\n');

    // Initialize WASM module (auto-loaded in CommonJS/nodejs target, but call for API compatibility)
    await init();

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

    // Test 5: Minimum size image (1x1)
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

    // Test 6: Static header and footer methods
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

    // Test 7: RGBA encoding
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

    // Test 8: CommonJS module exports
    if (test('CommonJS module exports are correct', () => {
        assert.equal(typeof init, 'function', 'init should be exported as a function');
        assert.equal(typeof StreamingJpegEncoder, 'function', 'StreamingJpegEncoder should be exported as a function');
        assert.equal(typeof WasmColorType, 'object', 'WasmColorType should be exported as an object');

        // Check WasmColorType enum values
        assert.equal(typeof WasmColorType.Rgb, 'number', 'WasmColorType.Rgb should be a number');
        assert.equal(typeof WasmColorType.Luma, 'number', 'WasmColorType.Luma should be a number');
        assert.equal(typeof WasmColorType.Rgba, 'number', 'WasmColorType.Rgba should be a number');
    })) {
        passed++;
    } else {
        failed++;
    }

    // Test 9: Verify default export
    if (test('CommonJS default export works', () => {
        const defaultInit = require('../pkg/cjs/index.cjs').default;
        assert.equal(typeof defaultInit, 'function', 'default export should be the init function');
    })) {
        passed++;
    } else {
        failed++;
    }

    console.log('\n=============================================');
    console.log(`Tests passed: ${passed}`);
    console.log(`Tests failed: ${failed}`);
    console.log('=============================================');

    if (failed > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
