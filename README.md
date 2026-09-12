# Lunheng (lunheng-article-pipeline) — a DeepSeek Harness bundle for multi-agent long-form writing

> 🌐 **English** (this file) ｜ [中文](README.zh.md) ｜ [Español](README.es.md) ｜ [Português](README.pt.md) ｜ [हिन्दी](README.hi.md)

> 版本：v18.0.4（DSH bundle：package.json + cordis.patch.yml + lib/index.js）

> A DeepSeek Harness (DSH) bundle that registers one on-demand agent skill. The skill turns long-form production — academic papers, industry analysis, business commentary, and long-form articles — into a **9-role pipeline with a human in the loop**.

## What this is

Lunheng is a writing pipeline, not a text generator. It splits a long-form deliverable into 9 independent roles (T1–T9) across 6 phases, orchestrated with DSH `subagent` calls, and produces output with an evidence base, counter-argument review, independent audit, and human checkpoints.

The nine roles are independent and interchangeable with nothing else: T1 literature scout, T2 data scout, T3 case scout, T4 analyst, T5 writer, T6 critical companion, T7 auditor, T8 finalizer (executed by the coordinator itself), T9 peer reviewer.

## When to use it

- You need a long-form piece (over 2000 characters) that has to hold up under scrutiny, and you can wait 1–3 hours.
- The topic involves facts, figures, or multiple viewpoints, so it needs an evidence base rather than opinion only.
- You want human checkpoints: confirm the outline before drafting, and review the final draft.

## When not to use it

Lunheng actively collects **published** evidence and integrates evidence you supply. It cannot produce the following on its own; supply the material first, or use another tool:

- **First-hand data collection** — experiments, surveys, interviews, field work.
- **Statistical analysis** — it can cite results but does not run SPSS/R/Python.
- **Raw chart data collection** — it renders data visualizations; scraping, OCR, and speech-to-text need dedicated tools.
- **Original images or video** — DSH has no built-in text-to-image. Covers fall back to local SVG or supplied files.
- **Code execution** — the pipeline runs only whitelisted scripts; anything else needs your explicit approval.

Rule of thumb: ask whether the evidence is already **published**. If yes, Lunheng collects it. If not, supply it first.

## What you get

