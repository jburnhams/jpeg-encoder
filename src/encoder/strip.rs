//! Streaming ("strip") encoding: feed an image a few rows at a time instead of
//! holding the whole image in memory.
//!
//! It reuses the regular interleaved baseline encoder one MCU row at a time,
//! so the output is byte-for-byte identical to [`Encoder::encode`] with the
//! same settings.

use super::{DefaultOperations, Encoder, InterleavedState};
use crate::image_buffer::*;
use crate::marker::Marker;
use crate::quantization::QuantizationTable;
use crate::writer::JfifWrite;
use crate::{ColorType, EncodingError, JpegColorType};

use alloc::format;
use alloc::vec::Vec;

/// # Streaming JPEG encoder
///
/// Encodes an image whose rows arrive in strips (any number of complete rows
/// at a time), so only a single row of MCUs (8 or 16 image rows) has to be
/// buffered. Encoded bytes are passed to the underlying writer as soon as
/// each MCU row is complete.
///
/// Create one with [`Encoder::into_strip_encoder`]. The JPEG headers are
/// written immediately, every call to [`encode_strip`](Self::encode_strip)
/// writes the entropy coded data for any completed MCU rows, and
/// [`finish`](Self::finish) writes the end of image marker.
///
/// Strip encoding always produces a baseline (single scan, interleaved) JPEG,
/// so progressive encoding, optimized huffman tables and sampling factors
/// that can't be interleaved (e.g. `F_4_1`) are rejected.
///
/// ```rust
/// # use jpeg_encoder::{ColorType, Encoder, EncodingError};
/// # fn main() -> Result<(), EncodingError> {
/// let width = 64u16;
/// let height = 40u16;
/// let row_bytes = usize::from(width) * 3;
/// let image = vec![128u8; row_bytes * usize::from(height)];
///
/// let mut strips = Encoder::new(Vec::new(), 85).into_strip_encoder(width, height, ColorType::Rgb)?;
///
/// // Strips may be any whole number of rows; here 10 rows at a time
/// for strip in image.chunks(row_bytes * 10) {
///     strips.encode_strip(strip)?;
/// }
///
/// let jpeg: Vec<u8> = strips.finish()?;
/// # assert_eq!(&jpeg[..2], &[0xFF, 0xD8]);
/// # Ok(())
/// # }
/// ```
pub struct StripEncoder<W: JfifWrite> {
    encoder: Encoder<W>,
    q_tables: [QuantizationTable; 2],
    state: InterleavedState,
    color_type: ColorType,
    width: u16,
    height: u16,
    row_bytes: usize,
    mcu_row_bytes: usize,
    rows_received: usize,
    pending: Vec<u8>,
    #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
    use_avx2: bool,
}

