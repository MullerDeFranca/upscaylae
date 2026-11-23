import crypto from "crypto";
import { app, dialog, ipcMain, shell } from "electron";
import settings from "electron-settings";
import fs from "fs";
import path from "path";
import { MULLER, EventoMuller } from "../../common/muller-commands";
import { ELECTRON_COMMANDS } from "../../common/electron-commands";
import {
  normalizarOpcoes,
  PRESETS_PADRAO,
} from "../../common/muller-presets";
import {
  ConfigMuller,
  OpcoesMuller,
  PresetMuller,
  ResultadoMuller,
} from "../../common/muller-types";
import { getMainWindow } from "../main-window";
import { savedCustomModelsPath } from "../utils/config-variables";
import { execPath, modelsPath } from "../utils/get-resource-paths";
import logit from "../utils/logit";
import { ApiLocal } from "./api-local";
import { cancelarFila, enfileirar, tamanhoDaFila } from "./fila";
import { baixarModeloFundo, estadoModelos } from "./modelos";
import { definirLogOnnx } from "./onnx";
import { opcoesParaPastaVigiada, PastaVigiada } from "./pasta-vigiada";
import { AmbienteMuller } from "./pipeline";

const CHAVE_CONFIG = "muller";

function pastaModelosIA() {
  return path.join(app.getPath("userData"), "modelos-ia");
}

function configPadrao(): ConfigMuller {
  return {
    opcoes: normalizarOpcoes(PRESETS_PADRAO[0].opcoes),
    presetsPersonalizados: [],
    pastaVigiada: {
      ativo: false,
      entrada: "",
      saida: "",
      presetId: "logo-dtf",
      moverOriginais: false,
    },
    api: {
      ativo: false,
      porta: 7341,
      chave: crypto.randomBytes(12).toString("hex"),
    },
  };
}

let config: ConfigMuller = configPadrao();

async function carregarConfig() {
  try {
    const salvo = (await settings.get(CHAVE_CONFIG)) as any;
    if (salvo) {
      const padrao = configPadrao();
      config = {
        opcoes: normalizarOpcoes(salvo.opcoes),
        presetsPersonalizados: Array.isArray(salvo.presetsPersonalizados)
          ? salvo.presetsPersonalizados.map((p: PresetMuller) => ({ ...p, opcoes: normalizarOpcoes(p.opcoes) }))
          : [],
        pastaVigiada: { ...padrao.pastaVigiada, ...(salvo.pastaVigiada ?? {}) },
        api: { ...padrao.api, ...(salvo.api ?? {}) },
      };
    } else {
      await settings.set(CHAVE_CONFIG, config as any);
    }
  } catch (e) {
    logit("⚠️ Não consegui ler a configuração Muller:", String(e));
  }
}

function todosPresets(): PresetMuller[] {
  return [...PRESETS_PADRAO, ...config.presetsPersonalizados];
}

function ambiente(opcoes?: OpcoesMuller): AmbienteMuller {
  return {
    execPath,
    modelsPath,
    customModelsPath: savedCustomModelsPath,
    gpuId: opcoes?.gpuId,
    pastaModelosOnnx: pastaModelosIA(),
    log: logit,
  };
}

function emitir(evento: Omit<EventoMuller, "quando">) {
  const janela = getMainWindow();
  janela?.webContents.send(MULLER.EVENTO, { ...evento, quando: Date.now() });
  logit(`📣 [${evento.tipo}] ${evento.mensagem}`);
}

function processar(arquivo: string, opcoes: OpcoesMuller): Promise<ResultadoMuller> {
  const janela = getMainWindow();
  return enfileirar(arquivo, opcoes, ambiente(opcoes), (p) => {
    janela?.webContents.send(MULLER.PROGRESSO, p);
    if (p.pct !== undefined && janela) janela.setProgressBar(p.pct >= 100 ? -1 : p.pct / 100);
  });
}

// ---------------------------------------------------------------------------
const vigia = new PastaVigiada({
  processar: (arquivo) => {
    const preset = todosPresets().find((p) => p.id === config.pastaVigiada.presetId);
    const base = preset ? preset.opcoes : config.opcoes;
    return processar(arquivo, opcoesParaPastaVigiada(normalizarOpcoes(base), config.pastaVigiada.saida));
  },
  avisar: (tipo, mensagem, arquivo) => emitir({ tipo, mensagem, arquivo }),
});

const api = new ApiLocal({
  presets: todosPresets,
  opcoesAtuais: () => config.opcoes,
  processar,
  status: () => ({
    versao: app.getVersion(),
    fila: tamanhoDaFila(),
    pastaVigiada: vigia.ativa,
  }),
  avisar: (mensagem) => emitir({ tipo: "api", mensagem }),
});

