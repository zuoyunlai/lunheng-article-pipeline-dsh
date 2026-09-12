# Lunheng (lunheng-article-pipeline) — pipeline multiagente para textos longos

> 版本：v18.0.4（DSH bundle：package.json + cordis.patch.yml + lib/index.js）

> Um bundle do DeepSeek Harness (DSH) que registra uma skill de agente sob demanda. A skill transforma a produção de textos longos — artigos acadêmicos, análise setorial, comentário econômico e artigos extensos — em uma **pipeline de 9 papéis com participação humana**.

## What this is

Lunheng é uma pipeline de escrita, não um gerador de texto. Divide a produção de um texto longo em 9 papéis independentes (T1–T9) ao longo de 6 fases, orquestrados com chamadas `subagent` do DSH, e entrega um resultado com base probatória, revisão de contra-argumentos, auditoria independente e pontos de controle humanos.

Os nove papéis são independentes e insubstituíveis: T1 busca bibliográfica, T2 busca de dados, T3 busca de casos, T4 análise, T5 redação, T6 companheiro crítico, T7 auditoria, T8 verificação final (executada pelo próprio coordenador), T9 revisão por pares.

## When to use it

- Você precisa de um texto extenso (mais de 2000 caracteres) que resista a escrutínio e pode esperar de 1 a 3 horas.
- O tema envolve fatos, números ou múltiplos pontos de vista, exigindo base probatória em vez de opinião apenas.
- Você quer pontos de controle humanos: confirmar o esboço antes de redigir e revisar o rascunho final.

## When not to use it

Lunheng coleta **evidência publicada** e integra a evidência que você fornece. Não consegue produzir o seguinte sozinha; forneça o material primeiro ou use outra ferramenta:

- **Coleta de dados em primeira mão** — experimentos, questionários, entrevistas, trabalho de campo.
- **Análise estatística** — pode citar resultados, mas não executa SPSS/R/Python.
- **Coleta de dados brutos para gráficos** — renderiza visualizações; scraping, OCR e transcrição exigem ferramentas dedicadas.
- **Imagens ou vídeo originais** — o DSH não inclui geração de imagens; capas usam SVG local ou arquivos fornecidos.
- **Execução de código** — a pipeline executa apenas scripts autorizados; qualquer outra coisa exige sua aprovação explícita.

Regra prática: pergunte se a evidência já está **publicada**. Se estiver, Lunheng a coleta. Se não, forneça-a primeiro.

## What you get

| Item | Conteúdo |
|---|---|
| Fichas bibliográficas `[Lxx]` | Fontes publicadas com grau de confiança A/B/C e lista de precursores |
| Fichas de dados `[Dxx]` | Números com fonte, ano, vigência, nível de confiança e números conflitantes lado a lado |
| Fichas de casos `[Cxx]` | Estrutura do evento (quem/quando/o quê/versão de cada parte), ou marcador explícito `[C-空]` |
| Esboço de análise | Fio argumentativo, mapeamento afirmação-evidência, plano de contra-argumentos, evidência portante |
| Rascunhos | Versões sucessivas com limpeza de vestígios de IA, cada uma de um redator independente |
| Relatórios | Relatório crítico (C1–C7), auditoria (G0–G14), revisão por pares (6 dimensões + periódicos) |
| Entregáveis finais | `final/定稿.md`, figuras, pacote probatório, notas de entrega, relatório do portão M |

## Pipeline overview

```text
Fase 0  Tema          Confirmar tema, extensão, formato de citação; consentimento de serviços externos
Fase 1  Busca         T1 bibliografia ∥ T2 dados ∥ T3 casos (paralelo real e independente)
Portão T2.5           Entradas de dados ≥ requisito do briefing; níveis de confiança completos
Fase 2  Análise       T4 analista → esboço de análise
Fase 2.5 Esboço       Revisão humana (no circuito)
Fase 3  Redação       T5 redator → rascunho v1
Fase 3.5 Perspectiva  O humano fornece contexto em primeira mão (no circuito) → rascunho v2
Fase 3.6 Crítica      T6 companheiro crítico → relatório C1–C7
Fase 4  Auditoria     T7 auditor → relatório G0–G14 e lista de revisão
Fase 4.2 Revisão      Redator + notas de revisão (≤2 rodadas, redator independente)
Fase 4.5 Revisão      T9 revisão por pares + portão G14 de vestígios de IA (em paralelo); figuras
Portão T7.5           Auditoria mais recente + lista P0/P1 + portão M exit 0 + isolamento
Fase 5  Verificação   T8 (executada pelo coordenador) → texto final, pacote probatório, notas de entrega
```