impl<W: JfifWrite> Encoder<W> {
    /// Turn this encoder into a [`StripEncoder`] for an image of the given size
    ///
    /// All settings made on this encoder (quality, quantization tables,
    /// sampling factor, chroma subsampling method, restart interval, density,
    /// app segments, ICC profile, ...) are used. The JPEG headers are written
    /// to the writer before this returns.
    ///
    /// # Errors
    ///
    /// Returns an error if a dimension is zero, if progressive encoding or
    /// huffman table optimization is enabled, if the sampling factor doesn't
    /// support interleaved encoding, or if writing the headers fails.
    pub fn into_strip_encoder(
        mut self,
        width: u16,
        height: u16,
        color_type: ColorType,
    ) -> Result<StripEncoder<W>, EncodingError> {
        if width == 0 || height == 0 {
            return Err(EncodingError::ZeroImageDimensions { width, height });
        }

        if self.progressive_scans.is_some() {
            return Err(EncodingError::StripEncoding(
                "progressive encoding is not supported".into(),
            ));
        }

        if self.optimize_huffman_table {
            return Err(EncodingError::StripEncoding(
                "optimized huffman tables are not supported".into(),
            ));
        }

        if !self.sampling_factor.supports_interleaved() {
            return Err(EncodingError::StripEncoding(format!(
                "sampling factor {:?} can't be interleaved",
                self.sampling_factor
            )));
        }

        let q_tables = [
            QuantizationTable::new_with_quality(&self.quantization_tables[0], self.quality, true),
            QuantizationTable::new_with_quality(&self.quantization_tables[1], self.quality, false),
        ];

        // Image used for the frame header; only its dimensions and color type are read
        let header_image = StripImage {
            data: &[],
            width,
            height,
            color_type,
            #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
            use_avx2: false,
        };

        let jpeg_color_type = header_image.get_jpeg_color_type();
        self.init_components(jpeg_color_type);
        self.write_file_header(jpeg_color_type)?;
        self.write_frame_header(&header_image, &q_tables)?;
        self.writer
            .write_scan_header(&self.components.iter().collect::<Vec<_>>(), None)?;

        let state = self.init_interleaved_state(width);
        let row_bytes = usize::from(width) * color_type.get_bytes_per_pixel();
        let mcu_row_bytes = row_bytes * 8 * state.max_v_sampling;

        Ok(StripEncoder {
            encoder: self,
            q_tables,
            state,
            color_type,
            width,
            height,
            row_bytes,
            mcu_row_bytes,
            rows_received: 0,
            pending: Vec::new(),
            #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
            use_avx2: std::is_x86_feature_detected!("avx2"),
        })
    }
}

impl<W: JfifWrite> StripEncoder<W> {
    /// Image width in pixels
    pub fn width(&self) -> u16 {
        self.width
    }

    /// Image height in pixels
    pub fn height(&self) -> u16 {
        self.height
    }

    /// Number of image rows that still have to be passed to [`encode_strip`](Self::encode_strip)
    pub fn rows_remaining(&self) -> usize {
        usize::from(self.height) - self.rows_received
    }

    /// Get a reference to the underlying writer
    pub fn writer(&self) -> &W {
        self.encoder.writer.get_ref()
    }

    /// Get a mutable reference to the underlying writer
    ///
    /// Useful to drain bytes written so far, for example from a `Vec<u8>`.
    /// Never write to it directly, that would corrupt the JPEG stream.
    pub fn writer_mut(&mut self) -> &mut W {
        self.encoder.writer.get_mut()
    }

    /// Encode the next rows of the image
    ///
    /// `data` must contain a whole number of rows (`width * bytes per pixel`
    /// bytes each) in the color type given to
    /// [`Encoder::into_strip_encoder`]. Strips can have any height and don't
    /// need to line up with MCU boundaries; rows are buffered until an MCU
    /// row is complete. The final partial MCU row is padded by repeating the
    /// last image row, exactly like [`Encoder::encode`] does.
    ///
    /// # Errors
    ///
    /// Returns an error if `data` isn't a whole number of rows, contains more
    /// rows than remain in the image, or if writing fails.
    pub fn encode_strip(&mut self, mut data: &[u8]) -> Result<(), EncodingError> {
        if !data.len().is_multiple_of(self.row_bytes) {
            return Err(EncodingError::StripEncoding(format!(
                "strip length {} is not a multiple of the row length {}",
                data.len(),
                self.row_bytes
            )));
        }

        let rows = data.len() / self.row_bytes;
        if rows > self.rows_remaining() {
            return Err(EncodingError::StripEncoding(format!(
                "received {} rows but only {} remain",
                rows,
                self.rows_remaining()
            )));
        }
        self.rows_received += rows;

        // Top up rows left over from the previous strip
        if !self.pending.is_empty() {
            let take = (self.mcu_row_bytes - self.pending.len()).min(data.len());
            self.pending.extend_from_slice(&data[..take]);
            data = &data[take..];

            if self.pending.len() == self.mcu_row_bytes {
                let pending = core::mem::take(&mut self.pending);
                self.encode_mcu_row(&pending)?;
                self.pending = pending;
                self.pending.clear();
            }
        }

        // Encode whole MCU rows straight from the input
        while data.len() >= self.mcu_row_bytes {
            let (mcu_row, rest) = data.split_at(self.mcu_row_bytes);
            self.encode_mcu_row(mcu_row)?;
            data = rest;
        }

        self.pending.extend_from_slice(data);

        // Last rows of the image: encode the partial MCU row right away
        if self.rows_remaining() == 0 && !self.pending.is_empty() {
            let pending = core::mem::take(&mut self.pending);
            self.encode_mcu_row(&pending)?;
        }

        Ok(())
    }

