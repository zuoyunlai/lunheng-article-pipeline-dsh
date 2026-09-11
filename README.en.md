# Lunheng (lunheng-article-pipeline) — a DeepSeek Harness bundle plugin

A multi-agent pipeline skill package for **long-form serious writing** (academic papers, business commentary, industry analysis, in-depth articles), shipped as a **DeepSeek Harness (`dsh`) bundle plugin**.

> 中文文档：[`README.md`](README.md)

It splits the production of a long article / paper into **9 independent, non-substitutable roles T1–T9** (literature / data / case retrieval, analysis, writing, critique, audit, final check, peer review). The orchestrator is **T0** and also *performs* **T8 final check** (T8 is its own role but is executed by the orchestrator, which does not spawn a subagent for it); **T9 peer review** is optional, selected by default, and mandatory for academic papers.

Phase 1 runs three retrieval agents **T1 literature ∥ T2 data ∥ T3 cases truly in parallel**; T3 always spawns (including an explicit "0 cases" empty-card protocol). T6 attacks the argument from the opposing side, T9 adds peer review plus journal matching, and delivery is gated by an independent **G0–G14 audit** (including the **G14 Chinese AI-trace gate**) and the mechanical **M-Gate** (M-Form 11 / M-Exist 10 / M-Integrity 2). Orchestration uses the dsh `subagent` tool. Output is a deliverable with an **evidence base, counter-arguments, an independent audit trail and human checkpoints**.

> Version: v17.0.0 (DSH-native plugin).

## Install (on the target machine)

```sh
# 1) Install into a profile (recommended)
dsh plugin --profile web add lunheng-article-pipeline
#    Recent dsh versions (reconcilePlugins) automatically add any dependency that
#    declares dsh.bundle to dsh.profile.bundles — no manual edit needed.
#    Restart dsh web afterwards.

# 2) Only for plain npm/pnpm installs (bypassing `dsh plugin`) or older dsh builds,
#    add the bundle manually in $DSH_HOME/profiles/web/package.json:
#    "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "lunheng-article-pipeline"] } }

# 3) Restart dsh web
```

After installation the skill appears in the session's `skill` tool catalogue automatically — no copying into a skill root is required.

## Contents

- `skills/lunheng-article-pipeline/` — the skill itself (`SKILL.md` + `AGENTS.md` + `references/`: 10 role cards, templates, shared mechanisms (M-Gate / failure modes / journal matching / G14 gate), the operations manual and design docs)
- `cordis.patch.yml` — the bundle patch: registers a filesystem skill provider pointing at the packaged `skills/`

## Data charts (SVG, fully local)

The writer only marks figure slots (`[图N：标题]`, on its own line) → in Phase 4.5 the orchestrator **hand-writes SVG** into `final/图件/图N_标题.svg` (the only supported path; **text-to-image is forbidden** because numbers must be exact) → export with `node scripts/md2html.mjs <final.md> <out.html> --fig-dir final/图件`, or via pandoc + rsvg-convert.

- **Mechanical gate**: M-Gate **M-Form-9 figure closure** (run automatically by `scripts/m-gate-check.mjs`) reconciles figure slots ↔ figure files ↔ numbers printed in the chart — missing figure / too few slots → P1·P0; orphan files, numbers with no source in the data cards, SVG safety warnings → P2 notes; when charts are unused the item is recorded as N/A (never a failure).
- **Pre-export validation**: structurally invalid SVG (unclosed tags / no `viewBox` / DTD·ENTITY) → export **exits 2 and writes no HTML**; `<script>`, `on*`, `javascript:` and external references are stripped with warnings; a missing figure renders an explicit placeholder including the expected filename.
- **Visibility**: figure files are copied into `证据包/图件/` and the audit view carries a figure reconciliation section, so T7/T8 never have to open them one by one.

## Per-role model tiers (optional, adaptive)

**Single-model setups need zero configuration** — every role inherits the session model. If you have several models and want tiering by role capability (cheap-and-fast retrieval / strong reasoning for analysis & writing / top-tier for audit), the bundle already inserts three subagent tools:

| Tool | Roles | Intent | Default provider/model (overridable) |
|---|---|---|---|
| `subagent_retrieval` | T1 literature / T2 data / T3 cases | cheap & fast | inherits parent session (tiering only if `LUNHENG_RETRIEVAL_*` is set) |
| `subagent_strong` | T4 analysis / T5 writing / T6 critique / T9 review | strong reasoning | inherits parent session (`LUNHENG_STRONG_*`) |
| `subagent_audit` | T7 audit / G14 detection | top-tier, catches omissions | inherits parent session (`LUNHENG_AUDIT_*`) |

