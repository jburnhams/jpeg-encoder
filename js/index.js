// ESM entry point of the npm package. Copied to pkg/esm/index.js by scripts/build-bindings.js.
import initWasm, {
    StreamingJpegEncoder as RawStreamingJpegEncoder,
    WasmColorType,
    WasmSamplingFactor,
} from "./jpeg_encoder.js";

export { WasmColorType, WasmSamplingFactor };

let ready;

const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;

async function loadDefaultModule() {
    const url = new URL("./jpeg_encoder_bg.wasm", import.meta.url);
    if (isNode && url.protocol === "file:") {
        // fetch() can't read file:// URLs in Node, so read the bundled file directly.
        // The specifier is hidden from bundlers, which never take this branch.
        const fs = "node:fs/promises";
        const { readFile } = await import(/* webpackIgnore: true */ /* @vite-ignore */ fs);
        return readFile(url);
    }
    return url;
}

/**
 * Load the WebAssembly module. Must be awaited once before creating encoders;
 * later calls return the same promise.
 *
 * With no argument the bundled `jpeg_encoder_bg.wasm` is loaded, in Node and
 * in browsers. Pass a URL, Response, bytes or `WebAssembly.Module` to load it
 * from somewhere else.
 */
export function init(module) {
    if (!ready) {
        ready = (async () => {
            const source = module ?? (await loadDefaultModule());
            await initWasm({ module_or_path: source });
        })();
        ready.catch(() => {
            ready = undefined;
        });
    }
    return ready;
}

export default init;

/**
 * Streaming JPEG encoder. Feed rows with `encode_strip()`, collect the bytes
 * each call returns, then call `finish()` for the rest.
 */
export class StreamingJpegEncoder {
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

    /** Encode one or more complete rows and return the JPEG bytes produced so far. */
    encode_strip(data) {
        return this.#active().encode_strip(data);
    }

    /** Return bytes produced so far (the headers, right after construction) without encoding. */
    take_output() {
        return this.#active().take_output();
    }

    /** Number of rows still to be passed to `encode_strip()`. */
    get rows_remaining() {
        return this.#inner ? this.#inner.rows_remaining : 0;
    }

    /**
     * Write the end of the image, free the WebAssembly memory and return the
     * remaining bytes. Throws, and keeps the encoder usable, if rows are missing.
     */
    finish() {
        const bytes = this.#active().finish();
        this.free();
        return bytes;
    }

    /** Free the WebAssembly memory without finishing. Safe to call more than once. */
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

/**
 * Encode a whole image in one call. `init()` must have been awaited.
 */
export function encodeJpeg(data, width, height, colorType = WasmColorType.Rgba, quality = 85, samplingFactor) {
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
