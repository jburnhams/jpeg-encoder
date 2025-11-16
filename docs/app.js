import init, { StreamingJpegEncoder, WasmColorType } from './dist/jpeg_encoder.js';

// Initialize WASM module
await init();

// Canvas setup
const canvas = document.getElementById('draw-canvas');
const ctx = canvas.getContext('2d');
let isDrawing = false;

// Set initial canvas background
ctx.fillStyle = 'white';
ctx.fillRect(0, 0, canvas.width, canvas.height);

// Drawing functionality
let currentColor = document.getElementById('color').value;

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);

// Touch support
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
    isDrawing = true;
});

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!isDrawing) return;
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    ctx.lineTo(x, y);
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
});

canvas.addEventListener('touchend', () => {
    isDrawing = false;
});

function startDrawing(e) {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
}

function draw(e) {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
}

function stopDrawing() {
    isDrawing = false;
}

// Color picker
document.getElementById('color').addEventListener('change', (e) => {
    currentColor = e.target.value;
});

// Quality slider
const qualitySlider = document.getElementById('quality');
const qualityValue = document.getElementById('quality-value');

qualitySlider.addEventListener('input', (e) => {
    qualityValue.textContent = e.target.value;
});

// Clear button
document.getElementById('clear-btn').addEventListener('click', () => {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
});

// Helper function to concatenate Uint8Arrays
function concatUint8Arrays(...arrays) {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

// Helper function to extract RGB from ImageData
function imageDataToRGB(imageData) {
    const rgb = new Uint8Array((imageData.data.length / 4) * 3);
    for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
        rgb[j] = imageData.data[i];         // R
        rgb[j + 1] = imageData.data[i + 1]; // G
        rgb[j + 2] = imageData.data[i + 2]; // B
    }
    return rgb;
}

// Encode button
let lastJpegBlob = null;

document.getElementById('encode-btn').addEventListener('click', async () => {
    const quality = parseInt(qualitySlider.value);
    const startTime = performance.now();

    try {
        // Get image data from canvas
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageDataToRGB(imageData);

        // Create encoder
        const encoder = new StreamingJpegEncoder(
            canvas.width,
            canvas.height,
            WasmColorType.Rgb,
            quality
        );

        // Encode
        const chunk1 = encoder.encode_strip(pixels);
        const chunk2 = encoder.finish();
        const jpegData = concatUint8Arrays(chunk1, chunk2);

        const endTime = performance.now();

        // Create blob and display
        const blob = new Blob([jpegData], { type: 'image/jpeg' });
        lastJpegBlob = blob;
        const url = URL.createObjectURL(blob);

        const outputImg = document.getElementById('output-img');
        const placeholder = document.getElementById('placeholder');

        outputImg.src = url;
        outputImg.style.display = 'block';
        placeholder.style.display = 'none';

        // Show stats
        const inputSize = pixels.length;
        const outputSize = jpegData.length;
        const ratio = (inputSize / outputSize).toFixed(2);

        document.getElementById('stats').style.display = 'block';
        document.getElementById('encode-time').textContent = `${(endTime - startTime).toFixed(2)} ms`;
        document.getElementById('input-size').textContent = `${(inputSize / 1024).toFixed(2)} KB (RGB data)`;
        document.getElementById('output-size').textContent = `${(outputSize / 1024).toFixed(2)} KB`;
        document.getElementById('compression-ratio').textContent = `${ratio}:1`;

    } catch (error) {
        console.error('Encoding error:', error);
        alert('Failed to encode image: ' + error.message);
    }
});

// Download button
document.getElementById('download-btn').addEventListener('click', () => {
    if (!lastJpegBlob) {
        alert('Please encode an image first!');
        return;
    }

    const url = URL.createObjectURL(lastJpegBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `encoded-q${qualitySlider.value}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// Example buttons
function drawGradient() {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#FF6B6B');
    gradient.addColorStop(0.33, '#4ECDC4');
    gradient.addColorStop(0.66, '#45B7D1');
    gradient.addColorStop(1, '#96CEB4');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawShapes() {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Red rectangle
    ctx.fillStyle = '#E74C3C';
    ctx.fillRect(50, 50, 150, 150);

    // Green circle
    ctx.fillStyle = '#2ECC71';
    ctx.beginPath();
    ctx.arc(350, 125, 75, 0, 2 * Math.PI);
    ctx.fill();

    // Blue triangle
    ctx.fillStyle = '#3498DB';
    ctx.beginPath();
    ctx.moveTo(100, 350);
    ctx.lineTo(200, 450);
    ctx.lineTo(0, 450);
    ctx.closePath();
    ctx.fill();

    // Purple star
    ctx.fillStyle = '#9B59B6';
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
        const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
        const x = 350 + Math.cos(angle) * 70;
        const y = 350 + Math.sin(angle) * 70;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
}

function drawPattern() {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const colors = ['#E74C3C', '#3498DB', '#2ECC71', '#F39C12', '#9B59B6'];
    const size = 40;

    for (let y = 0; y < canvas.height; y += size) {
        for (let x = 0; x < canvas.width; x += size) {
            const colorIndex = ((x / size) + (y / size)) % colors.length;
            ctx.fillStyle = colors[colorIndex];
            ctx.fillRect(x, y, size, size);
        }
    }
}

function drawText() {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'white';
    ctx.font = 'bold 64px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('JPEG', canvas.width / 2, canvas.height / 2 - 50);

    ctx.font = 'bold 48px Arial';
    ctx.fillText('Encoder', canvas.width / 2, canvas.height / 2 + 30);

    ctx.font = '24px Arial';
    ctx.fillText('WebAssembly', canvas.width / 2, canvas.height / 2 + 80);
}

document.querySelectorAll('.example-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const example = btn.dataset.example;
        switch (example) {
            case 'gradient':
                drawGradient();
                break;
            case 'shapes':
                drawShapes();
                break;
            case 'pattern':
                drawPattern();
                break;
            case 'text':
                drawText();
                break;
        }
    });
});

// Initial example
drawGradient();

console.log('JPEG Encoder WASM initialized successfully!');
