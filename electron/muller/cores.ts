import sharp from "sharp";
import { Rgba, rgbParaHex } from "./imagem";

/**
 * Redução de cores para logos: descobre a paleta real (ou usa uma quantidade
 * fixa) e troca cada pixel pela cor mais próxima. Resultado: cores chapadas,
 * sem os milhares de tons parecidos que o JPEG e a ampliação criam.
 */

type Lab = [number, number, number];

function rgbParaLab(r: number, g: number, b: number): Lab {
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = lin(r),
    G = lin(g),
    B = lin(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x);
  y = f(y);
  z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function distLab(a: Lab, b: Lab) {
  const d0 = a[0] - b[0],
    d1 = a[1] - b[1],
    d2 = a[2] - b[2];
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
}

interface Grupo {
  r: number;
  g: number;
  b: number;
  n: number;
  lab: Lab;
}

/** Diferença mínima (ΔE) para duas cores contarem como cores distintas no modo automático. */
const DISTANCIA_AUTO = 18;
/** Uma cor precisa ocupar pelo menos esta fração da logo para ficar no modo automático. */
const FRACAO_MINIMA = 0.004;
const MAX_CORES = 32;

export function encontrarPaleta(
  img: Rgba,
  modo: "auto" | "fixo",
  quantidade: number,
): [number, number, number][] {
  // histograma em 5 bits por canal, só pixels visíveis
  const hist = new Map<number, Grupo>();
  let totalVisivel = 0;
  const passo = Math.max(1, Math.floor((img.w * img.h) / 400_000));
  // Só conta pixels do "miolo" das áreas de cor: os da transição entre duas
  // cores (contorno, serrilhado, halo da ampliação) criariam cores falsas.
  const interior = mapaInterior(img);
  for (let i = 0; i < img.w * img.h; i += passo) {
    if (img.data[i * 4 + 3] < 128 || !interior[i]) continue;
    const r = img.data[i * 4],
      g = img.data[i * 4 + 1],
      b = img.data[i * 4 + 2];
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let gr = hist.get(k);
    if (!gr) {
      gr = { r: 0, g: 0, b: 0, n: 0, lab: [0, 0, 0] };
      hist.set(k, gr);
    }
    gr.r += r;
    gr.g += g;
    gr.b += b;
    gr.n++;
    totalVisivel++;
  }
  if (totalVisivel === 0) return [];

  let grupos = [...hist.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 256)
    .map((g) => {
      const r = g.r / g.n,
        gg = g.g / g.n,
        b = g.b / g.n;
      return { r, g: gg, b, n: g.n, lab: rgbParaLab(r, gg, b) } as Grupo;
    });

  const juntar = (a: Grupo, b: Grupo): Grupo => {
    const n = a.n + b.n;
    const r = (a.r * a.n + b.r * b.n) / n;
    const g = (a.g * a.n + b.g * b.n) / n;
    const bb = (a.b * a.n + b.b * b.n) / n;
    return { r, g, b: bb, n, lab: rgbParaLab(r, g, bb) };
  };

  const alvo = modo === "fixo" ? Math.max(1, Math.min(MAX_CORES, quantidade)) : 1;
  // junta sempre o par mais parecido (pesando pelo tamanho)
  while (grupos.length > alvo) {
    let melhor = Infinity,
      bi = 0,
      bj = 1;
    for (let i = 0; i < grupos.length; i++) {
      for (let j = i + 1; j < grupos.length; j++) {
        const d = distLab(grupos[i].lab, grupos[j].lab);
        if (d < melhor) {
          melhor = d;
          bi = i;
          bj = j;
        }
      }
    }
    if (modo === "auto") {
      const menor = grupos.reduce((m, g) => Math.min(m, g.n), Infinity);
      const pequenos = menor / totalVisivel < FRACAO_MINIMA;
      if (melhor >= DISTANCIA_AUTO && !pequenos && grupos.length <= MAX_CORES)
        break;
      if (melhor >= DISTANCIA_AUTO && pequenos) {
        // junta a menor cor com a mais parecida dela
        const im = grupos.findIndex((g) => g.n === menor);
        let dm = Infinity,
          jm = im === 0 ? 1 : 0;
        for (let j = 0; j < grupos.length; j++) {
          if (j === im) continue;
          const d = distLab(grupos[im].lab, grupos[j].lab);
          if (d < dm) {
            dm = d;
            jm = j;
          }
        }
        bi = Math.min(im, jm);
        bj = Math.max(im, jm);
      }
    }
    const novo = juntar(grupos[bi], grupos[bj]);
    grupos.splice(bj, 1);
    grupos[bi] = novo;
  }

  // refino k-means (3 passadas) sobre uma amostra
  let centros = grupos.map((g) => [g.r, g.g, g.b]);
  for (let it = 0; it < 3; it++) {
    const soma = centros.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < img.w * img.h; i += passo * 2) {
      if (img.data[i * 4 + 3] < 128 || !interior[i]) continue;
      const r = img.data[i * 4],
        g = img.data[i * 4 + 1],
        b = img.data[i * 4 + 2];
      const k = maisProxima(centros, r, g, b);
      soma[k][0] += r;
      soma[k][1] += g;
      soma[k][2] += b;
      soma[k][3]++;
    }
    centros = centros.map((c, k) =>
      soma[k][3] ? [soma[k][0] / soma[k][3], soma[k][1] / soma[k][3], soma[k][2] / soma[k][3]] : c,
    );
  }
  return centros.map((c) => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]);
}

