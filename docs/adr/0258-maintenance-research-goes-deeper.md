# ADR 0258 · The maintenance research goes deeper: 20 $ cap, extra-high effort, a quality bar for every card

Date: 2026-11-10 · Status: accepted (owner, 2026-11-10: «Aumenta il tetto della manutenzione deve essere proprio
efficace e proporre card veramente utili») · Changes: the default cap of 2026-10-23 (5 $) · Builds on: ADR 0257

## Context
Since ADR 0257 the research reads every chat and work thread since the previous pass, plus the noted lessons, and is
the only source of skill changes. With a 5 $ cap and one hour it could not read that much in depth, and Davide wants
fewer, really useful cards.

## Decision
- **Budget** (`shared/maintenance-research.ts`, `brainmodel/research.ts`): the click's research gets a 20 $ cap
  (`RESEARCH_CAP_USD`, the allowed range stays 0.5-50 $), two hours before the app stops it (`RESEARCH_MAX_MS`) and the
  extra-high effort (`xhigh`) where the engine has an effort setting, with the engine's strongest model as before.
- **Quality bar** (`brainmodel/research-prompt.ts`): before each card the model checks five questions and drops the
  card unless all are yes: evidence seen at least twice with ids; a difference the user would notice in his next week;
  specific to this user and his agents; not already said by a skill, a rule, me.md or a past card; the smallest change
  that fixes it. Seven cards is a ceiling, not a target. The budget line asks to spend it on reading the evidence of
  each candidate card in full instead of reading everything.
- The Guida, the Maintenance help text (it, en, de) and the README say 20 $.

## Consequences
- One click can cost up to 20 $ (the end notice says what it spent). Fewer cards per pass are expected.
