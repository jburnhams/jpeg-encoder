//! # JPEG encoder
//!
//! ## Using the encoder
//! ```no_run
//! # use jpeg_encoder::EncodingError;
//! # pub fn main() -> Result<(), EncodingError> {
//! use jpeg_encoder::{Encoder, ColorType};
//!
//! // An array with 4 pixels in RGB format.
//! let data = [
//!     255,0,0,
//!     0,255,0,
//!     0,0,255,
//!     255,255,255,
//! ];
//!
//! // Create new encoder that writes to a file with maximum quality (100)
//! let mut encoder = Encoder::new_file("some.jpeg", 100)?;
//!
//! // Encode the data with dimension 2x2
//! encoder.encode(&data, 2, 2, ColorType::Rgb)?;
//! # Ok(())
//! # }

#![no_std]
#![cfg_attr(not(feature = "simd"), forbid(unsafe_code))]

#[cfg(feature = "std")]
extern crate std;

extern crate alloc;
extern crate core;

#[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
mod avx2;
mod encoder;
mod error;
mod fdct;
mod huffman;
mod image_buffer;
mod marker;
mod quantization;
mod writer;

pub use encoder::{ColorType, ComponentSpec, Encoder, JpegColorType, SamplingFactor, StripEncoder};
pub use error::EncodingError;
pub use image_buffer::{cmyk_to_ycck, rgb_to_ycbcr, ImageBuffer};
pub use quantization::QuantizationTableType;
pub use writer::{CallbackWriter, Density, JfifWrite};

#[cfg(all(
    feature = "benchmark",
    feature = "simd",
    any(target_arch = "x86", target_arch = "x86_64")
))]
pub use avx2::fdct_avx2;
#[cfg(feature = "benchmark")]
pub use fdct::fdct;

#[cfg(test)]
mod tests {
    use crate::image_buffer::{cmyk_to_ycck, rgb_to_ycbcr};
    use crate::{
        CallbackWriter, ColorType, Encoder, QuantizationTableType, SamplingFactor, StripEncoder,
    };
    use jpeg_decoder::{Decoder, ImageInfo, PixelFormat};

    use alloc::boxed::Box;
    use alloc::rc::Rc;
    use alloc::vec;
    use alloc::vec::Vec;
    use core::cell::RefCell;

    fn create_test_img_rgb() -> (Vec<u8>, u16, u16) {
        // Ensure size which which ensures an odd MCU count per row to test chroma subsampling
        let width = 258;
        let height = 128;

        let mut data = Vec::with_capacity(width * height * 3);

        for y in 0..height {
            for x in 0..width {
                let x = x.min(255);
                data.push(x as u8);
                data.push((y * 2) as u8);
                data.push(((x + y * 2) / 2) as u8);
            }
        }

        (data, width as u16, height as u16)
    }

    fn create_test_img_bgr() -> (Vec<u8>, u16, u16) {
        let width = 258;
        let height = 128;

        let mut data = Vec::with_capacity(width * height * 3);

        for y in 0..height {
            for x in 0..width {
                let x = x.min(255);
                data.push(((x + y * 2) / 2) as u8);
                data.push((y * 2) as u8);
                data.push(x as u8);
            }
        }

        (data, width as u16, height as u16)
    }

    fn create_test_img_rgba() -> (Vec<u8>, u16, u16) {
        // Ensure size which which ensures an odd MCU count per row to test chroma subsampling
        let width = 258;
        let height = 128;

        let mut data = Vec::with_capacity(width * height * 3);

        for y in 0..height {
            for x in 0..width {
                let x = x.min(255);
                data.push(x as u8);
                data.push((y * 2) as u8);
                data.push(((x + y * 2) / 2) as u8);
                data.push(x as u8);
            }
        }

        (data, width as u16, height as u16)
    }

    fn create_test_img_bgra() -> (Vec<u8>, u16, u16) {
        let width = 258;
        let height = 128;

        let mut data = Vec::with_capacity(width * height * 4);

        for y in 0..height {
            for x in 0..width {
                let x = x.min(255);
                data.push(((x + y * 2) / 2) as u8);
                data.push((y * 2) as u8);
                data.push(x as u8);
                data.push((255 - x) as u8);
            }
        }

        (data, width as u16, height as u16)
    }

