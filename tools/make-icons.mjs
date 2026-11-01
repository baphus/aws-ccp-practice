import fs from 'node:fs';
import zlib from 'node:zlib';

/* ---------------------------------------------------------------------------
   Minimal PNG writer (no dependencies).
   Renders the app icon: AWS orange rounded square, white "C" glyph + accent bar.
   Outputs icon-192.png, icon-512.png, icon-512-maskable.png
   ------------------------------------------------------------------------- */

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ORANGE = [255, 153, 0];
const INK = [26, 16, 0];
const WHITE = [255, 255, 255];

function draw(size, { maskable }) {
  const px = Buffer.alloc(size * size * 4);
  // Safe zone: maskable icons need content inside the middle 80%.
  const inset = maskable ? size * 0.1 : 0;
  const radius = maskable ? 0 : size * 0.22;

  const set = (x, y, [r, g, b], a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };

  // Rounded (or full-bleed) orange background with 4x supersampled corners.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x < inset || y < inset || x >= size - inset || y >= size - inset) {
        set(x, y, maskable ? ORANGE : [0, 0, 0], maskable ? 255 : 0);
        continue;
      }
      if (radius > 0) {
        const cx = Math.min(Math.max(x, radius), size - 1 - radius);
        const cy = Math.min(Math.max(y, radius), size - 1 - radius);
        const d = Math.hypot(x - cx, y - cy);
        if (d > radius) {
          // anti-alias the edge
          const a = Math.max(0, Math.min(1, radius - d + 0.5));
          set(x, y, ORANGE, Math.round(a * 255));
          continue;
        }
      }
      set(x, y, ORANGE);
    }
  }

  // A "C" drawn as an annulus with a gap on the right.
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * (maskable ? 0.26 : 0.30);
  const rInner = size * (maskable ? 0.165 : 0.19);
  const gap = 0.42; // half-angle of the opening, radians

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > rOuter + 1 || d < rInner - 1) continue;
      const angle = Math.atan2(dy, dx);
      if (Math.abs(angle) < gap) continue; // the C's opening

      // anti-alias radial edges
      const aOut = Math.min(1, Math.max(0, rOuter - d + 0.5));
      const aIn = Math.min(1, Math.max(0, d - rInner + 0.5));
      const aAng = Math.min(1, Math.max(0, (Math.abs(angle) - gap) * rInner + 0.5));
      const a = Math.min(aOut, aIn, aAng);
      if (a <= 0) continue;

      const i = (y * size + x) * 4;
      const prev = [px[i], px[i + 1], px[i + 2]];
      set(x, y, [
        Math.round(prev[0] * (1 - a) + WHITE[0] * a),
        Math.round(prev[1] * (1 - a) + WHITE[1] * a),
        Math.round(prev[2] * (1 - a) + WHITE[2] * a),
      ]);
    }
  }

  // Small orange dot in the C's opening, tying it to the brand dot.
  const dotR = size * 0.055;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx - rOuter * 0.62, y - cy);
      if (d > dotR + 1) continue;
      const a = Math.min(1, Math.max(0, dotR - d + 0.5));
      if (a <= 0) continue;
      const i = (y * size + x) * 4;
      set(x, y, [
        Math.round(px[i] * (1 - a) + INK[0] * a),
        Math.round(px[i + 1] * (1 - a) + INK[1] * a),
        Math.round(px[i + 2] * (1 - a) + INK[2] * a),
      ]);
    }
  }

  return png(size, size, px);
}

fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync('assets/icon-192.png', draw(192, { maskable: false }));
fs.writeFileSync('assets/icon-512.png', draw(512, { maskable: false }));
fs.writeFileSync('assets/icon-512-maskable.png', draw(512, { maskable: true }));

console.log('Wrote assets/icon-192.png, icon-512.png, icon-512-maskable.png');
