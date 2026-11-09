"use strict";
// CommonJS entry point of the npm package. Copied to pkg/cjs/index.cjs by scripts/build-bindings.js.
// The nodejs target of wasm-bindgen loads the WebAssembly module synchronously on require().

const {
    StreamingJpegEncoder: RawStreamingJpegEncoder,
    WasmColorType,
    WasmSamplingFactor,
} = require("./jpeg_encoder.js");

/** No-op kept for API parity with the ESM build: the module is already loaded. */
function init() {
    return Promise.resolve();
}

class StreamingJpegEncoder {
    #inner;

    constructor(width, height, colorType, quality, samplingFactor) {
        this.#inner = new RawStreamingJpegEncoder(width, height, colorType, quality, samplingFactor);
    }

    #active() {
        if (!this.#inner) {
            throw new Error("Encoder has already been finished or freed");
        }
        return this.#inner;
    }

    encode_strip(data) {
        return this.#active().encode_strip(data);
    }

    take_output() {
        return this.#active().take_output();
    }

    get rows_remaining() {
        return this.#inner ? this.#inner.rows_remaining : 0;
    }

    finish() {
        const bytes = this.#active().finish();
        this.free();
        return bytes;
    }

    free() {
        if (this.#inner) {
            this.#inner.free();
            this.#inner = undefined;
        }
    }

    [Symbol.dispose]() {
        this.free();
    }
}

function encodeJpeg(data, width, height, colorType = WasmColorType.Rgba, quality = 85, samplingFactor) {
    const encoder = new StreamingJpegEncoder(width, height, colorType, quality, samplingFactor);
    try {
        const body = encoder.encode_strip(data);
        const tail = encoder.finish();
        const out = new Uint8Array(body.length + tail.length);
        out.set(body, 0);
        out.set(tail, body.length);
        return out;
    } finally {
        encoder.free();
    }
}

module.exports = { init, default: init, StreamingJpegEncoder, WasmColorType, WasmSamplingFactor, encodeJpeg };
