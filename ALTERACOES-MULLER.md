# Alterações do Murilo — fork upscaylae

Fork do app `upscayl/upscayl` com as melhorias próprias do Murilo.
O motor ncnn em si tem fork separado: `MullerDeFranca/upscayl-ncnn`.

## Base oficial registrada

- Upstream: `upscayl/upscayl` (branch `main`)
- Commit de base da `main`: `a00d55f` (2026-03-27)
- Registrado em: 2026-11-23

## Alterações próprias (branch `Melhorias-Muller`)

| Commit | O que faz | Arquivos principais |
|---|---|---|
| `5b49c69` | Remove telemetria, notícias online, propaganda do Cloud e atualização automática | `electron/commands/auto-update.ts` (removido), `renderer/atoms/news-atom.ts`, `electron/index.ts`, `electron/main-window.ts`, `renderer/components/footer.tsx` |
| `8232788` | Adiciona modelos próprios de IA: `arte-chapada` (2x/3x/4x) e `limpa-jpeg` (4x) | `resources/models/arte-chapada-*`, `resources/models/limpa-jpeg-4x.*`, `common/models-list.ts` |
| `280354f` | Adiciona aba Logo/DTF com pipeline completo de tratamento de imagem | `electron/muller/*` (api-local, cores, fila, fundo, imagem, modelos, ncnn, onnx, pasta-vigiada, pipeline, vetor), `common/muller-*.ts` |
| `115eaaa` | Ajustes de interface e guia em português | `GUIA-MULLER.md`, `README.md` |

**Estratégia de isolamento (já praticada aqui):** alterações próprias vivem em
arquivos/módulos novos (`electron/muller/*`, `common/muller-*.ts`) ou em mudanças
pontuais em arquivos originais. A Central de Trabalho consome o motor via
*sidecar* (executável separado) com wrappers em Rust, sem exigir patches no motor.

## Como atualizar do oficial

```
git fetch upstream
git switch main && git merge upstream/main       # main continua espelho do oficial
git switch Melhorias-Muller && git merge main    # traz o oficial mantendo as alterações
```

Se houver conflito: nunca descartar nenhum dos lados automaticamente — resolver
manualmente e atualizar este arquivo se alguma alteração mudar.
