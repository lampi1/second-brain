# UX principles

The user (2026-10-11): "Vorrei che la UX fosse incredibile, usa tutti i migliori standard del momento". Calm UI
(few, useful notifications): what is not on screen does not exist, starting is the hard part, noise makes people stop trusting alerts.
References: Linear, Raycast, Arc, Claude desktop, Cursor, VS Code (and docs/research/research-harness-apps.md).

1. **Few things, clear.** One primary action per surface; secondary actions in the palette or a menu. Empty space is
   fine; clutter is not.
2. **What needs the user is always visible first** (needs-you lane, Regia tile, `Ctrl+J` next). Nothing that needs the user is
   ever only in a menu or a hidden tab.
3. **Everything by keyboard, discoverable**: `Ctrl+K` palette lists every action with its shortcut; shortcuts shown in
   tooltips and menus; focus always visible (2px ring); `Esc` always backs out one level.
4. **Immediate feedback**: optimistic UI (the message appears at once, the state pill changes at once), then
   reconciliation; long work shows progress and elapsed time, never a frozen screen.
5. **Undo over confirm**: closing a tile, dismissing, archiving → a 6-second "Annulla" toast. Confirm only what cannot
   be undone or costs money (Ferma tutto with several chats running, a budget overrun).
6. **Calm notifications**: in-app first; Windows toasts only for "needs you"; grouped; mute per kind; never steal
   focus; respect Focus Assist.
7. **Designed states**: every list/tile has an empty state that says what to do next, a loading skeleton (no spinners
   over 300 ms without text), an error state with cause + one action.
8. **Motion is short and meaningful**: 120–180 ms ease-out for enter/expand; none for frequent updates (streaming);
   `prefers-reduced-motion` turns transitions off.
9. **Accessible (WCAG 2.2 AA)**: contrast ≥ 4.5:1 text / 3:1 UI, targets ≥ 24 px, roles and labels for screen readers
   (tiles are regions with names; live regions for new questions), no information by color alone (state pills have
   text).
10. **A design system, not one-offs**: tokens for color, spacing (4/8 px grid), radius, type scale; light/dark from the
    system; density setting (comfortable / compact).
11. **The app remembers**: window size/position, view (Mosaico/Corsie), tile sizes, collapsed sections, last focus.
12. **Honest numbers**: costs labelled (real / list-price estimate); estimates show a range or "stima senza dati".

Validation: AI-driven usability tests run the user's real scenarios on the demo (answer a question from the lane, start a
chat, stop all, find yesterday's chat, follow a browser) and record steps, time and screenshots per phase.
