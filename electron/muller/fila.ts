import {
  OpcoesMuller,
  ProgressoMuller,
  ResultadoMuller,
} from "../../common/muller-types";
import { pararNcnn } from "./ncnn";
import { AmbienteMuller, processarImagem } from "./pipeline";

/**
 * Fila única de processamento: interface, pasta vigiada e API local usam a
 * mesma placa de vídeo, então um trabalho por vez.
 */
let corrente: Promise<unknown> = Promise.resolve();
let pendentes = 0;
let cancelado = false;

export function tamanhoDaFila() {
  return pendentes;
}

export function cancelarFila() {
  cancelado = true;
  pararNcnn();
}

export function enfileirar(
  entrada: string,
  opcoes: OpcoesMuller,
  amb: AmbienteMuller,
  aoProgredir?: (p: ProgressoMuller) => void,
): Promise<ResultadoMuller> {
  pendentes++;
  if (pendentes === 1) cancelado = false;
  const tarefa = corrente.then(async () => {
    try {
      if (cancelado) throw new Error("Cancelado");
      return await processarImagem(entrada, opcoes, amb, aoProgredir);
    } finally {
      pendentes--;
      if (pendentes === 0) cancelado = false;
    }
  });
  corrente = tarefa.catch(() => undefined);
  return tarefa;
}
