// Whether a key press is typing (an input, a text area, a select, an editable area): the News and Pull Request tabs'
// single-letter keys (J, K, S, U, E, O, R, 1-6) never fire then. Used by NewsPage.tsx and ImparaPrTab.tsx.
export const isTyping = (el: EventTarget | null): boolean => el instanceof HTMLElement && el.closest('input, textarea, select, [contenteditable="true"]') !== null;
