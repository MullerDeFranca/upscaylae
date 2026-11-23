import fs from "fs";
import path from "path";
import { OpcoesMuller, ResultadoMuller } from "../../common/muller-types";

const EXTENSOES = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"];

export interface VigiaCallbacks {
  processar: (arquivo: string) => Promise<ResultadoMuller>;
  avisar: (tipo: "pasta-vigiada" | "erro", mensagem: string, arquivo?: string) => void;
}

/**
 * Observa uma pasta: toda imagem nova que chega é tratada automaticamente.
 * Espera o arquivo terminar de ser copiado (tamanho estável) antes de abrir.
 */
export class PastaVigiada {
  private watcher: fs.FSWatcher | null = null;
  private vistos = new Map<string, number>();
  private aguardando = new Map<string, NodeJS.Timeout>();
  private pasta = "";
  private moverOriginais = false;

  constructor(private cb: VigiaCallbacks) {}

  get ativa() {
    return this.watcher !== null;
  }

  iniciar(pasta: string, moverOriginais: boolean) {
    this.parar();
    if (!pasta || !fs.existsSync(pasta) || !fs.statSync(pasta).isDirectory()) {
      this.cb.avisar("erro", `Pasta vigiada não encontrada: ${pasta || "(vazia)"}`);
      return false;
    }
    this.pasta = pasta;
    this.moverOriginais = moverOriginais;
    // o que já estava na pasta não é processado de novo
    for (const f of fs.readdirSync(pasta)) {
      const p = path.join(pasta, f);
      try {
        this.vistos.set(p, fs.statSync(p).mtimeMs);
      } catch {
        /* ignora */
      }
    }
    this.watcher = fs.watch(pasta, { persistent: true }, (_evento, nome) => {
      if (!nome) return;
      this.agendar(path.join(pasta, nome.toString()));
    });
    this.watcher.on("error", (e) => this.cb.avisar("erro", `Pasta vigiada: ${e.message}`));
    this.cb.avisar("pasta-vigiada", `Vigiando ${pasta}`);
    return true;
  }

  parar() {
    this.watcher?.close();
    this.watcher = null;
    for (const t of this.aguardando.values()) clearTimeout(t);
    this.aguardando.clear();
  }

  private agendar(arquivo: string) {
    if (!EXTENSOES.includes(path.extname(arquivo).toLowerCase())) return;
    const anterior = this.aguardando.get(arquivo);
    if (anterior) clearTimeout(anterior);
    this.aguardando.set(
      arquivo,
      setTimeout(() => this.quandoEstavel(arquivo, -1, 0), 800),
    );
  }

  private quandoEstavel(arquivo: string, tamanhoAnterior: number, tentativas: number) {
    this.aguardando.delete(arquivo);
    let st: fs.Stats;
    try {
      st = fs.statSync(arquivo);
    } catch {
      return; // apagado/movido
    }
    if (!st.isFile()) return;
    if (st.size !== tamanhoAnterior || st.size === 0) {
      if (tentativas > 60) return;
      this.aguardando.set(
        arquivo,
        setTimeout(() => this.quandoEstavel(arquivo, st.size, tentativas + 1), 700),
      );
      return;
    }
    if (this.vistos.get(arquivo) === st.mtimeMs) return;
    this.vistos.set(arquivo, st.mtimeMs);
    this.cb.avisar("pasta-vigiada", `Tratando ${path.basename(arquivo)}…`, arquivo);
    this.cb
      .processar(arquivo)
      .then((r) => {
        this.cb.avisar(
          "pasta-vigiada",
          `${path.basename(arquivo)} → ${path.basename(r.png)} (${r.larguraCm} × ${r.alturaCm} cm)`,
          r.png,
        );
        if (this.moverOriginais) this.moverParaProcessadas(arquivo);
      })
      .catch((e) => this.cb.avisar("erro", `${path.basename(arquivo)}: ${e.message}`, arquivo));
  }

  private moverParaProcessadas(arquivo: string) {
    try {
      const destinoPasta = path.join(this.pasta, "processadas");
      fs.mkdirSync(destinoPasta, { recursive: true });
      let destino = path.join(destinoPasta, path.basename(arquivo));
      if (fs.existsSync(destino)) {
        const p = path.parse(destino);
        destino = path.join(p.dir, `${p.name}_${Date.now()}${p.ext}`);
      }
      fs.renameSync(arquivo, destino);
    } catch (e: any) {
      this.cb.avisar("erro", `Não consegui mover o original: ${e.message}`, arquivo);
    }
  }
}

export function opcoesParaPastaVigiada(
  base: OpcoesMuller,
  saida: string,
): OpcoesMuller {
  const o: OpcoesMuller = JSON.parse(JSON.stringify(base));
  if (saida) o.saida.pasta = saida;
  return o;
}
