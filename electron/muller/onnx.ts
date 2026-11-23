import * as ort from "onnxruntime-node";
import { Rgba } from "./imagem";

export { ort };

type Log = (...args: any[]) => void;
let log: Log = () => {};
export function definirLogOnnx(fn: Log) {
  log = fn;
}

const sessoes = new Map<string, Promise<ort.InferenceSession>>();
const provedorUsado = new Map<string, string>();

/**
 * Abre o modelo uma vez e reaproveita. No Windows tenta a placa de vídeo via
 * DirectML (funciona em AMD, NVIDIA e Intel); se falhar, usa o processador.
 */
export function criarSessao(arquivo: string): Promise<ort.InferenceSession> {
  let s = sessoes.get(arquivo);
  if (!s) {
    s = abrir(arquivo);
    sessoes.set(arquivo, s);
    s.catch(() => sessoes.delete(arquivo));
  }
  return s;
}

async function abrir(arquivo: string): Promise<ort.InferenceSession> {
  const base: ort.InferenceSession.SessionOptions = {
    graphOptimizationLevel: "all",
  };
  if (process.platform === "win32") {
    try {
      const s = await ort.InferenceSession.create(arquivo, {
        ...base,
        executionProviders: ["dml"],
        // DirectML não suporta estes dois recursos
        enableMemPattern: false,
        executionMode: "sequential",
      });
      provedorUsado.set(arquivo, "GPU (DirectML)");
      log("🧠 ONNX na GPU (DirectML):", arquivo);
      return s;
    } catch (e) {
      log("⚠️ DirectML indisponível, usando CPU:", String(e));
    }
  }
  const s = await ort.InferenceSession.create(arquivo, {
    ...base,
    executionProviders: ["cpu"],
  });
  provedorUsado.set(arquivo, "CPU");
  log("🧠 ONNX na CPU:", arquivo);
  return s;
}

export function provedorDoModelo(arquivo: string) {
  return provedorUsado.get(arquivo);
}

export function liberarSessoes() {
  for (const p of sessoes.values()) p.then((s) => s.release()).catch(() => {});
  sessoes.clear();
}

// ---------------------------------------------------------------------------
// float16 <-> float32 (alguns modelos ONNX de ampliação são fp16)
// ---------------------------------------------------------------------------
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function paraHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sinal = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sinal;
    mant = (mant | 0x800000) >> (1 - exp);
    return sinal | ((mant + 0x1000) >> 13);
  }
  if (exp >= 31) return sinal | 0x7c00;
  return sinal | (exp << 10) | ((mant + 0x1000) >> 13);
}
function deHalf(h: number): number {
  const sinal = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sinal * Math.pow(2, -14) * (mant / 1024);
  if (exp === 31) return mant ? NaN : sinal * Infinity;
  return sinal * Math.pow(2, exp - 15) * (1 + mant / 1024);
}

// ---------------------------------------------------------------------------
// Ampliação com modelo ONNX, em blocos (para não estourar a memória da GPU)
// ---------------------------------------------------------------------------

interface InfoEntrada {
  nome: string;
  fp16: boolean;
  /** Tamanho fixo exigido pelo modelo (ou null se aceita qualquer tamanho). */
  ladoFixo: number | null;
}

function infoEntrada(sessao: ort.InferenceSession): InfoEntrada {
  const nome = sessao.inputNames[0];
  let fp16 = false;
  let ladoFixo: number | null = null;
  const meta: any = (sessao as any).inputMetadata?.[0];
  if (meta) {
    if (meta.type === "float16") fp16 = true;
    const shape: any[] = meta.shape ?? [];
    const h = shape[2],
      w = shape[3];
    if (typeof h === "number" && typeof w === "number" && h > 0 && h === w) {
      ladoFixo = h;
    }
  }
  return { nome, fp16, ladoFixo };
}

