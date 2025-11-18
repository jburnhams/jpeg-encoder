/**
 * TypeScript type checking test
 * This file is not executed, just type-checked to verify TypeScript definitions are correct
 */

import { init, StreamingJpegEncoder, WasmColorType } from '../pkg/index.js';

async function testTypes() {
    // Test init function
    await init();

    // Test WasmColorType enum - should have all 9 variants with correct values
    const luma: WasmColorType = WasmColorType.Luma; // 0
    const rgb: WasmColorType = WasmColorType.Rgb; // 1
    const rgba: WasmColorType = WasmColorType.Rgba; // 2
    const bgr: WasmColorType = WasmColorType.Bgr; // 3
    const bgra: WasmColorType = WasmColorType.Bgra; // 4
    const ycbcr: WasmColorType = WasmColorType.Ycbcr; // 5
    const cmyk: WasmColorType = WasmColorType.Cmyk; // 6
    const cmykAsYcck: WasmColorType = WasmColorType.CmykAsYcck; // 7
    const ycck: WasmColorType = WasmColorType.Ycck; // 8

    // Test StreamingJpegEncoder class
    const encoder = new StreamingJpegEncoder(100, 100, WasmColorType.Rgb, 85);

    // Test methods
    const pixels = new Uint8Array(100 * 100 * 3);
    const chunk1: Uint8Array = encoder.encode_strip(pixels);
    const chunk2: Uint8Array = encoder.finish();
    encoder.free();

    // Test static methods
    const header: Uint8Array = StreamingJpegEncoder.header_bytes(100, 100, WasmColorType.Rgb, 85);
    const footer: Uint8Array = StreamingJpegEncoder.footer_bytes();

    // Verify numeric values match documentation
    const numericRgb: WasmColorType = 1; // Should be RGB
    const numericLuma: WasmColorType = 0; // Should be Luma

    return { chunk1, chunk2, header, footer };
}

// Export to avoid "unused" errors
export { testTypes };
