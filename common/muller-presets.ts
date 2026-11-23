import { OpcoesMuller, PresetMuller } from "./muller-types";

/** Modelos NCNN com uso comercial liberado (os outros do Upscayl são não-comerciais). */
export const MODELOS_NCNN_COMERCIAIS = [
  "arte-chapada-4x",
  "arte-chapada-2x",
  "arte-chapada-3x",
  "limpa-jpeg-4x",
  "digital-art-4x",
  "upscayl-standard-4x",
  "upscayl-lite-4x",
  "high-fidelity-4x",
];

export const NOMES_MODELOS_NCNN: Record<string, string> = {
  "arte-chapada-4x": "Arte chapada 4x (logos)",
  "arte-chapada-2x": "Arte chapada 2x (logos)",
  "arte-chapada-3x": "Arte chapada 3x (logos)",
  "limpa-jpeg-4x": "Limpa JPEG 4x (imagem suja/WhatsApp)",
  "digital-art-4x": "Arte digital 4x (ilustração)",
  "upscayl-standard-4x": "Padrão 4x (foto)",
  "upscayl-lite-4x": "Leve 4x (foto, rápido)",
  "high-fidelity-4x": "Alta fidelidade 4x (foto)",
  "remacri-4x": "Remacri 4x — NÃO comercial",
  "ultramix-balanced-4x": "Ultramix 4x — NÃO comercial",
  "ultrasharp-4x": "Ultrasharp 4x — NÃO comercial",
};

export const OPCOES_PADRAO: OpcoesMuller = {
  fundo: {
    modo: "cor",
    tolerancia: 18,
    somenteBorda: true,
    furosPequenos: true,
    cor: "",
    modeloIA: "isnet-general-use",
  },
  ampliar: {
    ativo: true,
    motor: "ncnn",
    modeloNcnn: "arte-chapada-4x",
    modeloOnnx: "",
  },
  tamanho: { ativo: true, medidaCm: 28, lado: "maior", dpi: 300 },
  cores: { modo: "auto", quantidade: 4 },
  bordaDura: true,
  aparar: true,
  margemMm: 0,
  vetor: { ativo: false, estilo: "chapada" },
  saida: { pasta: "" },
};

const clonar = (o: OpcoesMuller): OpcoesMuller => JSON.parse(JSON.stringify(o));

const com = (mudar: (o: OpcoesMuller) => void): OpcoesMuller => {
  const o = clonar(OPCOES_PADRAO);
  mudar(o);
  return o;
};

export const PRESETS_PADRAO: PresetMuller[] = [
  {
    id: "logo-dtf",
    nome: "Logo para DTF",
    descricao:
      "Tira o fundo liso, amplia com o modelo de arte chapada, deixa as cores limpas e a borda dura. Sai PNG no tamanho e DPI certos.",
    opcoes: clonar(OPCOES_PADRAO),
  },
  {
    id: "logo-vetor",
    nome: "Logo + vetor",
    descricao: "Igual à Logo para DTF e ainda gera um SVG pronto para o Corel.",
    opcoes: com((o) => {
      o.vetor.ativo = true;
    }),
  },
  {
    id: "recorte-ia",
    nome: "Recorte com IA",
    descricao:
      "Para fotos e fundos complicados: a IA separa o objeto do fundo. Mantém as cores originais.",
    opcoes: com((o) => {
      o.fundo.modo = "ia";
      o.ampliar.modeloNcnn = "upscayl-standard-4x";
      o.cores.modo = "manter";
      o.bordaDura = false;
    }),
  },
  {
    id: "foto-estampa",
    nome: "Foto / estampa",
    descricao:
      "Só amplia até o tamanho de impressão, sem mexer em fundo nem cores.",
    opcoes: com((o) => {
      o.fundo.modo = "manter";
      o.ampliar.modeloNcnn = "upscayl-standard-4x";
      o.tamanho.medidaCm = 30;
      o.cores.modo = "manter";
      o.bordaDura = false;
      o.aparar = false;
    }),
  },
  {
    id: "imagem-suja",
    nome: "Imagem suja (WhatsApp)",
    descricao:
      "Para logo que chegou comprimida e borrada: limpa o ruído do JPEG antes de tratar.",
    opcoes: com((o) => {
      o.ampliar.modeloNcnn = "limpa-jpeg-4x";
    }),
  },
];

/** Completa opções antigas/parciais com os valores padrão. */
export function normalizarOpcoes(parcial: any): OpcoesMuller {
  const base = clonar(OPCOES_PADRAO);
  if (!parcial || typeof parcial !== "object") return base;
  for (const chave of Object.keys(base) as (keyof OpcoesMuller)[]) {
    const v = parcial[chave];
    if (v === undefined) continue;
    if (typeof base[chave] === "object" && base[chave] !== null) {
      (base as any)[chave] = { ...(base as any)[chave], ...v };
    } else {
      (base as any)[chave] = v;
    }
  }
  if (parcial.gpuId) base.gpuId = parcial.gpuId;
  return base;
}
