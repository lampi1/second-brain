// The command behind scripts/guide-anchors.mjs (ADR 0196): hashes every anchor of the Guida's cards in this checkout and
// writes src/shared/guide-anchors.json (sorted, so a diff shows exactly which anchors moved). `--check` writes nothing
// and exits 1 listing the cards whose code changed and the pages or Settings sections without a card (main/guide/
// coverage.ts, ADR 0208). An anchor whose symbol cannot be found stops both with its card and point: fix the anchor in
// concept-guide.ts first. Root = SB_REPO_ROOT (set by the script).
import fs from 'node:fs';
import path from 'node:path';
import { computeHashes, staleInRepo, staleMessage } from './anchors';
import { coverageInRepo } from './coverage';

function main(root: string, check: boolean): number {
  const { hashes, missing } = computeHashes(root);
  if (missing.length) {
    for (const m of missing) console.error(`card ${m.card} ${m.point >= 0 ? `point ${m.point + 1}` : 'technical part'}: ${m.ref} not found (renamed or removed?); fix the anchor in src/shared/concept-guide.ts`);
    return 1;
  }
  if (check) {
    const stale = staleInRepo(root), gaps = coverageInRepo(root);
    if (stale.length || gaps.length) { console.error([...stale.map(staleMessage), ...gaps.map(g => g.message)].join('\n')); return 1; }
    console.log(`guide anchors: ${Object.keys(hashes).length} up to date; every page and Settings section has its card`);
    return 0;
  }
  fs.writeFileSync(path.join(root, 'src/shared/guide-anchors.json'), `${JSON.stringify({ version: 1, hashes }, null, 2)}\n`);
  console.log(`guide anchors: ${Object.keys(hashes).length} hashes written to src/shared/guide-anchors.json`);
  return 0;
}
process.exitCode = main(process.env.SB_REPO_ROOT ?? process.cwd(), process.argv.includes('--check'));
