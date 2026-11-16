// Minimal single-file zip ("stored", no compression): enough for Lambda inline code, with no dependency.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of bytes) c = (crcTable[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(name: string, text: string): Uint8Array {
  const enc = new TextEncoder();
  const n = enc.encode(name);
  const d = enc.encode(text);
  const crc = crc32(d);
  const local = new DataView(new ArrayBuffer(30));
  const cen = new DataView(new ArrayBuffer(46));
  const end = new DataView(new ArrayBuffer(22));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true);
  local.setUint16(6, 0x0800, true);
  local.setUint16(12, 33, true);
  local.setUint32(14, crc, true);
  local.setUint32(18, d.length, true);
  local.setUint32(22, d.length, true);
  local.setUint16(26, n.length, true);
  cen.setUint32(0, 0x02014b50, true);
  cen.setUint16(4, 0x031e, true);
  cen.setUint16(6, 20, true);
  cen.setUint16(8, 0x0800, true);
  cen.setUint16(14, 33, true);
  cen.setUint32(16, crc, true);
  cen.setUint32(20, d.length, true);
  cen.setUint32(24, d.length, true);
  cen.setUint16(28, n.length, true);
  cen.setUint32(38, (0o100644 << 16) >>> 0, true); // rw-r--r--, so Lambda can read the file
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + n.length, true);
  end.setUint32(16, 30 + n.length + d.length, true);
  const parts = [new Uint8Array(local.buffer), n, d, new Uint8Array(cen.buffer), n, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function fileToBase64(file: File): Promise<string> {
  return toBase64(new Uint8Array(await file.arrayBuffer()));
}
