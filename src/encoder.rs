use crate::fdct::fdct;
use crate::huffman::{CodingClass, HuffmanTable};
use crate::image_buffer::*;
use crate::marker::Marker;
use crate::quantization::{QuantizationTable, QuantizationTableType};
use crate::writer::{JfifWrite, JfifWriter, ZIGZAG};
use crate::{Density, EncodingError};

use alloc::vec;
use alloc::vec::Vec;
use core::marker::PhantomData;

#[cfg(feature = "std")]
use std::io::BufWriter;

#[cfg(feature = "std")]
use std::fs::File;

#[cfg(feature = "std")]
use std::path::Path;

/// # Color types used in encoding
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum JpegColorType {
    /// One component grayscale colorspace
    Luma,

    /// Three component YCbCr colorspace
    Ycbcr,

    /// 4 Component CMYK colorspace
    Cmyk,

    /// 4 Component YCbCrK colorspace
    Ycck,
}

impl JpegColorType {
    pub(crate) fn get_num_components(self) -> usize {
        use JpegColorType::*;

        match self {
            Luma => 1,
            Ycbcr => 3,
            Cmyk | Ycck => 4,
        }
    }
}

/// # Color types for input images
///
/// Available color input formats for [Encoder::encode]. Other types can be used
/// by implementing an [ImageBuffer](crate::ImageBuffer).
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ColorType {
    /// Grayscale with 1 byte per pixel
    Luma,

    /// RGB with 3 bytes per pixel
    Rgb,

    /// Red, Green, Blue with 4 bytes per pixel. The alpha channel will be ignored during encoding.
    Rgba,

    /// RGB with 3 bytes per pixel
    Bgr,

    /// RGBA with 4 bytes per pixel. The alpha channel will be ignored during encoding.
    Bgra,

    /// YCbCr with 3 bytes per pixel.
    Ycbcr,

    /// CMYK with 4 bytes per pixel.
    Cmyk,

    /// CMYK with 4 bytes per pixel. Encoded as YCCK (YCbCrK)
    CmykAsYcck,

    /// YCCK (YCbCrK) with 4 bytes per pixel.
    Ycck,
}

impl ColorType {
    pub(crate) fn get_bytes_per_pixel(self) -> usize {
        use ColorType::*;

        match self {
            Luma => 1,
            Rgb | Bgr | Ycbcr => 3,
            Rgba | Bgra | Cmyk | CmykAsYcck | Ycck => 4,
        }
    }
}

