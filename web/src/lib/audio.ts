/** Audio plumbing for the EVP station: decode, peaks, spectrogram. */

export async function loadAudioBuffer(url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not read audio (${res.status})`);
  const data = await res.arrayBuffer();
  const Ctor: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  try {
    return await ctx.decodeAudioData(data);
  } finally {
    void ctx.close();
  }
}

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
}

export function computePeaks(channel: Float32Array, columns: number): Peaks {
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  const step = channel.length / columns;
  for (let c = 0; c < columns; c++) {
    const start = Math.floor(c * step);
    const end = Math.min(channel.length, Math.max(start + 1, Math.floor((c + 1) * step)));
    let lo = 1;
    let hi = -1;
    for (let i = start; i < end; i++) {
      const v = channel[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi < lo) {
      lo = 0;
      hi = 0;
    }
    min[c] = lo;
    max[c] = hi;
  }
  return { min, max };
}

/* In-place radix-2 FFT. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        const ur = re[a];
        const ui = im[a];
        re[a] = ur + vr;
        im[a] = ui + vi;
        re[b] = ur - vr;
        im[b] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const COLORMAP: [number, number[]][] = [
  [0, [7, 8, 11]],
  [0.22, [18, 39, 58]],
  [0.45, [32, 96, 118]],
  [0.68, [58, 158, 138]],
  [0.85, [255, 178, 62]],
  [1, [255, 244, 214]],
];

function colorFor(v: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, v));
  for (let i = 1; i < COLORMAP.length; i++) {
    const [p1, c1] = COLORMAP[i];
    if (t <= p1) {
      const [p0, c0] = COLORMAP[i - 1];
      const f = (t - p0) / (p1 - p0 || 1);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return [255, 244, 214];
}

/**
 * Render a spectrogram into an offscreen canvas sized (columns × bins).
 * Frequency runs bottom (0 Hz) to top (Nyquist). Values are dB-scaled.
 */
export function spectrogramImage(buffer: AudioBuffer, maxColumns = 1200): HTMLCanvasElement | null {
  const fftSize = 512;
  const bins = fftSize / 2;
  const channel = buffer.getChannelData(0);
  const n = channel.length;
  if (n < fftSize) return null;

  const hop = Math.max(64, Math.ceil((n - fftSize) / maxColumns));
  const columns = Math.max(1, Math.min(maxColumns, Math.floor((n - fftSize) / hop) + 1));

  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = bins;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(columns, bins);
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));

  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);

  for (let c = 0; c < columns; c++) {
    const offset = c * hop;
    for (let i = 0; i < fftSize; i++) {
      const s = channel[offset + i] ?? 0;
      re[i] = s * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) {
      const mag = Math.hypot(re[b], im[b]) / bins;
      const db = 20 * Math.log10(mag + 1e-9);
      const t = (db + 92) / 72; // -92 dB floor, -20 dB ceiling
      const [r, g, bl] = colorFor(t);
      const row = bins - 1 - b;
      const idx = (row * columns + c) * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = bl;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