async function aplicarServicos() {
  if (config.pastaVigiada.ativo) vigia.iniciar(config.pastaVigiada.entrada, config.pastaVigiada.moverOriginais);
  else vigia.parar();

  if (config.api.ativo) {
    if (!api.ativa || api.porta !== config.api.porta) {
      try {
        await api.iniciar(config.api.porta, config.api.chave);
      } catch (e: any) {
        emitir({ tipo: "erro", mensagem: `API local: ${e.code === "EADDRINUSE" ? `a porta ${config.api.porta} já está em uso` : e.message}` });
      }
    }
  } else {
    await api.parar();
  }
}

// ---------------------------------------------------------------------------
export async function iniciarMuller() {
  definirLogOnnx(logit);
  fs.mkdirSync(pastaModelosIA(), { recursive: true });
  await carregarConfig();

  ipcMain.handle(MULLER.OBTER_CONFIG, () => ({
    config,
    presetsPadrao: PRESETS_PADRAO,
    servicos: { pastaVigiada: vigia.ativa, api: api.ativa },
  }));

  ipcMain.handle(MULLER.SALVAR_CONFIG, async (_e, novo: ConfigMuller) => {
    const chaveAntiga = config.api.chave;
    config = {
      opcoes: normalizarOpcoes(novo.opcoes),
      presetsPersonalizados: (novo.presetsPersonalizados ?? []).map((p) => ({
        ...p,
        opcoes: normalizarOpcoes(p.opcoes),
      })),
      pastaVigiada: { ...config.pastaVigiada, ...novo.pastaVigiada },
      api: { ...config.api, ...novo.api },
    };
    await settings.set(CHAVE_CONFIG, config as any);
    if (config.api.chave !== chaveAntiga) await api.parar();
    await aplicarServicos();
    return { config, servicos: { pastaVigiada: vigia.ativa, api: api.ativa } };
  });

  ipcMain.handle(
    MULLER.PROCESSAR,
    async (_e, pedido: { arquivos: string[]; opcoes: OpcoesMuller }) => {
      const opcoes = normalizarOpcoes(pedido.opcoes);
      const resultados: (ResultadoMuller | { entrada: string; erro: string })[] = [];
      for (const arquivo of pedido.arquivos) {
        try {
          resultados.push(await processar(arquivo, opcoes));
        } catch (e: any) {
          logit("❌ Muller:", e?.stack ?? String(e));
          resultados.push({ entrada: arquivo, erro: e?.message ?? String(e) });
        }
      }
      getMainWindow()?.setProgressBar(-1);
      return resultados;
    },
  );

  ipcMain.on(MULLER.PARAR, () => cancelarFila());
  // o botão "parar" da tela de progresso também cancela o modo Logo/DTF
  ipcMain.on(ELECTRON_COMMANDS.STOP, () => cancelarFila());

  ipcMain.handle(MULLER.MODELOS, () =>
    estadoModelos(pastaModelosIA(), modelsPath, savedCustomModelsPath),
  );

  ipcMain.handle(MULLER.BAIXAR_MODELO, async (_e, id: string) => {
    const janela = getMainWindow();
    try {
      await baixarModeloFundo(id, pastaModelosIA(), (d) => janela?.webContents.send(MULLER.DOWNLOAD, d));
      return { ok: true };
    } catch (e: any) {
      return { ok: false, erro: e.message };
    }
  });

  ipcMain.on(MULLER.ABRIR_PASTA_MODELOS, () => {
    const pasta = path.join(pastaModelosIA(), "ampliacao");
    fs.mkdirSync(pasta, { recursive: true });
    shell.openPath(pasta);
  });

  ipcMain.handle(MULLER.ESCOLHER_PASTA, async () => {
    const janela = getMainWindow();
    const r = janela
      ? await dialog.showOpenDialog(janela, { properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle(MULLER.ESCOLHER_ARQUIVOS, async () => {
    const opts: Electron.OpenDialogOptions = {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Imagens", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "gif"] }],
    };
    const janela = getMainWindow();
    const r = janela ? await dialog.showOpenDialog(janela, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.on(MULLER.MOSTRAR_ARQUIVO, (_e, arquivo: string) => {
    if (arquivo && fs.existsSync(arquivo)) shell.showItemInFolder(arquivo);
  });

  await aplicarServicos();
}

export async function encerrarMuller() {
  vigia.parar();
  await api.parar();
}
