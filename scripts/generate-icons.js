/**
 * Generate PNG icon files for the GitHub Folder Downloader extension.
 *
 * Produces 16x16, 48x48, and 128x128 icons showing a folder shape with a
 * download arrow, using the neobrutalist dark-mode palette:
 *   - Lime accent  #ccff00  (folder body)
 *   - Black        #000000  (arrow + outlines)
 *   - Transparent background
 *
 * Zero external dependencies -- builds valid PNG files from raw RGBA pixels.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── PNG encoder (minimal, RGBA, non-interlaced) ─────────────────────────

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  // Build raw scanlines: filter byte (0 = None) + row bytes
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter: None
    rgba.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = pngChunk('IDAT', compressed);
  const iend = pngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, pngChunk('IHDR', ihdr), idat, iend]);
}

// ── Icon rasteriser ─────────────────────────────────────────────────────

/**
 * Draw the folder + download-arrow icon into an RGBA buffer of the given size.
 *
 * Co-ordinates are expressed as fractions of the icon size so the same
 * drawing code works at every resolution.
 */
function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4); // RGBA, initialised to 0 (transparent)

  const LIME = [0xcc, 0xff, 0x00, 0xff];
  const BLACK = [0x00, 0x00, 0x00, 0xff];
  const DARK = [0x1a, 0x1a, 0x1a, 0xff]; // subtle dark fill for outline contrast

  function setPixel(x, y, color) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = color[0];
    buf[i + 1] = color[1];
    buf[i + 2] = color[2];
    buf[i + 3] = color[3];
  }

  function fillRect(x0, y0, w, h, color) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        setPixel(x0 + dx, y0 + dy, color);
      }
    }
  }

  // Scale helper: fraction → pixel coord (rounded)
  const s = (frac) => Math.round(frac * size);

  // ── Folder body ────────────────────────────────────────────────────
  // Neobrutalist: thick outlines, solid fills, no gradients.

  const pad = Math.max(1, s(0.06));       // outer padding
  const outW = s(0.04);                   // outline width
  const tabW = s(0.35);                   // tab width (fraction of body)
  const tabH = Math.max(1, s(0.12));      // tab height

  const bx = pad;                         // body left
  const by = pad + tabH;                  // body top (below tab)
  const bw = size - pad * 2;              // body width
  const bh = size - pad - by;             // body height

  // Black outline (draw slightly larger rect behind lime fill)
  fillRect(bx - outW, by - outW, bw + outW * 2, bh + outW * 2, BLACK);

  // Tab outline
  fillRect(bx - outW, by - tabH - outW, tabW + outW * 2, tabH + outW * 2, BLACK);

  // Lime folder body
  fillRect(bx, by, bw, bh, LIME);

  // Lime tab
  fillRect(bx, by - tabH, tabW, tabH, LIME);

  // ── Download arrow (black on lime) ────────────────────────────────
  // Arrow = vertical shaft + triangular head

  const cx = s(0.5);                      // centre x
  const arrowTop = by + s(0.12);
  const arrowBot = by + bh - s(0.14);
  const shaftW = Math.max(1, s(0.12));    // shaft half-width
  const headW = Math.max(2, s(0.22));     // head half-width

  // Shaft
  fillRect(cx - shaftW, arrowTop, shaftW * 2, arrowBot - arrowTop - s(0.10), BLACK);

  // Arrowhead (triangle pointing down)
  const headTop = arrowBot - s(0.22);
  const headBot = arrowBot;
  const headRows = headBot - headTop;
  if (headRows > 0) {
    for (let row = 0; row < headRows; row++) {
      const frac = row / headRows;
      const halfW = Math.round(headW * (0.3 + 0.7 * frac));
      const y = headTop + row;
      fillRect(cx - halfW, y, halfW * 2, 1, BLACK);
    }
  }

  // Small horizontal bar at bottom of folder (download "tray")
  const trayH = Math.max(1, s(0.05));
  const trayY = by + bh - trayH - Math.max(1, s(0.06));
  const trayPad = s(0.14);
  fillRect(bx + trayPad, trayY, bw - trayPad * 2, trayH, BLACK);

  return buf;
}

// ── Main ────────────────────────────────────────────────────────────────

const SIZES = [16, 48, 128];
const outDir = path.join(__dirname, '..', 'src', 'icons');

fs.mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const rgba = drawIcon(size);
  const png = encodePNG(size, size, rgba);
  const filePath = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`  wrote ${filePath}  (${png.length} bytes)`);
}

console.log('\nDone – icons generated.');
