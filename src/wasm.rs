use crate::{ColorType, Encoder, EncodingError, StripEncoder};
use crate::writer::JfifWrite;
use alloc::rc::Rc;
use alloc::string::ToString;
use alloc::vec::Vec;
use core::cell::RefCell;
use core::mem;
use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub enum WasmColorType {
    Luma,
    Rgb,
    Rgba,
    Bgr,
    Bgra,
    Ycbcr,
    Cmyk,
    CmykAsYcck,
    Ycck,
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

#[derive(Clone)]
struct SharedBufferWriter {
    buffer: Rc<RefCell<Vec<u8>>>,
}

impl SharedBufferWriter {
    fn new(buffer: Rc<RefCell<Vec<u8>>>) -> Self {
        SharedBufferWriter { buffer }
    }
}

impl JfifWrite for SharedBufferWriter {
    fn write_all(&mut self, buf: &[u8]) -> Result<(), EncodingError> {
        self.buffer.borrow_mut().extend_from_slice(buf);
        Ok(())
    }
}

fn encoding_error_to_js(err: EncodingError) -> JsValue {
    JsValue::from_str(&err.to_string())
}

fn take_buffer(buffer: &Rc<RefCell<Vec<u8>>>) -> Uint8Array {
    let mut data = buffer.borrow_mut();
    if data.is_empty() {
        return Uint8Array::new_with_length(0);
    }

    let vec = mem::take(&mut *data);
    let array = Uint8Array::from(vec.as_slice());
    array
}

#[wasm_bindgen]
pub struct StreamingJpegEncoder {
    encoder: Option<StripEncoder<SharedBufferWriter>>,
    buffer: Rc<RefCell<Vec<u8>>>,
}

#[wasm_bindgen]
impl StreamingJpegEncoder {
    #[wasm_bindgen(constructor)]
    pub fn new(
        width: u16,
        height: u16,
        color_type: WasmColorType,
        quality: u8,
    ) -> Result<StreamingJpegEncoder, JsValue> {
        let buffer = Rc::new(RefCell::new(Vec::new()));
        let writer = SharedBufferWriter::new(buffer.clone());
        let encoder = Encoder::new(writer, quality);
        let mut strip_encoder = encoder
            .into_strip_encoder(width, height, color_type.into())
            .map_err(encoding_error_to_js)?;
        strip_encoder.write_headers().map_err(encoding_error_to_js)?;

        Ok(StreamingJpegEncoder {
            encoder: Some(strip_encoder),
            buffer,
        })
    }

    pub fn encode_strip(&mut self, data: &[u8]) -> Result<Uint8Array, JsValue> {
        let encoder = self
            .encoder
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Encoder has already been finished"))?;
        encoder.encode_strip(data).map_err(encoding_error_to_js)?;

        Ok(take_buffer(&self.buffer))
    }

    pub fn finish(&mut self) -> Result<Uint8Array, JsValue> {
        let encoder = self
            .encoder
            .take()
            .ok_or_else(|| JsValue::from_str("Encoder has already been finished"))?;
        let writer = encoder.finish().map_err(encoding_error_to_js)?;
        drop(writer);

        Ok(take_buffer(&self.buffer))
    }

    pub fn take_output(&self) -> Uint8Array {
        take_buffer(&self.buffer)
    }

    pub fn header_bytes(
        width: u16,
        height: u16,
        color_type: WasmColorType,
        quality: u8,
    ) -> Result<Uint8Array, JsValue> {
        let buffer = Rc::new(RefCell::new(Vec::new()));
        let writer = SharedBufferWriter::new(buffer);
        let encoder = Encoder::new(writer, quality);
        let strip_encoder = encoder
            .into_strip_encoder(width, height, color_type.into())
            .map_err(encoding_error_to_js)?;
        let header = strip_encoder.header_bytes().map_err(encoding_error_to_js)?;

        Ok(Uint8Array::from(header.as_slice()))
    }

    pub fn footer_bytes() -> Uint8Array {
        let footer = StripEncoder::<SharedBufferWriter>::footer_bytes();
        Uint8Array::from(footer.as_slice())
    }
}
