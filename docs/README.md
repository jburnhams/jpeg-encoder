# JPEG Encoder WASM - Browser Demo

This directory contains a live interactive demo of the JPEG encoder running in the browser via WebAssembly.

## Files

- `index.html` - Main demo page with interactive canvas
- `app.js` - JavaScript application using the WASM encoder
- `dist/` - Compiled WASM files (**generated**, not in source control)

## Building

To build the WASM files for the demo:

```bash
npm run build           # Build WASM to pkg/
npm run prepare:docs    # Copy to docs/dist/
```

The `prepare:docs` script copies the compiled files from `pkg/` to `docs/dist/`.
This happens automatically in the GitHub Pages deployment workflow.

## Running Locally

You need to serve the files over HTTP (not file://) due to WASM requirements:

```bash
# Using Python
python3 -m http.server 8000 --directory docs

# Using Node.js
npx serve docs

# Using PHP
php -S localhost:8000 -t docs
```

Then open http://localhost:8000 in your browser.

## Features

The demo showcases:

- **Interactive Drawing**: Draw on the canvas with your mouse or touch
- **Real-time Encoding**: Encode canvas content to JPEG instantly
- **Quality Control**: Adjust JPEG quality from 1-100
- **Performance Stats**: See encoding time, sizes, and compression ratios
- **Example Patterns**: Pre-loaded examples (gradients, shapes, patterns, text)
- **Download**: Save encoded JPEGs to your device

## Deployment

The demo is automatically deployed to GitHub Pages when changes are pushed to the main branch. See `.github/workflows/deploy-pages.yml` for the deployment configuration.

## Browser Compatibility

The demo works in all modern browsers that support:
- WebAssembly
- ES6 Modules
- Canvas API

Tested in: Chrome, Firefox, Safari, Edge (latest versions)
