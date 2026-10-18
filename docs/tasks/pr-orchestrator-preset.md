Title: feat(agents): add default Orchestrator preset

The canonical Orchestrator now starts with a catalog-owned coordination preset instead of a separate hardcoded workflow. Its compact instructions delegate execution immediately, specify complete briefs, track workers, demand evidence before completion claims, and retain the user conversation. Classifier scores inform worker selection when available; they never imply capability or permission.

The additive seed migration follows the pulse preset pattern: add once, record history before the catalog, preserve existing definitions and v1 files, and respect catalog capacity. Full catalogs retain all agents and use the portable built-in instructions until a slot is available on a later load. Corrupt catalogs remain untouched. The launch keeps the selected Claude Code, Codex or Cursor engine/model/effort.

Editing uses the existing v2 preset semantics: a user-locked behavioral version on the same identity, with the original seed retained in history. It is not a new-ID fork. New coordinator chats use the edited version; existing chat snapshots stay frozen. Legacy coordinators without a catalog snapshot receive the shared built-in instructions. App-specific update/approval boundaries remain composed around the editable prompt. Ordinary worker launches of this preset are rejected because workers do not have coordinator tools.

Design sources, read 2026-10-18:

- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): simple orchestrator-worker decomposition, synthesis and evidence-driven verification.
- [Anthropic: Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system): bounded delegation with objectives, output expectations, tool boundaries and proportional effort. Applied here without copying research-specific execution assumptions.
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) and [OpenAI AGENTS.md conventions](https://learn.chatgpt.com/docs/agent-configuration/agents-md): focused contexts and explicit repository instructions. Workers receive self-contained briefs and read applicable local rules.
- [OpenAI: A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf): the manager owns user interaction and delegates specialized work. This preset hands off tasks without transferring ownership of the user conversation.

Validation: targeted catalog, migration, version, manifest, setup and ChatManager tests; ESLint on touched TypeScript; fresh-context correctness/security/UX review. The review caught and verified the fix for worker launches. Full TypeScript checking is blocked by missing highlight.js modules in untouched src/renderer/brain/lib/file-format.ts. No build, e2e, commit or push attempted under task constraints. Runtime visual validation and the integration gate remain for the integrator.

The agreed fork-on-edit behavior arrives with .sbagent. This branch deliberately uses the base catalog's existing save path; it introduces no Orchestrator-specific edit semantics. When integrating .sbagent, use its common preset fork flow and update the preset-edit tests to that shared contract. Ensure the customized coordinator remains the selected default if the shared fork flow changes its identity.

Integration: agent-catalog changes no main-process catalog code. agent-classifier adds discovery scores; this prompt uses them when exposed. The pulse branch touches adjacent constructor seed code: retain both additive migrations. Once its routable field lands, mark default-orchestrator non-routable in seeding/restoration and filter it from worker suggestions; the launch guard already enforces the boundary. No shared contract, wiring or bootstrap changes here.
