import fs from "fs";
import https from "https";
import path from "path";
import { EstadoDownload, EstadoModelos } from "../../common/muller-types";
import { listarModelosFundo, MODELOS_FUNDO } from "./fundo";
import { listarModelosNcnn } from "./ncnn";

export function pastaAmpliacaoOnnx(pastaModelos: string) {
  return path.join(pastaModelos, "ampliacao");
}

export function estadoModelos(
  pastaModelos: string,
  modelsPath: string,
  customModelsPath?: string,
): EstadoModelos {
  fs.mkdirSync(pastaAmpliacaoOnnx(pastaModelos), { recursive: true });
  const ampliacaoOnnx = fs
    .readdirSync(pastaAmpliacaoOnnx(pastaModelos))
    .filter((f) => f.toLowerCase().endsWith(".onnx"));
  const ncnn = [
    ...listarModelosNcnn(modelsPath),
    ...(customModelsPath ? listarModelosNcnn(customModelsPath) : []),
  ];
  return {
    pastaModelos,
    fundo: listarModelosFundo(pastaModelos),
    ampliacaoOnnx,
    ncnn: [...new Set(ncnn)],
  };
}

const baixando = new Set<string>();

/** Baixa um modelo de remoção de fundo (do GitHub do projeto rembg). */
export function baixarModeloFundo(
  id: string,
  pastaModelos: string,
  aoProgredir: (e: EstadoDownload) => void,
): Promise<void> {
  const cfg = MODELOS_FUNDO.find((m) => m.id === id);
  if (!cfg) return Promise.reject(new Error("Modelo desconhecido"));
  if (baixando.has(id)) return Promise.reject(new Error("Este modelo já está sendo baixado"));
  fs.mkdirSync(pastaModelos, { recursive: true });
  const destino = path.join(pastaModelos, cfg.arquivo);
  const parcial = destino + ".baixando";
  baixando.add(id);

  return new Promise<void>((resolve, reject) => {
    const falhar = (e: Error) => {
      baixando.delete(id);
      fs.rmSync(parcial, { force: true });
      aoProgredir({ id, recebidoMb: 0, totalMb: cfg.tamanhoMb, concluido: false, erro: e.message });
      reject(e);
    };
    const pedir = (url: string, saltos: number) => {
      https
        .get(url, { headers: { "User-Agent": "Upscaylae" } }, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            if (saltos > 5) return falhar(new Error("Redirecionamentos demais"));
            return pedir(new URL(res.headers.location, url).toString(), saltos + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return falhar(new Error(`Falha no download (HTTP ${res.statusCode})`));
          }
          const total = parseInt(String(res.headers["content-length"] ?? "0"), 10);
          let recebido = 0;
          let ultimoAviso = 0;
          const arq = fs.createWriteStream(parcial);
          res.on("data", (chunk: Buffer) => {
            recebido += chunk.length;
            const agora = Date.now();
            if (agora - ultimoAviso > 300) {
              ultimoAviso = agora;
              aoProgredir({
                id,
                recebidoMb: recebido / 1048576,
                totalMb: (total || cfg.tamanhoMb * 1048576) / 1048576,
                concluido: false,
              });
            }
          });
          res.pipe(arq);
          arq.on("finish", () => {
            arq.close();
            if (total && recebido !== total) {
              return falhar(new Error("Download incompleto. Tente de novo."));
            }
            fs.renameSync(parcial, destino);
            baixando.delete(id);
            aoProgredir({ id, recebidoMb: recebido / 1048576, totalMb: recebido / 1048576, concluido: true });
            resolve();
          });
          res.on("error", falhar);
          arq.on("error", falhar);
        })
        .on("error", falhar);
    };
    pedir(cfg.url, 0);
  });
}