| Item | Content |
|---|---|
| Literature cards `[Lxx]` | Published sources with A/B/C confidence grading and a pioneer list for originality checks |
| Data cards `[Dxx]` | Figures with source, year, freshness grading, trust level, and conflicting figures shown side by side |
| Case cards `[Cxx]` | Event structure (who/when/what/each side's account), or an explicit `[C-空]` empty marker |
| Analysis outline | Argument thread, claim-to-evidence mapping, counter-argument plan, load-bearing evidence list |
| Drafts | Successive versions with AI-trace cleanup, each independent writer run |
| Review reports | Critical report (C1–C7), audit report (G0–G14), peer-review report (6 dimensions + journal matching), AI-trace report |
| Final deliverables | `final/定稿.md`, figures, evidence bundle, delivery notes, M-gate report |

## Pipeline overview

```text
Phase 0  Topic        Confirm topic, length, citation format; external-service consent
Phase 1  Retrieval    T1 literature ∥ T2 data ∥ T3 cases (true parallel, independent)
Gate T2.5             Data entries ≥ brief requirement; trust levels complete
Phase 2  Analysis     T4 analyst → analysis outline
Phase 2.5 Outline     Human review (in the loop)
Phase 3  Writing      T5 writer → draft v1
Phase 3.5 Insight     Human supplies first-hand context (in the loop) → draft v2
Phase 3.6 Critique    T6 critical companion → C1–C7 report
Phase 4  Audit        T7 auditor → G0–G14 audit report and revision task list
Phase 4.2 Revision    Writer revision + revision notes (≤2 rounds, independent writer)
Phase 4.5 Review      T9 peer review + G14 Chinese AI-trace gate (in parallel); figures
Gate T7.5             Latest audit + P0/P1 list + M-gate exit 0 + report isolation
Phase 5  Finalize     T8 finalizer (run by the coordinator) → final draft, evidence bundle, delivery notes
```

**Triangular evidence base** (`[L]` + `[D]` + `[C]`) — every claim must map to literature, data, and (for event claims) case evidence. **Independent audit** — the auditor never edits; it reports. **Four human checkpoints** — Phase 0, 2.5, 3.5, and 5.

## Repository layout

```text
lunheng-article-pipeline/                 # the package is the repository
├── package.json              # declares main (lib/index.js) + dsh.bundle.patch
├── cordis.patch.yml          # bundle layer: inserts the 3 model-tier subagent tools
├── lib/index.js              # plugin entry: registers the skill through ctx.skills
├── skills/lunheng-article-pipeline/       # the skill body (one directory)
│   ├── SKILL.md              # skill entry (roles, gates, execution boundaries)
│   ├── AGENTS.md             # operator manual
│   ├── QUICKSTART.md         # five-minute start
│   ├── README.md             # skill-level readme (Chinese)
│   ├── references/           # 9 role cards, templates, shared gate algorithms, journal database
│   └── scripts/              # 11 zero-dependency .mjs verification scripts
├── scripts/                  # repository gates: packaging surface + mechanical hygiene
├── tests/                    # node --test suites (scripts + plugin entry smoke)
├── docs/                     # installation, usage, architecture, faq, troubleshooting
├── examples/preset/          # model-tier notes and install guide
├── README.md                 # this file (English source)
├── README.zh.md README.es.md README.pt.md README.hi.md
├── SECURITY.md CHANGELOG.md CONTRIBUTING.md LICENSE
```

The plugin entry registers `skills/lunheng-article-pipeline/SKILL.md` as a skill whose `resourceBase` is that directory, so `references/**` and `scripts/**` resolve relative to it from any working directory.

The patch layer does two things: it **inserts one row for this package** (`- id: lunheng-article-pipeline` / `name: lunheng-article-pipeline`) — that row is what makes the loader import `lib/index.js`, which is what registers the skill — and it inserts the three model-tier subagent tools. **That self row is load-bearing**: without it the entry is never imported and no skill appears (the v18.0.0 defect fixed in 18.0.1; guarded by `tests/bundle-contract.test.mjs`).

### Documentation

| File | Content |
|---|---|
| `docs/installation.md` | Install and verify |
| `docs/usage.md` | Usage flow (phases and artifact structure) |
| `docs/architecture.md` | Architecture (9 roles, triangular evidence, G0–G14 audit, M-gate) |
| `docs/introduction.md` | Plugin introduction |
| `docs/faq.md` | Frequently asked questions |
| `docs/troubleshooting.md` | Install/verify troubleshooting (symptom → cause → fix) |
| `SECURITY.md` | Security policy and trust boundary |
| `CHANGELOG.md` | Version history |
| `CONTRIBUTING.md` | Maintenance and release guide |

### Publishing (maintainers)

Releases are **tag-only**; a local `npm publish` is forbidden (it would bypass the CI gates and OIDC provenance, and a published npm version can never be overwritten).

```sh
git tag v18.0.4 && git push origin v18.0.0   # push one tag at a time (GitHub: >3 tags in one push triggers no workflow)
# publish.yml then runs gate 1 consistency → gate 2 packaging surface → gate 3 hygiene → script tests
#   → tag/version equality → idempotency guard → OIDC publish --provenance --tag dsh → post-publish audit
```

## Install

**As a bundle** (recommended; the entry registers the skill and the patch layer activates the model tiers):

```sh
dsh plugin --profile web add lunheng-article-pipeline
dsh --profile web --dump-config   # shows the "# == lunheng-article-pipeline" layer
```

A modern `dsh` adds the dependency to `dsh.profile.bundles` automatically once it sees the `dsh.bundle` declaration — install and restart `dsh web`. Only plain npm/pnpm installs or older builds need the manual `dsh.profile.bundles` entry.

**As a plain skill directory** (no install, hot-reloaded):

```sh
# Copy the SKILL directory (not the repository root) into any DSH skill root:
#   $DSH_HOME/skills/lunheng-article-pipeline        (user scope, rank 400)
#   <project>/.dsh/skills/lunheng-article-pipeline   (project scope, rank 100)
```

A plain directory carries no `dsh.bundle` declaration, so `dsh plugin add` installs it only as a dependency and activates no layer. Copying the skill directory is the supported path.

### Requirements

| Item | Requirement |
|---|---|
| DSH | `dsh` CLI available; the bundle's `- insert:` incremental patch rows need DSH 5.5.0+ |
| Node | `^22.19.0 \|\| >=24.0.0` (DSH runtime floor; see `engines` in `package.json`) |
| pnpm | Required by install/uninstall (`dsh plugin` delegates to pnpm) |
| Platform | Windows / macOS / Linux (the scripts have zero dependencies and run cross-platform) |

### Uninstall

```sh
dsh plugin --profile <profile> remove lunheng-article-pipeline
```

Removing the bundle removes the 3 `- insert:` rows and the skill registered by the entry, leaving no residue. If you also copied the skill directory into a skill root, delete that copy separately.

## Model routing

DSH routes models through `settings.yaml`; `subagent` inherits the session model, so a single-model setup works with no configuration. To tier by role, the bundle installs three tiered tools:

| Tool | Roles | Capability |
|---|---|---|
| `subagent_retrieval` | T1 literature / T2 data / T3 cases | Cheap and fast |
| `subagent_strong` | T4 analyst / T5 writer | Strong reasoning |
| `subagent_audit` | T6 critical / T7 auditor / T9 reviewer / G14 detector | Top tier, no downgrade for cost |

Override with `LUNHENG_{RETRIEVAL,STRONG,AUDIT}_PROVIDER` and `LUNHENG_{RETRIEVAL,STRONG,AUDIT}_MODEL`. Provider and model are independent fields; crossing providers requires both. `LUNHENG_TIERING=off` forces every tier back to inheritance. When a tier tool is not mounted, dispatch falls back to `subagent`. See `examples/preset/README.md` and `docs/installation.md`.

## Data and external services

The pipeline sends the following to third parties:

| Operation | Content sent | Recipient |
|---|---|---|
| `web_search` / `web_fetch` | Search keywords, target URLs | The DSH-configured search and fetch providers |
| Model inference | Literature, data, and case cards; outlines; drafts | The active model provider |
| Text-to-image (optional, off by default) | Topic and brand prompt | An image MCP, only if you enable and configure one |

The coordinator must disclose these and obtain explicit consent at Phase 0. For confidential topics: anonymize wording, keep covers as local SVG (zero external calls), and select a local model endpoint. Refusing any item returns the run to Phase 0.

## Verification status

| Article | Scale | Key outcome |
|---|---|---|
| Brand-consistency article (2026-08) | ~7900 chars, 15 sources + 54 data points | Evidence bundle; 8 audit findings closed |
| Originality-paradox article (2026-08) | ~9500 chars, 12 sources + 34 data + 6 cases | 4 revision rounds, A- grade, published |
| Teacher-field isolation paper (2026-08) | ~12000 chars, 18 sources + 47 data + 9 cases | Audit round 2 passed; first consistency audit |
| Generative-AI student writing commentary (2026-08) | ~2000 chars, 12 sources + 26 data | Three-way parallel retrieval; M-gate exit 0 |
| Formaldehyde cabbage article (2026-08) | ~4200 chars, 12 sources + 29 data + 4 cases | M-gate exit 0; 6 back-feed rules merged |
| Notion vs. idea philosophy paper (2026-09) | ~6280 chars, 18 sources + 15 data, 0 cases | 2 audit rounds, 23/30 minor revision, M-gate true P0 = 0 |

Local gates: `node skills/lunheng-article-pipeline/scripts/consistency-check.mjs`, `node scripts/plugin-surface-check.mjs`, `node scripts/repo-hygiene-check.mjs`, `node --test "tests/**/*.test.mjs"`.

## Known limitations

- **Chinese-first.** Role prompts, deliverables, file names, and workflows default to Chinese.
- **No network verification by default.** Numeric-level source checks often remain "pending manual review" because paywalled and offline sources cannot be fetched.
- **Audit independence has a cost.** A full run dispatches 15+ subagents; most token spend is context reads, not generation.
- **M-gate false positives are possible.** A script can flag a legitimate construct; the finalizer must record `script_exit_raw` and justify the `exit` verdict rather than editing the document to force exit 0.
- **Not a substitute for peer review.** The T9 report is a pre-submission simulation only.

## License

MIT, see `LICENSE`.
