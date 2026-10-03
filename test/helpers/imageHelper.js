/**
 * Minimal real image buffers (valid magic bytes) for upload tests.
 * Upload middleware verifies file content, so plain text buffers are rejected.
 */

// 1x1 transparent PNG
export const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

// JPEG header (SOI + JFIF APP0 marker) padded to a minimal payload
export const JPEG_BUFFER = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.alloc(16),
  Buffer.from([0xff, 0xd9]),
]);