    /// Write the end of the image and return the writer
    ///
    /// # Errors
    ///
    /// Returns an error if not all rows of the image have been encoded, or
    /// if writing fails.
    pub fn finish(mut self) -> Result<W, EncodingError> {
        if self.rows_remaining() != 0 {
            return Err(EncodingError::StripEncoding(format!(
                "expected {} rows but received {}",
                self.height, self.rows_received
            )));
        }

        self.encoder.writer.finalize_bit_buffer()?;
        self.encoder.writer.write_marker(Marker::EOI)?;

        Ok(self.encoder.writer.into_inner())
    }

    /// Encode one MCU row from up to `8 * max_v_sampling` image rows
    fn encode_mcu_row(&mut self, data: &[u8]) -> Result<(), EncodingError> {
        let image = StripImage {
            data,
            width: self.width,
            height: (data.len() / self.row_bytes) as u16,
            color_type: self.color_type,
            #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
            use_avx2: self.use_avx2,
        };

        #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
        {
            if self.use_avx2 {
                return self
                    .encoder
                    .encode_interleaved_mcu_row::<_, crate::avx2::AVX2Operations>(
                        &image,
                        0,
                        &self.q_tables,
                        &mut self.state,
                    );
            }
        }

        self.encoder
            .encode_interleaved_mcu_row::<_, DefaultOperations>(
                &image,
                0,
                &self.q_tables,
                &mut self.state,
            )
    }
}

/// A block of image rows in any [`ColorType`], dispatching to the same
/// [`ImageBuffer`] implementations [`Encoder::encode`] uses
struct StripImage<'a> {
    data: &'a [u8],
    width: u16,
    height: u16,
    color_type: ColorType,
    #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
    use_avx2: bool,
}

