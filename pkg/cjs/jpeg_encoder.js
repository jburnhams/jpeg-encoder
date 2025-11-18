
let imports = {};
imports['__wbindgen_placeholder__'] = module.exports;

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

cachedTextDecoder.decode();

function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let WASM_VECTOR_LEN = 0;

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}
/**
 * @enum {0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}
 */
exports.WasmColorType = Object.freeze({
    Luma: 0, "0": "Luma",
    Rgb: 1, "1": "Rgb",
    Rgba: 2, "2": "Rgba",
    Bgr: 3, "3": "Bgr",
    Bgra: 4, "4": "Bgra",
    Ycbcr: 5, "5": "Ycbcr",
    Cmyk: 6, "6": "Cmyk",
    CmykAsYcck: 7, "7": "CmykAsYcck",
    Ycck: 8, "8": "Ycck",
});

const StreamingJpegEncoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_streamingjpegencoder_free(ptr >>> 0, 1));

class StreamingJpegEncoder {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        StreamingJpegEncoderFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_streamingjpegencoder_free(ptr, 0);
    }
    /**
     * @returns {Uint8Array}
     */
    take_output() {
        const ret = wasm.streamingjpegencoder_take_output(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Uint8Array} data
     * @returns {Uint8Array}
     */
    encode_strip(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.streamingjpegencoder_encode_strip(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {Uint8Array}
     */
    static footer_bytes() {
        const ret = wasm.streamingjpegencoder_footer_bytes();
        return ret;
    }
    /**
     * @param {number} width
     * @param {number} height
     * @param {WasmColorType} color_type
     * @param {number} quality
     * @returns {Uint8Array}
     */
    static header_bytes(width, height, color_type, quality) {
        const ret = wasm.streamingjpegencoder_header_bytes(width, height, color_type, quality);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {number} width
     * @param {number} height
     * @param {WasmColorType} color_type
     * @param {number} quality
     */
    constructor(width, height, color_type, quality) {
        const ret = wasm.streamingjpegencoder_new(width, height, color_type, quality);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        StreamingJpegEncoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Uint8Array}
     */
    finish() {
        const ret = wasm.streamingjpegencoder_finish(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) StreamingJpegEncoder.prototype[Symbol.dispose] = StreamingJpegEncoder.prototype.free;

exports.StreamingJpegEncoder = StreamingJpegEncoder;

exports.__wbg___wbindgen_throw_b855445ff6a94295 = function(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
};

exports.__wbg_new_from_slice_92f4d78ca282a2d2 = function(arg0, arg1) {
    const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
    return ret;
};

exports.__wbg_new_with_length_01aa0dc35aa13543 = function(arg0) {
    const ret = new Uint8Array(arg0 >>> 0);
    return ret;
};

exports.__wbindgen_cast_2241b6af4c4b2941 = function(arg0, arg1) {
    // Cast intrinsic for `Ref(String) -> Externref`.
    const ret = getStringFromWasm0(arg0, arg1);
    return ret;
};

exports.__wbindgen_init_externref_table = function() {
    const table = wasm.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
    ;
};

const wasmPath = `${__dirname}/jpeg_encoder_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
const wasm = exports.__wasm = new WebAssembly.Instance(wasmModule, imports).exports;

wasm.__wbindgen_start();

