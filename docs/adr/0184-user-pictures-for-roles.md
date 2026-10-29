# ADR 0184 · The user's own picture for a role

Numbered 0090 until 2026-10-29, when duplicate ADR numbers were removed.

Date: 2026-10-20 · Status: accepted (owner, 2026-10-20: «vorrei che si potesse caricare un'immagine custom anche per
gli agenti con quelle attuali come predefinite») · Builds on: ADR 0083 (the nine fixed roles and their characters)

## Context
Each role (Orchestrator + eight work roles) is drawn as a fixed cartoon character (`renderer/lib/character-art.ts`).
The owner wants to give a role a picture of their own, keeping the characters as the default. Image avatars existed
before the fixed roles (`{ kind: 'image', dataUrl }` in the agent profile) and were dropped with the catalog.

## Decision
- **One square PNG per role, outside the role profile**: `<userData>/agent-images/<roleId>.png`
  (`src/main/agents/agent-images.ts`). The role's `avatar` stays `{ kind: 'character' }`: versions, packs, the brain
  and the engines never see the picture, and editing a role never touches it. The picture is a UI preference of this
  install, like the theme.
- **Picked on the role's page** (`AgentImagePicker.tsx`, under the badge): "Cambia immagine" takes a PNG, JPG or WebP;
  the renderer checks format and header size before decoding (≤ 15 MB, ≤ 8192 px a side, `lib/avatar-raster.ts`)
  and sends the centre square at 256 px as PNG. "Immagine predefinita" deletes the file and the character is back.
- **Main does not trust the bytes**: PNG signature, ≤ 600 KB, role id from the fixed list (no path from the
  renderer), decoded by `nativeImage`, square, re-encoded at 256 px before it is written (no metadata kept).
- **Every badge follows**: `AgentAvatar` reads one shared map (`avatars:get`, kept fresh by `avatars:changed`) and draws
  the picture in the same round frame wherever the role's character was drawn. The CSP already allows `data:` images.

## Consequences
- The picture is per machine: a stable and a dev install, or two PCs, each have their own.
- Pulse and chats without a role keep their badge; only the nine roles take a picture.
