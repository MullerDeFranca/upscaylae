"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import { MULLER, EventoMuller } from "@common/muller-commands";
import {
  MODELOS_NCNN_COMERCIAIS,
  NOMES_MODELOS_NCNN,
} from "@common/muller-presets";
import {
  ConfigMuller,
  EstadoDownload,
  EstadoModelos,
  OpcoesMuller,
  PresetMuller,
  ProgressoMuller,
  ResultadoMuller,
} from "@common/muller-types";
import { progressAtom } from "@/atoms/user-settings-atom";
import { useToast } from "@/components/ui/use-toast";
import { invocar, useOuvirMuller } from "./use-muller";

type Props = {
  imagePath: string;
  selectImageHandler: () => Promise<void>;
  setUpscaledImagePath: React.Dispatch<React.SetStateAction<string>>;
};

type Falha = { entrada: string; erro: string };

const nomeArquivo = (p: string) => p.split(/[\\/]/).pop() ?? p;
const DPIS = [150, 200, 300, 600];

// ---------------------------------------------------------------------------
// Peças de interface reutilizadas
// ---------------------------------------------------------------------------
function Secao({
  titulo,
  children,
  aberta = true,
  extra,
}: {
  titulo: string;
  children: React.ReactNode;
  aberta?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <details open={aberta} className="group rounded-btn bg-base-200/60 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
        <span>{titulo}</span>
        <span className="flex items-center gap-2 text-xs font-normal text-base-content/60">
          {extra}
          <span className="transition-transform group-open:rotate-90">›</span>
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </details>
  );
}

function Liga({
  rotulo,
  dica,
  valor,
  mudar,
}: {
  rotulo: string;
  dica?: string;
  valor: boolean;
  mudar: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-sm">{rotulo}</span>
        {dica && <span className="text-xs text-base-content/60">{dica}</span>}
      </span>
      <input
        type="checkbox"
        className="toggle toggle-success toggle-sm mt-0.5"
        checked={valor}
        onChange={(e) => mudar(e.target.checked)}
      />
    </label>
  );
}

