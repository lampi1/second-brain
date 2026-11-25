// Brain delivery timing remains readable while the retired transport switch is ignored. No personal files used.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readOrchestratorMail } from '../../../src/main/brain/brain-settings';
import { Live } from '../../../src/main/brain/live';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bset-'));

describe('brain-settings.json delivery timing', () => {
  it('reads timing words without rewriting a legacy false or other keys', () => {
    const root = tmp();
    expect(readOrchestratorMail(root)).toBeUndefined();
    const f = path.join(root, 'brain-settings.json');
    const raw = JSON.stringify({ other: 1, crossHarnessMessages: false, orchestratorMail: { urgent: ['urgent'] } });
    fs.writeFileSync(f, raw);
    expect(readOrchestratorMail(root)).toEqual({ urgent: ['urgent'] });
    expect(fs.readFileSync(f, 'utf8')).toBe(raw);
  });

  it('accepts BOM and UTF-16 and leaves unreadable files unchanged', () => {
    const root = tmp();
    const f = path.join(root, 'brain-settings.json');
    for (const raw of [Buffer.from('\ufeff{"orchestratorMail":{"urgent":["now"]},"crossHarnessMessages":false}'),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"orchestratorMail":{"urgent":["now"]},"crossHarnessMessages":false}', 'utf16le')])]) {
      fs.writeFileSync(f, raw);
      expect(readOrchestratorMail(root)).toEqual({ urgent: ['now'] });
      expect(fs.readFileSync(f)).toEqual(raw);
    }
    fs.writeFileSync(f, '{oops');
    expect(readOrchestratorMail(root)).toBeUndefined();
    expect(fs.readFileSync(f, 'utf8')).toBe('{oops');
  });

  it('a blocked row in the mailbox log becomes a "Messaggio bloccato" event; old rows never do', () => {
    const root = tmp();
    const dir = path.join(root, 'ops', 'state', 'inbox');
    fs.mkdirSync(dir, { recursive: true });
    const logf = path.join(dir, 'inbox.log');
    fs.writeFileSync(logf, `${JSON.stringify({ action: 'blocked', from: 'old', to: 'x' })}\n`);
    const live = new Live({ root, stateFile: path.join(root, 's.json'), node: { exe: process.execPath, env: process.env } as never, onEvents: () => {} });
    expect(live.inboxEvents()).toEqual([{ kind: 'mail', title: 'nuovi messaggi tra chat', detail: '' }]); // first look: baseline
    fs.appendFileSync(logf, `${JSON.stringify({ action: 'sent', from: 'a', to: 'b' })}\n${JSON.stringify({ action: 'blocked', from: 'cur-a', to: 'cla-b', fromHarness: 'cursor', toHarness: 'claude' })}\n`);
    const ev = live.inboxEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'mail-blocked', title: 'cur-a → cla-b' });
  });
});
