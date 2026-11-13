# ADR 0050 · Screenshots go to file; the agent's image is scaled to ~1000 px

Date: 2026-10-14 · Status: accepted · Amends: ADR 0003 (screenshot pixels = CSS pixels), ADR 0006 (`app_screenshot`)

## Context
The user wants chats to spend fewer tokens. A 7-day measure of the user's transcripts (each tool result's tokens × the turns
it stays in context) put ~21% of the weight on images: 591 screenshots of the app's browser, ~630 of the desktop
browser pane, ~850 PNGs opened with Read. Two things made our share large: `screenshot` with `save_to` (QA evidence)
also returned the image, so every evidence step stayed in context as an image the agent rarely needed; and every
image came back as a full-size PNG (agent tabs are 1920×1080 CSS px), which the API bills at its ~1.15 MP cap.

## Decision
- **`save_to` returns only the path and size** (`Saved: <path>`, `PNG 1920x1080, not shown`). `view: true` returns the
  image too. The evidence file stays a full-size PNG. `return_image` is gone (`view` replaces it).
- **The agent's image is scaled** (`browser/preview.ts`): the smallest round factor of 1, 1.25, 1.5, 2, 2.5, 3, 4… that
  brings the long side within 1100 px (≈ 1000), as JPEG quality 80. A 1920×1080 tab becomes
  960×540 (~690 tokens instead of ~1530).
- **Coordinates: documented, not remapped.** Click coordinates stay CSS px, as for refs, `javascript` and the
  tools' errors; the result's text says how to map: `click coordinate = image px × 2`, for a region
  `(x0 + image x × k, y0 + image y × k)`, for a full page `page point = image px × k`. A round factor keeps the
  arithmetic easy. Remapping coordinates through the last screenshot was rejected: hidden state, and it would break
  coordinates that come from scripts or an earlier region shot.
- **Text first.** The MCP instructions and the tool descriptions tell agents to try `read_page`, `find` or
  `get_page_text` (`app_state`, `app_chats`, `app_chat_items` for the app) and to take a screenshot only to really see.
- **`app_screenshot`** returns the same scaled JPEGs, each caption with its factor. It gets no `save_to`: it has no
  evidence folder and no user who needs one, and a file-writing argument would be new surface on the app endpoint.

## Consequences
- Measured on a fake QA chat run against the real app before and after (8 evidence shots, 4 looks, 1 full page,
  2 `app_screenshot`, 20 more turns): context weight 930k → 396k (−57%) with the flat 1600 tokens per image of the
  measuring script, 891k → 196k (−78%) with each image's real size.
- Agents that saved evidence and also looked at it must pass `view: true` (the QA agent's brief says so).
- Evidence quality is unchanged (full-size PNG on file).