/** Marca pixels cuja vizinhança (raio ~0,3% do lado) tem a mesma cor. */
function mapaInterior(img: Rgba): Uint8Array {
  const n = img.w * img.h;
  const r = Math.max(2, Math.round(Math.max(img.w, img.h) / 300));
  const out = new Uint8Array(n);
  let algum = false;
  const parecido = (a: number, b: number) =>
    Math.abs(img.data[a] - img.data[b]) < 28 &&
    Math.abs(img.data[a + 1] - img.data[b + 1]) < 28 &&
    Math.abs(img.data[a + 2] - img.data[b + 2]) < 28 &&
    img.data[b + 3] >= 128;
  for (let y = r; y < img.h - r; y++) {
    for (let x = r; x < img.w - r; x++) {
      const i = y * img.w + x;
      const a = i * 4;
      if (
        parecido(a, (i - r) * 4) &&
        parecido(a, (i + r) * 4) &&
        parecido(a, (i - r * img.w) * 4) &&
        parecido(a, (i + r * img.w) * 4)
      ) {
        out[i] = 1;
        algum = true;
      }
    }
  }
  if (!algum) out.fill(1); // imagem minúscula ou só detalhe fino: usa tudo
  return out;
}

function maisProxima(centros: number[][], r: number, g: number, b: number) {
  let melhor = 0,
    dm = Infinity;
  for (let k = 0; k < centros.length; k++) {
    const dr = centros[k][0] - r,
      dg = centros[k][1] - g,
      db = centros[k][2] - b;
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < dm) {
      dm = d;
      melhor = k;
    }
  }
  return melhor;
}

/** Suaviza o ruído (mediana) e pinta cada pixel com a cor mais próxima da paleta. */
export async function aplicarPaleta(
  img: Rgba,
  paleta: [number, number, number][],
): Promise<Rgba> {
  if (paleta.length === 0) return img;
  const suave = await sharp(img.data, {
    raw: { width: img.w, height: img.h, channels: 4 },
    limitInputPixels: false,
  })
    .median(3)
    .raw()
    .toBuffer();
  const n = img.w * img.h;
  const centros = paleta.map((p) => [...p]);
  const cache = new Map<number, number>();
  const SEM = 255;
  let idx = new Uint8Array(n).fill(SEM);
  for (let i = 0; i < n; i++) {
    if (img.data[i * 4 + 3] === 0) continue;
    const r = suave[i * 4],
      g = suave[i * 4 + 1],
      b = suave[i * 4 + 2];
    const chave = (r << 16) | (g << 8) | b;
    let k = cache.get(chave);
    if (k === undefined) {
      k = maisProxima(centros, r, g, b);
      if (cache.size < 500_000) cache.set(chave, k);
    }
    idx[i] = k;
  }
  idx = limparFiapos(idx, img.w, img.h, paleta.length);
  const out = Buffer.from(img.data);
  for (let i = 0; i < n; i++) {
    const k = idx[i];
    if (k === SEM) continue;
    out[i * 4] = paleta[k][0];
    out[i * 4 + 1] = paleta[k][1];
    out[i * 4 + 2] = paleta[k][2];
  }
  return { data: out, w: img.w, h: img.h };
}

