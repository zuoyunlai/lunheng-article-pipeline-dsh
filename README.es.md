# Lunheng (lunheng-article-pipeline) — pipeline multiagente para textos largos

> 版本：v18.0.4（DSH bundle：package.json + cordis.patch.yml + lib/index.js）

> Un bundle de DeepSeek Harness (DSH) que registra una skill de agente bajo demanda. La skill convierte la producción de textos largos —artículos académicos, análisis sectorial, comentario económico y artículos extensos— en una **pipeline de 9 roles con intervención humana**.

## What this is

Lunheng es una pipeline de escritura, no un generador de texto. Divide la producción de un texto largo en 9 roles independientes (T1–T9) a lo largo de 6 fases, orquestados con llamadas `subagent` de DSH, y entrega un resultado con base probatoria, revisión de contraargumentos, auditoría independiente y puntos de control humanos.

Los nueve roles son independientes y no sustituibles: T1 búsqueda bibliográfica, T2 búsqueda de datos, T3 búsqueda de casos, T4 análisis, T5 redacción, T6 compañero crítico, T7 auditoría, T8 verificación final (la ejecuta el propio coordinador), T9 revisión por pares.

## When to use it

- Necesita un texto extenso (más de 2000 caracteres) que resista escrutinio y puede esperar de 1 a 3 horas.
- El tema implica hechos, cifras o múltiples puntos de vista, por lo que requiere una base probatoria y no solo opinión.
- Desea puntos de control humanos: confirmar el esquema antes de redactar y revisar el borrador final.

## When not to use it

Lunheng recopila **evidencia publicada** e integra la evidencia que usted aporte. No puede producir lo siguiente por sí sola; aporte el material primero o use otra herramienta:

- **Recolección de datos de primera mano** — experimentos, encuestas, entrevistas, trabajo de campo.
- **Análisis estadístico** — puede citar resultados, pero no ejecuta SPSS/R/Python.
- **Recolección de datos brutos para gráficos** — renderiza visualizaciones; el scraping, OCR y la transcripción necesitan herramientas dedicadas.
- **Imágenes o vídeo originales** — DSH no incluye generación de imágenes; las portadas usan SVG local o archivos aportados.
- **Ejecución de código** — la pipeline solo ejecuta scripts autorizados; cualquier otra cosa requiere su aprobación explícita.

Regla práctica: pregunte si la evidencia ya está **publicada**. Si lo está, Lunheng la recopila. Si no, apórtela primero.

## What you get

| Elemento | Contenido |
|---|---|
| Fichas bibliográficas `[Lxx]` | Fuentes publicadas con grado de confianza A/B/C y lista de precursores |
| Fichas de datos `[Dxx]` | Cifras con fuente, año, vigencia, nivel de confianza y cifras en conflicto lado a lado |
| Fichas de casos `[Cxx]` | Estructura del evento (quién/cuándo/qué/versión de cada parte), o marcador explícito `[C-空]` |
| Esquema de análisis | Hilo argumental, mapeo afirmación-evidencia, plan de contraargumentos, evidencia portante |
| Borradores | Versiones sucesivas con limpieza de huellas de IA, cada una de un redactor independiente |
| Informes | Informe crítico (C1–C7), auditoría (G0–G14), revisión por pares (6 dimensiones + revistas) |
| Entregables finales | `final/定稿.md`, figuras, paquete probatorio, notas de entrega, informe de la puerta M |

## Pipeline overview

```text
Fase 0  Tema          Confirmar tema, extensión, formato de citas; consentimiento de servicios externos
Fase 1  Búsqueda      T1 bibliografía ∥ T2 datos ∥ T3 casos (paralelo real e independiente)
Puerta T2.5           Entradas de datos ≥ requisito del brief; niveles de confianza completos
Fase 2  Análisis      T4 analista → esquema de análisis
Fase 2.5 Esquema      Revisión humana (en el circuito)
Fase 3  Redacción     T5 redactor → borrador v1
Fase 3.5 Perspectiva  El humano aporta contexto de primera mano (en el circuito) → borrador v2
Fase 3.6 Crítica      T6 compañero crítico → informe C1–C7
Fase 4  Auditoría     T7 auditor → informe G0–G14 y lista de revisión
Fase 4.2 Revisión     Redactor + notas de revisión (≤2 rondas, redactor independiente)
Fase 4.5 Revisión     T9 revisión por pares + puerta G14 de huellas de IA (en paralelo); figuras
Puerta T7.5           Auditoría más reciente + lista P0/P1 + puerta M exit 0 + aislamiento
Fase 5  Verificación  T8 (lo ejecuta el coordinador) → texto final, paquete probatorio, notas de entrega
```

