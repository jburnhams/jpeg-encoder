import { TextDecoder, TextEncoder } from 'util';

// Polyfill TextDecoder and TextEncoder for jsdom
global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;
