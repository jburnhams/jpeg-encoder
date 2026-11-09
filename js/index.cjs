'use strict';
// CommonJS entry point of the npm package. Copied to pkg/cjs/index.cjs by scripts/build-bindings.js.
// The nodejs target of wasm-bindgen loads the WebAssembly module synchronously on require().

const {
  EncoderSettings,
  StreamingJpegEncoder: RawStreamingJpegEncoder,
  WasmColorType,
  WasmDensityUnit,
  WasmQuantizationTable,
  WasmSamplingFactor,
} = require('./jpeg_encoder.js');
const { createEncoderClass } = require('./encoder.cjs');

/** No-op kept for API parity with the ESM build: the module is already loaded. */
function init() {
  return Promise.resolve();
}

const { StreamingJpegEncoder, encodeJpeg } = createEncoderClass(
  RawStreamingJpegEncoder,
  EncoderSettings,
  WasmColorType,
  WasmDensityUnit
);

module.exports = {
  init,
  default: init,
  StreamingJpegEncoder,
  encodeJpeg,
  WasmColorType,
  WasmDensityUnit,
  WasmQuantizationTable,
  WasmSamplingFactor,
};
