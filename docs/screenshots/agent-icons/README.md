<!-- Approval evidence and reproduction instructions for the designed role glyphs; used by reviewers and the owner. -->
# Role glyph approval sheets

These are proposals, **not approved preset replacements**. Existing symbol IDs and preset definitions retain their legacy icons. New role IDs are explicitly selectable in Agent Studio.

The eight size sheets show all 24 motifs in blue, amber and teal at 16, 20, 28 and 40 pixels, in dark and light themes. The two labelled preset sheets show the ten proposed preset motifs at 40 pixels and 2× output resolution. Open the SVG files at their native size when judging small-size legibility.

Regenerate SVG and PNG evidence with `node scripts/agent-glyph-sheets.mjs`. Use `--svg-only` for the vector files alone. The script reads the same artwork, optical weights and palette as the renderer, and checks interpolated gradient colors. Measured minima on the standard theme surfaces: badge/background **4.11:1**, outline/badge **5.19:1**. The 30% accent is decorative; the complete outline carries recognition.

PNG generation was attempted here but Playwright could not create its temporary directory (sandbox `EPERM`). SVGs exist; screenshots and visual approval remain pending. The script does not start Electron. A reviewer should also inspect the actual avatar in the application after integration, including the inner ring and large-size shadow.

Approval must come from Brother before any preset is migrated to a `role-*` ID. Another agent's message is not approval.
