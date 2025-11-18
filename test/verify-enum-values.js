/**
 * Verify that WasmColorType enum values match between TypeScript definitions and runtime
 */

import { WasmColorType } from '../pkg/esm/index.js';

console.log('Verifying WasmColorType enum values:');
console.log('=====================================\n');

const expectedValues = {
    Luma: 0,
    Rgb: 1,
    Rgba: 2,
    Bgr: 3,
    Bgra: 4,
    Ycbcr: 5,
    Cmyk: 6,
    CmykAsYcck: 7,
    Ycck: 8,
};

let allCorrect = true;

for (const [name, expectedValue] of Object.entries(expectedValues)) {
    const actualValue = WasmColorType[name];
    const correct = actualValue === expectedValue;

    console.log(`  ${name}: ${actualValue} ${correct ? '✓' : `✗ (expected ${expectedValue})`}`);

    if (!correct) {
        allCorrect = false;
    }
}

console.log('\n=====================================');
if (allCorrect) {
    console.log('✓ All enum values match!');
} else {
    console.log('✗ Some enum values do not match!');
    process.exit(1);
}