impl ImageBuffer for StripImage<'_> {
    fn get_jpeg_color_type(&self) -> JpegColorType {
        use ColorType::*;

        match self.color_type {
            Luma => JpegColorType::Luma,
            Rgb | Rgba | Bgr | Bgra | Ycbcr => JpegColorType::Ycbcr,
            Cmyk => JpegColorType::Cmyk,
            CmykAsYcck | Ycck => JpegColorType::Ycck,
        }
    }

    fn width(&self) -> u16 {
        self.width
    }

    fn height(&self) -> u16 {
        self.height
    }

    fn fill_buffers(&self, y: u16, buffers: &mut [Vec<u8>; 4]) {
        let (data, w, h) = (self.data, self.width, self.height);

        #[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
        {
            if self.use_avx2 {
                use crate::avx2::*;

                match self.color_type {
                    ColorType::Rgb => return RgbImageAVX2(data, w, h).fill_buffers(y, buffers),
                    ColorType::Rgba => return RgbaImageAVX2(data, w, h).fill_buffers(y, buffers),
                    ColorType::Bgr => return BgrImageAVX2(data, w, h).fill_buffers(y, buffers),
                    ColorType::Bgra => return BgraImageAVX2(data, w, h).fill_buffers(y, buffers),
                    _ => {}
                }
            }
        }

        match self.color_type {
            ColorType::Luma => GrayImage(data, w, h).fill_buffers(y, buffers),
            ColorType::Rgb => RgbImage(data, w, h).fill_buffers(y, buffers),
            ColorType::Rgba => RgbaImage(data, w, h).fill_buffers(y, buffers),
            ColorType::Bgr => BgrImage(data, w, h).fill_buffers(y, buffers),
            ColorType::Bgra => BgraImage(data, w, h).fill_buffers(y, buffers),
            ColorType::Ycbcr => YCbCrImage(data, w, h).fill_buffers(y, buffers),
            ColorType::Cmyk => CmykImage(data, w, h).fill_buffers(y, buffers),
            ColorType::CmykAsYcck => CmykAsYcckImage(data, w, h).fill_buffers(y, buffers),
            ColorType::Ycck => YcckImage(data, w, h).fill_buffers(y, buffers),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        ChromaSubsamplingMethod, ColorType, Encoder, EncodingError, JfifWrite, SamplingFactor,
    };
    use alloc::vec::Vec;

    fn test_image(width: u16, height: u16, color_type: ColorType) -> Vec<u8> {
        let bpp = color_type.get_bytes_per_pixel();
        let mut data = Vec::with_capacity(usize::from(width) * usize::from(height) * bpp);
        for y in 0..usize::from(height) {
            for x in 0..usize::from(width) {
                for c in 0..bpp {
                    data.push((x * 7 + y * 13 + c * 61 + (x * y) % 23) as u8);
                }
            }
        }
        data
    }

    fn configure<W: JfifWrite>(
        encoder: &mut Encoder<W>,
        sampling: SamplingFactor,
        restart: Option<u16>,
    ) {
        encoder.set_sampling_factor(sampling);
        if let Some(interval) = restart {
            encoder.set_restart_interval(interval);
        }
    }

    /// Encode with `Encoder::encode` and with a `StripEncoder` fed `strip_rows` rows at a time
    fn assert_matches(
        width: u16,
        height: u16,
        color_type: ColorType,
        sampling: SamplingFactor,
        restart: Option<u16>,
        strip_rows: &[usize],
    ) {
        let data = test_image(width, height, color_type);

        let mut expected = Vec::new();
        let mut encoder = Encoder::new(&mut expected, 85);
        configure(&mut encoder, sampling, restart);
        encoder.encode(&data, width, height, color_type).unwrap();

        let mut encoder = Encoder::new(Vec::new(), 85);
        configure(&mut encoder, sampling, restart);
        let mut strips = encoder
            .into_strip_encoder(width, height, color_type)
            .unwrap();

        let row_bytes = usize::from(width) * color_type.get_bytes_per_pixel();
        let mut offset = 0;
        for rows in strip_rows.iter().cycle() {
            if offset == data.len() {
                break;
            }
            let end = (offset + rows * row_bytes).min(data.len());
            strips.encode_strip(&data[offset..end]).unwrap();
            offset = end;
        }
        assert_eq!(strips.rows_remaining(), 0);

        let result = strips.finish().unwrap();
        assert!(
            result == expected,
            "{:?} {:?} {}x{} restart {:?} strips {:?}: output differs",
            color_type,
            sampling,
            width,
            height,
            restart,
            strip_rows
        );
    }

    #[test]
    fn matches_full_image_encoder_for_any_strip_height() {
        for strip_rows in [
            &[1][..],
            &[3],
            &[7],
            &[8],
            &[16],
            &[24],
            &[5, 11, 2],
            &[1000],
        ] {
            assert_matches(
                61,
                45,
                ColorType::Rgb,
                SamplingFactor::F_2_2,
                None,
                strip_rows,
            );
        }
    }

    #[test]
    fn matches_full_image_encoder_for_all_color_types() {
        use ColorType::*;
        for color_type in [Luma, Rgb, Rgba, Bgr, Bgra, Ycbcr, Cmyk, CmykAsYcck, Ycck] {
            assert_matches(33, 19, color_type, SamplingFactor::F_2_2, None, &[4]);
        }
    }

    #[test]
    fn matches_full_image_encoder_for_interleaved_sampling_factors() {
        use SamplingFactor::*;
        for sampling in [
            F_1_1, F_2_1, F_1_2, F_2_2, R_4_4_4, R_4_2_2, R_4_2_0, R_4_4_0,
        ] {
            assert_matches(40, 37, ColorType::Rgb, sampling, None, &[6]);
        }
    }

    #[test]
    fn matches_full_image_encoder_with_restart_interval() {
        assert_matches(
            100,
            50,
            ColorType::Rgb,
            SamplingFactor::F_2_2,
            Some(3),
            &[9],
        );
        assert_matches(
            100,
            50,
            ColorType::Luma,
            SamplingFactor::F_1_1,
            Some(1),
            &[1],
        );
    }

    #[test]
    fn matches_full_image_encoder_with_average_chroma_subsampling() {
        let (width, height) = (50u16, 30u16);
        let data = test_image(width, height, ColorType::Rgb);

        let mut expected = Vec::new();
        let mut encoder = Encoder::new(&mut expected, 90);
        encoder.set_chroma_subsampling_method(ChromaSubsamplingMethod::Average);
        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        let mut encoder = Encoder::new(Vec::new(), 90);
        encoder.set_chroma_subsampling_method(ChromaSubsamplingMethod::Average);
        let mut strips = encoder
            .into_strip_encoder(width, height, ColorType::Rgb)
            .unwrap();
        for strip in data.chunks(usize::from(width) * 3 * 7) {
            strips.encode_strip(strip).unwrap();
        }

        assert_eq!(strips.finish().unwrap(), expected);
    }

    #[test]
    fn writes_headers_up_front_and_bytes_per_mcu_row() {
        let (width, height) = (32u16, 32u16);
        let data = test_image(width, height, ColorType::Rgb);
        let row_bytes = usize::from(width) * 3;

        let mut strips = Encoder::new(Vec::new(), 80)
            .into_strip_encoder(width, height, ColorType::Rgb)
            .unwrap();
        let header_len = strips.writer().len();
        assert_eq!(&strips.writer()[..2], &[0xFF, 0xD8]);

        // 15 rows don't complete a 16 row MCU row, so nothing new is written
        strips.encode_strip(&data[..15 * row_bytes]).unwrap();
        assert_eq!(strips.writer().len(), header_len);

        strips
            .encode_strip(&data[15 * row_bytes..16 * row_bytes])
            .unwrap();
        assert!(strips.writer().len() > header_len);

        strips.writer_mut().clear();
        strips.encode_strip(&data[16 * row_bytes..]).unwrap();
        let tail = strips.finish().unwrap();
        assert_eq!(&tail[tail.len() - 2..], &[0xFF, 0xD9]);
    }

    #[test]
    fn rejects_unsupported_settings() {
        let mut encoder = Encoder::new(Vec::new(), 80);
        encoder.set_progressive(true);
        assert!(matches!(
            encoder.into_strip_encoder(8, 8, ColorType::Rgb),
            Err(EncodingError::StripEncoding(_))
        ));

        let mut encoder = Encoder::new(Vec::new(), 80);
        encoder.set_optimized_huffman_tables(true);
        assert!(matches!(
            encoder.into_strip_encoder(8, 8, ColorType::Rgb),
            Err(EncodingError::StripEncoding(_))
        ));

        let mut encoder = Encoder::new(Vec::new(), 80);
        encoder.set_sampling_factor(SamplingFactor::F_4_1);
        assert!(matches!(
            encoder.into_strip_encoder(8, 8, ColorType::Rgb),
            Err(EncodingError::StripEncoding(_))
        ));

        assert!(matches!(
            Encoder::new(Vec::new(), 80).into_strip_encoder(0, 8, ColorType::Rgb),
            Err(EncodingError::ZeroImageDimensions { .. })
        ));
    }

    #[test]
    fn rejects_bad_strips() {
        let mut strips = Encoder::new(Vec::new(), 80)
            .into_strip_encoder(4, 2, ColorType::Rgb)
            .unwrap();

        // Not a whole number of rows
        assert!(strips.encode_strip(&[0; 13]).is_err());
        // More rows than the image has
        assert!(strips.encode_strip(&[0; 36]).is_err());
        assert_eq!(strips.rows_remaining(), 2);

        strips.encode_strip(&[0; 12]).unwrap();
        assert_eq!(strips.rows_remaining(), 1);
        assert!(matches!(
            strips.finish(),
            Err(EncodingError::StripEncoding(_))
        ));
    }
}
