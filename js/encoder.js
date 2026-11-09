// Shared by the ESM and CommonJS entry points. Copied next to them by
// scripts/build-bindings.js (as encoder.js and encoder.cjs).

function toSettings(EncoderSettings, WasmDensityUnit, options, samplingFactor) {
    const settings = new EncoderSettings();
    const o = options;

    const factor = o.samplingFactor ?? samplingFactor;
    if (factor != null) settings.set_sampling_factor(factor);
    if (o.chromaSubsampling === "average") settings.set_chroma_average(true);
    else if (o.chromaSubsampling != null && o.chromaSubsampling !== "nearest") {
        throw new TypeError(`chromaSubsampling must be "nearest" or "average", got ${o.chromaSubsampling}`);
    }

    if (o.dpi != null) {
        const [x, y] = typeof o.dpi === "number" ? [o.dpi, o.dpi] : [o.dpi.x, o.dpi.y];
        settings.set_density(x, y, WasmDensityUnit.Inch);
    } else if (o.density != null) {
        settings.set_density(o.density.x, o.density.y, o.density.unit ?? WasmDensityUnit.Inch);
    }

    if (o.quantizationTable != null) settings.set_quantization_table(o.quantizationTable);
    if (o.restartInterval != null) settings.set_restart_interval(o.restartInterval);
    if (o.exif != null) settings.set_exif(o.exif);
    if (o.iccProfile != null) settings.set_icc_profile(o.iccProfile);
    return settings;
}

function createEncoderClass(RawStreamingJpegEncoder, EncoderSettings, WasmColorType, WasmDensityUnit) {
    /**
     * Streaming JPEG encoder. Feed rows with `encode_strip()`, collect the bytes
     * each call returns, then call `finish()` for the rest.
     *
     *   new StreamingJpegEncoder(width, height, colorType, quality?, samplingFactor?)
     *   new StreamingJpegEncoder(width, height, colorType, options?)
     */
    class StreamingJpegEncoder {
        #inner;

        constructor(width, height, colorType, qualityOrOptions, samplingFactor) {
            const options =
                qualityOrOptions != null && typeof qualityOrOptions === "object"
                    ? qualityOrOptions
                    : { quality: qualityOrOptions };
            const quality = options.quality ?? 85;
            const settings = toSettings(EncoderSettings, WasmDensityUnit, options, samplingFactor);
            // The raw constructor takes ownership of `settings`
            this.#inner = new RawStreamingJpegEncoder(width, height, colorType, quality, settings);
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
     * Encode a whole image in one call.
     *
     *   encodeJpeg(pixels, width, height, colorType = Rgba, quality = 85, samplingFactor?)
     *   encodeJpeg(pixels, width, height, colorType, options)
     */
    function encodeJpeg(data, width, height, colorType = WasmColorType.Rgba, qualityOrOptions, samplingFactor) {
        const encoder = new StreamingJpegEncoder(width, height, colorType, qualityOrOptions, samplingFactor);
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

    return { StreamingJpegEncoder, encodeJpeg };
}

export { createEncoderClass };
