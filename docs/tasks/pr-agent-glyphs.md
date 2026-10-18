Title: feat(agents): designed agent icon set and AgentAvatar (A3)

<!-- Reviewable change description and outstanding gates for the role-glyph worktree. -->

## Summary

Agent Studio now offers 24 dedicated duotone role glyphs, ten category tones, category-aware unused-tone suggestions, and a non-blocking warning when another agent uses the same glyph and tone. Selections use the existing validated symbol/tone persistence boundary; no SVG enters catalog data. Legacy IDs still render their existing icons, so presets do not change before approval.

## What changed

The set includes ten preset-role proposals and fourteen common-role motifs, with rounded strokes, smaller-size simplification and optical weights for 16/20/28/40 px. A trusted registry, fallback renderer, round theme-aware badges and reproducible approval sheets accompany the editor. Uploaded raster avatars remain supported and are cropped round.

Approval required: Brother must approve the sheets in `docs/screenshots/agent-icons/` before presets adopt these glyphs. The SVG proposals are generated; PNG screenshots and visual review are pending because Playwright was blocked by sandbox EPERM creating its temporary directory. The app was not launched, as required by the task brief.

## Tests

- Integrator run on this branch (rebased on origin/main 2e34ff7): `npx tsc --noEmit` clean, `npx eslint .` clean, `npx vitest run`: 2618 passed; the five failures were environmental (timing under load, Electron binary not yet downloaded, local untracked `tmp/` seen by the working-tree guard) and pass when rerun in isolation together with `test/unit/agent-glyphs.test.ts`.
- Sheet generation and computed contrast: minimum 5.19:1 outline/badge and 4.11:1 badge/background across ten tones, both themes and interpolated stops on standard surfaces.
- `test/e2e/agent-glyphs.spec.ts` adds save, duplicate-warning, tone and draft-navigation screenshots; e2e runs only on main (ADR 0027).
- Integrator review of the full diff: the symbol allowlist stays the persistence boundary (`AGENT_SYMBOLS` in `src/main/agents/catalog.ts`), unknown IDs fall back to the spark, no SVG enters catalog data, category is validated by the catalog.

Approval still required: Brother approves the sheets in `docs/screenshots/agent-icons/` (SVG; PNG screenshots not generated) before presets adopt these glyphs.

No new runtime dependencies.
