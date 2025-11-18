"use strict";

// For nodejs target, wasm-bindgen auto-loads the WASM module
const { StreamingJpegEncoder: RawStreamingJpegEncoder, WasmColorType } = require("./jpeg_encoder.js");

/**
 * Initialize the underlying WebAssembly module.
 *
 * For the CommonJS build using nodejs target, the WASM module is automatically
 * loaded. This function exists for API compatibility with the ESM build.
 * You can optionally pass wasm bytes to override the default loading.
 */
async function init(wasmBytes) {
    // In nodejs target, WASM is already initialized
    // This function is a no-op for compatibility
    return Promise.resolve();
}

// Maintain compatibility with the wasm-bindgen generated default export.
module.exports.default = init;
module.exports.init = init;

/**
 * Thin wrapper around the wasm-bindgen generated encoder that hides
 * implementation details and static helpers that consumers should not call.
 */
class StreamingJpegEncoder {
    #inner;

    constructor(width, height, color_type, quality) {
        this.#inner = new RawStreamingJpegEncoder(width, height, color_type, quality);
    }

    #requireActive() {
        if (!this.#inner) {
            throw new Error("Encoder has already been freed or finished");
        }
    }

    /**
     * Encode one or more complete rows. The return value contains any newly
     * produced JPEG bytes and clears the internal buffer.
     */
    encode_strip(data) {
        this.#requireActive();
        return this.#inner.encode_strip(data);
    }

    /**
     * Finalize the JPEG, free the underlying wasm allocations, and return any
     * remaining bytes. All rows must have been provided before calling this.
     */
    finish() {
        this.#requireActive();

        const bytes = this.#inner.finish();
        this.free();
        return bytes;
    }

    /**
     * Free the underlying wasm allocations. Calling this after `finish()` is
     * unnecessary because `finish()` already releases the resources.
     */
    free() {
        if (!this.#inner) {
            return;
        }

        this.#inner.free();
        this.#inner = null;
    }

    /**
     * Get JPEG header bytes without creating an encoder instance.
     * This is a static method for advanced use cases.
     */
    static header_bytes(width, height, color_type, quality) {
        return RawStreamingJpegEncoder.header_bytes(width, height, color_type, quality);
    }

    /**
     * Get JPEG footer bytes.
     * This is a static method for advanced use cases.
     */
    static footer_bytes() {
        return RawStreamingJpegEncoder.footer_bytes();
    }
}

module.exports.StreamingJpegEncoder = StreamingJpegEncoder;
module.exports.WasmColorType = WasmColorType;