async function rodarBloco(
  sessao: ort.InferenceSession,
  info: InfoEntrada,
  rgb: Float32Array,
  w: number,
  h: number,
): Promise<{ data: Float32Array; w: number; h: number }> {
  const tensor = info.fp16
    ? new ort.Tensor(
        "float16",
        Uint16Array.from(rgb, (v) => paraHalf(v)),
        [1, 3, h, w],
      )
    : new ort.Tensor("float32", rgb, [1, 3, h, w]);
  const saidas = await sessao.run({ [info.nome]: tensor });
  const t = saidas[sessao.outputNames[0]];
  const [, , oh, ow] = t.dims as number[];
  let data: Float32Array;
  if (t.type === "float16") {
    const raw = t.data as Uint16Array;
    data = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = deHalf(raw[i]);
  } else {
    data = t.data as Float32Array;
  }
  return { data, w: ow, h: oh };
}

/** Descobre quantas vezes o modelo amplia (2x, 4x...) rodando um bloco pequeno. */
export async function escalaDoModelo(arquivo: string): Promise<number> {
  const sessao = await criarSessao(arquivo);
  const info = infoEntrada(sessao);
  const lado = info.ladoFixo ?? 32;
  const r = await rodarBloco(
    sessao,
    info,
    new Float32Array(3 * lado * lado).fill(0.5),
    lado,
    lado,
  );
  return Math.round(r.w / lado);
}

export async function ampliarOnnx(
  img: Rgba,
  arquivo: string,
  aoProgredir?: (pct: number) => void,
): Promise<Rgba> {
  const sessao = await criarSessao(arquivo);
  const info = infoEntrada(sessao);
  const bloco = info.ladoFixo ?? 256;
  const sobra = info.ladoFixo ? Math.min(16, Math.floor(bloco / 8)) : 16;
  const util = bloco - 2 * sobra;
  const escala = await escalaDoModelo(arquivo);
  const W = img.w * escala,
    H = img.h * escala;
  const out = Buffer.alloc(W * H * 4);
  const total = Math.ceil(img.w / util) * Math.ceil(img.h / util);
  let feitos = 0;

  for (let ty = 0; ty < img.h; ty += util) {
    for (let tx = 0; tx < img.w; tx += util) {
      // região útil deste bloco
      const uw = Math.min(util, img.w - tx);
      const uh = Math.min(util, img.h - ty);
      // região com sobra (contexto) em volta
      const x0 = Math.max(0, tx - sobra);
      const y0 = Math.max(0, ty - sobra);
      const x1 = Math.min(img.w, tx + uw + sobra);
      const y1 = Math.min(img.h, ty + uh + sobra);
      // tamanho enviado ao modelo (fixo, se o modelo exigir)
      const bw = info.ladoFixo ?? x1 - x0;
      const bh = info.ladoFixo ?? y1 - y0;
      const area = bw * bh;
      const rgb = new Float32Array(3 * area);
      for (let y = 0; y < bh; y++) {
        const sy = Math.min(y0 + y, img.h - 1);
        for (let x = 0; x < bw; x++) {
          const sx = Math.min(x0 + x, img.w - 1);
          const si = (sy * img.w + sx) * 4;
          const di = y * bw + x;
          rgb[di] = img.data[si] / 255;
          rgb[area + di] = img.data[si + 1] / 255;
          rgb[2 * area + di] = img.data[si + 2] / 255;
        }
      }
      const r = await rodarBloco(sessao, info, rgb, bw, bh);
      const oarea = r.w * r.h;
      // copia só a parte útil
      const ox = (tx - x0) * escala,
        oy = (ty - y0) * escala;
      for (let y = 0; y < uh * escala; y++) {
        for (let x = 0; x < uw * escala; x++) {
          const si = (oy + y) * r.w + ox + x;
          const di = ((ty * escala + y) * W + tx * escala + x) * 4;
          out[di] = clamp(r.data[si]);
          out[di + 1] = clamp(r.data[oarea + si]);
          out[di + 2] = clamp(r.data[2 * oarea + si]);
          out[di + 3] = 255;
        }
      }
      feitos++;
      aoProgredir?.((feitos / total) * 100);
    }
  }
  return { data: out, w: W, h: H };
}

function clamp(v: number) {
  return v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
}
