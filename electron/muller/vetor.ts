import { EstiloVetor } from "../../common/muller-types";
import { Rgba } from "./imagem";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const vtracer = require("@visioncortex/vtracer");

/**
 * Converte para SVG com o VTracer. Em vez de sliders, três estilos prontos.
 * Quando a paleta é conhecida, o vetor usa exatamente essas cores.
 */
export function vetorizar(
  img: Rgba,
  estilo: EstiloVetor,
  paletaHex: string[] | undefined,
  tamanhoCm: { w: number; h: number },
): string {
  const lado = Math.max(img.w, img.h);
  // manchas menores que ~0,1% do lado somem (sujeira), mínimo 4 px
  const mancha = Math.max(4, Math.round(lado / 1000) * 4);
  let opcoes: Record<string, any>;
  if (estilo === "traco") {
    opcoes = {
      preset: "bw",
      clustering: "bw",
      mode: "spline",
      filterSpeckle: mancha,
      cornerThreshold: 60,
      simplify: 1.5,
      optimize: 1,
    };
  } else {
    const detalhe = estilo === "detalhe";
    opcoes = {
      preset: "poster",
      clustering: "color-cluster",
      hierarchical: "stacked",
      mode: "spline",
      filterSpeckle: detalhe ? Math.max(2, mancha >> 1) : mancha,
      cornerThreshold: detalhe ? 45 : 60,
      lengthThreshold: 4,
      spliceThreshold: 45,
      simplify: detalhe ? 0.8 : 1.6,
      optimize: 1,
    };
    if (paletaHex && paletaHex.length > 0) opcoes.palette = paletaHex;
  }
  const svg: string = vtracer.convertPixels(
    new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.length),
    img.w,
    img.h,
    opcoes,
  );
  return ajustarTamanhoSvg(svg, img.w, img.h, tamanhoCm);
}

/** Grava o tamanho físico (cm) no SVG para o Corel/Illustrator abrirem na medida certa. */
function ajustarTamanhoSvg(
  svg: string,
  w: number,
  h: number,
  cm: { w: number; h: number },
) {
  const fmt = (v: number) => (Math.round(v * 1000) / 1000).toString();
  return svg.replace(/<svg\b([^>]*)>/, (_tudo, attrs: string) => {
    let a = attrs
      .replace(/\swidth="[^"]*"/, "")
      .replace(/\sheight="[^"]*"/, "");
    if (!/viewBox=/.test(a)) a += ` viewBox="0 0 ${w} ${h}"`;
    return `<svg${a} width="${fmt(cm.w)}cm" height="${fmt(cm.h)}cm">`;
  });
}
