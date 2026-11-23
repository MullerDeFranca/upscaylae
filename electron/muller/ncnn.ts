import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import getModelScale from "../../common/check-model-scale";
import { lerRgba, Rgba, salvarPngTemporario } from "./imagem";

export interface AmbienteNcnn {
  execPath: string;
  modelsPath: string;
  /** Pasta de modelos personalizados do Upscayl (opcional). */
  customModelsPath?: string;
  gpuId?: string;
}

const processos = new Set<ChildProcess>();

export function pararNcnn() {
  for (const p of processos) p.kill();
  processos.clear();
}

export function listarModelosNcnn(pasta: string): string[] {
  if (!pasta || !fs.existsSync(pasta)) return [];
  return fs
    .readdirSync(pasta)
    .filter((f) => f.endsWith(".param"))
    .map((f) => f.slice(0, -6))
    .filter((m) => fs.existsSync(path.join(pasta, m + ".bin")));
}

export function escalaNcnn(modelo: string) {
  return parseInt(getModelScale(modelo), 10);
}

/** Amplia uma vez com o motor do Upscayl (Real-ESRGAN via Vulkan). */
export async function ampliarNcnn(
  img: Rgba,
  modelo: string,
  amb: AmbienteNcnn,
  aoProgredir?: (pct: number) => void,
): Promise<Rgba> {
  const pastaModelo = fs.existsSync(path.join(amb.modelsPath, modelo + ".param"))
    ? amb.modelsPath
    : amb.customModelsPath;
  if (!pastaModelo || !fs.existsSync(path.join(pastaModelo, modelo + ".param"))) {
    throw new Error(`Modelo de ampliação não encontrado: ${modelo}`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "upscaylae-"));
  const entrada = path.join(tmp, "entrada.png");
  const saida = path.join(tmp, "saida.png");
  try {
    await salvarPngTemporario(img, entrada);
    const escala = String(escalaNcnn(modelo));
    const args = [
      "-i", entrada,
      "-o", saida,
      "-s", escala,
      "-m", pastaModelo,
      "-n", modelo,
      "-f", "png",
    ];
    if (amb.gpuId) args.push("-g", amb.gpuId);

    await new Promise<void>((resolve, reject) => {
      const p = spawn(amb.execPath, args, { detached: false });
      processos.add(p);
      let erro = "";
      p.stderr.on("data", (d: Buffer) => {
        const txt = d.toString();
        const m = /([\d.]+)%/.exec(txt);
        if (m) aoProgredir?.(parseFloat(m[1]));
        if (/error|failed|invalid gpu/i.test(txt)) erro += txt;
      });
      p.on("error", (e) => {
        processos.delete(p);
        reject(e);
      });
      p.on("close", (codigo) => {
        processos.delete(p);
        if (fs.existsSync(saida) && !erro) resolve();
        else
          reject(
            new Error(
              erro.trim() ||
                `O motor de ampliação parou (código ${codigo}). Tente um tile menor nas configurações.`,
            ),
          );
      });
    });
    return await lerRgba(saida);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