**Base probatoria triangular** (`[L]` + `[D]` + `[C]`) — toda afirmación debe mapear a bibliografía, datos y, para afirmaciones sobre eventos, casos. **Auditoría independiente** — quien audita nunca edita. **Cuatro puntos humanos** — fases 0, 2.5, 3.5 y 5.

## Repository layout

```text
lunheng-article-pipeline/                 # el paquete es el repositorio
├── package.json              # declara main (lib/index.js) + dsh.bundle.patch
├── cordis.patch.yml          # capa bundle: inserta las 3 herramientas subagent por nivel
├── lib/index.js              # entrada del plugin: registra la skill vía ctx.skills
├── skills/lunheng-article-pipeline/       # el cuerpo de la skill (un directorio)
│   ├── SKILL.md              # entrada de la skill (roles, puertas, límites de ejecución)
│   ├── AGENTS.md             # manual del operador
│   ├── QUICKSTART.md         # inicio en cinco minutos
│   ├── README.md             # readme de la skill (chino)
│   ├── references/           # 9 fichas de rol, plantillas, algoritmos de puerta, base de revistas
│   └── scripts/              # 11 scripts .mjs de verificación sin dependencias
├── scripts/                  # puertas del repositorio: superficie de empaquetado + higiene
├── tests/                    # suites node --test (scripts + humo de la entrada)
├── docs/                     # instalación, uso, arquitectura, faq, resolución de problemas
├── examples/preset/          # notas de niveles de modelo y guía de instalación
├── README.md                 # fuente en inglés
├── README.zh.md README.es.md README.pt.md README.hi.md
├── SECURITY.md CHANGELOG.md CONTRIBUTING.md LICENSE
```

La entrada del plugin registra `skills/lunheng-article-pipeline/SKILL.md` como skill con `resourceBase` apuntando a ese directorio, de modo que `references/**` y `scripts/**` se resuelven relativos a él desde cualquier directorio de trabajo.

La capa patch hace dos cosas: **inserta una fila para este paquete** (`- id: lunheng-article-pipeline` / `name: lunheng-article-pipeline`) — esa fila es la que hace que el loader importe `lib/index.js`, que es lo que registra la skill — e inserta las tres herramientas subagent por nivel. **Esa fila es portante**: sin ella la entrada nunca se importa y la skill no aparece (defecto de v18.0.0, corregido en 18.0.1; vigilado por `tests/bundle-contract.test.mjs`).

### Documentation

`docs/installation.md` (instalación y verificación) · `docs/usage.md` (flujo de uso) · `docs/architecture.md` (arquitectura) · `docs/introduction.md` (introducción) · `docs/faq.md` (preguntas frecuentes) · `docs/troubleshooting.md` (síntoma → causa → solución) · `SECURITY.md` (límite de confianza) · `CHANGELOG.md` · `CONTRIBUTING.md`.

### Publishing (maintainers)

Las versiones se publican **solo por tag**; `npm publish` local está prohibido (evita las puertas de CI y la procedencia OIDC, y una versión npm nunca se puede sobrescribir).

```sh
git tag v18.0.4 && git push origin v18.0.0   # un tag por push (GitHub: >3 tags en un push no dispara workflow)
# publish.yml ejecuta: puerta 1 consistencia → puerta 2 empaquetado → puerta 3 higiene → tests
#   → tag/versión iguales → guarda de idempotencia → OIDC publish --provenance --tag dsh → auditoría posterior
```

## Install

**Como bundle** (recomendado; la entrada registra la skill y la capa patch activa los niveles):

```sh
dsh plugin --profile web add lunheng-article-pipeline
dsh --profile web --dump-config   # muestra una capa "# == lunheng-article-pipeline"
```

Un `dsh` moderno añade la dependencia a `dsh.profile.bundles` en cuanto ve la declaración `dsh.bundle`: instale y reinicie `dsh web`. Solo las instalaciones npm/pnpm puras o las versiones antiguas necesitan la entrada manual.

**Como directorio de skill simple** (sin instalación, recarga en caliente):

```sh
# Copie el DIRECTORIO DE LA SKILL (no la raíz del repositorio) en cualquier raíz de skills:
#   $DSH_HOME/skills/lunheng-article-pipeline        (usuario, rank 400)
#   <proyecto>/.dsh/skills/lunheng-article-pipeline  (proyecto, rank 100)
```

Un directorio simple no declara `dsh.bundle`, así que `dsh plugin add` solo lo instala como dependencia y no activa ninguna capa. Copiar el directorio de la skill es la vía soportada.

