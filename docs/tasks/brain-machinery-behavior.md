<!-- Behavioral acceptance cases for the ADR 0062 product runtime; used by reviewers and opt-in model evaluations. -->
# Product rule behavior cases

| Situation | Expected | Fails if | Automated evidence |
|---|---|---|---|
| Fixed context at 15,001 chars grows | Refuse with budget and fix | Write allowed | rules.test.ts budget case |
| Oversized fixed context shrinks | Allow repair | Shrinking blocked | budget case |
| Direct now/error file write | Refuse; use validated product writer | Direct write allowed | malformed safety case |
| Two writers update now | Preserve other labels; refuse occupied lock | Lost update or multiline entry | memory case |
| Topic matches a prompt/tool/path | Inject actual text once per revision | Pointer only or repeated unchanged text | injection case |
| Many tools in one turn | Share one context cap | Per-tool reset | injection case |
| Agent message resembles a correction | No human correction reminder | Agent treated as user | feed case |
| Claude invokes Cursor, or converse | Refuse spend; version query allowed | Other engine invoked | vendor case |
| Lease already held | Require owner token to release | Time-based stealing | lease case |
| Session includes a credential label | Mask the excerpt | Raw credential returned | readers case |
| Transcript has no reported cost | Unknown, never fabricated zero | Missing becomes zero | readers case |
| Migration preimage differs | Refuse before swapping | Custom data overwritten | migration case |
| Roll back a migration | Restore original and retain newer tree | New data discarded | migration case |
| Product brain launches a template utility | Run the app-owned copy, which serves the brain | Code in the brain folder runs, or the copy writes its own folder | rules-tools utilities cases |
| Personal script next to template code | Stays in the brain, referenced by path | Rewritten to {tools} or removed | rules-tools reference/resolution cases |
| Claude launch on a product brain | Product hooks first, kept template hooks after, at the copy | Replaced hook runs twice or points at the brain | rules-tools activation cases |
| Topic text contains {tools} | Expanded to the copy path | Literal placeholder injected | rules-tools {tools} case |
| Legacy brain planned for migration | Frontmatter, references, code removal, activation; hooks kept by default | Global CLI hooks lose their files | rules-tools plan case |
| Crash during migrate | recover: not-applied / restored / applied; new migrate refused while pending | Both trees lost or a second swap | rules-tools recovery cases |
| Journal names other paths | Refuse; inspect by hand | Rename outside the brain's siblings | rules-tools invalid journal case |
| New brain created | Content only: no template code or global wiring, {tools} references, product-v1 | Code copies left in the brain | create.test.ts real template case |

These cases cover the product runtime and the template utilities, not every generic template rule. Hook fixtures
are synthetic protocol examples; recorded live hook inputs and model-dependent evaluation remain release acceptance work.