function Escolha<T extends string>({
  valor,
  opcoes,
  mudar,
}: {
  valor: T;
  opcoes: { v: T; rotulo: string; dica?: string }[];
  mudar: (v: T) => void;
}) {
  return (
    <div className="join w-full">
      {opcoes.map((o) => (
        <button
          key={o.v}
          title={o.dica}
          className={`btn join-item btn-sm flex-1 ${valor === o.v ? "btn-primary" : ""}`}
          onClick={() => mudar(o.v)}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function MullerTab({
  imagePath,
  selectImageHandler,
  setUpscaledImagePath,
}: Props) {
  const { toast } = useToast();
  const setProgress = useSetAtom(progressAtom);

  const [config, setConfig] = useState<ConfigMuller | null>(null);
  const [presetsPadrao, setPresetsPadrao] = useState<PresetMuller[]>([]);
  const [servicos, setServicos] = useState({ pastaVigiada: false, api: false });
  const [modelos, setModelos] = useState<EstadoModelos | null>(null);
  const [downloads, setDownloads] = useState<Record<string, EstadoDownload>>({});
  const [arquivos, setArquivos] = useState<string[]>([]);
  const [processando, setProcessando] = useState(false);
  const [resultados, setResultados] = useState<(ResultadoMuller | Falha)[]>([]);
  const [eventos, setEventos] = useState<EventoMuller[]>([]);
  const [presetAtivo, setPresetAtivo] = useState<string>("");
  const [nomeNovoPreset, setNomeNovoPreset] = useState("");
  const [arquivoAtual, setArquivoAtual] = useState(0);
  const salvarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // carregar ------------------------------------------------------------------
  const carregarModelos = useCallback(async () => {
    setModelos(await invocar<EstadoModelos>(MULLER.MODELOS));
  }, []);

  useEffect(() => {
    invocar(MULLER.OBTER_CONFIG).then((r) => {
      setConfig(r.config);
      setPresetsPadrao(r.presetsPadrao);
      setServicos(r.servicos);
    });
    carregarModelos();
  }, [carregarModelos]);

  // a imagem escolhida no Upscayl normal também entra aqui
  useEffect(() => {
    if (imagePath && arquivos.length === 0) setArquivos([imagePath]);
  }, [imagePath]);

  // eventos do processo principal ---------------------------------------------
  useOuvirMuller("progresso", (p: ProgressoMuller) => {
    if (!processando) return;
    const prefixo = arquivos.length > 1 ? `[${arquivoAtual + 1}/${arquivos.length}] ` : "";
    setProgress(`${prefixo}${p.etapa}${p.pct !== undefined && p.pct < 100 ? ` ${p.pct.toFixed(0)}%` : ""}`);
  });
  useOuvirMuller("evento", (e: EventoMuller) =>
    setEventos((prev) => [e, ...prev].slice(0, 30)),
  );
  useOuvirMuller("download", (d: EstadoDownload) => {
    setDownloads((prev) => ({ ...prev, [d.id]: d }));
    if (d.concluido) carregarModelos();
  });

  // salvar ---------------------------------------------------------------------
  const salvar = useCallback((novo: ConfigMuller, imediato = false) => {
    setConfig(novo);
    if (salvarTimer.current) clearTimeout(salvarTimer.current);
    const enviar = () =>
      invocar(MULLER.SALVAR_CONFIG, novo).then((r) => setServicos(r.servicos));
    if (imediato) enviar();
    else salvarTimer.current = setTimeout(enviar, 500);
  }, []);

  const mudarOpcoes = (fn: (o: OpcoesMuller) => void) => {
    if (!config) return;
    const o: OpcoesMuller = JSON.parse(JSON.stringify(config.opcoes));
    fn(o);
    setPresetAtivo("");
    salvar({ ...config, opcoes: o });
  };

  const todosPresets = useMemo(
    () => [...presetsPadrao, ...(config?.presetsPersonalizados ?? [])],
    [presetsPadrao, config],
  );

  const aplicarPreset = (p: PresetMuller) => {
    if (!config) return;
    const o = JSON.parse(JSON.stringify(p.opcoes)) as OpcoesMuller;
    // a pasta de saída e a GPU são do usuário, não do preset
    o.saida = config.opcoes.saida;
    if (config.opcoes.gpuId) o.gpuId = config.opcoes.gpuId;
    salvar({ ...config, opcoes: o });
    setPresetAtivo(p.id);
  };

  const salvarComoPreset = () => {
    if (!config || !nomeNovoPreset.trim()) return;
    const id = "meu-" + Date.now();
    const p: PresetMuller = {
      id,
      nome: nomeNovoPreset.trim(),
      descricao: "Preset seu",
      opcoes: JSON.parse(JSON.stringify(config.opcoes)),
    };
    salvar({ ...config, presetsPersonalizados: [...config.presetsPersonalizados, p] }, true);
    setNomeNovoPreset("");
    setPresetAtivo(id);
  };

  const apagarPreset = (id: string) => {
    if (!config) return;
    salvar(
      { ...config, presetsPersonalizados: config.presetsPersonalizados.filter((p) => p.id !== id) },
      true,
    );
  };

  // processar ------------------------------------------------------------------
  const escolherArquivos = async () => {
    const lista: string[] = await invocar(MULLER.ESCOLHER_ARQUIVOS);
    if (lista.length) setArquivos(lista);
  };

  const processar = async () => {
    if (!config) return;
    if (arquivos.length === 0) {
      toast({ title: "Nenhuma imagem", description: "Escolha uma ou mais imagens primeiro." });
      return;
    }
    setProcessando(true);
    setUpscaledImagePath("");
    setResultados([]);
    const todos: (ResultadoMuller | Falha)[] = [];
    try {
      for (let i = 0; i < arquivos.length; i++) {
        setArquivoAtual(i);
        setProgress(`Preparando ${nomeArquivo(arquivos[i])}`);
        const [r] = await invocar<(ResultadoMuller | Falha)[]>(MULLER.PROCESSAR, {
          arquivos: [arquivos[i]],
          opcoes: config.opcoes,
        });
        todos.push(r);
        setResultados([...todos]);
        if ("erro" in r && r.erro === "Cancelado") break;
      }
    } finally {
      setProcessando(false);
      setProgress("");
    }
    const ok = todos.filter((r): r is ResultadoMuller => !("erro" in r));
    const falhas = todos.filter((r): r is Falha => "erro" in r);
    // mostra a comparação antes/depois da imagem aberta na tela
    const daTela = ok.find((r) => r.entrada === imagePath);
    if (daTela) setUpscaledImagePath(daTela.png);
    if (falhas.length) {
      toast({ title: `${falhas.length} imagem(ns) com erro`, description: falhas[0].erro });
    } else if (ok.length) {
      toast({ title: "Pronto!", description: `${ok.length} imagem(ns) tratada(s).` });
    }
  };

  // ---------------------------------------------------------------------------
  if (!config) {
    return <div className="p-4 text-sm text-base-content/60">Carregando…</div>;
  }
  const o = config.opcoes;
  const pxAlvo = Math.round((o.tamanho.medidaCm / 2.54) * o.tamanho.dpi);
  const modelosNcnn = modelos?.ncnn ?? MODELOS_NCNN_COMERCIAIS;
  const ncnnOrdenados = [
    ...MODELOS_NCNN_COMERCIAIS.filter((m) => modelosNcnn.includes(m)),
    ...modelosNcnn.filter((m) => !MODELOS_NCNN_COMERCIAIS.includes(m)),
  ];
  const modelosFundoBaixados = modelos?.fundo.filter((m) => m.baixado) ?? [];

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto overflow-x-hidden px-3 pb-4 scrollbar-thin">
      {/* ARQUIVOS ----------------------------------------------------------- */}
      <div className="flex flex-col gap-2 rounded-btn bg-base-200/60 p-3">
        <div className="flex gap-2">
          <button className="btn btn-primary btn-sm flex-1" onClick={escolherArquivos}>
            Escolher imagens
          </button>
          <button className="btn btn-sm" title="Abrir uma imagem para ver o antes/depois" onClick={selectImageHandler}>
            Abrir na tela
          </button>
        </div>
        {arquivos.length > 0 ? (
          <div className="flex items-center justify-between text-xs text-base-content/70">
            <span className="truncate">
              {arquivos.length === 1 ? nomeArquivo(arquivos[0]) : `${arquivos.length} imagens`}
            </span>
            <button className="link text-xs" onClick={() => setArquivos([])}>
              limpar
            </button>
          </div>
        ) : (
          <p className="text-xs text-base-content/60">Escolha uma ou várias imagens para tratar.</p>
        )}
      </div>

      {/* PRESETS ------------------------------------------------------------ */}
      <Secao titulo="Pronto para usar">
        <div className="flex flex-wrap gap-1">
          {todosPresets.map((p) => (
            <span key={p.id} className="flex">
              <button
                title={p.descricao}
                className={`btn btn-xs ${presetAtivo === p.id ? "btn-primary" : ""}`}
                onClick={() => aplicarPreset(p)}
              >
                {p.nome}
              </button>
              {p.id.startsWith("meu-") && (
                <button className="btn btn-ghost btn-xs px-1" title="Apagar preset" onClick={() => apagarPreset(p.id)}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        {presetAtivo && (
          <p className="text-xs text-base-content/60">
            {todosPresets.find((p) => p.id === presetAtivo)?.descricao}
          </p>
        )}
        <div className="flex gap-1">
          <input
            className="input input-xs input-bordered flex-1"
            placeholder="Nome para salvar estes ajustes"
            value={nomeNovoPreset}
            onChange={(e) => setNomeNovoPreset(e.target.value)}
          />
          <button className="btn btn-xs" disabled={!nomeNovoPreset.trim()} onClick={salvarComoPreset}>
            Salvar
          </button>
        </div>
      </Secao>

      {/* FUNDO -------------------------------------------------------------- */}
      <Secao titulo="1. Fundo">
        <Escolha
          valor={o.fundo.modo}
          mudar={(v) => mudarOpcoes((x) => (x.fundo.modo = v))}
          opcoes={[
            { v: "manter", rotulo: "Manter" },
            { v: "cor", rotulo: "Fundo liso", dica: "Tira o fundo de uma cor só (branco, preto...)" },
            { v: "ia", rotulo: "IA", dica: "Para fotos e fundos complicados" },
          ]}
        />
        {o.fundo.modo === "cor" && (
          <>
            <label className="flex flex-col gap-1">
              <span className="flex justify-between text-xs">
                <span>Quanto tirar</span>
                <span className="text-base-content/60">
                  {o.fundo.tolerancia < 12 ? "só a cor exata" : o.fundo.tolerancia < 30 ? "normal" : "tons parecidos também"}
                </span>
              </span>
              <input
                type="range"
                min={2}
                max={50}
                className="range range-primary range-xs"
                value={o.fundo.tolerancia}
                onChange={(e) => mudarOpcoes((x) => (x.fundo.tolerancia = +e.target.value))}
              />
            </label>
            <Liga
              rotulo="Manter o fundo de dentro da arte"
              dica="Ex.: o branco dentro de um círculo continua branco."
              valor={o.fundo.somenteBorda}
              mudar={(v) => mudarOpcoes((x) => (x.fundo.somenteBorda = v))}
            />
            {o.fundo.somenteBorda && (
              <Liga
                rotulo="Miolo das letras transparente"
                dica="O, A, B, e... ficam vazados."
                valor={o.fundo.furosPequenos}
                mudar={(v) => mudarOpcoes((x) => (x.fundo.furosPequenos = v))}
              />
            )}
            <div className="flex items-center gap-2 text-xs">
              <span>Cor do fundo:</span>
              <input
                type="color"
                className="h-6 w-10 cursor-pointer rounded"
                value={o.fundo.cor || "#ffffff"}
                onChange={(e) => mudarOpcoes((x) => (x.fundo.cor = e.target.value))}
              />
              <button
                className={`btn btn-xs ${!o.fundo.cor ? "btn-primary" : ""}`}
                onClick={() => mudarOpcoes((x) => (x.fundo.cor = ""))}
              >
                detectar
              </button>
            </div>
          </>
        )}
        {o.fundo.modo === "ia" && (
          <>
            {modelosFundoBaixados.length === 0 ? (
              <p className="text-xs text-warning">
                Nenhum modelo de recorte baixado ainda. Baixe um em "Modelos de IA", lá embaixo.
              </p>
            ) : (
              <select
                className="select select-bordered select-sm"
                value={o.fundo.modeloIA}
                onChange={(e) => mudarOpcoes((x) => (x.fundo.modeloIA = e.target.value as any))}
              >
                {modelosFundoBaixados.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </Secao>

      {/* AMPLIAR ------------------------------------------------------------ */}
      <Secao titulo="2. Ampliar com IA" extra={o.ampliar.ativo ? "ligado" : "desligado"}>
        <Liga rotulo="Ampliar com IA" valor={o.ampliar.ativo} mudar={(v) => mudarOpcoes((x) => (x.ampliar.ativo = v))} />
        {o.ampliar.ativo && (
          <>
            <Escolha
              valor={o.ampliar.motor}
              mudar={(v) => mudarOpcoes((x) => (x.ampliar.motor = v))}
              opcoes={[
                { v: "ncnn", rotulo: "Upscayl" },
                { v: "onnx", rotulo: "ONNX (novos)", dica: "Modelos mais novos, rodando na placa de vídeo via DirectML" },
              ]}
            />
            {o.ampliar.motor === "ncnn" ? (
              <select
                className="select select-bordered select-sm"
                value={o.ampliar.modeloNcnn}
                onChange={(e) => mudarOpcoes((x) => (x.ampliar.modeloNcnn = e.target.value))}
              >
                {ncnnOrdenados.map((m) => (
                  <option key={m} value={m}>
                    {NOMES_MODELOS_NCNN[m] ?? m}
                  </option>
                ))}
              </select>
            ) : (modelos?.ampliacaoOnnx.length ?? 0) === 0 ? (
              <div className="flex flex-col gap-1 text-xs text-base-content/70">
                <p>Nenhum modelo .onnx na pasta. Baixe modelos de ampliação (ex.: no site OpenModelDB) e coloque na pasta.</p>
                <div className="flex gap-1">
                  <button className="btn btn-xs" onClick={() => window.electron.send(MULLER.ABRIR_PASTA_MODELOS)}>
                    Abrir pasta
                  </button>
                  <button className="btn btn-xs" onClick={carregarModelos}>
                    Atualizar lista
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-1">
                <select
                  className="select select-bordered select-sm flex-1"
                  value={o.ampliar.modeloOnnx}
                  onChange={(e) => mudarOpcoes((x) => (x.ampliar.modeloOnnx = e.target.value))}
                >
                  <option value="">Escolha…</option>
                  {modelos!.ampliacaoOnnx.map((m) => (
                    <option key={m} value={m}>
                      {m.replace(/\.onnx$/i, "")}
                    </option>
                  ))}
                </select>
                <button className="btn btn-sm" title="Atualizar lista" onClick={carregarModelos}>
                  ↻
                </button>
              </div>
            )}
            {o.ampliar.motor === "ncnn" && !MODELOS_NCNN_COMERCIAIS.includes(o.ampliar.modeloNcnn) && (
              <p className="text-xs text-warning">Atenção: este modelo não permite uso comercial.</p>
            )}
          </>
        )}
      </Secao>

      {/* TAMANHO ------------------------------------------------------------ */}
      <Secao titulo="3. Tamanho de impressão" extra={o.tamanho.ativo ? `${o.tamanho.medidaCm} cm · ${o.tamanho.dpi} DPI` : "livre"}>
        <Liga
          rotulo="Definir tamanho final"
          dica="Desligado: só amplia pelo modelo (ex.: 4x)."
          valor={o.tamanho.ativo}
          mudar={(v) => mudarOpcoes((x) => (x.tamanho.ativo = v))}
        />
        {o.tamanho.ativo && (
          <>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0.5}
                step={0.5}
                className="input input-bordered input-sm w-24"
                value={o.tamanho.medidaCm}
                onChange={(e) => mudarOpcoes((x) => (x.tamanho.medidaCm = Math.max(0.1, +e.target.value || 0)))}
              />
              <span className="text-sm">cm no lado</span>
              <select
                className="select select-bordered select-sm flex-1"
                value={o.tamanho.lado}
                onChange={(e) => mudarOpcoes((x) => (x.tamanho.lado = e.target.value as any))}
              >
                <option value="maior">maior</option>
                <option value="largura">largura</option>
                <option value="altura">altura</option>
              </select>
            </div>
            <div className="flex items-center gap-1">
              <span className="mr-1 text-sm">DPI</span>
              {DPIS.map((d) => (
                <button
                  key={d}
                  className={`btn btn-xs ${o.tamanho.dpi === d ? "btn-primary" : ""}`}
                  onClick={() => mudarOpcoes((x) => (x.tamanho.dpi = d))}
                >
                  {d}
                </button>
              ))}
              <input
                type="number"
                min={72}
                max={1200}
                className="input input-bordered input-xs w-16"
                value={o.tamanho.dpi}
                onChange={(e) => mudarOpcoes((x) => (x.tamanho.dpi = Math.max(72, +e.target.value || 300)))}
              />
            </div>
            <p className="text-xs text-base-content/60">
              = {pxAlvo.toLocaleString("pt-BR")} px no lado escolhido. O arquivo sai com o DPI gravado.
            </p>
          </>
        )}
      </Secao>

      {/* ACABAMENTO --------------------------------------------------------- */}
      <Secao titulo="4. Acabamento">
        <span className="text-xs">Cores</span>
        <Escolha
          valor={o.cores.modo}
          mudar={(v) => mudarOpcoes((x) => (x.cores.modo = v))}
          opcoes={[
            { v: "manter", rotulo: "Manter", dica: "Não mexe nas cores (fotos)" },
            { v: "auto", rotulo: "Chapar", dica: "Descobre as cores reais da logo e limpa o resto" },
            { v: "fixo", rotulo: "Nº fixo" },
          ]}
        />
        {o.cores.modo === "fixo" && (
          <div className="flex items-center gap-2 text-sm">
            <input
              type="number"
              min={1}
              max={32}
              className="input input-bordered input-sm w-20"
              value={o.cores.quantidade}
              onChange={(e) => mudarOpcoes((x) => (x.cores.quantidade = Math.min(32, Math.max(1, +e.target.value || 1))))}
            />
            cores
          </div>
        )}
        <Liga
          rotulo="Borda dura"
          dica="Sem meia-transparência no contorno. Recomendado para DTF."
          valor={o.bordaDura}
          mudar={(v) => mudarOpcoes((x) => (x.bordaDura = v))}
        />
        <Liga
          rotulo="Aparar espaço vazio"
          dica="A medida passa a valer para a arte, não para a folha."
          valor={o.aparar}
          mudar={(v) => mudarOpcoes((x) => (x.aparar = v))}
        />
        <div className="flex items-center gap-2 text-sm">
          <span>Margem</span>
          <input
            type="number"
            min={0}
            step={0.5}
            className="input input-bordered input-xs w-16"
            value={o.margemMm}
            onChange={(e) => mudarOpcoes((x) => (x.margemMm = Math.max(0, +e.target.value || 0)))}
          />
          <span className="text-xs text-base-content/60">mm transparente em volta</span>
        </div>
      </Secao>

      {/* VETOR -------------------------------------------------------------- */}
      <Secao titulo="5. Vetor (SVG)" extra={o.vetor.ativo ? "ligado" : "desligado"} aberta={o.vetor.ativo}>
        <Liga
          rotulo="Gerar SVG também"
          dica="Abre no Corel já no tamanho em cm."
          valor={o.vetor.ativo}
          mudar={(v) => mudarOpcoes((x) => (x.vetor.ativo = v))}
        />
        {o.vetor.ativo && (
          <Escolha
            valor={o.vetor.estilo}
            mudar={(v) => mudarOpcoes((x) => (x.vetor.estilo = v))}
            opcoes={[
              { v: "chapada", rotulo: "Logo chapada", dica: "Curvas suaves, ignora sujeira pequena" },
              { v: "detalhe", rotulo: "Mais detalhe", dica: "Guarda detalhes finos, mais nós" },
              { v: "traco", rotulo: "Traço P&B", dica: "Desenho de linha, uma cor" },
            ]}
          />
        )}
        {o.vetor.ativo && o.cores.modo === "manter" && (
          <p className="text-xs text-warning">Dica: com as cores em "Chapar" o vetor sai bem mais limpo.</p>
        )}
      </Secao>

      {/* SAÍDA -------------------------------------------------------------- */}
      <Secao titulo="Salvar em" aberta={false} extra={o.saida.pasta ? nomeArquivo(o.saida.pasta) : "ao lado do original"}>
        <p className="break-all text-xs text-base-content/70">
          {o.saida.pasta || 'Subpasta "Upscaylae" ao lado de cada imagem original.'}
        </p>
        <div className="flex gap-1">
          <button
            className="btn btn-xs"
            onClick={async () => {
              const p = await invocar<string | null>(MULLER.ESCOLHER_PASTA);
              if (p) mudarOpcoes((x) => (x.saida.pasta = p));
            }}
          >
            Escolher pasta
          </button>
          {o.saida.pasta && (
            <button className="btn btn-xs" onClick={() => mudarOpcoes((x) => (x.saida.pasta = ""))}>
              Ao lado do original
            </button>
          )}
        </div>
      </Secao>

      {/* PROCESSAR ---------------------------------------------------------- */}
      <button className="btn btn-primary" disabled={processando || arquivos.length === 0} onClick={processar}>
        {processando ? "Processando…" : arquivos.length > 1 ? `Tratar ${arquivos.length} imagens` : "Tratar imagem"}
      </button>

      {/* RESULTADOS --------------------------------------------------------- */}
      {resultados.length > 0 && (
        <div className="flex flex-col gap-1 rounded-btn bg-base-200/60 p-2">
          {resultados.map((r, i) =>
            "erro" in r ? (
              <div key={i} className="text-xs text-error">
                {nomeArquivo(r.entrada)}: {r.erro}
              </div>
            ) : (
              <div key={i} className="flex flex-col gap-1 border-b border-base-300 pb-1 text-xs last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium" title={r.png}>
                    {nomeArquivo(r.png)}
                  </span>
                  <button className="btn btn-ghost btn-xs" onClick={() => window.electron.send(MULLER.MOSTRAR_ARQUIVO, r.png)}>
                    mostrar
                  </button>
                </div>
                <div className="flex items-center gap-2 text-base-content/70">
                  <span>
                    {r.larguraCm} × {r.alturaCm} cm · {r.dpi} DPI{r.svg ? " · +SVG" : ""}
                  </span>
                  {r.cores && (
                    <span className="flex gap-0.5">
                      {r.cores.map((c) => (
                        <span key={c} title={c} className="h-3 w-3 rounded-sm border border-base-content/20" style={{ background: c }} />
                      ))}
                    </span>
                  )}
                </div>
                {r.avisos.map((a, j) => (
                  <span key={j} className="text-warning">
                    {a}
                  </span>
                ))}
              </div>
            ),
          )}
        </div>
      )}

      {/* AUTOMAÇÃO ---------------------------------------------------------- */}
      <Secao
        titulo="Automação"
        aberta={false}
        extra={[servicos.pastaVigiada && "pasta", servicos.api && "API"].filter(Boolean).join(" + ") || "desligada"}
      >
        <p className="text-xs font-semibold">Pasta vigiada</p>
        <Liga
          rotulo="Tratar sozinho tudo que chegar na pasta"
          valor={config.pastaVigiada.ativo}
          mudar={(v) => salvar({ ...config, pastaVigiada: { ...config.pastaVigiada, ativo: v } }, true)}
        />
        <div className="flex items-center gap-1 text-xs">
          <button
            className="btn btn-xs"
            onClick={async () => {
              const p = await invocar<string | null>(MULLER.ESCOLHER_PASTA);
              if (p) salvar({ ...config, pastaVigiada: { ...config.pastaVigiada, entrada: p } }, true);
            }}
          >
            Pasta de entrada
          </button>
          <span className="truncate text-base-content/70" title={config.pastaVigiada.entrada}>
            {config.pastaVigiada.entrada || "não escolhida"}
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button
            className="btn btn-xs"
            onClick={async () => {
              const p = await invocar<string | null>(MULLER.ESCOLHER_PASTA);
              if (p) salvar({ ...config, pastaVigiada: { ...config.pastaVigiada, saida: p } }, true);
            }}
          >
            Pasta de saída
          </button>
          <span className="truncate text-base-content/70">
            {config.pastaVigiada.saida || 'subpasta "Upscaylae"'}
          </span>
        </div>
        <label className="flex items-center gap-2 text-xs">
          Ajustes:
          <select
            className="select select-bordered select-xs flex-1"
            value={config.pastaVigiada.presetId}
            onChange={(e) => salvar({ ...config, pastaVigiada: { ...config.pastaVigiada, presetId: e.target.value } }, true)}
          >
            <option value="">Os ajustes atuais desta aba</option>
            {todosPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        <Liga
          rotulo='Mover originais para "processadas"'
          valor={config.pastaVigiada.moverOriginais}
          mudar={(v) => salvar({ ...config, pastaVigiada: { ...config.pastaVigiada, moverOriginais: v } }, true)}
        />

        <div className="divider my-0" />
        <p className="text-xs font-semibold">API local (para a central de trabalho)</p>
        <Liga
          rotulo="Ativar API"
          dica="Só este PC acessa, e precisa da chave."
          valor={config.api.ativo}
          mudar={(v) => salvar({ ...config, api: { ...config.api, ativo: v } }, true)}
        />
        <div className="flex items-center gap-2 text-xs">
          Porta
          <input
            type="number"
            className="input input-bordered input-xs w-20"
            value={config.api.porta}
            onChange={(e) => salvar({ ...config, api: { ...config.api, porta: +e.target.value || 7341 } })}
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          Chave
          <code className="flex-1 truncate rounded bg-base-300 px-1">{config.api.chave}</code>
          <button className="btn btn-xs" onClick={() => navigator.clipboard.writeText(config.api.chave)}>
            copiar
          </button>
          <button
            className="btn btn-xs"
            title="Gerar outra chave"
            onClick={() => {
              const nova = Array.from(crypto.getRandomValues(new Uint8Array(12)))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
              salvar({ ...config, api: { ...config.api, chave: nova } }, true);
            }}
          >
            ↻
          </button>
        </div>
        {servicos.api && (
          <p className="break-all text-[10px] text-base-content/60">
            Ex.: POST http://127.0.0.1:{config.api.porta}/processar-imagem?preset=logo-dtf com a imagem no corpo e o
            cabeçalho X-Chave.
          </p>
        )}

        {eventos.length > 0 && (
          <>
            <div className="divider my-0" />
            <div className="flex max-h-32 flex-col gap-0.5 overflow-y-auto text-[11px]">
              {eventos.map((e, i) => (
                <span key={i} className={e.tipo === "erro" ? "text-error" : "text-base-content/70"}>
                  {new Date(e.quando).toLocaleTimeString("pt-BR")} · {e.mensagem}
                </span>
              ))}
            </div>
          </>
        )}
      </Secao>

      {/* MODELOS ------------------------------------------------------------ */}
      <Secao titulo="Modelos de IA" aberta={false}>
        <p className="text-xs text-base-content/70">
          Recorte de fundo (baixa uma vez, depois funciona sem internet):
        </p>
        {modelos?.fundo.map((m) => {
          const d = downloads[m.id];
          const baixandoAgora = d && !d.concluido && !d.erro;
          return (
            <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex flex-col">
                <span className="font-medium">{m.nome}</span>
                <span className="text-base-content/60">{m.descricao}</span>
                {d?.erro && <span className="text-error">{d.erro}</span>}
              </span>
              {m.baixado ? (
                <span className="badge badge-success badge-sm">baixado</span>
              ) : baixandoAgora ? (
                <span className="whitespace-nowrap">
                  {Math.round(d.recebidoMb)}/{Math.round(d.totalMb)} MB
                </span>
              ) : (
                <button
                  className="btn btn-xs whitespace-nowrap"
                  onClick={() => {
                    setDownloads((p) => ({ ...p, [m.id]: { id: m.id, recebidoMb: 0, totalMb: m.tamanhoMb, concluido: false } }));
                    invocar(MULLER.BAIXAR_MODELO, m.id).then((r) => {
                      if (!r.ok) toast({ title: "Falha no download", description: r.erro });
                    });
                  }}
                >
                  Baixar {m.tamanhoMb} MB
                </button>
              )}
            </div>
          );
        })}
        <div className="divider my-0" />
        <p className="text-xs text-base-content/70">
          Ampliação ONNX: coloque arquivos .onnx na pasta e clique em atualizar. Funciona na placa de vídeo via DirectML.
        </p>
        <div className="flex gap-1">
          <button className="btn btn-xs" onClick={() => window.electron.send(MULLER.ABRIR_PASTA_MODELOS)}>
            Abrir pasta
          </button>
          <button className="btn btn-xs" onClick={carregarModelos}>
            Atualizar ({modelos?.ampliacaoOnnx.length ?? 0})
          </button>
        </div>
      </Secao>
    </div>
  );
}
