import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCrossHarness, writeCrossHarness } from '../../../src/main/brain/brain-settings';
import { Live } from '../../../src/main/brain/live';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bset-'));

describe('brain-settings.json (Claude <-> Cursor switch)', () => {
  it('missing file says nothing; written value is read back; other keys kept', () => {
    const root = tmp();
    expect(readCrossHarness(root)).toBeNull();
    fs.writeFileSync(path.join(root, 'brain-settings.json'), JSON.stringify({ other: 1 }));
    writeCrossHarness(root, false);
    expect(readCrossHarness(root)).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'brain-settings.json'), 'utf8'))).toEqual({ other: 1, crossHarnessMessages: false });
  });

  it('reads hand-edited files like inbox.mjs: BOM, UTF-16; unreadable fails closed', () => {
    const root = tmp();
    const f = path.join(root, 'brain-settings.json');
    fs.writeFileSync(f, '﻿{"crossHarnessMessages":true}');
    expect(readCrossHarness(root)).toBe(true);
    fs.writeFileSync(f, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"crossHarnessMessages":false}', 'utf16le')]));
    expect(readCrossHarness(root)).toBe(false);
    fs.writeFileSync(f, '{oops');
    expect(readCrossHarness(root)).toBe(false);
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