    fn create_test_img_gray() -> (Vec<u8>, u16, u16) {
        let width = 258;
        let height = 128;

        let mut data = Vec::with_capacity(width * height);

        for y in 0..height {
            for x in 0..width {
                let x = x.min(255);
                let (y, _, _) = rgb_to_ycbcr(x as u8, (y * 2) as u8, ((x + y * 2) / 2) as u8);
                data.push(y);
            }
        }

        (data, width as u16, height as u16)
    }

    fn create_test_img_ycbcr() -> (Vec<u8>, u16, u16) {
        let width = 258;
        let height = 128;

        let mut data = Vec::with_capacity(width * height * 3);

        for y in 0..height {
            for x in 0..width {
                let x = x.min(255);
                let (yy, cb, cr) = rgb_to_ycbcr(x as u8, (y * 2) as u8, ((x + y * 2) / 2) as u8);
                data.push(yy);
                data.push(cb);
                data.push(cr);
            }
        }

        (data, width as u16, height as u16)
    }

    fn create_test_img_cmyk() -> (Vec<u8>, u16, u16) {
        let width = 258;
        let height = 192;

        let mut data = Vec::with_capacity(width * height * 4);

        for y in 0..height {
            for x in 0..width {
                let x = x.min(255);
                data.push(x as u8);
                data.push((y * 3 / 2) as u8);
                data.push(((x + y * 3 / 2) / 2) as u8);
                data.push((255 - (x + y) / 2) as u8);
            }
        }

        (data, width as u16, height as u16)
    }

    fn create_test_img_ycck() -> (Vec<u8>, u16, u16) {
        let (cmyk, width, height) = create_test_img_cmyk();
        let mut data = Vec::with_capacity(cmyk.len());

        for pixel in cmyk.chunks_exact(4) {
            let (y, cb, cr, k) = cmyk_to_ycck(pixel[0], pixel[1], pixel[2], pixel[3]);
            data.push(y);
            data.push(cb);
            data.push(cr);
            data.push(k);
        }

        (data, width, height)
    }

    fn decode(data: &[u8]) -> (Vec<u8>, ImageInfo) {
        let mut decoder = Decoder::new(data);

        (decoder.decode().unwrap(), decoder.info().unwrap())
    }

    fn check_result(
        data: Vec<u8>,
        width: u16,
        height: u16,
        result: &mut Vec<u8>,
        pixel_format: PixelFormat,
    ) {
        let (img, info) = decode(&result);

        assert_eq!(info.pixel_format, pixel_format);
        assert_eq!(info.width, width);
        assert_eq!(info.height, height);
        assert_eq!(img.len(), data.len());

        for (i, (&v1, &v2)) in data.iter().zip(img.iter()).enumerate() {
            let diff = (v1 as i16 - v2 as i16).abs();
            assert!(
                diff < 20,
                "Large color diff at index: {}: {} vs {}",
                i,
                v1,
                v2
            );
        }
    }

    fn assert_strip_matches(
        data: &[u8],
        width: u16,
        height: u16,
        color_type: ColorType,
        quality: u8,
        strip_height: usize,
    ) {
        assert!(strip_height > 0, "Strip height must be positive");

        let mut expected = Vec::new();
        Encoder::new(&mut expected, quality)
            .encode(data, width, height, color_type)
            .unwrap();

        let streaming_encoder = Encoder::new(Vec::new(), quality);
        let mut strip_encoder = streaming_encoder
            .into_strip_encoder(width, height, color_type)
            .unwrap();

        let header = strip_encoder.header_bytes().unwrap();
        let row_stride = usize::from(width) * color_type.get_bytes_per_pixel();

        for chunk in data.chunks(row_stride * strip_height) {
            strip_encoder.encode_strip(chunk).unwrap();
        }

        let result = strip_encoder.finish().unwrap();

        assert_eq!(result, expected);
        assert_eq!(&result[..header.len()], header.as_slice());
        let footer = StripEncoder::<Vec<u8>>::footer_bytes();
        assert_eq!(&result[result.len() - footer.len()..], &footer);
    }

    #[test]
    fn test_gray_100() {
        let (data, width, height) = create_test_img_gray();

        let mut result = Vec::new();
        let encoder = Encoder::new(&mut result, 100);
        encoder
            .encode(&data, width, height, ColorType::Luma)
            .unwrap();

        check_result(data, width, height, &mut result, PixelFormat::L8);
    }

