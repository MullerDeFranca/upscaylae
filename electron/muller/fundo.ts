import fs from "fs";
import path from "path";
import sharp from "sharp";
import { ModeloFundoId, ModeloFundoInfo } from "../../common/muller-types";
import { hexParaRgb, Mascara, Rgba } from "./imagem";
import { criarSessao, ort } from "./onnx";

// ---------------------------------------------------------------------------
// Fundo por cor
// ---------------------------------------------------------------------------

/** Cor mais comum na borda da imagem (mediana por canal dos pixels opacos da borda). */
export function corDaBorda(img: Rgba): [number, number, number] {
  const rs: number[] = [],
    gs: number[] = [],
    bs: number[] = [];
  const add = (x: number, y: number) => {
    const i = (y * img.w + x) * 4;
    if (img.data[i + 3] < 128) return;
    rs.push(img.data[i]);
    gs.push(img.data[i + 1]);
    bs.push(img.data[i + 2]);
  };
  for (let x = 0; x < img.w; x++) {
    add(x, 0);
    add(x, img.h - 1);
  }
  for (let y = 0; y < img.h; y++) {
    add(0, y);
    add(img.w - 1, y);
  }
  if (rs.length === 0) return [255, 255, 255];
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

/**
 * Remove o fundo de cor lisa. Com `somenteBorda`, só some o fundo ligado à borda
 * (o branco de dentro da logo fica). A borda ganha meia-transparência suave.
 */
export function mascaraPorCor(
  img: Rgba,
  opcoes: {
    tolerancia: number;
    somenteBorda: boolean;
    furosPequenos?: boolean;
    cor: string;
  },
): { mascara: Mascara; cor: [number, number, number] } {
  const cor = hexParaRgb(opcoes.cor) ?? corDaBorda(img);
  const n = img.w * img.h;
  // distância de cor ponderada (aproxima a percepção humana)
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dr = img.data[i * 4] - cor[0];
    const dg = img.data[i * 4 + 1] - cor[1];
    const db = img.data[i * 4 + 2] - cor[2];
    const rm = (img.data[i * 4] + cor[0]) / 2;
    dist[i] = Math.sqrt(
      (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db,
    );
  }
  const maxDist = 765; // ~ distância entre preto e branco nessa escala
  const limite = Math.max(1, (opcoes.tolerancia / 100) * maxDist * 0.5);
  const suave = limite * 0.6;

  const fundo = new Uint8Array(n); // 1 = fundo
  if (opcoes.somenteBorda) {
    const fila = new Int32Array(n);
    let ini = 0,
      fim = 0;
    const semear = (i: number) => {
      if (!fundo[i] && dist[i] <= limite) {
        fundo[i] = 1;
        fila[fim++] = i;
      }
    };
    for (let x = 0; x < img.w; x++) {
      semear(x);
      semear((img.h - 1) * img.w + x);
    }
    for (let y = 0; y < img.h; y++) {
      semear(y * img.w);
      semear(y * img.w + img.w - 1);
    }
    while (ini < fim) {
      const i = fila[ini++];
      const x = i % img.w;
      if (x > 0) semear(i - 1);
      if (x < img.w - 1) semear(i + 1);
      if (i >= img.w) semear(i - img.w);
      if (i < n - img.w) semear(i + img.w);
    }
    if (opcoes.furosPequenos) marcarFurosPequenos(fundo, dist, limite, img.w, img.h);
  } else {
    for (let i = 0; i < n; i++) if (dist[i] <= limite) fundo[i] = 1;
  }

  const alfa = Buffer.alloc(n, 255);
  for (let i = 0; i < n; i++) {
    if (fundo[i]) {
      alfa[i] = 0;
      continue;
    }
    // pixel de contorno: vizinho de fundo → transparência proporcional à distância
    const x = i % img.w;
    const vizinhoFundo =
      (x > 0 && fundo[i - 1]) ||
      (x < img.w - 1 && fundo[i + 1]) ||
      (i >= img.w && fundo[i - img.w]) ||
      (i < n - img.w && fundo[i + img.w]);
    if (vizinhoFundo && dist[i] < limite + suave) {
      alfa[i] = Math.round(((dist[i] - limite) / suave) * 255);
    }
  }
  return { mascara: { data: alfa, w: img.w, h: img.h }, cor };
}

/** Área máxima de um furo (fração da imagem) para ele ser considerado miolo de letra. */
const FURO_MAXIMO = 0.012;

/**
 * Regiões da cor do fundo que ficaram presas dentro da arte. As pequenas são
 * miolos de letras (O, A, B, e...) e viram transparentes; as grandes ficam,
 * porque costumam fazer parte do desenho (ex.: o branco dentro de um círculo).
 */
function marcarFurosPequenos(
  fundo: Uint8Array,
  dist: Float32Array,
  limite: number,
  w: number,
  h: number,
) {
  const n = w * h;
  const visto = new Uint8Array(n);
  const fila = new Int32Array(n);
  const maximo = Math.max(16, n * FURO_MAXIMO);
  for (let s = 0; s < n; s++) {
    if (fundo[s] || visto[s] || dist[s] > limite) continue;
    let ini = 0,
      fim = 0;
    fila[fim++] = s;
    visto[s] = 1;
    while (ini < fim) {
      const i = fila[ini++];
      const x = i % w;
      const viz = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of viz) {
        if (j < 0 || j >= n || visto[j] || fundo[j] || dist[j] > limite) continue;
        visto[j] = 1;
        fila[fim++] = j;
      }
    }
    if (fim <= maximo) for (let k = 0; k < fim; k++) fundo[fila[k]] = 1;
  }
}

