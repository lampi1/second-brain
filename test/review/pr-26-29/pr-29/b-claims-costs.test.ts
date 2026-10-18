// Claim audit of PR #29 (in-app «Guida», src/shared/concept-guide.ts), card 'costs', last point: it names the setting
// «Riparti le chat Claude a» / "Restart Claude chats at" and says chats "restart compacted". On main the setting
// compactWindowTokens is labelled 'Compatta le chat Claude a (token)' (src/main/brain/settings-schema.ts) and each Claude
// chat compacts its own context into a summary near that window (same chat, no restart). Fails while the card keeps the
// wrong label. Review-only test.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '@shared/concept-guide';

const root = path.resolve(import.meta.dirname, '../../../..');
const schema = fs.readFileSync(path.join(root, 'src/main/brain/settings-schema.ts'), 'utf8');
const card = CONCEPTS.find(c => c.id === 'costs')!;

describe("card 'costs': the compaction setting", () => {
  it("names the setting with main's real label", () => {
    const label = /key: 'compactWindowTokens'[^}]*?label: '([^']+)'/.exec(schema)?.[1];
    expect(label).toBe('Compatta le chat Claude a (token)');
    const point = card.points.find(p => p.en.includes('200,000'))!;
    expect(point).toBeDefined();
    // the Italian UI label (without the unit) must be the one the card quotes
    expect(point.it).toContain(label!.replace(/ \(token\)$/, ''));
    expect(point.en).not.toContain('Restart Claude chats at');
  });
});
