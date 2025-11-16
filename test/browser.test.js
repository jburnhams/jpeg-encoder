/**
 * @jest-environment jsdom
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { StreamingJpegEncoder, WasmColorType } from '../pkg/jpeg_encoder.js';
import { createCanvas } from 'canvas';

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
    expect(data[0]).toBe(0xFF);
    expect(data[1]).toBe(0xD8);

    // Check EOI marker at the end (0xFF 0xD9)
    expect(data[data.length - 2]).toBe(0xFF);
    expect(data[data.length - 1]).toBe(0xD9);
}

/**
 * Creates image data from a canvas
 */
function createCanvasImageData(width, height, drawFn) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Call the draw function
    drawFn(ctx, width, height);

    // Get image data
    const imageData = ctx.getImageData(0, 0, width, height);
    return imageData;
}

/**
 * Extract RGB data from ImageData (removing alpha channel)
 */
function imageDataToRGB(imageData) {
    const rgb = new Uint8Array((imageData.data.length / 4) * 3);
    for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
        rgb[j] = imageData.data[i];         // R
        rgb[j + 1] = imageData.data[i + 1]; // G
        rgb[j + 2] = imageData.data[i + 2]; // B
        // Skip alpha (i + 3)
    }
    return rgb;
}

describe('JPEG Encoder Browser Integration Tests', () => {
    test('should encode solid color canvas to JPEG', () => {
        const width = 64;
        const height = 64;

        const imageData = createCanvasImageData(width, height, (ctx) => {
            ctx.fillStyle = '#FF0000';
            ctx.fillRect(0, 0, width, height);
        });

        const pixels = imageDataToRGB(imageData);

        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 85);
        const chunk1 = encoder.encode_strip(pixels);
        const chunk2 = encoder.finish();
        const jpegData = concatUint8Arrays(chunk1, chunk2);

        expect(jpegData.length).toBeGreaterThan(0);
        validateJpeg(jpegData);
    });

    test('should encode gradient canvas to JPEG', () => {
        const width = 128;
        const height = 128;

        const imageData = createCanvasImageData(width, height, (ctx, w, h) => {
            const gradient = ctx.createLinearGradient(0, 0, w, h);
            gradient.addColorStop(0, '#FF0000');
            gradient.addColorStop(0.5, '#00FF00');
            gradient.addColorStop(1, '#0000FF');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, w, h);
        });

        const pixels = imageDataToRGB(imageData);

        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 85);
        const chunk1 = encoder.encode_strip(pixels);
        const chunk2 = encoder.finish();
        const jpegData = concatUint8Arrays(chunk1, chunk2);

        expect(jpegData.length).toBeGreaterThan(0);
        validateJpeg(jpegData);
    });

    test('should encode canvas with shapes to JPEG', () => {
        const width = 256;
        const height = 256;

        const imageData = createCanvasImageData(width, height, (ctx, w, h) => {
            // Background
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, w, h);

            // Draw some shapes
            ctx.fillStyle = '#FF0000';
            ctx.fillRect(20, 20, 60, 60);

            ctx.fillStyle = '#00FF00';
            ctx.beginPath();
            ctx.arc(150, 50, 30, 0, 2 * Math.PI);
            ctx.fill();

            ctx.fillStyle = '#0000FF';
            ctx.beginPath();
            ctx.moveTo(50, 150);
            ctx.lineTo(100, 200);
            ctx.lineTo(0, 200);
            ctx.closePath();
            ctx.fill();
        });

        const pixels = imageDataToRGB(imageData);

        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 85);
        const chunk1 = encoder.encode_strip(pixels);
        const chunk2 = encoder.finish();
        const jpegData = concatUint8Arrays(chunk1, chunk2);

        expect(jpegData.length).toBeGreaterThan(0);
        validateJpeg(jpegData);
    });

    test('should handle RGBA canvas data', () => {
        const width = 64;
        const height = 64;

        const imageData = createCanvasImageData(width, height, (ctx) => {
            ctx.fillStyle = 'rgba(255, 128, 0, 0.5)';
            ctx.fillRect(0, 0, width, height);
        });

        // Use RGBA data directly
        const pixels = new Uint8Array(imageData.data);

        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgba, 85);
        const chunk1 = encoder.encode_strip(pixels);
        const chunk2 = encoder.finish();
        const jpegData = concatUint8Arrays(chunk1, chunk2);

        expect(jpegData.length).toBeGreaterThan(0);
        validateJpeg(jpegData);
    });

    test('should encode text rendered on canvas', () => {
        const width = 200;
        const height = 100;

        const imageData = createCanvasImageData(width, height, (ctx) => {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);

            ctx.fillStyle = '#000000';
            ctx.font = '30px Arial';
            ctx.fillText('JPEG Test', 10, 50);
        });

        const pixels = imageDataToRGB(imageData);

        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 85);
        const chunk1 = encoder.encode_strip(pixels);
        const chunk2 = encoder.finish();
        const jpegData = concatUint8Arrays(chunk1, chunk2);

        expect(jpegData.length).toBeGreaterThan(0);
        validateJpeg(jpegData);
    });

    test('should work with different quality levels', () => {
        const width = 100;
        const height = 100;

        const imageData = createCanvasImageData(width, height, (ctx) => {
            ctx.fillStyle = '#808080';
            ctx.fillRect(0, 0, width, height);
        });

        const pixels = imageDataToRGB(imageData);

        const qualities = [50, 85, 95];
        const results = [];

        for (const quality of qualities) {
            const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, quality);
            const chunk1 = encoder.encode_strip(pixels);
            const chunk2 = encoder.finish();
            const jpegData = concatUint8Arrays(chunk1, chunk2);

            validateJpeg(jpegData);
            results.push({ quality, size: jpegData.length });
        }

        // All should produce valid output
        results.forEach(result => {
            expect(result.size).toBeGreaterThan(0);
        });
    });

    test('should work in browser-like environment (jsdom)', () => {
        // Verify we're actually running in jsdom
        expect(typeof window).toBe('object');
        expect(typeof document).toBe('object');

        // Create a simple Uint8Array (browser-compatible)
        const width = 32;
        const height = 32;
        const pixels = new Uint8Array(width * height * 3);
        pixels.fill(128);

        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 85);
        const chunk1 = encoder.encode_strip(pixels);
        const chunk2 = encoder.finish();
        const jpegData = concatUint8Arrays(chunk1, chunk2);

        // Verify Uint8Array works in browser environment
        expect(jpegData instanceof Uint8Array).toBe(true);
        expect(jpegData.buffer instanceof ArrayBuffer).toBe(true);

        validateJpeg(jpegData);
    });

    test('should handle ImageData object directly', () => {
        const width = 50;
        const height = 50;

        const imageData = createCanvasImageData(width, height, (ctx) => {
            ctx.fillStyle = '#FF00FF';
            ctx.fillRect(0, 0, width, height);
        });

        // Verify ImageData structure (as it would be in browser)
        expect(imageData.width).toBe(width);
        expect(imageData.height).toBe(height);
        expect(imageData.data.length).toBe(width * height * 4);

        const pixels = imageDataToRGB(imageData);

        const encoder = new StreamingJpegEncoder(width, height, WasmColorType.Rgb, 85);
        const chunk1 = encoder.encode_strip(pixels);
        const chunk2 = encoder.finish();
        const jpegData = concatUint8Arrays(chunk1, chunk2);

        validateJpeg(jpegData);
    });
});
