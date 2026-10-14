# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This repo uses the **single-context** layout, but both artifacts live **outside** the conventional root paths — read the two pointers below before looking for root files:

- **Domain glossary**: `skills/lunheng-article-pipeline/references/glossary.md` (the repo's declared "核心概念单一真源"). There is **no** root `GLOSSARY.md`, and one must **not** be created: a second glossary would break the repo's single-home rule, and no gate can reconcile two glossaries.
- **Architecture decisions**: `audits/decisions/ADR-0001..N` (+ `ADR-template.md`). This repo does **not** use `docs/adr/` — the placement and its reason (`audits/` sits outside the doc word-budget ratchet) are recorded in `skills/lunheng-article-pipeline/references/maintainers.md` §十三.

(No `GLOSSARY-MAP.md`, no per-context `GLOSSARY.md` / `docs/adr/` sub-trees.) `CONTEXT.md` and `CONTEXT-MAP.md` are created lazily by `/domain-modeling` when terms or decisions actually get resolved.

## Before exploring, read these

- **`skills/lunheng-article-pipeline/references/glossary.md`** — the repo's single domain glossary; read the sections relevant to your topic.
- **`audits/decisions/`** — read the ADRs that touch the area you're about to work in. This repo does **not** use `docs/adr/` (see Layout above).

If `CONTEXT.md` / `CONTEXT-MAP.md` don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved. The two artifacts listed above **do** exist and are not optional reading.

## File structure

The trees below are the **generic** upstream layouts (shown for orientation only — this repo uses neither):

Single-context repo (most repos):

```
/
├── GLOSSARY.md                        ← not used in this repo (see Layout above)
├── docs/adr/                          ← not used in this repo (see Layout above)
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context repo (presence of `GLOSSARY-MAP.md` at the root — not this repo):

```
/
├── GLOSSARY-MAP.md                    ← not used in this repo
├── docs/adr/                          ← system-wide decisions (not used in this repo)
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `skills/lunheng-article-pipeline/references/glossary.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts `audits/decisions/ADR-0006` (long-sentence-ratio threshold), but worth reopening because…_
