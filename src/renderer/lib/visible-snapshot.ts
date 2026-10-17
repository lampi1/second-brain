// An offscreen transcript keeps its last rendered snapshot. Store data continues to update normally.
// On re-entry the selector returns the latest value immediately, preserving the mounted list and its scroll state.
export function visibleSnapshot<T>(initial: T): (latest: T, visible: boolean) => T {
  let snapshot = initial;
  return (latest, visible) => {
    if (visible) snapshot = latest;
    return snapshot;
  };
}
