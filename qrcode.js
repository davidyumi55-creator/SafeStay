/* =========================================================
   SAFE-STAY OFFLINE QR CODE GENERATOR (qrcode.js)
   Generates real, scannable QR codes as crisp SVG images
   with zero internet connection or external libraries.
   Supports standard QR Versions 1-10 (Error Correction M).
   ========================================================= */

const SafeStayQR = (function () {
  // Error Correction Level M parameters for Versions 1 to 10:
  // [totalCodewords, ecCodewordsPerBlock, numBlocksGroup1, dataCodewordsGroup1, numBlocksGroup2, dataCodewordsGroup2]
  const VERSION_PARAMS = [
    null,
    [26, 10, 1, 16, 0, 0],    // V1 (21x21)
    [44, 16, 1, 28, 0, 0],    // V2 (25x25)
    [70, 26, 1, 44, 0, 0],    // V3 (29x29)
    [100, 18, 2, 32, 0, 0],   // V4 (33x33)
    [134, 24, 2, 43, 0, 0],   // V5 (37x37)
    [172, 16, 4, 27, 0, 0],   // V6 (41x41)
    [196, 18, 4, 31, 0, 0],   // V7 (45x45)
    [242, 22, 2, 38, 2, 39],  // V8 (49x49)
    [292, 22, 3, 36, 2, 37],  // V9 (53x53)
    [346, 26, 4, 43, 1, 44]   // V10 (57x57)
  ];

  // Alignment pattern center coordinates per version
  const ALIGNMENT_POS = [
    [],
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50]
  ];

  // Precomputed GF(256) exp and log tables for Reed-Solomon
  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) {
      GF_EXP[i] = GF_EXP[i - 255];
    }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function rsGeneratorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const factor = GF_EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly;
  }

  function rsComputeEC(data, ecCount) {
    const gen = rsGeneratorPoly(ecCount);
    const rem = new Array(ecCount).fill(0);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ rem[0];
      rem.shift();
      rem.push(0);
      if (factor !== 0) {
        for (let j = 0; j < ecCount; j++) {
          rem[j] ^= gfMul(gen[j + 1], factor);
        }
      }
    }
    return rem;
  }

  function encodeUTF8(text) {
    if (typeof TextEncoder !== "undefined") {
      return Array.from(new TextEncoder().encode(text));
    }
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      bytes.push(text.charCodeAt(i) & 0xff);
    }
    return bytes;
  }

  function chooseVersion(byteLength) {
    for (let v = 1; v <= 10; v++) {
      const p = VERSION_PARAMS[v];
      const totalDataBytes = p[2] * p[3] + p[4] * p[5];
      const countBits = v <= 9 ? 8 : 16;
      const neededBits = 4 + countBits + byteLength * 8;
      if (Math.ceil(neededBits / 8) <= totalDataBytes) {
        return v;
      }
    }
    return 10; // Fallback max supported version
  }

  function buildCodewords(bytes, version) {
    const p = VERSION_PARAMS[version];
    const ecLen = p[1];
    const totalDataBytes = p[2] * p[3] + p[4] * p[5];
    const countBits = version <= 9 ? 8 : 16;

    // Bit buffer
    const bits = [];
    function pushBits(val, len) {
      for (let i = len - 1; i >= 0; i--) {
        bits.push((val >> i) & 1);
      }
    }

    // Mode indicator: Byte mode (0100)
    pushBits(0b0100, 4);
    const maxBytes = totalDataBytes - (version <= 9 ? 2 : 3);
    const clipped = bytes.slice(0, maxBytes);
    pushBits(clipped.length, countBits);
    for (const b of clipped) pushBits(b, 8);

    // Terminator (up to 4 zero bits)
    const maxBits = totalDataBytes * 8;
    const termLen = Math.min(4, maxBits - bits.length);
    for (let i = 0; i < termLen; i++) bits.push(0);

    // Pad to byte boundary
    while (bits.length % 8 !== 0) bits.push(0);

    // Convert bits to bytes
    const dataBytes = [];
    for (let i = 0; i < bits.length; i += 8) {
      let val = 0;
      for (let j = 0; j < 8; j++) val = (val << 1) | bits[i + j];
      dataBytes.push(val);
    }

    // Pad codewords alternating 0xEC and 0x11
    let padToggle = true;
    while (dataBytes.length < totalDataBytes) {
      dataBytes.push(padToggle ? 0xec : 0x11);
      padToggle = !padToggle;
    }

    // Split into blocks and compute Reed-Solomon EC for each
    const blocks = [];
    const ecBlocks = [];
    let offset = 0;

    for (let i = 0; i < p[2]; i++) {
      const blk = dataBytes.slice(offset, offset + p[3]);
      offset += p[3];
      blocks.push(blk);
      ecBlocks.push(rsComputeEC(blk, ecLen));
    }
    for (let i = 0; i < p[4]; i++) {
      const blk = dataBytes.slice(offset, offset + p[5]);
      offset += p[5];
      blocks.push(blk);
      ecBlocks.push(rsComputeEC(blk, ecLen));
    }

    // Interleave data codewords
    const result = [];
    const maxBlockLen = Math.max(p[3], p[5]);
    for (let i = 0; i < maxBlockLen; i++) {
      for (let b = 0; b < blocks.length; b++) {
        if (i < blocks[b].length) result.push(blocks[b][i]);
      }
    }
    // Interleave EC codewords
    for (let i = 0; i < ecLen; i++) {
      for (let b = 0; b < ecBlocks.length; b++) {
        result.push(ecBlocks[b][i]);
      }
    }
    return result;
  }

  function createMatrix(version) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Uint8Array(size));
    const isFunction = Array.from({ length: size }, () => new Uint8Array(size));

    function setFunc(r, c, dark) {
      if (r >= 0 && r < size && c >= 0 && c < size) {
        modules[r][c] = dark ? 1 : 0;
        isFunction[r][c] = 1;
      }
    }

    // Finder patterns + separators
    function drawFinder(top, left) {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = top + r, cc = left + c;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
          const dark = inOuter && (
            r === 0 || r === 6 || c === 0 || c === 6 ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4)
          );
          setFunc(rr, cc, dark);
        }
      }
    }
    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Alignment patterns
    const pos = ALIGNMENT_POS[version];
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const rCenter = pos[i], cCenter = pos[j];
        if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) {
          continue;
        }
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setFunc(rCenter + dr, cCenter + dc, dark);
          }
        }
      }
    }

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      if (!isFunction[6][i]) setFunc(6, i, i % 2 === 0);
      if (!isFunction[i][6]) setFunc(i, 6, i % 2 === 0);
    }

    // Dark module & reserve format info areas
    setFunc(size - 8, 8, true);
    for (let i = 0; i < 9; i++) {
      if (!isFunction[8][i]) setFunc(8, i, false);
      if (!isFunction[i][8]) setFunc(i, 8, false);
    }
    for (let i = size - 8; i < size; i++) {
      if (!isFunction[8][i]) setFunc(8, i, false);
      if (!isFunction[i][8]) setFunc(i, 8, false);
    }

    // Version info for Version >= 7
    if (version >= 7) {
      let rem = version;
      for (let i = 0; i < 12; i++) {
        rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      }
      const bits = (version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        setFunc(a, b, bit);
        setFunc(b, a, bit);
      }
    }

    return { size, modules, isFunction };
  }

  function placeData(matrix, codewords) {
    const { size, modules, isFunction } = matrix;
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    let upward = true;

    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // Skip vertical timing column
      for (let step = 0; step < size; step++) {
        const r = upward ? size - 1 - step : step;
        for (let dx = 0; dx < 2; dx++) {
          const c = right - dx;
          if (!isFunction[r][c]) {
            let dark = 0;
            if (bitIdx < totalBits) {
              dark = (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
              bitIdx++;
            }
            modules[r][c] = dark;
          }
        }
      }
      upward = !upward;
    }
  }

  function applyMaskAndFormat(matrix, maskPattern) {
    const { size, modules, isFunction } = matrix;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFunction[r][c]) {
          let invert = false;
          if (maskPattern === 0) invert = (r + c) % 2 === 0;
          else if (maskPattern === 1) invert = r % 2 === 0;
          else if (maskPattern === 2) invert = c % 3 === 0;
          else if (maskPattern === 3) invert = (r + c) % 3 === 0;
          if (invert) modules[r][c] ^= 1;
        }
      }
    }

    // Format info for EC Level M (00) + maskPattern (3 bits)
    const data = (0b00 << 3) | maskPattern;
    let rem = data;
    for (let i = 0; i < 10; i++) {
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    }
    const formatBits = ((data << 10) | rem) ^ 0x5412;

    // Place format bits around finders
    for (let i = 0; i <= 5; i++) modules[8][i] = (formatBits >>> (14 - i)) & 1;
    modules[8][7] = (formatBits >>> 8) & 1;
    modules[8][8] = (formatBits >>> 7) & 1;
    modules[7][8] = (formatBits >>> 6) & 1;
    for (let i = 0; i <= 5; i++) modules[5 - i][8] = (formatBits >>> (5 - i)) & 1;

    for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = (formatBits >>> i) & 1;
    for (let i = 0; i < 7; i++) modules[size - 1 - i][8] = (formatBits >>> (14 - i)) & 1;
  }

  function generateMatrix(text) {
    const bytes = encodeUTF8(text);
    const version = chooseVersion(bytes.length);
    const codewords = buildCodewords(bytes, version);
    const matrix = createMatrix(version);
    placeData(matrix, codewords);
    applyMaskAndFormat(matrix, 0);
    return matrix;
  }

  function toSVG(text, pixelSize) {
    const { size, modules } = generateMatrix(text);
    const quiet = 3;
    const total = size + quiet * 2;
    let rects = "";

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (modules[r][c]) {
          rects += `<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`;
        }
      }
    }

    const px = pixelSize || 150;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><g fill="#0f172a">${rects}</g></svg>`;
  }

  return { toSVG, generateMatrix };
})();
