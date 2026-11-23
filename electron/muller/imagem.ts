import sharp from "sharp";

/** Imagem crua em memória: RGBA 8 bits, linha a linha. */
export interface Rgba {
  data: Buffer;
  w: number;
  h: number;
}

/** Máscara de 1 canal (0–255). */
export interface Mascara {
  data: Buffer;
  w: number;
  h: number;
}

sharp.cache(false);

export async function lerRgba(caminhoOuBuffer: string | Buffer): Promise<Rgba> {
  const { data, info } = await sharp(caminhoOuBuffer, {
    limitInputPixels: false,
  })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

export function temTransparencia(img: Rgba): boolean {
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] < 255) return true;
  }
  return false;
}

export function extrairAlfa(img: Rgba): Mascara {
  const out = Buffer.alloc(img.w * img.h);
  for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = img.data[j];
  return { data: out, w: img.w, h: img.h };
}

export function aplicarAlfa(img: Rgba, m: Mascara): void {
  for (let i = 0, j = 3; i < m.data.length; i++, j += 4) img.data[j] = m.data[i];
}

/** Junta duas máscaras pegando o menor valor (o mais transparente). */
export function mascaraMinima(a: Mascara, b: Mascara): Mascara {
  const out = Buffer.alloc(a.data.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(a.data[i], b.data[i]);
  return { data: out, w: a.w, h: a.h };
}

export async function redimensionarRgba(
  img: Rgba,
  w: number,
  h: number,
): Promise<Rgba> {
  if (img.w === w && img.h === h) return img;
  const { data, info } = await sharp(img.data, {
    raw: { width: img.w, height: img.h, channels: 4 },
    limitInputPixels: false,
  })
    .resize(w, h, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

export async function redimensionarMascara(
  m: Mascara,
  w: number,
  h: number,
): Promise<Mascara> {
  if (m.w === w && m.h === h) return m;
  const { data, info } = await sharp(m.data, {
    raw: { width: m.w, height: m.h, channels: 1 },
    limitInputPixels: false,
  })
    .resize(w, h, { fit: "fill", kernel: "lanczos3" })
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

export function recortarRgba(
  img: Rgba,
  x: number,
  y: number,
  w: number,
  h: number,
): Rgba {
  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * img.w + x) * 4;
    img.data.copy(out, row * w * 4, src, src + w * 4);
  }
  return { data: out, w, h };
}

export function recortarMascara(
  m: Mascara,
  x: number,
  y: number,
  w: number,
  h: number,
): Mascara {
  const out = Buffer.alloc(w * h);
  for (let row = 0; row < h; row++) {
    const src = (y + row) * m.w + x;
    m.data.copy(out, row * w, src, src + w);
  }
  return { data: out, w, h };
}

/** Caixa que contém todos os pixels com alfa acima do limite. Null se tudo transparente. */
export function caixaVisivel(
  m: Mascara,
  limite = 8,
): { x: number; y: number; w: number; h: number } | null {
  let x0 = m.w,
    y0 = m.h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < m.h; y++) {
    const linha = y * m.w;
    for (let x = 0; x < m.w; x++) {
      if (m.data[linha + x] > limite) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Preenche a cor dos pixels transparentes com a cor dos vizinhos visíveis.
 * Evita contorno escuro/claro quando a IA amplia uma imagem que já veio sem fundo.
 */
export async function sangrarCor(img: Rgba): Promise<Rgba> {
  const n = img.w * img.h;
  const pre = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const a = img.data[i * 4 + 3];
    pre[i * 4] = (img.data[i * 4] * a) / 255;
    pre[i * 4 + 1] = (img.data[i * 4 + 1] * a) / 255;
    pre[i * 4 + 2] = (img.data[i * 4 + 2] * a) / 255;
    pre[i * 4 + 3] = a;
  }
  const sigma = Math.max(2, Math.round(Math.min(img.w, img.h) / 60));
  const borrado = await sharp(pre, {
    raw: { width: img.w, height: img.h, channels: 4 },
    limitInputPixels: false,
  })
    .blur(sigma)
    .raw()
    .toBuffer();
  const out = Buffer.from(img.data);
  for (let i = 0; i < n; i++) {
    const a = img.data[i * 4 + 3] / 255;
    if (a >= 1) continue;
    const ab = borrado[i * 4 + 3];
    for (let c = 0; c < 3; c++) {
      const preenchido =
        ab > 0 ? Math.min(255, (borrado[i * 4 + c] * 255) / ab) : 255;
      out[i * 4 + c] = Math.round(
        img.data[i * 4 + c] * a + preenchido * (1 - a),
      );
    }
    out[i * 4 + 3] = 255;
  }
  return { data: out, w: img.w, h: img.h };
}

/** Cópia com alfa 255 (a IA de ampliação trabalha só com as cores). */
export function opaco(img: Rgba): Rgba {
  const out = Buffer.from(img.data);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return { data: out, w: img.w, h: img.h };
}

export async function salvarPngTemporario(img: Rgba, caminho: string) {
  await sharp(img.data, {
    raw: { width: img.w, height: img.h, channels: 4 },
    limitInputPixels: false,
  })
    .png({ compressionLevel: 1 })
    .toFile(caminho);
}

export async function salvarPngFinal(img: Rgba, caminho: string, dpi: number) {
  await sharp(img.data, {
    raw: { width: img.w, height: img.h, channels: 4 },
    limitInputPixels: false,
  })
    .withMetadata({ density: dpi })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(caminho);
}

export function hexParaRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbParaHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")
  );
}
