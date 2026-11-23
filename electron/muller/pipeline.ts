import fs from "fs";
import path from "path";
import {
  OpcoesMuller,
  ProgressoMuller,
  ResultadoMuller,
} from "../../common/muller-types";
import { normalizarOpcoes } from "../../common/muller-presets";
import { aplicarPaleta, encontrarPaleta, paletaEmHex } from "./cores";
import {
  apagarRestosDeFundo,
  corDaBorda,
  descontaminarBorda,
  mascaraPorCor,
  mascaraPorIA,
} from "./fundo";
import {
  aplicarAlfa,
  caixaVisivel,
  extrairAlfa,
  lerRgba,
  Mascara,
  mascaraMinima,
  opaco,
  recortarMascara,
  recortarRgba,
  redimensionarMascara,
  redimensionarRgba,
  Rgba,
  salvarPngFinal,
  sangrarCor,
  temTransparencia,
} from "./imagem";
import { AmbienteNcnn, ampliarNcnn, escalaNcnn } from "./ncnn";
import { ampliarOnnx, escalaDoModelo } from "./onnx";
import { vetorizar } from "./vetor";

export interface AmbienteMuller extends AmbienteNcnn {
  /** Pasta onde ficam os modelos ONNX (fundo e ampliação). */
  pastaModelosOnnx: string;
  log?: (...args: any[]) => void;
}

const CM_POR_POLEGADA = 2.54;
/** No máximo 3 passadas de IA (até 64x com modelo 4x). */
const MAX_PASSADAS = 3;

export function pastaDeSaida(entrada: string, opcoes: OpcoesMuller) {
  return opcoes.saida.pasta?.trim()
    ? opcoes.saida.pasta.trim()
    : path.join(path.dirname(entrada), "Upscaylae");
}

const fmtCm = (v: number) =>
  (Math.round(v * 10) / 10).toString().replace(".", ",");

/**
 * Processa uma imagem do começo ao fim:
 * fundo → recorte → ampliação → medida exata → cores → borda → PNG (+ SVG).
 */