**Base probatória triangular** (`[L]` + `[D]` + `[C]`) — toda afirmação deve mapear para bibliografia, dados e, para afirmações sobre eventos, casos. **Auditoria independente** — quem audita nunca edita. **Quatro pontos humanos** — fases 0, 2.5, 3.5 e 5.

## Repository layout

```text
lunheng-article-pipeline/                 # o pacote é o repositório
├── package.json              # declara main (lib/index.js) + dsh.bundle.patch
├── cordis.patch.yml          # camada bundle: insere as 3 ferramentas subagent por nível
├── lib/index.js              # entrada do plugin: registra a skill via ctx.skills
├── skills/lunheng-article-pipeline/       # o corpo da skill (um diretório)
│   ├── SKILL.md              # entrada da skill (papéis, portões, limites de execução)
│   ├── AGENTS.md             # manual do operador
│   ├── QUICKSTART.md         # início em cinco minutos
│   ├── README.md             # readme da skill (chinês)
│   ├── references/           # 9 fichas de papel, modelos, algoritmos de portão, base de periódicos
│   └── scripts/              # 11 scripts .mjs de verificação sem dependências
├── scripts/                  # portões do repositório: superfície de empacotamento + higiene
├── tests/                    # suítes node --test (scripts + fumaça da entrada)
├── docs/                     # instalação, uso, arquitetura, faq, solução de problemas
├── examples/preset/          # notas de níveis de modelo e guia de instalação
├── README.md                 # fonte em inglês
├── README.zh.md README.es.md README.pt.md README.hi.md
├── SECURITY.md CHANGELOG.md CONTRIBUTING.md LICENSE
```

A entrada do plugin registra `skills/lunheng-article-pipeline/SKILL.md` como skill com `resourceBase` apontando para esse diretório, então `references/**` e `scripts/**` resolvem-se relativos a ele a partir de qualquer diretório de trabalho.

A camada patch faz duas coisas: **insere uma linha para este pacote** (`- id: lunheng-article-pipeline` / `name: lunheng-article-pipeline`) — é essa linha que faz o loader importar `lib/index.js`, que é o que registra a skill — e insere as três ferramentas subagent por nível. **Essa linha é estrutural**: sem ela a entrada nunca é importada e a skill não aparece (defeito da v18.0.0, corrigido na 18.0.1; vigiado por `tests/bundle-contract.test.mjs`).

### Documentation

`docs/installation.md` (instalação e verificação) · `docs/usage.md` (fluxo de uso) · `docs/architecture.md` (arquitetura) · `docs/introduction.md` (introdução) · `docs/faq.md` (perguntas frequentes) · `docs/troubleshooting.md` (sintoma → causa → correção) · `SECURITY.md` (limite de confiança) · `CHANGELOG.md` · `CONTRIBUTING.md`.

### Publishing (maintainers)

As versões são publicadas **apenas por tag**; `npm publish` local é proibido (contorna os portões de CI e a proveniência OIDC, e uma versão npm nunca pode ser sobrescrita).

```sh
git tag v18.0.4 && git push origin v18.0.0   # uma tag por push (GitHub: >3 tags em um push não dispara workflow)
# publish.yml executa: portão 1 consistência → portão 2 empacotamento → portão 3 higiene → testes
#   → tag/versão iguais → guarda de idempotência → OIDC publish --provenance --tag dsh → auditoria posterior
```

## Install

**Como bundle** (recomendado; a entrada registra a skill e a camada patch ativa os níveis):

```sh
dsh plugin --profile web add lunheng-article-pipeline
dsh --profile web --dump-config   # mostra uma camada "# == lunheng-article-pipeline"
```

Um `dsh` moderno adiciona a dependência a `dsh.profile.bundles` assim que vê a declaração `dsh.bundle`: instale e reinicie o `dsh web`. Somente instalações npm/pnpm puras ou versões antigas precisam da entrada manual.

**Como diretório de skill simples** (sem instalação, recarga a quente):

```sh
# Copie o DIRETÓRIO DA SKILL (não a raiz do repositório) para qualquer raiz de skills:
#   $DSH_HOME/skills/lunheng-article-pipeline        (usuário, rank 400)
#   <projeto>/.dsh/skills/lunheng-article-pipeline   (projeto, rank 100)
```

Um diretório simples não declara `dsh.bundle`, então `dsh plugin add` apenas o instala como dependência e não ativa camada alguma. Copiar o diretório da skill é o caminho suportado.

