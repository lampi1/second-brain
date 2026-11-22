// The split and join points of the framed groups in a project map drawn as a line (ADR 0335): a small circle on the
// top edge of a group's frame where the arrow from the place before splits into it, and on its bottom edge where its
// arrows join toward the place after. Drawn only where an arrow really passes (the layout marks it: usesSplit /
// usesJoin in project-map-line.ts), so a back arrow or a link to an outside box, which runs along the lane, leaves no
// orphan point. Rendered inside the arrows' svg by ProjectMapView.tsx; tested by test/unit/project-map-hubs.test.ts.
import type { LevelGroup } from '@shared/project-map';

export function GroupHubs({ groups }: { groups: readonly LevelGroup[] | undefined }) {
  return <>{(groups ?? []).flatMap(g => [g.usesSplit && g.split, g.usesJoin && g.join].map((c, i) => c
    ? <circle key={`h-${g.ids[0]}-${i}`} cx={c[0]} cy={c[1]} r={6} className="pm-hub" data-testid={`pm-hub-${i ? 'join' : 'split'}-${g.ids[0]}`} />
    : null))}</>;
}