### Requirements

| Elemento | Requisito |
|---|---|
| DSH | CLI `dsh` disponible; las filas `- insert:` necesitan DSH 5.5.0+ |
| Node | `^22.19.0 \|\| >=24.0.0` (mínimo de DSH; ver `engines` en `package.json`) |
| pnpm | Necesario para instalar/desinstalar (`dsh plugin` delega en pnpm) |
| Plataforma | Windows / macOS / Linux (scripts sin dependencias) |

### Uninstall

```sh
dsh plugin --profile <profile> remove lunheng-article-pipeline
```

Al desinstalar desaparecen las 3 filas `- insert:` y la skill registrada por la entrada, sin residuos. Si además copió el directorio de la skill en una raíz de skills, bórrelo aparte.

## Model routing

DSH enruta modelos mediante `settings.yaml`; `subagent` hereda el modelo de la sesión, de modo que una configuración de un solo modelo funciona sin ajustes. Para escalonar por rol, el bundle instala tres herramientas por nivel:

| Herramienta | Roles | Capacidad |
|---|---|---|
| `subagent_retrieval` | T1 bibliografía / T2 datos / T3 casos | Rápido y económico |
| `subagent_strong` | T4 análisis / T5 redacción | Razonamiento fuerte |
| `subagent_audit` | T6 crítica / T7 auditoría / T9 revisión / detector G14 | Máximo nivel, sin degradar por coste |

Sobrescriba con `LUNHENG_{RETRIEVAL,STRONG,AUDIT}_PROVIDER` y `LUNHENG_{RETRIEVAL,STRONG,AUDIT}_MODEL`: proveedor y modelo son campos independientes (cruzar proveedores exige ambos) y `LUNHENG_TIERING=off` devuelve los tres niveles a la herencia. Cuando una herramienta de nivel no está montada, el envío recae en `subagent`. Véase `examples/preset/README.md` y `docs/installation.md`.

## Data and external services

La pipeline envía lo siguiente a terceros:

| Operación | Contenido enviado | Destinatario |
|---|---|---|
| `web_search` / `web_fetch` | Palabras clave y URL de destino | Los proveedores de búsqueda y lectura configurados en DSH |
| Inferencia del modelo | Fichas bibliográficas, de datos y de casos; esquemas; borradores | El proveedor de modelo activo |
| Generación de imágenes (opcional, desactivada) | Tema y prompt de marca | Un MCP de imágenes, solo si usted lo habilita |

El coordinador debe divulgar estos envíos y obtener consentimiento explícito en la fase 0. Para temas confidenciales: anonimice el texto, mantenga las portadas como SVG local (cero llamadas externas) y elija un endpoint de modelo local. Rechazar cualquier elemento devuelve la ejecución a la fase 0.

## Verification status

| Artículo | Escala | Resultado |
|---|---|---|
| Consistencia de marca (2026-08) | ~7900 caracteres, 15 fuentes + 54 datos | Paquete probatorio; 8 hallazgos cerrados |
| Paradoja de originalidad (2026-08) | ~9500 caracteres, 12 fuentes + 34 datos + 6 casos | 4 rondas de revisión, nota A-, publicado |
| Aislamiento del campo docente (2026-08) | ~12000 caracteres, 18 fuentes + 47 datos + 9 casos | Auditoría ronda 2 aprobada |
| Escritura estudiantil con IA generativa (2026-08) | ~2000 caracteres, 12 fuentes + 26 datos | Búsqueda triple paralela; puerta M exit 0 |
| Caso de la col china con formaldehído (2026-08) | ~4200 caracteres, 12 fuentes + 29 datos + 4 casos | Puerta M exit 0; 6 reglas incorporadas |
| Artículo sobre noción e idea (2026-09) | ~6280 caracteres, 18 fuentes + 15 datos, 0 casos | 2 rondas de auditoría, 23/30 revisión menor, P0 real = 0 |

## Known limitations

- **Prioridad del chino.** Prompts de rol, entregables, nombres de archivo y flujos están en chino por defecto.
- **Sin verificación de red por defecto.** Las comprobaciones numéricas suelen quedar «pendientes de revisión manual» porque las fuentes de pago no se pueden recuperar.
- **La independencia de la auditoría tiene coste.** Una ejecución completa lanza más de 15 subagentes; el gasto se concentra en lecturas de contexto.
- **La puerta M puede dar falsos positivos.** El verificador debe registrar `script_exit_raw` y justificar el veredicto `exit` en lugar de editar el documento para forzar exit 0.
- **No sustituye la revisión real.** El informe T9 es una simulación previa al envío.

## License

MIT License
