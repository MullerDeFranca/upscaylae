/** Canais de comunicação entre a interface e o processo principal (melhorias Muller). */
export const MULLER = {
  OBTER_CONFIG: "muller:obter-config",
  SALVAR_CONFIG: "muller:salvar-config",
  PROCESSAR: "muller:processar",
  PARAR: "muller:parar",
  PROGRESSO: "muller:progresso",
  EVENTO: "muller:evento",
  MODELOS: "muller:modelos",
  BAIXAR_MODELO: "muller:baixar-modelo",
  DOWNLOAD: "muller:download",
  ABRIR_PASTA_MODELOS: "muller:abrir-pasta-modelos",
  ESCOLHER_PASTA: "muller:escolher-pasta",
  ESCOLHER_ARQUIVOS: "muller:escolher-arquivos",
  MOSTRAR_ARQUIVO: "muller:mostrar-arquivo",
} as const;

export interface EventoMuller {
  tipo: "pasta-vigiada" | "api" | "info" | "erro";
  mensagem: string;
  arquivo?: string;
  quando: number;
}