```sh
# Tiering is active as soon as the bundle is installed (no preset directory to copy —
# examples/preset/ is documentation only and contains no loadable agent.cordis.yml).

# To change models, set environment variables and restart dsh (evaluated once at mount time)
#    ⚠️ provider and model are separate: model is a bare id, provider must be given explicitly
#    ⚠️ setting MODEL without PROVIDER is silently ignored — that tier keeps inheriting the session model
export LUNHENG_AUDIT_PROVIDER=deepseek-official
export LUNHENG_AUDIT_MODEL=deepseek-v4-pro
dsh web
```

Without any tiering configuration the skill falls back to `subagent` and every role inherits the session model. See `examples/preset/README.md` and `docs/installation.md`.

## Verify

```sh
dsh --profile web --dump-config   # should show the skill-filesystem-lunheng row
# then start a new session; the skill catalogue should list lunheng-article-pipeline
```

## Requirements

| Item | Requirement |
|---|---|
| DSH | `dsh` CLI available (the bundle's incremental `- insert:` patch needs DSH 5.5.0+) |
| Node | `^22.19.0 \|\| >=24.0.0` (the DSH runtime floor; see `engines` in `package.json`) |
| pnpm | required by install/uninstall (`dsh plugin` delegates to pnpm) |
| Platform | Windows / macOS / Linux (the bundled scripts are dependency-free and cross-platform) |

## Uninstall

```sh
dsh plugin --profile <profile> remove lunheng-article-pipeline
```

Removing the package removes all four `- insert:` rows from `cordis.patch.yml` — the skill provider and the three subagent tools disappear together, with no leftover rows.
If you previously copied the skill directory into a skill root (`.dsh/skills/` or `.agents/skills/`), delete that copy separately.

## Data flow & disclaimer

- **Leaves the machine**: retrieval keywords and target URLs are sent to the search provider configured in DSH (e.g. DeepSeek's `web_search`). Phase 0 has an explicit "choose 1 of 4" consent gate; declining any outbound item means the plan is revised and Phase 0 is redone.
- **Stays local**: file-based memory (`memory/*.md`, `references/memory/lessons.md`) and all bundled scripts (zero network calls); PDF/HTML export are local steps.
- **Your manuscript**: project names, topics and outlines may contain unpublished information — redact sensitive subjects, prefer the locally generated SVG cover, and only supply first-hand material you are allowed to share. **You are the data controller.**
- **AI disclosure**: the pipeline emits an AI-usage statement in its deliverables (academic submissions add a dedicated "AI usage" section); generation method is never concealed.
- **Warranty**: this software is provided "as is" under the MIT licence, without warranty of any kind; correctness, compliance and citation accuracy of the output remain the user's responsibility.
- **Security**: the trust boundary at install time (including load-time `!!js` evaluation) is documented in [`SECURITY.md`](SECURITY.md).

## Publishing (maintainers)

> **Release by pushing a tag — never run `npm publish` locally** (since v2.5.2-dsh.13).
> A local publish bypasses CI's gates and the OIDC provenance attestation, and npm versions cannot be overwritten.

```sh
git tag vX.Y.Z && git push origin vX.Y.Z   # push ONE tag at a time (GitHub runs no workflow when >3 tags are pushed at once)
# publish.yml then runs: gate 1 consistency → gate 2 packaging surface → gate 3 mechanical hygiene → script regression tests
#   → tag/version match → idempotency guard (skip if already published) → OIDC publish --provenance --tag dsh → post-publish audit (gitHead/dist-tags)
```

Local pre-flight (same gates):

```sh
node skills/lunheng-article-pipeline/scripts/consistency-check.mjs
node scripts/plugin-surface-check.mjs
node scripts/repo-hygiene-check.mjs
node --test "tests/**/*.test.mjs"
```

## Documentation

- `docs/installation.md` — install & verify (Chinese)
- `docs/usage.md` — workflow and artifact layout
- `docs/architecture.md` — architecture (9 roles, triangle verification, G0–G14 audit, M-Gate)
- `docs/introduction.md` — plugin introduction
- `docs/faq.md` — FAQ
- `docs/troubleshooting.md` — install/verify troubleshooting (symptom → cause → fix)
- `SECURITY.md` — security policy and trust boundary
- `CHANGELOG.md` — version history
- `CONTRIBUTING.md` — maintenance and sync guide

## License

MIT — see `LICENSE`.
