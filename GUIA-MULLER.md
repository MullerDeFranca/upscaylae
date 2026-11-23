# Upscaylae — melhorias Muller

Fork do [Upscayl](https://github.com/upscayl/upscayl) (AGPL-3.0) com foco em logos, DTF e impressão.
Tudo roda no seu PC, sem internet (a não ser para baixar os modelos de recorte uma única vez).

## O que mudou

| | Antes (Upscayl) | Agora (Upscaylae) |
|---|---|---|
| Tamanho | 2x, 3x, 4x ou largura em pixels | **cm + DPI**, com o DPI gravado no PNG |
| Fundo | não mexe | **fundo liso por cor** (com miolo das letras vazado) ou **IA** |
| Cores | não mexe | **cores chapadas**: descobre as cores reais da logo e limpa halos e serrilhado |
| Vetor | não tem | **SVG com VTracer**, já com a medida em cm para o Corel |
| Modelos | foto e arte digital | + **Arte chapada 2x/3x/4x** e **Limpa JPEG 4x** |
| Motor | só Real-ESRGAN (NCNN/Vulkan) | + **modelos ONNX** novos na placa de vídeo (DirectML) |
| Automação | não tem | **pasta vigiada** e **API local** para a central de trabalho |
| Privacidade | rastreamento de uso (PostHog), notícias online, propaganda do Cloud | **100% offline**, sem rastreamento |
| Atualização | automática (substituiria este fork) | desligada |

O app instala com outro nome e outro ID, então pode ficar ao lado do Upscayl original.

## Como gerar o instalador no Windows

Precisa de [Node.js 20 ou mais novo](https://nodejs.org) e do [Git](https://git-scm.com).

```bat
git clone https://github.com/MullerDeFranca/upscaylae
cd upscaylae
git checkout Melhorias-Muller
npm install
npm run dist:win
```

O instalador sai na pasta `dist` (`upscaylae-2.15.0-win.exe`). Como o instalador não é assinado
digitalmente, o Windows pode mostrar o aviso do SmartScreen: clique em "Mais informações" →
"Executar assim mesmo".

Para testar sem instalar: `npm start`.

## Aba Logo/DTF

Abre por padrão. A ordem dos blocos é a ordem em que a imagem é tratada.

**Pronto para usar** — presets que já ligam tudo do jeito certo:

- **Logo para DTF**: tira o fundo liso, amplia com Arte chapada, chapa as cores, borda dura, 28 cm a 300 DPI.
- **Logo + vetor**: o mesmo e ainda gera o SVG.
- **Recorte com IA**: para foto/fundo complicado; mantém as cores.
- **Foto / estampa**: só amplia até o tamanho de impressão.
- **Imagem suja (WhatsApp)**: usa o modelo Limpa JPEG antes de tratar.

Qualquer ajuste pode ser salvo como preset seu (campo "Nome para salvar estes ajustes").

1. **Fundo** — *Fundo liso* detecta a cor pela borda (ou você escolhe). "Manter o fundo de dentro
   da arte" preserva, por exemplo, o branco dentro de um círculo; "Miolo das letras transparente"
   vaza O, A, B, e… *IA* usa um modelo de recorte (baixe em "Modelos de IA").
2. **Ampliar com IA** — a ampliação é calculada sozinha a partir do tamanho final. Com Arte chapada
   ele escolhe 2x, 3x ou 4x conforme o necessário. Modelos marcados "NÃO comercial" (Remacri,
   Ultramix, Ultrasharp) não podem ser usados em trabalho para cliente.
3. **Tamanho de impressão** — medida em cm no lado maior, na largura ou na altura, e o DPI.
   Com "Aparar" ligado a medida vale para a arte, não para a folha.
4. **Acabamento** — *Chapar* descobre as cores reais; *Nº fixo* força uma quantidade. *Borda dura*
   deixa o contorno 100% opaco ou 100% transparente (bom para a camada de branco do DTF).
5. **Vetor** — três estilos em vez de sliders: *Logo chapada*, *Mais detalhe* e *Traço P&B*.

Os arquivos saem como `nome_28x16cm_300dpi.png` (e `.svg`), numa subpasta `Upscaylae` ao lado do
original, ou na pasta que você escolher.

## Modelos de IA

- **Recorte de fundo** (baixados pelo próprio app, do projeto [rembg](https://github.com/danielgatis/rembg)):
  ISNet (171 MB, recomendado), BiRefNet Lite (214 MB), BiRefNet (928 MB), ISNet Anime (168 MB).
- **Ampliação ONNX**: coloque arquivos `.onnx` em "Modelos de IA → Abrir pasta". O app descobre
  sozinho se o modelo é 2x ou 4x, aceita modelos fp32 e fp16, de tamanho livre ou fixo, e roda na
  placa de vídeo via DirectML (AMD, NVIDIA ou Intel). Um bom lugar para achar modelos é o
  [OpenModelDB](https://openmodeldb.info) (procure os que têm versão ONNX e confira a licença).

Os modelos ficam em `%APPDATA%\Upscaylae\modelos-ia`.

## Pasta vigiada

Em "Automação": escolha a pasta de entrada, a de saída e o preset. Toda imagem nova que chegar é
tratada sozinha (ele espera o arquivo terminar de copiar). Opcionalmente o original vai para uma
subpasta `processadas`. As imagens que já estavam na pasta não são reprocessadas.

## API local

Em "Automação → API local". Escuta só em `127.0.0.1` (o próprio PC) e todo pedido precisa da chave
no cabeçalho `X-Chave`. Porta padrão: 7341.

| Rota | O que faz |
|---|---|
| `GET /status` | versão, tamanho da fila, se a pasta vigiada está ativa |
| `GET /presets` | lista dos presets (padrão + os seus) |
| `POST /processar` | JSON `{ "caminho": "D:\\...\\logo.jpg", "preset": "logo-dtf" }` (ou `caminhos: [...]`, e `opcoes` para sobrescrever) — trata arquivos do disco e devolve os caminhos gerados |
| `POST /processar-imagem` | corpo = bytes da imagem; `?preset=logo-dtf&formato=png\|svg\|json&nome=logo.jpg` — devolve a imagem pronta |

Os cabeçalhos da resposta trazem `X-Largura-Cm`, `X-Altura-Cm`, `X-Largura-Px`, `X-Altura-Px`,
`X-Dpi`, `X-Cores` e `X-Avisos`.

Exemplo no navegador (a central de trabalho):

```js
const resp = await fetch("http://127.0.0.1:7341/processar-imagem?preset=logo-dtf", {
  method: "POST",
  headers: { "X-Chave": "SUA_CHAVE" },
  body: arquivo, // File do <input type="file">
});
const png = await resp.blob();
const larguraCm = resp.headers.get("X-Largura-Cm");
```

Exemplo no terminal:

```bat
curl -H "X-Chave: SUA_CHAVE" --data-binary @logo.jpg "http://127.0.0.1:7341/processar-imagem?preset=logo-vetor&formato=svg" -o logo.svg
```

## Onde fica o código

- `electron/muller/` — processamento (fundo, ampliação NCNN e ONNX, cores, vetor), fila, pasta vigiada e API
- `common/muller-*.ts` — tipos, presets e canais compartilhados
- `renderer/components/sidebar/muller-tab/` — a aba Logo/DTF

## Licenças

- Upscayl e este fork: AGPL-3.0.
- Arte chapada (Real-ESRGAN animevideo v3) e Limpa JPEG (Real-ESRGAN General WDN v3): BSD-3, uso comercial liberado.
- VTracer: MIT. ONNX Runtime: MIT. Modelos ISNet: Apache-2.0. BiRefNet: MIT.
- Remacri, Ultramix e Ultrasharp (vindos do Upscayl): **somente uso não comercial**.
