import initWasm, { StreamingJpegEncoder as RawStreamingJpegEncoder, WasmColorType } from "./jpeg_encoder.js";

/**
 * Initialize the underlying WebAssembly module.
 *
 * This must be awaited before constructing a {@link StreamingJpegEncoder}.
 * By default it loads the bundled `jpeg_encoder_bg.wasm` next to this file.
 */
export async function init(module) {
    await initWasm(module);
}

/**
 * Thin wrapper around the wasm-bindgen generated encoder that hides
 * implementation details and static helpers that consumers should not call.
 */
export class StreamingJpegEncoder {
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
}

export { WasmColorType };