### Requirements

| Item | Requisito |
|---|---|
| DSH | CLI `dsh` disponível; as linhas `- insert:` exigem DSH 5.5.0+ |
| Node | `^22.19.0 \|\| >=24.0.0` (mínimo do DSH; ver `engines` no `package.json`) |
| pnpm | Necessário para instalar/desinstalar (`dsh plugin` delega ao pnpm) |
| Plataforma | Windows / macOS / Linux (scripts sem dependências) |

### Uninstall

```sh
dsh plugin --profile <profile> remove lunheng-article-pipeline
```

Ao desinstalar, as 3 linhas `- insert:` e a skill registrada pela entrada desaparecem, sem resíduos. Se você também copiou o diretório da skill para uma raiz de skills, apague essa cópia separadamente.

## Model routing

O DSH roteia modelos por `settings.yaml`; `subagent` herda o modelo da sessão, então uma configuração de modelo único funciona sem ajustes. Para escalonar por papel, o bundle instala três ferramentas por nível:

| Ferramenta | Papéis | Capacidade |
|---|---|---|
| `subagent_retrieval` | T1 bibliografia / T2 dados / T3 casos | Rápido e barato |
| `subagent_strong` | T4 análise / T5 redação | Raciocínio forte |
| `subagent_audit` | T6 crítica / T7 auditoria / T9 revisão / detector G14 | Nível máximo, sem degradar por custo |

Substitua com `LUNHENG_{RETRIEVAL,STRONG,AUDIT}_PROVIDER` e `LUNHENG_{RETRIEVAL,STRONG,AUDIT}_MODEL`: provedor e modelo são campos independentes (cruzar provedores exige ambos) e `LUNHENG_TIERING=off` devolve os três níveis à herança. Quando uma ferramenta de nível não está montada, o despacho recai em `subagent`. Veja `examples/preset/README.md` e `docs/installation.md`.

## Data and external services

A pipeline envia o seguinte a terceiros:

| Operação | Conteúdo enviado | Destinatário |
|---|---|---|
| `web_search` / `web_fetch` | Palavras-chave e URL de destino | Os provedores de busca e leitura configurados no DSH |
| Inferência do modelo | Fichas bibliográficas, de dados e de casos; esboços; rascunhos | O provedor de modelo ativo |
| Geração de imagens (opcional, desligada) | Tema e prompt de marca | Um MCP de imagens, apenas se você habilitar |

O coordenador deve divulgar esses envios e obter consentimento explícito na fase 0. Para temas confidenciais: anonimize o texto, mantenha as capas como SVG local (zero chamadas externas) e escolha um endpoint de modelo local. Recusar qualquer item devolve a execução à fase 0.

## Verification status

| Artigo | Escala | Resultado |
|---|---|---|
| Consistência de marca (2026-08) | ~7900 caracteres, 15 fontes + 54 dados | Pacote probatório; 8 achados encerrados |
| Paradoxo da originalidade (2026-08) | ~9500 caracteres, 12 fontes + 34 dados + 6 casos | 4 rodadas de revisão, nota A-, publicado |
| Isolamento do campo docente (2026-08) | ~12000 caracteres, 18 fontes + 47 dados + 9 casos | Auditoria rodada 2 aprovada |
| Escrita estudantil com IA generativa (2026-08) | ~2000 caracteres, 12 fontes + 26 dados | Busca tripla paralela; portão M exit 0 |
| Caso do repolho com formaldeído (2026-08) | ~4200 caracteres, 12 fontes + 29 dados + 4 casos | Portão M exit 0; 6 regras incorporadas |
| Artigo sobre noção e ideia (2026-09) | ~6280 caracteres, 18 fontes + 15 dados, 0 casos | 2 rodadas de auditoria, 23/30 revisão menor, P0 real = 0 |

## Known limitations

- **Prioridade do chinês.** Prompts de papel, entregáveis, nomes de arquivo e fluxos são em chinês por padrão.
- **Sem verificação de rede por padrão.** As checagens numéricas costumam ficar «pendentes de revisão manual» porque fontes pagas não podem ser recuperadas.
- **A independência da auditoria tem custo.** Uma execução completa lança mais de 15 subagentes; o gasto concentra-se em leituras de contexto.
- **O portão M pode dar falsos positivos.** O verificador deve registrar `script_exit_raw` e justificar o veredicto `exit` em vez de editar o documento para forçar exit 0.
- **Não substitui a revisão real.** O relatório T9 é uma simulação pré-submissão.

## License

MIT License
