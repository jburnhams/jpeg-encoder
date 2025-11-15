# JPEG encoder

[![docs.rs badge](https://docs.rs/jpeg-encoder/badge.svg)](https://docs.rs/jpeg-encoder/)
[![crates.io badge](https://img.shields.io/crates/v/jpeg-encoder.svg)](https://crates.io/crates/jpeg-encoder/)
[![Rust](https://github.com/vstroebel/jpeg-encoder/actions/workflows/rust.yml/badge.svg)](https://github.com/vstroebel/jpeg-encoder/actions/workflows/rust.yml)

A JPEG encoder written in Rust featuring:

- Baseline and progressive compression
- Chroma subsampling
- Optimized huffman tables
- 1, 3 and 4 component colorspaces
- Restart interval
- Custom quantization tables
- AVX2 based optimizations (Optional)
- Support for no_std + alloc
- No `unsafe` by default (Enabling the `simd` feature adds unsafe code)

## Example
```rust
use jpeg_encoder::{Encoder, ColorType};

// An array with 4 pixels in RGB format.
let data = [
    255, 0, 0,
    0, 255, 0,
    0, 0, 255,
    255, 255, 255,
];

// Create new encoder that writes to a file with maximum quality (100)
let mut encoder = Encoder::new_file("some.jpeg", 100)?;

// Encode the data with dimension 2x2
encoder.encode(&data, 2, 2, ColorType::Rgb)?;
```

## WebAssembly package

This repository ships WebAssembly bindings located in the `pkg/` directory.
Producing an optimized build requires:

- The Rust toolchain with the `wasm32-unknown-unknown` target installed
- [`wasm-bindgen-cli`](https://github.com/rustwasm/wasm-bindgen)
- [`wasm-opt`](https://github.com/WebAssembly/binaryen) from the Binaryen toolkit

Install the prerequisites with your system package manager, for example:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli
# Debian/Ubuntu
sudo apt-get install binaryen
# macOS
brew install binaryen
```

After installing the tools you can generate the bindings with:

```bash
cargo build --manifest-path wasm-bindings/Cargo.toml --release --target wasm32-unknown-unknown
wasm-bindgen target/wasm32-unknown-unknown/release/jpeg_encoder_wasm.wasm \
  --out-dir pkg --target bundler --typescript --out-name jpeg_encoder
wasm-opt -Oz pkg/jpeg_encoder_bg.wasm -o pkg/jpeg_encoder_bg.wasm
```

These are the same steps executed by the `wasm-bindgen` GitHub Actions workflow.

## Crate features
- `std` (default): Enables functionality dependent on the std lib
- `simd`: Enables SIMD optimizations (implies `std` and only AVX2 as for now)

## Minimum Supported Version of Rust (MSRV)

This crate needs at least 1.61 or higher.

## License

This project is licensed under either of

* Apache License, Version 2.0, ([LICENSE-APACHE](LICENSE-APACHE) or https://www.apache.org/licenses/LICENSE-2.0)
* MIT license ([LICENSE-MIT](LICENSE-MIT) or https://opensource.org/licenses/MIT)

## Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted 
for inclusion in jpeg-encoder by you, as defined in the Apache-2.0 license, 
shall be dual licensed as above, without any additional terms or conditions.
