// The Orchestrator's view of the call recordings (ADR 0154, src/main/appctl/recordings.ts): the list, a transcript by
// id (whole, by words, in parts), the recent audio/video files on the PC not imported yet, and an import only of one of
// those (it asks the app's page, ui:command recImport).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { recordingTools } from '../../src/main/appctl/recordings';
import type { Recording } from '../../src/shared/recordings';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rec-home-'));
fs.mkdirSync(path.join(home, 'Downloads'));
fs.writeFileSync(path.join(home, 'Downloads', 'call-teams.mp4'), Buffer.alloc(200_000));
fs.writeFileSync(path.join(home, 'Downloads', 'note.txt'), Buffer.alloc(200_000));
const done = path.join(home, 'Downloads', 'gia.m4a');
fs.writeFileSync(done, Buffer.alloc(200_000));

const rec: Recording = { id: '20261022-150200-abcd', title: 'Call bug SMS', source: 'call', startedAt: Date.UTC(2026, 9, 22, 15, 2), durationMs: 61_000, channels: 2, status: 'ready', bytes: 1, lines: 2, systemAudio: true };
const imported: Recording = { ...rec, id: '20261023-100000-abcd', title: 'gia', source: 'file', channels: 1, status: 'transcribing', progress: 0.4, fromPath: done };
const text = '# Call bug SMS\n\n[0:12] Altri: Il totale ordine è sbagliato.\n[0:21] Tu: Lo riproduco su staging.\n';
const ui: { action: string; value?: string }[] = [];
const [list, imp] = recordingTools({ list: () => [rec, imported], text: id => (id === rec.id ? text : null), textFile: id => `/data/${id}/trascrizione.md` }, c => ui.push(c), home);

it('lists the recordings and, with pc, the files not imported yet', async () => {
  const out = await list!.run({ pc: true }) as { recordings: { id: string; status: string; length: string }[]; onPc: { name: string }[] };
  expect(out.recordings.map(r => [r.id, r.status, r.length])).toEqual([[rec.id, 'ready', '1:01'], [imported.id, 'transcribing', '1:01']]);
  expect(out.onPc.map(f => f.name)).toEqual(['call-teams.mp4']);
});

it('reads a transcript: whole, by words, refused when unknown or not ready', async () => {
  expect(await list!.run({ id: rec.id })).toMatchObject({ title: 'Call bug SMS', text });
  expect(await list!.run({ id: rec.id, query: 'staging' })).toMatchObject({ matches: 1, lines: '[0:21] Tu: Lo riproduco su staging.' });
  expect(await list!.run({ id: imported.id })).toMatchObject({ status: 'transcribing' });
  await expect(list!.run({ id: 'nope' })).rejects.toThrow(/sconosciuta/);
});

it('imports only a file the PC search found', async () => {
  await expect(imp!.run({ path: '/etc/passwd' })).rejects.toThrow();
  await imp!.run({ path: path.join(home, 'Downloads', 'call-teams.mp4') });
  expect(ui).toEqual([{ action: 'recImport', value: path.join(home, 'Downloads', 'call-teams.mp4') }]);
});