fn color_type_to_jpeg(color_type: ColorType) -> JpegColorType {
    match color_type {
        ColorType::Luma => JpegColorType::Luma,
        ColorType::Rgb | ColorType::Rgba | ColorType::Bgr | ColorType::Bgra | ColorType::Ycbcr => {
            JpegColorType::Ycbcr
        }
        ColorType::Cmyk => JpegColorType::Cmyk,
        ColorType::CmykAsYcck | ColorType::Ycck => JpegColorType::Ycck,
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
/// # Sampling factors for chroma subsampling
///
/// ## Warning
/// Sampling factor of 4 are not supported by all decoders or applications
#[allow(non_camel_case_types)]
pub enum SamplingFactor {
    F_1_1 = 1 << 4 | 1,
    F_2_1 = 2 << 4 | 1,
    F_1_2 = 1 << 4 | 2,
    F_2_2 = 2 << 4 | 2,
    F_4_1 = 4 << 4 | 1,
    F_4_2 = 4 << 4 | 2,
    F_1_4 = 1 << 4 | 4,
    F_2_4 = 2 << 4 | 4,

    /// Alias for F_1_1
    R_4_4_4 = 0x80 | 1 << 4 | 1,

    /// Alias for F_1_2
    R_4_4_0 = 0x80 | 1 << 4 | 2,

    /// Alias for F_1_4
    R_4_4_1 = 0x80 | 1 << 4 | 4,

    /// Alias for F_2_1
    R_4_2_2 = 0x80 | 2 << 4 | 1,

    /// Alias for F_2_2
    R_4_2_0 = 0x80 | 2 << 4 | 2,

    /// Alias for F_2_4
    R_4_2_1 = 0x80 | 2 << 4 | 4,

    /// Alias for F_4_1
    R_4_1_1 = 0x80 | 4 << 4 | 1,

    /// Alias for F_4_2
    R_4_1_0 = 0x80 | 4 << 4 | 2,
}

impl SamplingFactor {
    /// Get variant for supplied factors or None if not supported
    pub fn from_factors(horizontal: u8, vertical: u8) -> Option<SamplingFactor> {
        use SamplingFactor::*;

        match (horizontal, vertical) {
            (1, 1) => Some(F_1_1),
            (1, 2) => Some(F_1_2),
            (1, 4) => Some(F_1_4),
            (2, 1) => Some(F_2_1),
            (2, 2) => Some(F_2_2),
            (2, 4) => Some(F_2_4),
            (4, 1) => Some(F_4_1),
            (4, 2) => Some(F_4_2),
            _ => None,
        }
    }

    pub(crate) fn get_sampling_factors(self) -> (u8, u8) {
        let value = self as u8;
        ((value >> 4) & 0x07, value & 0xf)
    }

    pub(crate) fn supports_interleaved(self) -> bool {
        use SamplingFactor::*;

        // Interleaved mode is only supported with h/v sampling factors of 1 or 2.
        // Sampling factors of 4 needs sequential encoding
        matches!(
            self,
            F_1_1 | F_2_1 | F_1_2 | F_2_2 | R_4_4_4 | R_4_4_0 | R_4_2_2 | R_4_2_0
        )
    }
}

pub(crate) struct Component {
    pub id: u8,
    pub quantization_table: u8,
    pub dc_huffman_table: u8,
    pub ac_huffman_table: u8,
    pub horizontal_sampling_factor: u8,
    pub vertical_sampling_factor: u8,
}

/// Public description of a JPEG component used by strip encoding constructors.
#[derive(Clone, Debug)]
pub struct ComponentSpec {
    pub id: u8,
    pub quantization_table: u8,
    pub dc_huffman_table: u8,
    pub ac_huffman_table: u8,
    pub horizontal_sampling_factor: u8,
    pub vertical_sampling_factor: u8,
}

impl From<&Component> for ComponentSpec {
    fn from(component: &Component) -> Self {
        ComponentSpec {
            id: component.id,
            quantization_table: component.quantization_table,
            dc_huffman_table: component.dc_huffman_table,
            ac_huffman_table: component.ac_huffman_table,
            horizontal_sampling_factor: component.horizontal_sampling_factor,
            vertical_sampling_factor: component.vertical_sampling_factor,
        }
    }
}

impl From<ComponentSpec> for Component {
    fn from(spec: ComponentSpec) -> Self {
        Component {
            id: spec.id,
            quantization_table: spec.quantization_table,
            dc_huffman_table: spec.dc_huffman_table,
            ac_huffman_table: spec.ac_huffman_table,
            horizontal_sampling_factor: spec.horizontal_sampling_factor,
            vertical_sampling_factor: spec.vertical_sampling_factor,
        }
    }
}

macro_rules! add_component {
    ($components:expr, $id:expr, $dest:expr, $h_sample:expr, $v_sample:expr) => {
        $components.push(Component {
            id: $id,
            quantization_table: $dest,
            dc_huffman_table: $dest,
            ac_huffman_table: $dest,
            horizontal_sampling_factor: $h_sample,
            vertical_sampling_factor: $v_sample,
        });
    };
}

fn write_file_headers<W: JfifWrite>(
    writer: &mut JfifWriter<W>,
    density: Density,
    jpeg_color_type: JpegColorType,
    app_segments: &[(u8, Vec<u8>)],
) -> Result<(), EncodingError> {
    writer.write_marker(Marker::SOI)?;
    writer.write_header(&density)?;

    if jpeg_color_type == JpegColorType::Cmyk {
        // Set ColorTransform info to "Unknown"
        let app_14 = b"Adobe\0\0\0\0\0\0\0";
        writer.write_segment(Marker::APP(14), app_14.as_ref())?;
    } else if jpeg_color_type == JpegColorType::Ycck {
        // Set ColorTransform info to YCCK
        let app_14 = b"Adobe\0\0\0\0\0\0\x02";
        writer.write_segment(Marker::APP(14), app_14.as_ref())?;
    }

    for (nr, data) in app_segments {
        writer.write_segment(Marker::APP(*nr), data)?;
    }

    Ok(())
}

fn write_frame_header_common<W: JfifWrite>(
    writer: &mut JfifWriter<W>,
    width: u16,
    height: u16,
    components: &[Component],
    progressive: bool,
    q_tables: &[QuantizationTable; 2],
    huffman_tables: &[(HuffmanTable, HuffmanTable); 2],
    restart_interval: Option<u16>,
    component_count: usize,
) -> Result<(), EncodingError> {
    writer.write_frame_header(width, height, components, progressive)?;

    writer.write_quantization_segment(0, &q_tables[0])?;
    writer.write_quantization_segment(1, &q_tables[1])?;

    writer.write_huffman_segment(CodingClass::Dc, 0, &huffman_tables[0].0)?;
    writer.write_huffman_segment(CodingClass::Ac, 0, &huffman_tables[0].1)?;

    if component_count >= 3 {
        writer.write_huffman_segment(CodingClass::Dc, 1, &huffman_tables[1].0)?;
        writer.write_huffman_segment(CodingClass::Ac, 1, &huffman_tables[1].1)?;
    }

    if let Some(restart_interval) = restart_interval {
        writer.write_dri(restart_interval)?;
    }

    Ok(())
}

fn build_components(sampling_factor: SamplingFactor, color: JpegColorType) -> Vec<Component> {
    let (horizontal_sampling_factor, vertical_sampling_factor) =
        sampling_factor.get_sampling_factors();

    let mut components = Vec::new();

    match color {
        JpegColorType::Luma => {
            add_component!(components, 0, 0, 1, 1);
        }
        JpegColorType::Ycbcr => {
            add_component!(
                components,
                0,
                0,
                horizontal_sampling_factor,
                vertical_sampling_factor
            );
            add_component!(components, 1, 1, 1, 1);
            add_component!(components, 2, 1, 1, 1);
        }
        JpegColorType::Cmyk => {
            add_component!(components, 0, 1, 1, 1);
            add_component!(components, 1, 1, 1, 1);
            add_component!(components, 2, 1, 1, 1);
            add_component!(
                components,
                3,
                0,
                horizontal_sampling_factor,
                vertical_sampling_factor
            );
        }
        JpegColorType::Ycck => {
            add_component!(
                components,
                0,
                0,
                horizontal_sampling_factor,
                vertical_sampling_factor
            );
            add_component!(components, 1, 1, 1, 1);
            add_component!(components, 2, 1, 1, 1);
            add_component!(
                components,
                3,
                0,
                horizontal_sampling_factor,
                vertical_sampling_factor
            );
        }
    }

    components
}

/// # The JPEG encoder
pub struct Encoder<W: JfifWrite> {
    writer: JfifWriter<W>,
    density: Density,
    quality: u8,

    components: Vec<Component>,
    quantization_tables: [QuantizationTableType; 2],
    huffman_tables: [(HuffmanTable, HuffmanTable); 2],

    sampling_factor: SamplingFactor,

    progressive_scans: Option<u8>,

    restart_interval: Option<u16>,

    optimize_huffman_table: bool,

    app_segments: Vec<(u8, Vec<u8>)>,
}

impl<W: JfifWrite> Encoder<W> {
    /// Create a new encoder with the given quality
    ///
    /// The quality must be between 1 and 100 where 100 is the highest image quality.<br>
    /// By default, quality settings below 90 use a chroma subsampling (2x2 / 4:2:0) which can
    /// be changed with [set_sampling_factor](Encoder::set_sampling_factor)
    pub fn new(w: W, quality: u8) -> Encoder<W> {
        let huffman_tables = [
            (
                HuffmanTable::default_luma_dc(),
                HuffmanTable::default_luma_ac(),
            ),
            (
                HuffmanTable::default_chroma_dc(),
                HuffmanTable::default_chroma_ac(),
            ),
        ];

        let quantization_tables = [
            QuantizationTableType::Default,
            QuantizationTableType::Default,
        ];

        let sampling_factor = if quality < 90 {
            SamplingFactor::F_2_2
        } else {
            SamplingFactor::F_1_1
        };

        Encoder {
            writer: JfifWriter::new(w),
            density: Density::None,
            quality,
            components: vec![],
            quantization_tables,
            huffman_tables,
            sampling_factor,
            progressive_scans: None,
            restart_interval: None,
            optimize_huffman_table: false,
            app_segments: Vec::new(),
        }
    }

    /// Set pixel density for the image
    ///
    /// By default, this value is None which is equal to "1 pixel per pixel".
    pub fn set_density(&mut self, density: Density) {
        self.density = density;
    }

    /// Return pixel density
    pub fn density(&self) -> Density {
        self.density
    }

    /// Set chroma subsampling factor
    pub fn set_sampling_factor(&mut self, sampling: SamplingFactor) {
        self.sampling_factor = sampling;
    }

    /// Get chroma subsampling factor
    pub fn sampling_factor(&self) -> SamplingFactor {
        self.sampling_factor
    }

    /// Set quantization tables for luma and chroma components
    pub fn set_quantization_tables(
        &mut self,
        luma: QuantizationTableType,
        chroma: QuantizationTableType,
    ) {
        self.quantization_tables = [luma, chroma];
    }

    /// Get configured quantization tables
    pub fn quantization_tables(&self) -> &[QuantizationTableType; 2] {
        &self.quantization_tables
    }

    /// Controls if progressive encoding is used.
    ///
    /// By default, progressive encoding uses 4 scans.<br>
    /// Use [set_progressive_scans](Encoder::set_progressive_scans) to use a different number of scans
    pub fn set_progressive(&mut self, progressive: bool) {
        self.progressive_scans = if progressive { Some(4) } else { None };
    }

    /// Set number of scans per component for progressive encoding
    ///
    /// Number of scans must be between 2 and 64.
    /// There is at least one scan for the DC coefficients and one for the remaining 63 AC coefficients.
    ///
    /// # Panics
    /// If number of scans is not within valid range
    pub fn set_progressive_scans(&mut self, scans: u8) {
        assert!(
            (2..=64).contains(&scans),
            "Invalid number of scans: {}",
            scans
        );
        self.progressive_scans = Some(scans);
    }

    /// Return number of progressive scans if progressive encoding is enabled
    pub fn progressive_scans(&self) -> Option<u8> {
        self.progressive_scans
    }

    /// Set restart interval
    ///
    /// Set numbers of MCUs between restart markers.
    pub fn set_restart_interval(&mut self, interval: u16) {
        self.restart_interval = if interval == 0 { None } else { Some(interval) };
    }

    /// Return the restart interval
    pub fn restart_interval(&self) -> Option<u16> {
        self.restart_interval
    }

    /// Set if optimized huffman table should be created
    ///
    /// Optimized tables result in slightly smaller file sizes but decrease encoding performance.
    pub fn set_optimized_huffman_tables(&mut self, optimize_huffman_table: bool) {
        self.optimize_huffman_table = optimize_huffman_table;
    }

    /// Returns if optimized huffman table should be generated
    pub fn optimized_huffman_tables(&self) -> bool {
        self.optimize_huffman_table
    }

    /// Appends a custom app segment to the JFIF file
    ///
    /// Segment numbers need to be in the range between 1 and 15<br>
    /// The maximum allowed data length is 2^16 - 2 bytes.
    ///
    /// # Errors
    ///
    /// Returns an error if the segment number is invalid or data exceeds the allowed size
    pub fn add_app_segment(&mut self, segment_nr: u8, data: &[u8]) -> Result<(), EncodingError> {
        if segment_nr == 0 || segment_nr > 15 {
            Err(EncodingError::InvalidAppSegment(segment_nr))
        } else if data.len() > 65533 {
            Err(EncodingError::AppSegmentTooLarge(data.len()))
        } else {
            self.app_segments.push((segment_nr, data.to_vec()));
            Ok(())
        }
    }

    /// Add an ICC profile
    ///
    /// The maximum allowed data length is 16,707,345 bytes.
    ///
    /// # Errors
    ///
    /// Returns an Error if the data exceeds the maximum size for the ICC profile
    pub fn add_icc_profile(&mut self, data: &[u8]) -> Result<(), EncodingError> {
        // Based on https://www.color.org/ICC_Minor_Revision_for_Web.pdf
        // B.4  Embedding ICC profiles in JFIF files

        const MARKER: &[u8; 12] = b"ICC_PROFILE\0";
        const MAX_CHUNK_LENGTH: usize = 65535 - 2 - 12 - 2;

        let num_chunks = ceil_div(data.len(), MAX_CHUNK_LENGTH);

        // Sequence number is stored as a byte and starts with 1
        if num_chunks >= 255 {
            return Err(EncodingError::IccTooLarge(data.len()));
        }

        let mut chunk_data = Vec::with_capacity(MAX_CHUNK_LENGTH);

        for (i, data) in data.chunks(MAX_CHUNK_LENGTH).enumerate() {
            chunk_data.clear();
            chunk_data.extend_from_slice(MARKER);
            chunk_data.push(i as u8 + 1);
            chunk_data.push(num_chunks as u8);
            chunk_data.extend_from_slice(data);

            self.add_app_segment(2, &chunk_data)?;
        }

        Ok(())
    }

    /// Encode an image
    ///
    /// Data format and length must conform to specified width, height and color type.
    pub fn encode(
        self,
        data: &[u8],
        width: u16,
        height: u16,
        color_type: ColorType,
    ) -> Result<(), EncodingError> {
        let required_data_len = width as usize * height as usize * color_type.get_bytes_per_pixel();

        if data.len() < required_data_len {
            return Err(EncodingError::BadImageData {
                length: data.len(),
                required: required_data_len,
            });
        }

        #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
        {
            if std::is_x86_feature_detected!("avx2") {
                use crate::avx2::*;

                return match color_type {
                    ColorType::Luma => self
                        .encode_image_internal::<_, AVX2Operations>(GrayImage(data, width, height)),
                    ColorType::Rgb => self.encode_image_internal::<_, AVX2Operations>(
                        RgbImageAVX2(data, width, height),
                    ),
                    ColorType::Rgba => self.encode_image_internal::<_, AVX2Operations>(
                        RgbaImageAVX2(data, width, height),
                    ),
                    ColorType::Bgr => self.encode_image_internal::<_, AVX2Operations>(
                        BgrImageAVX2(data, width, height),
                    ),
                    ColorType::Bgra => self.encode_image_internal::<_, AVX2Operations>(
                        BgraImageAVX2(data, width, height),
                    ),
                    ColorType::Ycbcr => self.encode_image_internal::<_, AVX2Operations>(
                        YCbCrImage(data, width, height),
                    ),
                    ColorType::Cmyk => self
                        .encode_image_internal::<_, AVX2Operations>(CmykImage(data, width, height)),
                    ColorType::CmykAsYcck => self.encode_image_internal::<_, AVX2Operations>(
                        CmykAsYcckImage(data, width, height),
                    ),
                    ColorType::Ycck => self
                        .encode_image_internal::<_, AVX2Operations>(YcckImage(data, width, height)),
                };
            }
        }

        match color_type {
            ColorType::Luma => self.encode_image(GrayImage(data, width, height))?,
            ColorType::Rgb => self.encode_image(RgbImage(data, width, height))?,
            ColorType::Rgba => self.encode_image(RgbaImage(data, width, height))?,
            ColorType::Bgr => self.encode_image(BgrImage(data, width, height))?,
            ColorType::Bgra => self.encode_image(BgraImage(data, width, height))?,
            ColorType::Ycbcr => self.encode_image(YCbCrImage(data, width, height))?,
            ColorType::Cmyk => self.encode_image(CmykImage(data, width, height))?,
            ColorType::CmykAsYcck => self.encode_image(CmykAsYcckImage(data, width, height))?,
            ColorType::Ycck => self.encode_image(YcckImage(data, width, height))?,
        }

        Ok(())
    }

    /// Encode an image
    pub fn encode_image<I: ImageBuffer>(self, image: I) -> Result<(), EncodingError> {
        #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
        {
            if std::is_x86_feature_detected!("avx2") {
                use crate::avx2::*;
                return self.encode_image_internal::<_, AVX2Operations>(image);
            }
        }
        self.encode_image_internal::<_, DefaultOperations>(image)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn into_strip_encoder(
        self,
        width: u16,
        height: u16,
        color_type: ColorType,
    ) -> Result<StripEncoder<W>, EncodingError> {
        let Encoder {
            writer,
            density,
            quality,
            quantization_tables,
            huffman_tables,
            sampling_factor,
            progressive_scans,
            restart_interval,
            optimize_huffman_table,
            app_segments,
            ..
        } = self;

        if width == 0 || height == 0 {
            return Err(EncodingError::ZeroImageDimensions { width, height });
        }

        if progressive_scans.is_some() {
            return Err(EncodingError::Write(
                "Strip encoding does not support progressive scans".into(),
            ));
        }

        if optimize_huffman_table {
            return Err(EncodingError::Write(
                "Strip encoding does not support optimized Huffman tables".into(),
            ));
        }

        if !sampling_factor.supports_interleaved() {
            return Err(EncodingError::Write(
                "Strip encoding requires interleaved sampling factors".into(),
            ));
        }

        let jpeg_color_type = color_type_to_jpeg(color_type);
        let components = build_components(sampling_factor, jpeg_color_type);
        let component_specs: Vec<_> = components.iter().map(ComponentSpec::from).collect();

        let quantization_tables = [
            QuantizationTable::new_with_quality(&quantization_tables[0], quality, true),
            QuantizationTable::new_with_quality(&quantization_tables[1], quality, false),
        ];

        StripEncoder::new_with_tables(
            writer.into_inner(),
            width,
            height,
            color_type,
            jpeg_color_type,
            component_specs,
            quantization_tables,
            huffman_tables,
            restart_interval,
            density,
            app_segments,
        )
    }

    fn encode_image_internal<I: ImageBuffer, OP: Operations>(
        mut self,
        image: I,
    ) -> Result<(), EncodingError> {
        if image.width() == 0 || image.height() == 0 {
            return Err(EncodingError::ZeroImageDimensions {
                width: image.width(),
                height: image.height(),
            });
        }

        let q_tables = [
            QuantizationTable::new_with_quality(&self.quantization_tables[0], self.quality, true),
            QuantizationTable::new_with_quality(&self.quantization_tables[1], self.quality, false),
        ];

        let jpeg_color_type = image.get_jpeg_color_type();
        self.init_components(jpeg_color_type);

        write_file_headers(
            &mut self.writer,
            self.density,
            jpeg_color_type,
            &self.app_segments,
        )?;

        if let Some(scans) = self.progressive_scans {
            self.encode_image_progressive::<_, OP>(image, scans, &q_tables)?;
        } else if self.optimize_huffman_table || !self.sampling_factor.supports_interleaved() {
            self.encode_image_sequential::<_, OP>(image, &q_tables)?;
        } else {
            self.encode_image_interleaved::<_, OP>(image, &q_tables)?;
        }

        self.writer.write_marker(Marker::EOI)?;

        Ok(())
    }

    fn init_components(&mut self, color: JpegColorType) {
        self.components = build_components(self.sampling_factor, color);
    }

    fn get_max_sampling_size(&self) -> (usize, usize) {
        get_max_sampling_size_for(&self.components)
    }

    fn write_frame_header<I: ImageBuffer>(
        &mut self,
        image: &I,
        q_tables: &[QuantizationTable; 2],
    ) -> Result<(), EncodingError> {
        write_frame_header_common(
            &mut self.writer,
            image.width(),
            image.height(),
            &self.components,
            self.progressive_scans.is_some(),
            q_tables,
            &self.huffman_tables,
            self.restart_interval,
            image.get_jpeg_color_type().get_num_components(),
        )
    }

    fn init_rows(&mut self, buffer_size: usize) -> [Vec<u8>; 4] {
        init_rows_for_components(self.components.len(), buffer_size)
    }

    /// Encode all components with one scan
    ///
    /// This is only valid for sampling factors of 1 and 2
    fn encode_image_interleaved<I: ImageBuffer, OP: Operations>(
        &mut self,
        image: I,
        q_tables: &[QuantizationTable; 2],
    ) -> Result<(), EncodingError> {
        self.write_frame_header(&image, q_tables)?;
        self.writer
            .write_scan_header(&self.components.iter().collect::<Vec<_>>(), None)?;

        let (max_h_sampling, max_v_sampling) = self.get_max_sampling_size();

        let width = image.width();
        let height = image.height();

        let num_cols = ceil_div(usize::from(width), 8 * max_h_sampling);
        let num_rows = ceil_div(usize::from(height), 8 * max_v_sampling);

        let buffer_width = num_cols * 8 * max_h_sampling;
        let buffer_size = buffer_width * 8 * max_v_sampling;

        let mut row: [Vec<_>; 4] = self.init_rows(buffer_size);

        let mut prev_dc = [0i16; 4];
        let mut restart = RestartState::new(self.restart_interval);

        for block_y in 0..num_rows {
            for r in &mut row {
                r.clear();
            }

            for y in 0..(8 * max_v_sampling) {
                let y = y + block_y * 8 * max_v_sampling;
                let y = (y.min(height as usize - 1)) as u16;

                image.fill_buffers(y, &mut row);

                for _ in usize::from(width)..buffer_width {
                    for channel in &mut row {
                        if !channel.is_empty() {
                            channel.push(channel[channel.len() - 1]);
                        }
                    }
                }
            }

            write_interleaved_mcu_row::<_, OP>(
                &mut self.writer,
                &self.components,
                &self.huffman_tables,
                q_tables,
                &mut prev_dc,
                max_h_sampling,
                max_v_sampling,
                buffer_width,
                num_cols,
                &mut restart,
                &row,
            )?;
        }

        self.writer.finalize_bit_buffer()?;

        Ok(())
    }

    /// Encode components with one scan per component
    fn encode_image_sequential<I: ImageBuffer, OP: Operations>(
        &mut self,
        image: I,
        q_tables: &[QuantizationTable; 2],
    ) -> Result<(), EncodingError> {
        let blocks = self.encode_blocks::<_, OP>(&image, q_tables);

        if self.optimize_huffman_table {
            self.optimize_huffman_table(&blocks);
        }

        self.write_frame_header(&image, q_tables)?;

        for (i, component) in self.components.iter().enumerate() {
            let restart_interval = self.restart_interval.unwrap_or(0);
            let mut restarts = 0;
            let mut restarts_to_go = restart_interval;

            self.writer.write_scan_header(&[component], None)?;

            let mut prev_dc = 0;

            for block in &blocks[i] {
                if restart_interval > 0 && restarts_to_go == 0 {
                    self.writer.finalize_bit_buffer()?;
                    self.writer
                        .write_marker(Marker::RST((restarts % 8) as u8))?;

                    prev_dc = 0;
                }

                self.writer.write_block(
                    block,
                    prev_dc,
                    &self.huffman_tables[component.dc_huffman_table as usize].0,
                    &self.huffman_tables[component.ac_huffman_table as usize].1,
                )?;

                prev_dc = block[0];

                if restart_interval > 0 {
                    if restarts_to_go == 0 {
                        restarts_to_go = restart_interval;
                        restarts += 1;
                        restarts &= 7;
                    }
                    restarts_to_go -= 1;
                }
            }

            self.writer.finalize_bit_buffer()?;
        }

        Ok(())
    }

    /// Encode image in progressive mode
    ///
    /// This only support spectral selection for now
    fn encode_image_progressive<I: ImageBuffer, OP: Operations>(
        &mut self,
        image: I,
        scans: u8,
        q_tables: &[QuantizationTable; 2],
    ) -> Result<(), EncodingError> {
        let blocks = self.encode_blocks::<_, OP>(&image, q_tables);

        if self.optimize_huffman_table {
            self.optimize_huffman_table(&blocks);
        }

        self.write_frame_header(&image, q_tables)?;

        // Phase 1: DC Scan
        //          Only the DC coefficients can be transfer in the first component scans
        for (i, component) in self.components.iter().enumerate() {
            self.writer.write_scan_header(&[component], Some((0, 0)))?;

            let restart_interval = self.restart_interval.unwrap_or(0);
            let mut restarts = 0;
            let mut restarts_to_go = restart_interval;

            let mut prev_dc = 0;

            for block in &blocks[i] {
                if restart_interval > 0 && restarts_to_go == 0 {
                    self.writer.finalize_bit_buffer()?;
                    self.writer
                        .write_marker(Marker::RST((restarts % 8) as u8))?;

                    prev_dc = 0;
                }

                self.writer.write_dc(
                    block[0],
                    prev_dc,
                    &self.huffman_tables[component.dc_huffman_table as usize].0,
                )?;

                prev_dc = block[0];

                if restart_interval > 0 {
                    if restarts_to_go == 0 {
                        restarts_to_go = restart_interval;
                        restarts += 1;
                        restarts &= 7;
                    }
                    restarts_to_go -= 1;
                }
            }

            self.writer.finalize_bit_buffer()?;
        }

        // Phase 2: AC scans
        let scans = scans as usize - 1;

        let values_per_scan = 64 / scans;

        for scan in 0..scans {
            let start = (scan * values_per_scan).max(1);
            let end = if scan == scans - 1 {
                // ensure last scan is always transfers the remaining coefficients
                64
            } else {
                (scan + 1) * values_per_scan
            };

            for (i, component) in self.components.iter().enumerate() {
                let restart_interval = self.restart_interval.unwrap_or(0);
                let mut restarts = 0;
                let mut restarts_to_go = restart_interval;

                self.writer
                    .write_scan_header(&[component], Some((start as u8, end as u8 - 1)))?;

                for block in &blocks[i] {
                    if restart_interval > 0 && restarts_to_go == 0 {
                        self.writer.finalize_bit_buffer()?;
                        self.writer
                            .write_marker(Marker::RST((restarts % 8) as u8))?;
                    }

                    self.writer.write_ac_block(
                        block,
                        start,
                        end,
                        &self.huffman_tables[component.ac_huffman_table as usize].1,
                    )?;

                    if restart_interval > 0 {
                        if restarts_to_go == 0 {
                            restarts_to_go = restart_interval;
                            restarts += 1;
                            restarts &= 7;
                        }
                        restarts_to_go -= 1;
                    }
                }

                self.writer.finalize_bit_buffer()?;
            }
        }

        Ok(())
    }

    fn encode_blocks<I: ImageBuffer, OP: Operations>(
        &mut self,
        image: &I,
        q_tables: &[QuantizationTable; 2],
    ) -> [Vec<[i16; 64]>; 4] {
        let width = image.width();
        let height = image.height();

        let (max_h_sampling, max_v_sampling) = self.get_max_sampling_size();

        let num_cols = ceil_div(usize::from(width), 8 * max_h_sampling) * max_h_sampling;
        let num_rows = ceil_div(usize::from(height), 8 * max_v_sampling) * max_v_sampling;

        debug_assert!(num_cols > 0);
        debug_assert!(num_rows > 0);

        let buffer_width = num_cols * 8;
        let buffer_size = num_cols * num_rows * 64;

        let mut row: [Vec<_>; 4] = self.init_rows(buffer_size);

        for y in 0..num_rows * 8 {
            let y = (y.min(usize::from(height) - 1)) as u16;

            image.fill_buffers(y, &mut row);

            for _ in usize::from(width)..num_cols * 8 {
                for channel in &mut row {
                    if !channel.is_empty() {
                        channel.push(channel[channel.len() - 1]);
                    }
                }
            }
        }

        let num_cols = ceil_div(usize::from(width), 8);
        let num_rows = ceil_div(usize::from(height), 8);

        debug_assert!(num_cols > 0);
        debug_assert!(num_rows > 0);

        let mut blocks: [Vec<_>; 4] = self.init_block_buffers(buffer_size / 64);

        for (i, component) in self.components.iter().enumerate() {
            let h_scale = max_h_sampling / component.horizontal_sampling_factor as usize;
            let v_scale = max_v_sampling / component.vertical_sampling_factor as usize;

            let cols = ceil_div(num_cols, h_scale);
            let rows = ceil_div(num_rows, v_scale);

            debug_assert!(cols > 0);
            debug_assert!(rows > 0);

            for block_y in 0..rows {
                for block_x in 0..cols {
                    let mut block = get_block(
                        &row[i],
                        block_x * 8 * h_scale,
                        block_y * 8 * v_scale,
                        h_scale,
                        v_scale,
                        buffer_width,
                    );

                    OP::fdct(&mut block);

                    let mut q_block = [0i16; 64];

                    OP::quantize_block(
                        &block,
                        &mut q_block,
                        &q_tables[component.quantization_table as usize],
                    );

                    blocks[i].push(q_block);
                }
            }
        }
        blocks
    }

    fn init_block_buffers(&mut self, buffer_size: usize) -> [Vec<[i16; 64]>; 4] {
        // To simplify the code and to give the compiler more infos to optimize stuff we always initialize 4 components
        // Resource overhead should be minimal because an empty Vec doesn't allocate

        match self.components.len() {
            1 => [
                Vec::with_capacity(buffer_size),
                Vec::new(),
                Vec::new(),
                Vec::new(),
            ],
            3 => [
                Vec::with_capacity(buffer_size),
                Vec::with_capacity(buffer_size),
                Vec::with_capacity(buffer_size),
                Vec::new(),
            ],
            4 => [
                Vec::with_capacity(buffer_size),
                Vec::with_capacity(buffer_size),
                Vec::with_capacity(buffer_size),
                Vec::with_capacity(buffer_size),
            ],
            len => unreachable!("Unsupported component length: {}", len),
        }
    }

    // Create new huffman tables optimized for this image
    fn optimize_huffman_table(&mut self, blocks: &[Vec<[i16; 64]>; 4]) {
        // TODO: Find out if it's possible to reuse some code from the writer

        let max_tables = self.components.len().min(2) as u8;

        for table in 0..max_tables {
            let mut dc_freq = [0u32; 257];
            dc_freq[256] = 1;
            let mut ac_freq = [0u32; 257];
            ac_freq[256] = 1;

            let mut had_ac = false;
            let mut had_dc = false;

            for (i, component) in self.components.iter().enumerate() {
                if component.dc_huffman_table == table {
                    had_dc = true;

                    let mut prev_dc = 0;

                    debug_assert!(!blocks[i].is_empty());

                    for block in &blocks[i] {
                        let value = block[0];
                        let diff = value - prev_dc;
                        let num_bits = get_num_bits(diff);

                        dc_freq[num_bits as usize] += 1;

                        prev_dc = value;
                    }
                }

                if component.ac_huffman_table == table {
                    had_ac = true;

                    if let Some(scans) = self.progressive_scans {
                        let scans = scans as usize - 1;

                        let values_per_scan = 64 / scans;

                        for scan in 0..scans {
                            let start = (scan * values_per_scan).max(1);
                            let end = if scan == scans - 1 {
                                // Due to rounding we might need to transfer more than values_per_scan values in the last scan
                                64
                            } else {
                                (scan + 1) * values_per_scan
                            };

                            debug_assert!(!blocks[i].is_empty());

                            for block in &blocks[i] {
                                let mut zero_run = 0;

                                for &value in &block[start..end] {
                                    if value == 0 {
                                        zero_run += 1;
                                    } else {
                                        while zero_run > 15 {
                                            ac_freq[0xF0] += 1;
                                            zero_run -= 16;
                                        }
                                        let num_bits = get_num_bits(value);
                                        let symbol = (zero_run << 4) | num_bits;

                                        ac_freq[symbol as usize] += 1;

                                        zero_run = 0;
                                    }
                                }

                                if zero_run > 0 {
                                    ac_freq[0] += 1;
                                }
                            }
                        }
                    } else {
                        for block in &blocks[i] {
                            let mut zero_run = 0;

                            for &value in &block[1..] {
                                if value == 0 {
                                    zero_run += 1;
                                } else {
                                    while zero_run > 15 {
                                        ac_freq[0xF0] += 1;
                                        zero_run -= 16;
                                    }
                                    let num_bits = get_num_bits(value);
                                    let symbol = (zero_run << 4) | num_bits;

                                    ac_freq[symbol as usize] += 1;

                                    zero_run = 0;
                                }
                            }

                            if zero_run > 0 {
                                ac_freq[0] += 1;
                            }
                        }
                    }
                }
            }

            assert!(had_dc, "Missing DC data for table {}", table);
            assert!(had_ac, "Missing AC data for table {}", table);

            self.huffman_tables[table as usize] = (
                HuffmanTable::new_optimized(dc_freq),
                HuffmanTable::new_optimized(ac_freq),
            );
        }
    }
}

pub struct StripEncoder<W: JfifWrite> {
    inner: StripEncoderVariant<W>,
}

enum StripEncoderVariant<W: JfifWrite> {
    Scalar(StripEncoderInner<W, DefaultOperations>),
    #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
    Avx2(StripEncoderInner<W, crate::avx2::AVX2Operations>),
}

impl<W: JfifWrite> StripEncoder<W> {
    pub fn write_headers(&mut self) -> Result<(), EncodingError> {
        match &mut self.inner {
            StripEncoderVariant::Scalar(inner) => inner.write_headers(),
            #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
            StripEncoderVariant::Avx2(inner) => inner.write_headers(),
        }
    }

    pub fn encode_strip(&mut self, data: &[u8]) -> Result<(), EncodingError> {
        match &mut self.inner {
            StripEncoderVariant::Scalar(inner) => inner.encode_strip(data),
            #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
            StripEncoderVariant::Avx2(inner) => inner.encode_strip(data),
        }
    }

    pub fn finish(self) -> Result<W, EncodingError> {
        match self.inner {
            StripEncoderVariant::Scalar(inner) => inner.finish(),
            #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
            StripEncoderVariant::Avx2(inner) => inner.finish(),
        }
    }

    pub fn header_bytes(&self) -> Result<Vec<u8>, EncodingError> {
        match &self.inner {
            StripEncoderVariant::Scalar(inner) => inner.header_bytes(),
            #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
            StripEncoderVariant::Avx2(inner) => inner.header_bytes(),
        }
    }

    pub fn footer_bytes() -> [u8; 2] {
        [0xFF, Marker::EOI.into()]
    }

    #[allow(clippy::too_many_arguments)]
    pub fn new_with_tables(
        writer: W,
        width: u16,
        height: u16,
        color_type: ColorType,
        jpeg_color_type: JpegColorType,
        components: Vec<ComponentSpec>,
        quantization_tables: [QuantizationTable; 2],
        huffman_tables: [(HuffmanTable, HuffmanTable); 2],
        restart_interval: Option<u16>,
        density: Density,
        app_segments: Vec<(u8, Vec<u8>)>,
    ) -> Result<Self, EncodingError> {
        if width == 0 || height == 0 {
            return Err(EncodingError::ZeroImageDimensions { width, height });
        }

        if jpeg_color_type.get_num_components() != components.len() {
            return Err(EncodingError::Write(alloc::format!(
                "Component count {} does not match JPEG color type {:?}",
                components.len(),
                jpeg_color_type
            )));
        }

        if color_type_to_jpeg(color_type) != jpeg_color_type {
            return Err(EncodingError::Write(alloc::format!(
                "Input color type {:?} is incompatible with JPEG color type {:?}",
                color_type,
                jpeg_color_type
            )));
        }

        let components: Vec<Component> = components.into_iter().map(Component::from).collect();

        let use_avx2 = {
            #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
            {
                std::is_x86_feature_detected!("avx2")
            }
            #[cfg(not(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64"))))]
            {
                false
            }
        };

        if use_avx2 {
            #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
            {
                use crate::avx2::AVX2Operations;

                let inner = StripEncoderInner::<W, AVX2Operations>::new(
                    writer,
                    density,
                    jpeg_color_type,
                    components,
                    quantization_tables,
                    huffman_tables,
                    restart_interval,
                    app_segments,
                    width,
                    height,
                    color_type,
                );

                return Ok(StripEncoder {
                    inner: StripEncoderVariant::Avx2(inner),
                });
            }
        }

        let inner = StripEncoderInner::<W, DefaultOperations>::new(
            writer,
            density,
            jpeg_color_type,
            components,
            quantization_tables,
            huffman_tables,
            restart_interval,
            app_segments,
            width,
            height,
            color_type,
        );

        Ok(StripEncoder {
            inner: StripEncoderVariant::Scalar(inner),
        })
    }
}

struct StripEncoderInner<W: JfifWrite, OP: Operations> {
    writer: JfifWriter<W>,
    density: Density,
    jpeg_color_type: JpegColorType,
    components: Vec<Component>,
    quantization_tables: [QuantizationTable; 2],
    huffman_tables: [(HuffmanTable, HuffmanTable); 2],
    restart_interval: Option<u16>,
    app_segments: Vec<(u8, Vec<u8>)>,
    width: u16,
    height: u16,
    max_h_sampling: usize,
    max_v_sampling: usize,
    buffer_width: usize,
    num_cols: usize,
    rows_per_mcu: usize,
    prev_dc: [i16; 4],
    restart_state: RestartState,
    row_buffers: [Vec<u8>; 4],
    last_rows: [Vec<u8>; 4],
    pending_rows: usize,
    processed_rows: usize,
    headers_written: bool,
    color_type: ColorType,
    bytes_per_pixel: usize,
    phantom: PhantomData<OP>,
}

impl<W: JfifWrite, OP: Operations> StripEncoderInner<W, OP> {
    fn new(
        writer: W,
        density: Density,
        jpeg_color_type: JpegColorType,
        components: Vec<Component>,
        quantization_tables: [QuantizationTable; 2],
        huffman_tables: [(HuffmanTable, HuffmanTable); 2],
        restart_interval: Option<u16>,
        app_segments: Vec<(u8, Vec<u8>)>,
        width: u16,
        height: u16,
        color_type: ColorType,
    ) -> Self {
        let (max_h_sampling, max_v_sampling) = get_max_sampling_size_for(&components);
        let num_cols = ceil_div(usize::from(width), 8 * max_h_sampling);
        let buffer_width = num_cols * 8 * max_h_sampling;
        let rows_per_mcu = 8 * max_v_sampling;
        let buffer_size = buffer_width * rows_per_mcu;
        let component_count = components.len();

        StripEncoderInner {
            writer: JfifWriter::new(writer),
            density,
            jpeg_color_type,
            components,
            quantization_tables,
            huffman_tables,
            restart_interval,
            app_segments,
            width,
            height,
            max_h_sampling,
            max_v_sampling,
            buffer_width,
            num_cols,
            rows_per_mcu,
            prev_dc: [0i16; 4],
            restart_state: RestartState::new(restart_interval),
            row_buffers: init_rows_for_components(component_count, buffer_size),
            last_rows: init_rows_for_components(component_count, buffer_width),
            pending_rows: 0,
            processed_rows: 0,
            headers_written: false,
            color_type,
            bytes_per_pixel: color_type.get_bytes_per_pixel(),
            phantom: PhantomData,
        }
    }

    fn write_headers(&mut self) -> Result<(), EncodingError> {
        if self.headers_written {
            return Ok(());
        }

        write_file_headers(
            &mut self.writer,
            self.density,
            self.jpeg_color_type,
            &self.app_segments,
        )?;

        write_frame_header_common(
            &mut self.writer,
            self.width,
            self.height,
            &self.components,
            false,
            &self.quantization_tables,
            &self.huffman_tables,
            self.restart_interval,
            self.jpeg_color_type.get_num_components(),
        )?;

        let component_refs: Vec<_> = self.components.iter().collect();
        self.writer.write_scan_header(&component_refs, None)?;

        self.headers_written = true;

        Ok(())
    }

    fn ensure_headers(&mut self) -> Result<(), EncodingError> {
        if !self.headers_written {
            self.write_headers()?;
        }
        Ok(())
    }

    fn header_bytes(&self) -> Result<Vec<u8>, EncodingError> {
        let mut buffer = Vec::new();
        let mut writer = JfifWriter::new(&mut buffer);

        write_file_headers(
            &mut writer,
            self.density,
            self.jpeg_color_type,
            &self.app_segments,
        )?;

        write_frame_header_common(
            &mut writer,
            self.width,
            self.height,
            &self.components,
            false,
            &self.quantization_tables,
            &self.huffman_tables,
            self.restart_interval,
            self.jpeg_color_type.get_num_components(),
        )?;

        let component_refs: Vec<_> = self.components.iter().collect();
        writer.write_scan_header(&component_refs, None)?;

        Ok(buffer)
    }

    fn encode_strip(&mut self, data: &[u8]) -> Result<(), EncodingError> {
        self.ensure_headers()?;

        if data.is_empty() {
            return Ok(());
        }

        let row_stride = usize::from(self.width) * self.bytes_per_pixel;

        if data.len() % row_stride != 0 {
            return Err(EncodingError::Write(alloc::format!(
                "Strip length {} is not a multiple of row stride {}",
                data.len(),
                row_stride
            )));
        }

        let rows = data.len() / row_stride;
        let remaining_rows = usize::from(self.height) - self.processed_rows;

        if rows > remaining_rows {
            return Err(EncodingError::Write(alloc::format!(
                "Received {} additional rows but only {} rows remain",
                rows,
                remaining_rows
            )));
        }

        for chunk in data.chunks(row_stride) {
            self.push_row(chunk)?;
            self.processed_rows += 1;
        }

        Ok(())
    }

    fn push_row(&mut self, row_data: &[u8]) -> Result<(), EncodingError> {
        match self.color_type {
            ColorType::Luma => {
                self.row_buffers[0].extend_from_slice(row_data);
            }
            ColorType::Rgb => {
                for pixel in row_data.chunks_exact(3) {
                    let (y, cb, cr) = rgb_to_ycbcr(pixel[0], pixel[1], pixel[2]);
                    self.row_buffers[0].push(y);
                    self.row_buffers[1].push(cb);
                    self.row_buffers[2].push(cr);
                }
            }
            ColorType::Rgba => {
                for pixel in row_data.chunks_exact(4) {
                    let (y, cb, cr) = rgb_to_ycbcr(pixel[0], pixel[1], pixel[2]);
                    self.row_buffers[0].push(y);
                    self.row_buffers[1].push(cb);
                    self.row_buffers[2].push(cr);
                }
            }
            ColorType::Bgr => {
                for pixel in row_data.chunks_exact(3) {
                    let (y, cb, cr) = rgb_to_ycbcr(pixel[2], pixel[1], pixel[0]);
                    self.row_buffers[0].push(y);
                    self.row_buffers[1].push(cb);
                    self.row_buffers[2].push(cr);
                }
            }
            ColorType::Bgra => {
                for pixel in row_data.chunks_exact(4) {
                    let (y, cb, cr) = rgb_to_ycbcr(pixel[2], pixel[1], pixel[0]);
                    self.row_buffers[0].push(y);
                    self.row_buffers[1].push(cb);
                    self.row_buffers[2].push(cr);
                }
            }
            ColorType::Ycbcr => {
                for pixel in row_data.chunks_exact(3) {
                    self.row_buffers[0].push(pixel[0]);
                    self.row_buffers[1].push(pixel[1]);
                    self.row_buffers[2].push(pixel[2]);
                }
            }
            ColorType::Cmyk => {
                for pixel in row_data.chunks_exact(4) {
                    self.row_buffers[0].push(255 - pixel[0]);
                    self.row_buffers[1].push(255 - pixel[1]);
                    self.row_buffers[2].push(255 - pixel[2]);
                    self.row_buffers[3].push(255 - pixel[3]);
                }
            }
            ColorType::CmykAsYcck => {
                for pixel in row_data.chunks_exact(4) {
                    let (y, cb, cr, k) = cmyk_to_ycck(pixel[0], pixel[1], pixel[2], pixel[3]);
                    self.row_buffers[0].push(y);
                    self.row_buffers[1].push(cb);
                    self.row_buffers[2].push(cr);
                    self.row_buffers[3].push(k);
                }
            }
            ColorType::Ycck => {
                for pixel in row_data.chunks_exact(4) {
                    self.row_buffers[0].push(pixel[0]);
                    self.row_buffers[1].push(pixel[1]);
                    self.row_buffers[2].push(pixel[2]);
                    self.row_buffers[3].push(pixel[3]);
                }
            }
        }

        let component_count = self.components.len();

        for _ in usize::from(self.width)..self.buffer_width {
            for buffer in self.row_buffers.iter_mut().take(component_count) {
                if let Some(&value) = buffer.last() {
                    buffer.push(value);
                }
            }
        }

        for i in 0..component_count {
            let buffer = &self.row_buffers[i];
            let start = buffer.len() - self.buffer_width;
            self.last_rows[i].clear();
            self.last_rows[i].extend_from_slice(&buffer[start..]);
        }

        for i in component_count..self.last_rows.len() {
            self.last_rows[i].clear();
        }

        self.pending_rows += 1;

        if self.pending_rows == self.rows_per_mcu {
            self.flush_full_mcu_row()?;
        }

        Ok(())
    }

    fn pad_pending_rows(&mut self) -> Result<(), EncodingError> {
        if self.pending_rows == 0 {
            return Ok(());
        }

        if self.rows_per_mcu == 0 {
            return Err(EncodingError::Write(
                "Invalid MCU configuration for strip encoder".into(),
            ));
        }

        let missing = self.rows_per_mcu - self.pending_rows;

        for _ in 0..missing {
            for (i, buffer) in self
                .row_buffers
                .iter_mut()
                .enumerate()
                .take(self.components.len())
            {
                if self.last_rows[i].is_empty() {
                    return Err(EncodingError::Write(
                        "Cannot pad final MCU without prior row data".into(),
                    ));
                }
                buffer.extend_from_slice(&self.last_rows[i]);
            }
        }

        self.pending_rows = self.rows_per_mcu;
        self.flush_full_mcu_row()
    }

    fn flush_full_mcu_row(&mut self) -> Result<(), EncodingError> {
        write_interleaved_mcu_row::<_, OP>(
            &mut self.writer,
            &self.components,
            &self.huffman_tables,
            &self.quantization_tables,
            &mut self.prev_dc,
            self.max_h_sampling,
            self.max_v_sampling,
            self.buffer_width,
            self.num_cols,
            &mut self.restart_state,
            &self.row_buffers,
        )?;

        for buffer in &mut self.row_buffers {
            buffer.clear();
        }

        self.pending_rows = 0;

        Ok(())
    }

    fn finish(mut self) -> Result<W, EncodingError> {
        self.ensure_headers()?;

        if self.processed_rows != usize::from(self.height) {
            return Err(EncodingError::Write(alloc::format!(
                "Expected {} rows but received {}",
                self.height,
                self.processed_rows
            )));
        }

        if self.pending_rows > 0 {
            self.pad_pending_rows()?;
        }

        self.writer.finalize_bit_buffer()?;
        self.writer.write_marker(Marker::EOI)?;

        Ok(self.writer.into_inner())
    }
}

#[cfg(feature = "std")]
impl Encoder<BufWriter<File>> {
    /// Create a new decoder that writes into a file
    ///
    /// See [new](Encoder::new) for further information.
    ///
    /// # Errors
    ///
    /// Returns an `IoError(std::io::Error)` if the file can't be created
    pub fn new_file<P: AsRef<Path>>(
        path: P,
        quality: u8,
    ) -> Result<Encoder<BufWriter<File>>, EncodingError> {
        let file = File::create(path)?;
        let buf = BufWriter::new(file);
        Ok(Self::new(buf, quality))
    }
}

struct RestartState {
    interval: u16,
    restarts: u16,
    restarts_to_go: u16,
}

impl RestartState {
    fn new(interval: Option<u16>) -> Self {
        let interval = interval.unwrap_or(0);
        RestartState {
            interval,
            restarts: 0,
            restarts_to_go: interval,
        }
    }

    fn before_mcu<W: JfifWrite>(
        &mut self,
        writer: &mut JfifWriter<W>,
        prev_dc: &mut [i16; 4],
        component_count: usize,
    ) -> Result<(), EncodingError> {
        if self.interval > 0 && self.restarts_to_go == 0 {
            writer.finalize_bit_buffer()?;
            writer.write_marker(Marker::RST((self.restarts % 8) as u8))?;

            for value in prev_dc.iter_mut().take(component_count) {
                *value = 0;
            }
        }

        Ok(())
    }

    fn after_mcu(&mut self) {
        if self.interval > 0 {
            if self.restarts_to_go == 0 {
                self.restarts_to_go = self.interval;
                self.restarts = (self.restarts + 1) & 7;
            }

            if self.restarts_to_go > 0 {
                self.restarts_to_go -= 1;
            }
        }
    }
}

fn write_interleaved_mcu_row<W: JfifWrite, OP: Operations>(
    writer: &mut JfifWriter<W>,
    components: &[Component],
    huffman_tables: &[(HuffmanTable, HuffmanTable); 2],
    q_tables: &[QuantizationTable; 2],
    prev_dc: &mut [i16; 4],
    max_h_sampling: usize,
    max_v_sampling: usize,
    buffer_width: usize,
    num_cols: usize,
    restart: &mut RestartState,
    row: &[Vec<u8>; 4],
) -> Result<(), EncodingError> {
    for block_x in 0..num_cols {
        restart.before_mcu(writer, prev_dc, components.len())?;

        for (i, component) in components.iter().enumerate() {
            for v_offset in 0..component.vertical_sampling_factor as usize {
                for h_offset in 0..component.horizontal_sampling_factor as usize {
                    let mut block = get_block(
                        &row[i],
                        block_x * 8 * max_h_sampling + (h_offset * 8),
                        v_offset * 8,
                        max_h_sampling / component.horizontal_sampling_factor as usize,
                        max_v_sampling / component.vertical_sampling_factor as usize,
                        buffer_width,
                    );

                    OP::fdct(&mut block);

                    let mut q_block = [0i16; 64];

                    OP::quantize_block(
                        &block,
                        &mut q_block,
                        &q_tables[component.quantization_table as usize],
                    );

                    writer.write_block(
                        &q_block,
                        prev_dc[i],
                        &huffman_tables[component.dc_huffman_table as usize].0,
                        &huffman_tables[component.ac_huffman_table as usize].1,
                    )?;

                    prev_dc[i] = q_block[0];
                }
            }
        }

        restart.after_mcu();
    }

    Ok(())
}

fn get_block(
    data: &[u8],
    start_x: usize,
    start_y: usize,
    col_stride: usize,
    row_stride: usize,
    width: usize,
) -> [i16; 64] {
    let mut block = [0i16; 64];

    for y in 0..8 {
        for x in 0..8 {
            let ix = start_x + (x * col_stride);
            let iy = start_y + (y * row_stride);

            block[y * 8 + x] = (data[iy * width + ix] as i16) - 128;
        }
    }

    block
}

fn ceil_div(value: usize, div: usize) -> usize {
    value / div + usize::from(value % div != 0)
}

fn init_rows_for_components(components: usize, buffer_size: usize) -> [Vec<u8>; 4] {
    match components {
        1 => [
            Vec::with_capacity(buffer_size),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        ],
        3 => [
            Vec::with_capacity(buffer_size),
            Vec::with_capacity(buffer_size),
            Vec::with_capacity(buffer_size),
            Vec::new(),
        ],
        4 => [
            Vec::with_capacity(buffer_size),
            Vec::with_capacity(buffer_size),
            Vec::with_capacity(buffer_size),
            Vec::with_capacity(buffer_size),
        ],
        len => unreachable!("Unsupported component length: {}", len),
    }
}

fn get_max_sampling_size_for(components: &[Component]) -> (usize, usize) {
    let max_h_sampling = components.iter().fold(1, |value, component| {
        value.max(component.horizontal_sampling_factor)
    });

    let max_v_sampling = components.iter().fold(1, |value, component| {
        value.max(component.vertical_sampling_factor)
    });

    (usize::from(max_h_sampling), usize::from(max_v_sampling))
}

fn get_num_bits(mut value: i16) -> u8 {
    if value < 0 {
        value = -value;
    }

    let mut num_bits = 0;

    while value > 0 {
        num_bits += 1;
        value >>= 1;
    }

    num_bits
}

pub(crate) trait Operations {
    #[inline(always)]
    fn fdct(data: &mut [i16; 64]) {
        fdct(data);
    }

    #[inline(always)]
    fn quantize_block(block: &[i16; 64], q_block: &mut [i16; 64], table: &QuantizationTable) {
        for i in 0..64 {
            let z = ZIGZAG[i] as usize & 0x3f;
            q_block[i] = table.quantize(block[z], z);
        }
    }
}

pub(crate) struct DefaultOperations;

impl Operations for DefaultOperations {}

#[cfg(test)]
mod tests {
    use alloc::vec;

    use crate::encoder::get_num_bits;
    use crate::writer::get_code;
    use crate::{Encoder, SamplingFactor};

    #[test]
    fn test_get_num_bits() {
        let min_max = 2i16.pow(13);

        for value in -min_max..=min_max {
            let num_bits1 = get_num_bits(value);
            let (num_bits2, _) = get_code(value);

            assert_eq!(
                num_bits1, num_bits2,
                "Difference in num bits for value {}: {} vs {}",
                value, num_bits1, num_bits2
            );
        }
    }

    #[test]
    fn sampling_factors() {
        assert_eq!(SamplingFactor::F_1_1.get_sampling_factors(), (1, 1));
        assert_eq!(SamplingFactor::F_2_1.get_sampling_factors(), (2, 1));
        assert_eq!(SamplingFactor::F_1_2.get_sampling_factors(), (1, 2));
        assert_eq!(SamplingFactor::F_2_2.get_sampling_factors(), (2, 2));
        assert_eq!(SamplingFactor::F_4_1.get_sampling_factors(), (4, 1));
        assert_eq!(SamplingFactor::F_4_2.get_sampling_factors(), (4, 2));
        assert_eq!(SamplingFactor::F_1_4.get_sampling_factors(), (1, 4));
        assert_eq!(SamplingFactor::F_2_4.get_sampling_factors(), (2, 4));

        assert_eq!(SamplingFactor::R_4_4_4.get_sampling_factors(), (1, 1));
        assert_eq!(SamplingFactor::R_4_4_0.get_sampling_factors(), (1, 2));
        assert_eq!(SamplingFactor::R_4_4_1.get_sampling_factors(), (1, 4));
        assert_eq!(SamplingFactor::R_4_2_2.get_sampling_factors(), (2, 1));
        assert_eq!(SamplingFactor::R_4_2_0.get_sampling_factors(), (2, 2));
        assert_eq!(SamplingFactor::R_4_2_1.get_sampling_factors(), (2, 4));
        assert_eq!(SamplingFactor::R_4_1_1.get_sampling_factors(), (4, 1));
        assert_eq!(SamplingFactor::R_4_1_0.get_sampling_factors(), (4, 2));
    }

    #[test]
    fn test_set_progressive() {
        let mut encoder = Encoder::new(vec![], 100);
        encoder.set_progressive(true);
        assert_eq!(encoder.progressive_scans(), Some(4));

        encoder.set_progressive(false);
        assert_eq!(encoder.progressive_scans(), None);
    }
}