    #[test]
    fn test_rgb_100() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let encoder = Encoder::new(&mut result, 100);
        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_rgb_80() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let encoder = Encoder::new(&mut result, 80);
        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_rgb_strip_encoder_matches() {
        let (data, width, height) = create_test_img_rgb();
        assert_strip_matches(&data, width, height, ColorType::Rgb, 80, 5);
    }

    #[test]
    fn test_gray_strip_encoder_matches() {
        let (data, width, height) = create_test_img_gray();
        assert_strip_matches(&data, width, height, ColorType::Luma, 90, 7);
    }

    #[test]
    fn test_bgr_strip_encoder_matches() {
        let (data, width, height) = create_test_img_bgr();
        assert_strip_matches(&data, width, height, ColorType::Bgr, 75, 3);
    }

    #[test]
    fn test_bgra_strip_encoder_matches() {
        let (data, width, height) = create_test_img_bgra();
        assert_strip_matches(&data, width, height, ColorType::Bgra, 85, 6);
    }

    #[test]
    fn test_ycbcr_strip_encoder_matches() {
        let (data, width, height) = create_test_img_ycbcr();
        assert_strip_matches(&data, width, height, ColorType::Ycbcr, 70, 4);
    }

    #[test]
    fn test_cmyk_strip_encoder_matches() {
        let (data, width, height) = create_test_img_cmyk();
        assert_strip_matches(&data, width, height, ColorType::Cmyk, 70, 5);
    }

    #[test]
    fn test_cmyk_as_ycck_strip_encoder_matches() {
        let (data, width, height) = create_test_img_cmyk();
        assert_strip_matches(&data, width, height, ColorType::CmykAsYcck, 65, 9);
    }

    #[test]
    fn test_ycck_strip_encoder_matches() {
        let (data, width, height) = create_test_img_ycck();
        assert_strip_matches(&data, width, height, ColorType::Ycck, 60, 11);
    }

    #[test]
    fn test_strip_encoder_callback_writer() {
        let (data, width, height) = create_test_img_rgb();
        let segments: Rc<RefCell<Vec<Vec<u8>>>> = Rc::new(RefCell::new(Vec::new()));
        let captured = Rc::clone(&segments);

        let writer = CallbackWriter::new(move |chunk: &[u8]| {
            captured.borrow_mut().push(chunk.to_vec());
            Ok(())
        });

        let streaming_encoder = Encoder::new(writer, 80);
        let mut strip_encoder = streaming_encoder
            .into_strip_encoder(width, height, ColorType::Rgb)
            .unwrap();

        let header_bytes = strip_encoder.header_bytes().unwrap();
        strip_encoder.write_headers().unwrap();

        let header_snapshot = segments.borrow().clone();
        let header_count = header_snapshot.len();
        assert!(header_count > 0);
        let header_written: Vec<u8> = header_snapshot
            .iter()
            .flat_map(|chunk| chunk.iter().copied())
            .collect();
        assert_eq!(header_written, header_bytes);

        let row_stride = usize::from(width) * ColorType::Rgb.get_bytes_per_pixel();
        for chunk in data.chunks(row_stride * 6) {
            strip_encoder.encode_strip(chunk).unwrap();
        }

        let callback_writer = strip_encoder.finish().unwrap();
        core::mem::drop(callback_writer);

        let segments_snapshot = segments.borrow().clone();
        assert!(segments_snapshot.len() >= header_count);

        let all_bytes: Vec<u8> = segments_snapshot
            .iter()
            .flat_map(|chunk| chunk.iter().copied())
            .collect();

        let mut expected = Vec::new();
        Encoder::new(&mut expected, 80)
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        assert_eq!(all_bytes, expected);

        let footer = StripEncoder::<Vec<u8>>::footer_bytes();
        assert!(all_bytes.ends_with(&footer));
    }

    #[test]
    fn test_rgba_80() {
        let (data, width, height) = create_test_img_rgba();

        let mut result = Vec::new();
        let encoder = Encoder::new(&mut result, 80);
        encoder
            .encode(&data, width, height, ColorType::Rgba)
            .unwrap();

        let (data, width, height) = create_test_img_rgb();

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_rgb_custom_q_table() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 100);

        let table = QuantizationTableType::Custom(Box::new([
            1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
            1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
            1, 1, 1, 1, 1, 1,
        ]));

