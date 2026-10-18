// Claim audit of PR #29 (in-app «Guida», src/shared/concept-guide.ts), card 'brain', point 3: it claims the app writes
// in the brain only under ops/state/improve/. Main also writes the owner's me.md (src/main/brain/profile.ts), mail
// messages in ops/state/inbox (src/main/chats/mail.ts sendMail) and brain-settings.json (src/main/brain/brain-settings.ts).
// Fails while the card keeps the "only ops/state/improve" claim. Review-only test (vitest.config.ts beside this folder).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '@shared/concept-guide';

const root = path.resolve(import.meta.dirname, '../../../..');
const src = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const card = CONCEPTS.find(c => c.id === 'brain')!;

describe("card 'brain': where the app writes in the brain", () => {
  it('main writes outside ops/state/improve (me.md, ops/state/inbox, brain-settings.json)', () => {
    // facts read from main's code
    expect(src('src/main/brain/profile.ts')).toMatch(/rename over me\.md/);
    const mail = src('src/main/chats/mail.ts');
    expect(mail).toMatch(/path\.join\(root, 'ops', 'state', 'inbox'\)/);
    expect(mail).toMatch(/fs\.renameSync\(tmp, path\.join\(box, `\$\{id\}\.json`\)\)/);
    expect(src('src/main/brain/brain-settings.ts')).toMatch(/fs\.writeFileSync\(tmp, /);
    // so the card must not say the app writes ONLY in ops/state/improve
    const text = card.points.map(p => `${p.it}\n${p.en}`).join('\n');
    expect(text).not.toMatch(/writes only in ops\/state\/improve/);
    expect(text).not.toMatch(/scrive solo in ops\/state\/improve/);
  });
});
