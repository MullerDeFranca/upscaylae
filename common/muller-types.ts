/**
 * Tipos compartilhados das melhorias Muller (processo, main e interface).
 */

export type ModoFundo = "manter" | "cor" | "ia";
export type ModeloFundoId =
  | "isnet-general-use"
  | "birefnet-general-lite"
  | "birefnet-general"
  | "isnet-anime";
export type MotorAmpliacao = "ncnn" | "onnx";
export type LadoMedida = "largura" | "altura" | "maior";
export type ModoCores = "manter" | "auto" | "fixo";
export type EstiloVetor = "chapada" | "detalhe" | "traco";

export interface OpcoesMuller {
  fundo: {
    modo: ModoFundo;
    /** 0–100. Quanto maior, mais tons parecidos com o fundo são removidos. */
    tolerancia: number;
    /** true: só remove o fundo que encosta na borda (mantém o branco de dentro da logo). */
    somenteBorda: boolean;
    /** Com somenteBorda: deixa transparentes também os "furos" pequenos (miolo do O, A, B...). */
    furosPequenos: boolean;
    /** Cor do fundo em #rrggbb. Vazio = detectar pela borda da imagem. */
    cor: string;
    modeloIA: ModeloFundoId;
  };
  ampliar: {
    ativo: boolean;
    motor: MotorAmpliacao;
    /** Nome do modelo NCNN (ex.: arte-chapada-4x). */
    modeloNcnn: string;
    /** Nome do arquivo .onnx na pasta de modelos ONNX. */
    modeloOnnx: string;
  };
  tamanho: {
    ativo: boolean;
    medidaCm: number;
    lado: LadoMedida;
    dpi: number;
  };
  cores: {
    modo: ModoCores;
    quantidade: number;
  };
  /** Transparência só 0 ou 100% (sem meio-termo na borda). Bom para DTF. */
  bordaDura: boolean;
  /** Corta o espaço vazio em volta. */
  aparar: boolean;
  /** Margem transparente depois de aparar, em milímetros. */
  margemMm: number;
  vetor: {
    ativo: boolean;
    estilo: EstiloVetor;
  };
  saida: {
    /** Pasta de saída. Vazio = subpasta "Upscaylae" ao lado da imagem original. */
    pasta: string;
  };
  gpuId?: string;
}

export interface ResultadoMuller {
  entrada: string;
  png: string;
  svg?: string;
  larguraPx: number;
  alturaPx: number;
  larguraCm: number;
  alturaCm: number;
  dpi: number;
  cores?: string[];
  avisos: string[];
  duracaoMs: number;
}

export interface ProgressoMuller {
  entrada: string;
  etapa: string;
  /** 0–100, quando houver. */
  pct?: number;
}

export interface PresetMuller {
  id: string;
  nome: string;
  descricao: string;
  opcoes: OpcoesMuller;
}

export interface ConfigPastaVigiada {
  ativo: boolean;
  entrada: string;
  /** Vazio = usa a pasta de saída das opções. */
  saida: string;
  presetId: string;
  /** Move o original para "processadas" depois de tratar. */
  moverOriginais: boolean;
}

export interface ConfigApiLocal {
  ativo: boolean;
  porta: number;
  chave: string;
}

export interface ConfigMuller {
  opcoes: OpcoesMuller;
  presetsPersonalizados: PresetMuller[];
  pastaVigiada: ConfigPastaVigiada;
  api: ConfigApiLocal;
}

export interface ModeloFundoInfo {
  id: ModeloFundoId;
  nome: string;
  descricao: string;
  arquivo: string;
  url: string;
  tamanhoMb: number;
  baixado: boolean;
}

export interface EstadoModelos {
  pastaModelos: string;
  fundo: ModeloFundoInfo[];
  /** Arquivos .onnx de ampliação encontrados na pasta. */
  ampliacaoOnnx: string[];
  ncnn: string[];
}

export interface EstadoDownload {
  id: string;
  recebidoMb: number;
  totalMb: number;
  concluido: boolean;
  erro?: string;
}