        encoder.set_quantization_tables(table.clone(), table);

        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_rgb_2_2() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 100);
        encoder.set_sampling_factor(SamplingFactor::F_2_2);
        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_rgb_2_1() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 100);
        encoder.set_sampling_factor(SamplingFactor::F_2_1);
        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_rgb_4_1() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 100);
        encoder.set_sampling_factor(SamplingFactor::F_4_1);
        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_rgb_1_1() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 100);
        encoder.set_sampling_factor(SamplingFactor::F_1_1);
        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_rgb_1_4() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 100);
        encoder.set_sampling_factor(SamplingFactor::F_1_4);
        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_rgb_progressive() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 100);
        encoder.set_sampling_factor(SamplingFactor::F_2_1);
        encoder.set_progressive(true);

        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_rgb_optimized() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 100);
        encoder.set_sampling_factor(SamplingFactor::F_2_2);
        encoder.set_optimized_huffman_tables(true);

        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_rgb_optimized_progressive() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 100);
        encoder.set_sampling_factor(SamplingFactor::F_2_1);
        encoder.set_progressive(true);
        encoder.set_optimized_huffman_tables(true);

        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_cmyk() {
        let (data, width, height) = create_test_img_cmyk();

        let mut result = Vec::new();
        let encoder = Encoder::new(&mut result, 100);
        encoder
            .encode(&data, width, height, ColorType::Cmyk)
            .unwrap();

        check_result(data, width, height, &mut result, PixelFormat::CMYK32);
    }

    #[test]
    fn test_ycck() {
        let (data, width, height) = create_test_img_cmyk();

        let mut result = Vec::new();
        let encoder = Encoder::new(&mut result, 100);
        encoder
            .encode(&data, width, height, ColorType::CmykAsYcck)
            .unwrap();

        check_result(data, width, height, &mut result, PixelFormat::CMYK32);
    }

    #[test]
    fn test_restart_interval() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 100);

        encoder.set_restart_interval(32);
        const DRI_DATA: &[u8; 6] = b"\xFF\xDD\0\x04\0\x20";

        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        assert!(result
            .as_slice()
            .windows(DRI_DATA.len())
            .any(|w| w == DRI_DATA));

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_restart_interval_4_1() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 100);
        encoder.set_sampling_factor(SamplingFactor::F_4_1);

        encoder.set_restart_interval(32);
        const DRI_DATA: &[u8; 6] = b"\xFF\xDD\0\x04\0\x20";

        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        assert!(result
            .as_slice()
            .windows(DRI_DATA.len())
            .any(|w| w == DRI_DATA));

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_restart_interval_progressive() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 85);
        encoder.set_progressive(true);

        encoder.set_restart_interval(32);
        const DRI_DATA: &[u8; 6] = b"\xFF\xDD\0\x04\0\x20";

        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        assert!(result
            .as_slice()
            .windows(DRI_DATA.len())
            .any(|w| w == DRI_DATA));

        check_result(data, width, height, &mut result, PixelFormat::RGB24);
    }

    #[test]
    fn test_app_segment() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 100);

        encoder.add_app_segment(15, b"HOHOHO\0").unwrap();

        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        let segment_data = b"\xEF\0\x09HOHOHO\0";

        assert!(result
            .as_slice()
            .windows(segment_data.len())
            .any(|w| w == segment_data));
    }

    #[test]
    fn test_icc_profile() {
        let (data, width, height) = create_test_img_rgb();

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 100);

        let mut icc = Vec::with_capacity(128 * 1024);

        for i in 0..128 * 1024 {
            icc.push((i % 255) as u8);
        }

        encoder.add_icc_profile(&icc).unwrap();

        encoder
            .encode(&data, width, height, ColorType::Rgb)
            .unwrap();

        const MARKER: &[u8; 12] = b"ICC_PROFILE\0";

        assert!(result.as_slice().windows(MARKER.len()).any(|w| w == MARKER));

        let mut decoder = Decoder::new(result.as_slice());

        decoder.decode().unwrap();

        let icc_out = match decoder.icc_profile() {
            Some(icc) => icc,
            None => panic!("Missing icc profile"),
        };

        assert_eq!(icc, icc_out);
    }

    #[test]
    fn test_rgb_optimized_missing_table_frequency() {
        let data = vec![0xfb, 0x15, 0x15];

        let mut result = Vec::new();
        let mut encoder = Encoder::new(&mut result, 100);
        encoder.set_sampling_factor(SamplingFactor::F_2_2);
        encoder.set_optimized_huffman_tables(true);

        encoder.encode(&data, 1, 1, ColorType::Rgb).unwrap();

        check_result(data, 1, 1, &mut result, PixelFormat::RGB24);
    }
}
