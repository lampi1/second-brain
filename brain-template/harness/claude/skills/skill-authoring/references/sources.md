# Sources of skill-authoring (read 2026-11-10) and the choices the app takes

Read this only to check or update the skill; a task that writes a skill needs SKILL.md alone.

## Sources
- Agent Skills specification, https://agentskills.io/specification (read 2026-11-10): SKILL.md with `name` (1-64,
  lowercase letters, digits, single hyphens, equal to the folder) and `description` (1-1024, what it does and when to
  use it, with keywords); optional `license`, `compatibility`, `metadata`, `allowed-tools` (experimental); optional
  `scripts/`, `references/`, `assets/`; progressive disclosure (metadata ~100 tokens at start, body under 5000 tokens
  when used, files on demand); SKILL.md under 500 lines; references by relative path, one level deep.
- Anthropic, Skill authoring best practices,
  https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices (read 2026-11-10): "Claude is
  already very smart", only add what it does not have; description in third person, what and when; degrees of
  freedom (exact scripts for fragile steps); body under 500 lines; references one level deep, a table of contents
  past 100 lines; one default instead of many options; consistent terms; no time-sensitive text; forward slashes;
  evaluations before long docs; no reserved words `anthropic`, `claude` in `name`.
- Claude Code skills, https://code.claude.com/docs/en/skills (read 2026-11-10): `.claude/skills/` in the project and
  `~/.claude/skills/`; extra keys (`when_to_use`, `disable-model-invocation`, `user-invocable`, `allowed-tools`,
  `paths`, `model`, `context`…); `${CLAUDE_SKILL_DIR}` = the skill's folder; description plus `when_to_use` cut at 1536
  characters in the skill listing, so the key use goes first.
- Anthropic skills repository, skill-creator, https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
  (read 2026-11-10): the description is the trigger, all "when to use" goes there, models tend to undertrigger so it
  may be a little pushy; test triggering with realistic should and should-not requests, near misses first.
- Cursor, https://cursor.com/docs/skills (read 2026-11-10): reads `.agents/skills/`, `.cursor/skills/`, and for
  compatibility `.claude/skills/` and `.codex/skills/`; `name` and `description` required, `name` equal to the folder;
  optional `paths`, `disable-model-invocation`, `metadata`; the agent picks a skill by its description.
- OpenAI Codex, https://learn.chatgpt.com/docs/build-skills (read 2026-11-10): reads `.agents/skills/` from the
  current folder up to the repository root and `~/.agents/skills/`; `name` and `description` required; name and
  description loaded at start within about 2% of the context window, descriptions shortened first when there are many.

## Where they disagree, and the app's choice
- **Naming**: Anthropic suggests gerunds (`processing-pdfs`), the spec's examples are nouns (`pdf-processing`). The app
  keeps whatever kebab-case name the brain already uses; consistency within the brain wins.
- **Extra frontmatter keys**: Claude Code and Cursor each read their own (`when_to_use`, `paths`…), others ignore them.
  Brain skills keep `name`, `description` and `metadata` only, so every engine picks them the same way.
- **Description length**: the spec allows 1024 characters, Claude Code cuts its listing at 1536 (with `when_to_use`),
  Codex shortens descriptions when many skills share its budget. The app keeps 1024 and puts the key use first.
- **"Pushy" or terse**: skill-creator asks for a slightly pushy description, the best practices for a concise one. The
  app asks for the real words of the user's requests and a `Not for` line: broad enough for the area, no wider.
- **File paths**: the spec writes package paths relative to the skill folder; the app writes `${CLAUDE_SKILL_DIR}/…`
  (ADR 0263) because its agents run from other folders. Cursor and Codex do not document that variable (an
  assumption, not tested: they read the path after it as the relative one).