/**
 * Tira a "contaminação" da cor de fundo nos pixels semitransparentes do contorno
 * (evita aquela auréola branca em volta da logo).
 */
export function descontaminarBorda(
  img: Rgba,
  cor: [number, number, number],
): void {
  for (let i = 0; i < img.w * img.h; i++) {
    const a = img.data[i * 4 + 3];
    if (a === 0 || a === 255) continue;
    const f = a / 255;
    for (let c = 0; c < 3; c++) {
      const v = (img.data[i * 4 + c] - cor[c] * (1 - f)) / f;
      img.data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
}

/**
 * Depois das cores limpas: pedaços da cor do fundo que encostam na área
 * transparente são sobras do fundo (ruído do JPEG) e também somem.
 */
export function apagarRestosDeFundo(
  img: Rgba,
  corPaleta: [number, number, number],
): number {
  const n = img.w * img.h;
  const igual = (i: number) =>
    img.data[i * 4 + 3] >= 128 &&
    img.data[i * 4] === corPaleta[0] &&
    img.data[i * 4 + 1] === corPaleta[1] &&
    img.data[i * 4 + 2] === corPaleta[2];
  const fila = new Int32Array(n);
  let ini = 0,
    fim = 0;
  const apagar = (j: number) => {
    img.data[j * 4 + 3] = 0;
    fila[fim++] = j;
  };
  for (let i = 0; i < n; i++) {
    if (img.data[i * 4 + 3] >= 128) continue;
    const x = i % img.w;
    if (x > 0 && igual(i - 1)) apagar(i - 1);
    if (x < img.w - 1 && igual(i + 1)) apagar(i + 1);
    if (i >= img.w && igual(i - img.w)) apagar(i - img.w);
    if (i < n - img.w && igual(i + img.w)) apagar(i + img.w);
  }
  // também a borda da imagem conta como "fora"
  for (let x = 0; x < img.w; x++) {
    if (igual(x)) apagar(x);
    if (igual(n - img.w + x)) apagar(n - img.w + x);
  }
  for (let y = 0; y < img.h; y++) {
    if (igual(y * img.w)) apagar(y * img.w);
    if (igual(y * img.w + img.w - 1)) apagar(y * img.w + img.w - 1);
  }
  while (ini < fim) {
    const i = fila[ini++];
    const x = i % img.w;
    if (x > 0 && igual(i - 1)) apagar(i - 1);
    if (x < img.w - 1 && igual(i + 1)) apagar(i + 1);
    if (i >= img.w && igual(i - img.w)) apagar(i - img.w);
    if (i < n - img.w && igual(i + img.w)) apagar(i + img.w);
  }
  return fim;
}

// ---------------------------------------------------------------------------
// Fundo por IA
// ---------------------------------------------------------------------------

interface ConfigModeloFundo {
  id: ModeloFundoId;
  nome: string;
  descricao: string;
  arquivo: string;
  url: string;
  tamanhoMb: number;
  media: [number, number, number];
  desvio: [number, number, number];
  sigmoide: boolean;
}

const BASE = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/";

export const MODELOS_FUNDO: ConfigModeloFundo[] = [
  {
    id: "isnet-general-use",
    nome: "ISNet (geral)",
    descricao: "Bom equilíbrio entre qualidade e velocidade. Recomendado.",
    arquivo: "isnet-general-use.onnx",
    url: BASE + "isnet-general-use.onnx",
    tamanhoMb: 171,
    media: [0.5, 0.5, 0.5],
    desvio: [1, 1, 1],
    sigmoide: false,
  },
  {
    id: "birefnet-general-lite",
    nome: "BiRefNet Lite",
    descricao: "Recorte mais preciso em cabelo, pelos e detalhes finos.",
    arquivo: "birefnet-general-lite.onnx",
    url: BASE + "BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
    tamanhoMb: 214,
    media: [0.485, 0.456, 0.406],
    desvio: [0.229, 0.224, 0.225],
    sigmoide: true,
  },
  {
    id: "birefnet-general",
    nome: "BiRefNet (máxima qualidade)",
    descricao: "O mais preciso, porém pesado e mais lento.",
    arquivo: "birefnet-general.onnx",
    url: BASE + "BiRefNet-general-epoch_244.onnx",
    tamanhoMb: 928,
    media: [0.485, 0.456, 0.406],
    desvio: [0.229, 0.224, 0.225],
    sigmoide: true,
  },
  {
    id: "isnet-anime",
    nome: "ISNet Anime",
    descricao: "Para personagens e desenhos estilo anime/cartoon.",
    arquivo: "isnet-anime.onnx",
    url: BASE + "isnet-anime.onnx",
    tamanhoMb: 168,
    media: [0.485, 0.456, 0.406],
    desvio: [1, 1, 1],
    sigmoide: false,
  },
];

export function listarModelosFundo(pasta: string): ModeloFundoInfo[] {
  return MODELOS_FUNDO.map((m) => ({
    id: m.id,
    nome: m.nome,
    descricao: m.descricao,
    arquivo: m.arquivo,
    url: m.url,
    tamanhoMb: m.tamanhoMb,
    baixado: fs.existsSync(path.join(pasta, m.arquivo)),
  }));
}

const LADO_IA = 1024;

export async function mascaraPorIA(
  img: Rgba,
  modeloId: ModeloFundoId,
  pastaModelos: string,
): Promise<Mascara> {
  const cfg = MODELOS_FUNDO.find((m) => m.id === modeloId);
  if (!cfg) throw new Error(`Modelo de fundo desconhecido: ${modeloId}`);
  const arquivo = path.join(pastaModelos, cfg.arquivo);
  if (!fs.existsSync(arquivo)) {
    throw new Error(
      `O modelo "${cfg.nome}" ainda não foi baixado. Baixe em Logo/DTF → Modelos de IA.`,
    );
  }
  const sessao = await criarSessao(arquivo);

  const pequeno = await sharp(img.data, {
    raw: { width: img.w, height: img.h, channels: 4 },
    limitInputPixels: false,
  })
    .removeAlpha()
    .resize(LADO_IA, LADO_IA, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();

  let max = 1e-6;
  for (let i = 0; i < pequeno.length; i++) if (pequeno[i] > max) max = pequeno[i];
  const area = LADO_IA * LADO_IA;
  const entrada = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    for (let c = 0; c < 3; c++) {
      entrada[c * area + i] =
        (pequeno[i * 3 + c] / max - cfg.media[c]) / cfg.desvio[c];
    }
  }
  const nomeEntrada = sessao.inputNames[0];
  const saidas = await sessao.run({
    [nomeEntrada]: new ort.Tensor("float32", entrada, [1, 3, LADO_IA, LADO_IA]),
  });
  const pred = saidas[sessao.outputNames[0]].data as Float32Array;
  const valores = new Float32Array(area);
  let mi = Infinity,
    ma = -Infinity;
  for (let i = 0; i < area; i++) {
    let v = pred[i];
    if (cfg.sigmoide) v = 1 / (1 + Math.exp(-v));
    valores[i] = v;
    if (v < mi) mi = v;
    if (v > ma) ma = v;
  }
  const faixa = ma - mi || 1;
  const m = Buffer.alloc(area);
  for (let i = 0; i < area; i++) m[i] = Math.round(((valores[i] - mi) / faixa) * 255);

  const { data } = await sharp(m, {
    raw: { width: LADO_IA, height: LADO_IA, channels: 1 },
  })
    .resize(img.w, img.h, { fit: "fill", kernel: "lanczos3" })
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: img.w, h: img.h };
}
