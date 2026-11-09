//! WebAssembly bindings for the streaming [`StripEncoder`].
//!
//! Built with `npm run build` into the `pkg/` directory and published to npm.
//! See the README's "WebAssembly / npm package" section for the JavaScript API.

use jpeg_encoder::{
    ChromaSubsamplingMethod, ColorType, Encoder, EncodingError, PixelDensity, PixelDensityUnit,
    QuantizationTableType, SamplingFactor, StripEncoder,
};
use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;

/// Pixel layout of the data passed to `encode_strip`
#[wasm_bindgen]
#[derive(Clone, Copy)]
pub enum WasmColorType {
    /// Grayscale, 1 byte per pixel
    Luma = 0,
    /// RGB, 3 bytes per pixel
    Rgb = 1,
    /// RGBA, 4 bytes per pixel (alpha is ignored)
    Rgba = 2,
    /// BGR, 3 bytes per pixel
    Bgr = 3,
    /// BGRA, 4 bytes per pixel (alpha is ignored)
    Bgra = 4,
    /// YCbCr, 3 bytes per pixel
    Ycbcr = 5,
    /// CMYK, 4 bytes per pixel
    Cmyk = 6,
    /// CMYK, 4 bytes per pixel, stored as YCCK
    CmykAsYcck = 7,
    /// YCCK, 4 bytes per pixel
    Ycck = 8,
}

impl From<WasmColorType> for ColorType {
    fn from(color_type: WasmColorType) -> Self {
        match color_type {
            WasmColorType::Luma => ColorType::Luma,
            WasmColorType::Rgb => ColorType::Rgb,
            WasmColorType::Rgba => ColorType::Rgba,
            WasmColorType::Bgr => ColorType::Bgr,
            WasmColorType::Bgra => ColorType::Bgra,
            WasmColorType::Ycbcr => ColorType::Ycbcr,
            WasmColorType::Cmyk => ColorType::Cmyk,
            WasmColorType::CmykAsYcck => ColorType::CmykAsYcck,
            WasmColorType::Ycck => ColorType::Ycck,
        }
    }
}

/// Chroma subsampling. `F_2_2` is 4:2:0, `F_1_1` is 4:4:4 (full colour detail)
#[wasm_bindgen]
#[derive(Clone, Copy)]
#[allow(non_camel_case_types)]
pub enum WasmSamplingFactor {
    F_1_1 = 0,
    F_2_1 = 1,
    F_1_2 = 2,
    F_2_2 = 3,
}

impl From<WasmSamplingFactor> for SamplingFactor {
    fn from(factor: WasmSamplingFactor) -> Self {
        match factor {
            WasmSamplingFactor::F_1_1 => SamplingFactor::F_1_1,
            WasmSamplingFactor::F_2_1 => SamplingFactor::F_2_1,
            WasmSamplingFactor::F_1_2 => SamplingFactor::F_1_2,
            WasmSamplingFactor::F_2_2 => SamplingFactor::F_2_2,
        }
    }
}

/// Unit of the pixel density written to the JFIF header
#[wasm_bindgen]
#[derive(Clone, Copy)]
pub enum WasmDensityUnit {
    /// No unit, the values only give the pixel aspect ratio
    AspectRatio = 0,
    /// Pixels per inch
    Inch = 1,
    /// Pixels per centimetre
    Centimeter = 2,
}

/// Quantization table presets (from mozjpeg), used for both luma and chroma
#[wasm_bindgen]
#[derive(Clone, Copy)]
pub enum WasmQuantizationTable {
    /// Annex K tables of the JPEG standard (the default)
    Default = 0,
    Flat = 1,
    /// Tuned for MS-SSIM
    MsSsim = 2,
    /// Tuned for PSNR-HVS
    PsnrHvs = 3,
    /// ImageMagick table by N. Robidoux
    ImageMagick = 4,
    KleinSilversteinCarney = 5,
    DentalXRays = 6,
    VisualDetectionModel = 7,
    ImprovedDetectionModel = 8,
}

impl From<WasmQuantizationTable> for QuantizationTableType {
    fn from(table: WasmQuantizationTable) -> Self {
        use QuantizationTableType::*;

        match table {
            WasmQuantizationTable::Default => Default,
            WasmQuantizationTable::Flat => Flat,
            WasmQuantizationTable::MsSsim => CustomMsSsim,
            WasmQuantizationTable::PsnrHvs => CustomPsnrHvs,
            WasmQuantizationTable::ImageMagick => ImageMagick,
            WasmQuantizationTable::KleinSilversteinCarney => KleinSilversteinCarney,
            WasmQuantizationTable::DentalXRays => DentalXRays,
            WasmQuantizationTable::VisualDetectionModel => VisualDetectionModel,
            WasmQuantizationTable::ImprovedDetectionModel => ImprovedDetectionModel,
        }
    }
}

/// Encoder settings besides size, colour type and quality. Built by the JS
/// wrapper from its options object.
#[wasm_bindgen]
#[derive(Default)]
pub struct EncoderSettings {
    sampling_factor: Option<SamplingFactor>,
    chroma_average: bool,
    density: Option<PixelDensity>,
    quantization_table: Option<WasmQuantizationTable>,
    restart_interval: u16,
    exif: Option<Vec<u8>>,
    icc_profile: Option<Vec<u8>>,
}

#[wasm_bindgen]
impl EncoderSettings {
    #[wasm_bindgen(constructor)]
    pub fn new() -> EncoderSettings {
        EncoderSettings::default()
    }

    pub fn set_sampling_factor(&mut self, factor: WasmSamplingFactor) {
        self.sampling_factor = Some(factor.into());
    }

