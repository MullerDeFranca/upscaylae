import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import {
  OpcoesMuller,
  PresetMuller,
  ResultadoMuller,
} from "../../common/muller-types";
import { normalizarOpcoes } from "../../common/muller-presets";

/**
 * API local para a central de trabalho (ou qualquer script) usar o motor.
 * Só escuta em 127.0.0.1 (o próprio PC) e exige a chave em todo pedido,
 * para que nenhum site aberto no navegador consiga usá-la sem permissão.
 *
 *   GET  /status
 *   GET  /presets
 *   POST /processar            JSON { caminho | caminhos[], preset?, opcoes? }
 *   POST /processar-imagem     corpo = bytes da imagem; ?preset=&formato=png|svg|json
 *
 * Chave: cabeçalho "X-Chave" (ou ?chave= na URL).
 */

export interface ApiCallbacks {
  presets: () => PresetMuller[];
  opcoesAtuais: () => OpcoesMuller;
  processar: (arquivo: string, opcoes: OpcoesMuller) => Promise<ResultadoMuller>;
  status: () => Record<string, unknown>;
  avisar: (mensagem: string) => void;
}

const LIMITE_CORPO = 150 * 1024 * 1024;

export class ApiLocal {
  private servidor: http.Server | null = null;
  porta = 0;

  constructor(private cb: ApiCallbacks) {}

  get ativa() {
    return this.servidor !== null;
  }

  async iniciar(porta: number, chave: string): Promise<void> {
    await this.parar();
    if (!chave || chave.length < 8) throw new Error("A chave da API precisa ter pelo menos 8 caracteres.");
    const srv = http.createServer((req, res) => this.atender(req, res, chave));
    await new Promise<void>((resolve, reject) => {
      srv.once("error", reject);
      srv.listen(porta, "127.0.0.1", () => resolve());
    });
    this.servidor = srv;
    this.porta = porta;
    this.cb.avisar(`API local ativa em http://127.0.0.1:${porta}`);
  }

  async parar() {
    const s = this.servidor;
    this.servidor = null;
    if (s) await new Promise<void>((r) => s.close(() => r()));
  }

  private async atender(req: http.IncomingMessage, res: http.ServerResponse, chave: string) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Chave");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Largura-Cm, X-Altura-Cm, X-Largura-Px, X-Altura-Px, X-Dpi, X-Cores, X-Avisos",
    );
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const recebida = (req.headers["x-chave"] as string) || url.searchParams.get("chave") || "";
    if (recebida !== chave) return json(res, 401, { erro: "Chave inválida ou ausente (cabeçalho X-Chave)." });

    try {
      if (req.method === "GET" && url.pathname === "/status") {
        return json(res, 200, { app: "Upscaylae", ...this.cb.status() });
      }
      if (req.method === "GET" && url.pathname === "/presets") {
        return json(res, 200, this.cb.presets());
      }
      if (req.method === "POST" && url.pathname === "/processar") {
        const corpo = JSON.parse((await lerCorpo(req)).toString("utf8") || "{}");
        const caminhos: string[] = corpo.caminhos ?? (corpo.caminho ? [corpo.caminho] : []);
        if (caminhos.length === 0) return json(res, 400, { erro: "Informe 'caminho' ou 'caminhos'." });
        const opcoes = this.montarOpcoes(corpo.preset, corpo.opcoes);
        this.cb.avisar(`API: ${caminhos.length} arquivo(s)`);
        const resultados: unknown[] = [];
        for (const c of caminhos) {
          try {
            resultados.push(await this.cb.processar(c, opcoes));
          } catch (e: any) {
            resultados.push({ entrada: c, erro: e.message });
          }
        }
        return json(res, 200, { resultados });
      }
      if (req.method === "POST" && url.pathname === "/processar-imagem") {
        const bytes = await lerCorpo(req);
        if (bytes.length === 0) return json(res, 400, { erro: "Envie a imagem no corpo do pedido." });
        let extra: any;
        const extraTxt = url.searchParams.get("opcoes");
        if (extraTxt) extra = JSON.parse(extraTxt);
        const opcoes = this.montarOpcoes(url.searchParams.get("preset") ?? undefined, extra);
        const formato = url.searchParams.get("formato") ?? "png";
        if (formato === "svg") opcoes.vetor.ativo = true;
        const nome = (url.searchParams.get("nome") ?? "imagem").replace(/[^\w.\-]+/g, "_").slice(0, 80);
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "upscaylae-api-"));
        try {
          const entrada = path.join(tmp, nome.includes(".") ? nome : nome + ".png");
          fs.writeFileSync(entrada, bytes);
          opcoes.saida.pasta = path.join(tmp, "saida");
          this.cb.avisar(`API: ${nome}`);
          const r = await this.cb.processar(entrada, opcoes);
          res.setHeader("X-Largura-Cm", String(r.larguraCm));
          res.setHeader("X-Altura-Cm", String(r.alturaCm));
          res.setHeader("X-Largura-Px", String(r.larguraPx));
          res.setHeader("X-Altura-Px", String(r.alturaPx));
          res.setHeader("X-Dpi", String(r.dpi));
          if (r.cores) res.setHeader("X-Cores", r.cores.join(","));
          if (r.avisos.length) res.setHeader("X-Avisos", encodeURIComponent(r.avisos.join(" | ")));
          if (formato === "json") {
            return json(res, 200, {
              ...r,
              png: fs.readFileSync(r.png).toString("base64"),
              svg: r.svg ? fs.readFileSync(r.svg, "utf8") : undefined,
            });
          }
          const arquivo = formato === "svg" && r.svg ? r.svg : r.png;
          res.writeHead(200, {
            "Content-Type": arquivo.endsWith(".svg") ? "image/svg+xml" : "image/png",
            "Content-Disposition": `inline; filename="${path.basename(arquivo)}"`,
          });
          res.end(fs.readFileSync(arquivo));
          return;
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      }
      return json(res, 404, { erro: "Rota não encontrada." });
    } catch (e: any) {
      return json(res, 500, { erro: e.message ?? String(e) });
    }
  }

  private montarOpcoes(presetId?: string, opcoes?: Partial<OpcoesMuller>): OpcoesMuller {
    let base = this.cb.opcoesAtuais();
    if (presetId) {
      const p = this.cb.presets().find((x) => x.id === presetId);
      if (!p) throw new Error(`Preset não encontrado: ${presetId}`);
      base = p.opcoes;
    }
    const o = normalizarOpcoes(JSON.parse(JSON.stringify(base)));
    if (opcoes) {
      for (const [k, v] of Object.entries(opcoes)) {
        if (v && typeof v === "object" && !Array.isArray(v)) (o as any)[k] = { ...(o as any)[k], ...v };
        else (o as any)[k] = v;
      }
    }
    return o;
  }
}

function json(res: http.ServerResponse, codigo: number, corpo: unknown) {
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(corpo));
}

function lerCorpo(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > LIMITE_CORPO) {
        reject(new Error("Arquivo grande demais (limite 150 MB)."));
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(partes)));
    req.on("error", reject);
  });
}