/**
 * Some com os "fiapos": linhas finas e pontinhos de outra cor que aparecem no
 * contorno entre duas cores (halo da ampliação). Toda área de cor mais fina
 * que ~0,5 mm (no tamanho final) é trocada pela cor vizinha mais próxima.
 */
function limparFiapos(
  idx: Uint8Array,
  w: number,
  h: number,
  nCores: number,
): Uint8Array {
  const n = w * h;
  const t = Math.max(1, Math.round(Math.max(w, h) / 1100));
  const SEM = 255;
  const fino = new Uint8Array(n);
  const soma = new Int32Array((w + 1) * (h + 1));
  const caixa = (x0: number, y0: number, x1: number, y1: number) => {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(w - 1, x1);
    y1 = Math.min(h - 1, y1);
    const W = w + 1;
    return (
      soma[(y1 + 1) * W + x1 + 1] -
      soma[y0 * W + x1 + 1] -
      soma[(y1 + 1) * W + x0] +
      soma[y0 * W + x0]
    );
  };
  const integral = (valor: (i: number) => number) => {
    const W = w + 1;
    for (let y = 0; y < h; y++) {
      let linha = 0;
      for (let x = 0; x < w; x++) {
        linha += valor(y * w + x);
        soma[(y + 1) * W + x + 1] = soma[y * W + x + 1] + linha;
      }
    }
  };
  const lado = 2 * t + 1;
  const cheio = lado * lado;
  const erodido = new Uint8Array(n);
  for (let k = 0; k < nCores; k++) {
    // erosão: o quadrado inteiro em volta é da cor k
    integral((i) => (idx[i] === k ? 1 : 0));
    let temCor = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (idx[i] !== k) {
          erodido[i] = 0;
          continue;
        }
        temCor = true;
        erodido[i] = caixa(x - t, y - t, x + t, y + t) === cheio ? 1 : 0;
      }
    }
    if (!temCor) continue;
    // dilatação: pixels de k que não voltam são finos demais
    integral((i) => erodido[i]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (idx[i] === k && caixa(x - t, y - t, x + t, y + t) === 0) fino[i] = 1;
      }
    }
  }
  // preenche os finos com a cor "firme" mais próxima (busca em largura)
  const out = new Uint8Array(idx);
  const fila = new Int32Array(n);
  let ini = 0,
    fim = 0;
  for (let i = 0; i < n; i++) {
    if (fino[i]) out[i] = SEM;
    else if (idx[i] !== SEM) fila[fim++] = i;
  }
  const pendente = (j: number) => fino[j] === 1 && out[j] === SEM;
  while (ini < fim) {
    const i = fila[ini++];
    const x = i % w;
    const c = out[i];
    if (x > 0 && pendente(i - 1)) { out[i - 1] = c; fila[fim++] = i - 1; }
    if (x < w - 1 && pendente(i + 1)) { out[i + 1] = c; fila[fim++] = i + 1; }
    if (i >= w && pendente(i - w)) { out[i - w] = c; fila[fim++] = i - w; }
    if (i < n - w && pendente(i + w)) { out[i + w] = c; fila[fim++] = i + w; }
  }
  // fino isolado (sem nenhuma cor firme por perto) mantém a cor original
  for (let i = 0; i < n; i++) if (out[i] === SEM && idx[i] !== SEM) out[i] = idx[i];
  return out;
}

export function paletaEmHex(paleta: [number, number, number][]) {
  return paleta.map(([r, g, b]) => rgbParaHex(r, g, b));
}