    /// Box-average each block of chroma samples instead of taking the top-left pixel
    pub fn set_chroma_average(&mut self, average: bool) {
        self.chroma_average = average;
    }

    pub fn set_density(&mut self, x: u16, y: u16, unit: WasmDensityUnit) {
        let unit = match unit {
            WasmDensityUnit::AspectRatio => PixelDensityUnit::PixelAspectRatio,
            WasmDensityUnit::Inch => PixelDensityUnit::Inches,
            WasmDensityUnit::Centimeter => PixelDensityUnit::Centimeters,
        };
        self.density = Some(PixelDensity {
            density: (x, y),
            unit,
        });
    }

    pub fn set_quantization_table(&mut self, table: WasmQuantizationTable) {
        self.quantization_table = Some(table);
    }

    /// MCUs between restart markers; 0 disables them
    pub fn set_restart_interval(&mut self, interval: u16) {
        self.restart_interval = interval;
    }

    /// Raw EXIF (TIFF) data, without the `Exif\0\0` header
    pub fn set_exif(&mut self, data: Vec<u8>) {
        self.exif = Some(data);
    }

    pub fn set_icc_profile(&mut self, data: Vec<u8>) {
        self.icc_profile = Some(data);
    }
}

impl EncoderSettings {
    fn apply(&self, encoder: &mut Encoder<Vec<u8>>) -> Result<(), EncodingError> {
        if let Some(factor) = self.sampling_factor {
            encoder.set_sampling_factor(factor);
        }
        if self.chroma_average {
            encoder.set_chroma_subsampling_method(ChromaSubsamplingMethod::Average);
        }
        if let Some(density) = self.density {
            encoder.set_density(density);
        }
        if let Some(table) = self.quantization_table {
            encoder.set_quantization_tables(table.into(), table.into());
        }
        encoder.set_restart_interval(self.restart_interval);
        if let Some(exif) = &self.exif {
            encoder.add_exif_metadata(exif)?;
        }
        if let Some(icc) = &self.icc_profile {
            encoder.add_icc_profile(icc)?;
        }
        Ok(())
    }
}

fn to_js(err: EncodingError) -> JsValue {
    js_sys::Error::new(&err.to_string()).into()
}

fn drain(buffer: &mut Vec<u8>) -> Uint8Array {
    let array = Uint8Array::from(buffer.as_slice());
    buffer.clear();
    array
}

/// Streaming JPEG encoder: pass rows in with `encode_strip`, get JPEG bytes back
#[wasm_bindgen]
pub struct StreamingJpegEncoder {
    encoder: Option<StripEncoder<Vec<u8>>>,
}

#[wasm_bindgen]
impl StreamingJpegEncoder {
    /// Create an encoder. `quality` is 1 to 100. Without a sampling factor in
    /// `settings`, quality below 90 uses `F_2_2` (4:2:0) and 90 or above uses
    /// `F_1_1` (4:4:4).
    ///
    /// The JPEG headers are produced immediately and returned by the first
    /// call to `encode_strip` (or `take_output`).
    #[wasm_bindgen(constructor)]
    pub fn new(
        width: u16,
        height: u16,
        color_type: WasmColorType,
        quality: u8,
        settings: Option<EncoderSettings>,
    ) -> Result<StreamingJpegEncoder, JsValue> {
        if !(1..=100).contains(&quality) {
            return Err(js_sys::RangeError::new(&format!(
                "quality must be between 1 and 100, got {quality}"
            ))
            .into());
        }

        let mut encoder = Encoder::new(Vec::new(), quality);
        if let Some(settings) = settings {
            settings.apply(&mut encoder).map_err(to_js)?;
        }
        let encoder = encoder
            .into_strip_encoder(width, height, color_type.into())
            .map_err(to_js)?;

        Ok(StreamingJpegEncoder {
            encoder: Some(encoder),
        })
    }

    fn active(&mut self) -> Result<&mut StripEncoder<Vec<u8>>, JsValue> {
        self.encoder
            .as_mut()
            .ok_or_else(|| js_sys::Error::new("Encoder has already been finished").into())
    }

    /// Encode one or more complete rows and return the JPEG bytes produced so far
    ///
    /// Strips can have any height; bytes are only produced once an MCU row
    /// (8 rows, or 16 with vertical subsampling) is complete.
    pub fn encode_strip(&mut self, data: &[u8]) -> Result<Uint8Array, JsValue> {
        let encoder = self.active()?;
        encoder.encode_strip(data).map_err(to_js)?;
        Ok(drain(encoder.writer_mut()))
    }

    /// Write the end of the image and return the remaining bytes
    ///
    /// Throws, and leaves the encoder usable, if rows are still missing.
    pub fn finish(&mut self) -> Result<Uint8Array, JsValue> {
        let remaining = self.active()?.rows_remaining();
        if remaining != 0 {
            return Err(js_sys::Error::new(&format!(
                "Strip encoding error: {remaining} rows have not been encoded yet"
            ))
            .into());
        }

        let encoder = self.encoder.take().expect("checked above");
        let mut bytes = encoder.finish().map_err(to_js)?;
        Ok(drain(&mut bytes))
    }

    /// Return the bytes produced since the last call without encoding anything
    pub fn take_output(&mut self) -> Result<Uint8Array, JsValue> {
        Ok(drain(self.active()?.writer_mut()))
    }

    /// Number of rows that still have to be passed to `encode_strip`
    #[wasm_bindgen(getter)]
    pub fn rows_remaining(&self) -> usize {
        self.encoder.as_ref().map_or(0, |e| e.rows_remaining())
    }
}
