// Encoder settings covered by the golden hashes and the visual report
import { WasmQuantizationTable, WasmSamplingFactor } from 'jpeg-encoder-wasm';

export const goldenCases = [
  { name: 'q30', options: { quality: 30 } },
  { name: 'q50', options: { quality: 50 } },
  { name: 'q75', options: { quality: 75 } },
  { name: 'q85', options: { quality: 85 } },
  { name: 'q95', options: { quality: 95 } },
  { name: 'q75-444', options: { quality: 75, samplingFactor: WasmSamplingFactor.F_1_1 } },
  { name: 'q75-422', options: { quality: 75, samplingFactor: WasmSamplingFactor.F_2_1 } },
  { name: 'q75-average', options: { quality: 75, chromaSubsampling: 'average' } },
  { name: 'q75-imagemagick', options: { quality: 75, quantizationTable: WasmQuantizationTable.ImageMagick } },
  { name: 'q75-psnr-hvs', options: { quality: 75, quantizationTable: WasmQuantizationTable.PsnrHvs } },
  { name: 'q75-restart', options: { quality: 75, restartInterval: 8 } },
];
