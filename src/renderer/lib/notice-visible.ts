// Visibility gate for destructive-action warnings: include scroll clipping, CSS visibility and DOM occlusion.
// It is deliberately conservative; an uncertain/partially hidden warning never authorizes automatic closure.
export function noticeVisible(el: HTMLElement): boolean {
  if (document.hidden || !el.isConnected || el.offsetParent === null) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0 || r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight) return false;
  for (let parent: HTMLElement | null = el; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    const clip = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (r.left < clip.left || r.right > clip.right)) return false;
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (r.top < clip.top || r.bottom > clip.bottom)) return false;
  }
  return [r.left + 1, (r.left + r.right) / 2, r.right - 1].every(x => {
    const top = document.elementFromPoint(x, (r.top + r.bottom) / 2);
    return !!top && (top === el || el.contains(top));
  });
}