export async function processarImagem(
  entrada: string,
  opcoesParciais: Partial<OpcoesMuller> | OpcoesMuller,
  amb: AmbienteMuller,
  aoProgredir?: (p: ProgressoMuller) => void,
): Promise<ResultadoMuller> {
  const inicio = Date.now();
  const o = normalizarOpcoes(opcoesParciais);
  const log = amb.log ?? (() => {});
  const avisos: string[] = [];
  const etapa = (nome: string, pct?: number) =>
    aoProgredir?.({ entrada, etapa: nome, pct });

  if (!fs.existsSync(entrada)) throw new Error(`Arquivo não encontrado: ${entrada}`);

  // 1. Leitura ---------------------------------------------------------------
  etapa("Lendo a imagem");
  let img = await lerRgba(entrada);
  const tinhaAlfa = temTransparencia(img);
  let mascara: Mascara | null = tinhaAlfa ? extrairAlfa(img) : null;
  let corFundo: [number, number, number] | null = null;

  // 2. Fundo (primeira passada, na resolução original) -----------------------
  if (o.fundo.modo === "cor") {
    etapa("Removendo o fundo (cor)");
    const r = mascaraPorCor(img, o.fundo);
    corFundo = r.cor;
    mascara = mascara ? mascaraMinima(mascara, r.mascara) : r.mascara;
  } else if (o.fundo.modo === "ia") {
    etapa("Removendo o fundo (IA)");
    const m = await mascaraPorIA(img, o.fundo.modeloIA, amb.pastaModelosOnnx);
    mascara = mascara ? mascaraMinima(mascara, m) : m;
  }

  // 3. Recorte do espaço vazio ----------------------------------------------
  if (o.aparar && mascara) {
    const caixa = caixaVisivel(mascara);
    if (!caixa) throw new Error("A imagem ficou totalmente transparente. Diminua a tolerância do fundo.");
    if (caixa.w < img.w || caixa.h < img.h) {
      img = recortarRgba(img, caixa.x, caixa.y, caixa.w, caixa.h);
      mascara = recortarMascara(mascara, caixa.x, caixa.y, caixa.w, caixa.h);
    }
  }

  // 4. Tamanho alvo ----------------------------------------------------------
  const ladoAtual = (w: number, h: number) =>
    o.tamanho.lado === "largura" ? w : o.tamanho.lado === "altura" ? h : Math.max(w, h);
  let alvoPx: number | null = null;
  if (o.tamanho.ativo && o.tamanho.medidaCm > 0 && o.tamanho.dpi > 0) {
    alvoPx = Math.round((o.tamanho.medidaCm / CM_POR_POLEGADA) * o.tamanho.dpi);
  }
  const fatorAlvo = alvoPx ? alvoPx / ladoAtual(img.w, img.h) : null;

  // 5. Ampliação com IA -------------------------------------------------------
  // A IA trabalha só nas cores. Se a imagem já veio transparente, "sangra" as
  // cores para baixo da transparência para não criar contorno.
  let cores: Rgba = tinhaAlfa ? await sangrarCor(img) : opaco(img);
  const querAmpliar =
    o.ampliar.ativo && (fatorAlvo === null || fatorAlvo > 1.05);
  if (querAmpliar) {
    let escala: number;
    let arquivoOnnx = "";
    if (o.ampliar.motor === "onnx") {
      if (!o.ampliar.modeloOnnx) throw new Error("Escolha um modelo ONNX de ampliação.");
      arquivoOnnx = path.isAbsolute(o.ampliar.modeloOnnx)
        ? o.ampliar.modeloOnnx
        : path.join(amb.pastaModelosOnnx, "ampliacao", o.ampliar.modeloOnnx);
      if (!fs.existsSync(arquivoOnnx)) throw new Error(`Modelo ONNX não encontrado: ${arquivoOnnx}`);
      escala = await escalaDoModelo(arquivoOnnx);
    } else {
      // Arte chapada tem versões 2x e 3x: se falta pouco, usa a menor (mais
      // rápida e sem gastar memória ampliando demais para depois reduzir).
      if (fatorAlvo !== null && /^arte-chapada-\dx$/.test(o.ampliar.modeloNcnn)) {
        o.ampliar.modeloNcnn =
          fatorAlvo <= 2 ? "arte-chapada-2x" : fatorAlvo <= 3 ? "arte-chapada-3x" : "arte-chapada-4x";
      }
      escala = escalaNcnn(o.ampliar.modeloNcnn);
    }
    const passadas =
      fatorAlvo === null
        ? 1
        : Math.min(MAX_PASSADAS, Math.max(1, Math.ceil(Math.log(fatorAlvo) / Math.log(escala) - 0.05)));
    if (fatorAlvo !== null && Math.pow(escala, passadas) < fatorAlvo * 0.95) {
      avisos.push(
        `A imagem é muito pequena para ${o.tamanho.medidaCm} cm: a IA ampliou ${Math.pow(escala, passadas)}x e o resto foi ampliação simples.`,
      );
    }
    for (let p = 0; p < passadas; p++) {
      const rotulo = `Ampliando com IA${passadas > 1 ? ` (${p + 1}/${passadas})` : ""}`;
      etapa(rotulo, 0);
      if (o.ampliar.motor === "onnx") {
        cores = await ampliarOnnx(cores, arquivoOnnx, (pct) => etapa(rotulo, pct));
      } else {
        cores = await ampliarNcnn(cores, o.ampliar.modeloNcnn, amb, (pct) => etapa(rotulo, pct));
      }
    }
  } else if (o.ampliar.ativo && fatorAlvo !== null && fatorAlvo <= 1.05) {
    log("ℹ️ Imagem já está no tamanho; ampliação com IA pulada.");
  }

  // 6. Tamanho aproximado do alvo (ajuste fino vem depois do recorte final) -
  let W = cores.w,
    H = cores.h;
  if (fatorAlvo !== null) {
    W = Math.max(1, Math.round(img.w * fatorAlvo));
    H = Math.max(1, Math.round(img.h * fatorAlvo));
    if (cores.w !== W || cores.h !== H) {
      etapa("Ajustando ao tamanho");
      cores = await redimensionarRgba(cores, W, H);
    }
  }

  // 7. Transparência na resolução final -------------------------------------
  let final: Rgba = cores;
  if (o.fundo.modo === "cor") {
    // refaz a remoção por cor na imagem ampliada: borda bem mais definida
    etapa("Refinando a borda");
    const r = mascaraPorCor(cores, { ...o.fundo, cor: o.fundo.cor || hex(corFundo ?? corDaBorda(cores)) });
    let m = r.mascara;
    if (tinhaAlfa) {
      const alfaOrig = await redimensionarMascara(extrairAlfa(img), W, H);
      m = mascaraMinima(m, alfaOrig);
    }
    aplicarAlfa(final, m);
    descontaminarBorda(final, r.cor);
  } else if (mascara) {
    const m = await redimensionarMascara(mascara, W, H);
    aplicarAlfa(final, m);
  }

  // 8. Recorte final + medida exata ------------------------------------------
  const algumaTransparencia = o.fundo.modo !== "manter" || tinhaAlfa;
  if (o.aparar && algumaTransparencia) {
    const caixa = caixaVisivel(extrairAlfa(final));
    if (caixa && (caixa.w < final.w || caixa.h < final.h)) {
      final = recortarRgba(final, caixa.x, caixa.y, caixa.w, caixa.h);
    }
  }
  if (alvoPx !== null) {
    const atual = ladoAtual(final.w, final.h);
    if (atual !== alvoPx) {
      const f = alvoPx / atual;
      final = await redimensionarRgba(
        final,
        Math.max(1, Math.round(final.w * f)),
        Math.max(1, Math.round(final.h * f)),
      );
    }
  }

  // 9. Cores chapadas --------------------------------------------------------
  let paletaHex: string[] | undefined;
  if (o.cores.modo !== "manter") {
    etapa("Limpando as cores");
    const paleta = encontrarPaleta(final, o.cores.modo, o.cores.quantidade);
    final = await aplicarPaleta(final, paleta);
    // sobras do fundo coladas na parte transparente
    if (o.fundo.modo === "cor" && o.fundo.somenteBorda && corFundo && paleta.length > 1) {
      const fundoRgb = corFundo;
      const d = (c: [number, number, number]) =>
        Math.hypot(c[0] - fundoRgb[0], c[1] - fundoRgb[1], c[2] - fundoRgb[2]);
      const maisPerto = paleta.reduce((a, b) => (d(b) < d(a) ? b : a));
      if (d(maisPerto) < 40) {
        const apagados = apagarRestosDeFundo(final, maisPerto);
        if (apagados > 0) log(`🧽 ${apagados} pixels de sobra do fundo removidos`);
      }
    }
    // só as cores que sobraram de fato
    const usadas = new Set<string>();
    for (let i = 0; i < final.w * final.h; i++) {
      if (final.data[i * 4 + 3] < 128) continue;
      usadas.add(`${final.data[i * 4]},${final.data[i * 4 + 1]},${final.data[i * 4 + 2]}`);
      if (usadas.size > paleta.length) break;
    }
    const paletaFinal = paleta.filter((c) => usadas.has(c.join(",")));
    paletaHex = paletaEmHex(paletaFinal);
    log("🎨 Paleta:", paletaHex.join(" "));
  }

  // 10. Borda dura -----------------------------------------------------------
  if (o.bordaDura) {
    for (let i = 3; i < final.data.length; i += 4) {
      final.data[i] = final.data[i] >= 128 ? 255 : 0;
    }
  }

  // 11. Margem ---------------------------------------------------------------
  const dpi = o.tamanho.dpi > 0 ? o.tamanho.dpi : 300;
  if (o.margemMm > 0) {
    const m = Math.round((o.margemMm / 10 / CM_POR_POLEGADA) * dpi);
    const nw = final.w + 2 * m,
      nh = final.h + 2 * m;
    const buf = Buffer.alloc(nw * nh * 4);
    for (let y = 0; y < final.h; y++) {
      final.data.copy(buf, ((y + m) * nw + m) * 4, y * final.w * 4, (y + 1) * final.w * 4);
    }
    final = { data: buf, w: nw, h: nh };
  }

  // 12. Gravação -------------------------------------------------------------
  etapa("Salvando");
  const pasta = pastaDeSaida(entrada, o);
  fs.mkdirSync(pasta, { recursive: true });
  const larguraCm = (final.w / dpi) * CM_POR_POLEGADA;
  const alturaCm = (final.h / dpi) * CM_POR_POLEGADA;
  const base = `${path.parse(entrada).name}_${fmtCm(larguraCm)}x${fmtCm(alturaCm)}cm_${dpi}dpi`;
  const png = path.join(pasta, base + ".png");
  await salvarPngFinal(final, png, dpi);

  let svg: string | undefined;
  if (o.vetor.ativo) {
    etapa("Vetorizando");
    const conteudo = vetorizar(final, o.vetor.estilo, paletaHex, {
      w: larguraCm,
      h: alturaCm,
    });
    svg = path.join(pasta, base + ".svg");
    fs.writeFileSync(svg, conteudo);
  }

  etapa("Pronto", 100);
  return {
    entrada,
    png,
    svg,
    larguraPx: final.w,
    alturaPx: final.h,
    larguraCm: Math.round(larguraCm * 100) / 100,
    alturaCm: Math.round(alturaCm * 100) / 100,
    dpi,
    cores: paletaHex,
    avisos,
    duracaoMs: Date.now() - inicio,
  };
}

function hex(c: [number, number, number]) {
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}
