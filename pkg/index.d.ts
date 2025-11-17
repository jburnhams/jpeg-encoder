import initWasm, { StreamingJpegEncoder as _RawStreamingJpegEncoder, WasmColorType } from "./jpeg_encoder.js";

/**
 * Initialize the underlying WebAssembly module.
 *
 * This must be awaited before constructing a {@link StreamingJpegEncoder}.
 * By default it loads the bundled `jpeg_encoder_bg.wasm` next to this file.
 */
export function init(module?: Parameters<typeof initWasm>[0]): Promise<void>;

/**
 * Thin wrapper around the wasm-bindgen generated encoder that hides
 * implementation details and static helpers that consumers should not call.
 */
export class StreamingJpegEncoder {
    private _inner: _RawStreamingJpegEncoder | null;
    constructor(width: number, height: number, color_type: WasmColorType, quality: number);
    /**
     * Encode one or more complete rows. The returned bytes are any newly
     * produced output, and the internal buffer is cleared.
     */
    encode_strip(data: Uint8Array): Uint8Array;
    /**
     * Finalize the JPEG, verify all rows were provided, release underlying
     * wasm allocations, and return remaining bytes.
     */
    finish(): Uint8Array;
    /**
     * Release the underlying wasm allocations early. Normally unnecessary
     * because `finish()` already frees resources.
     */
    free(): void;
}

export { WasmColorType };
