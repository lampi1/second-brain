// «Trovate sul PC» (ADR 0154; owner 2026-10-24: «due giorni fa avevo anche fatto una call e avevo la registrazione … l'app
// sa che deve andare a vedersi la registrazione»): the audio and video files of the last weeks in the usual places a
// recording lands (Downloads, Documents, Videos, Music, Desktop, Windows' Sound Recorder folder, OneDrive's
// «Recordings»/«Registrazioni» where Teams saves meetings), newest first. Names, sizes and dates only: nothing is read or
// imported until the user (or the Orchestrator, for the user) asks.
import fs from 'node:fs/promises';
import path from 'node:path';
import { recExtensionOk, type RecFound } from '@shared/recordings';

const DAYS = 30;
const MIN_BYTES = 100_000;
const MAX = 40;

/** The folders to look in under the user's home (absent ones are skipped). */
export async function recordingFolders(home: string): Promise<string[]> {
  const base = ['Downloads', 'Documents', 'Documenti', 'Videos', 'Video', 'Music', 'Musica', 'Desktop',
    path.join('Documents', 'Sound Recordings'), path.join('Documents', 'Registrazioni di suoni'), path.join('Videos', 'Captures')];
  const out = base.map(b => path.join(home, b));
  try {
    for (const e of await fs.readdir(home, { withFileTypes: true })) {
      if (!e.isDirectory() || !/^OneDrive/i.test(e.name)) continue;
      for (const sub of ['Recordings', 'Registrazioni', 'Documents', 'Documenti', 'Desktop']) out.push(path.join(home, e.name, sub));
    }
  } catch { /* no home */ }
  return out;
}

async function walk(dir: string, depth: number, since: number, out: RecFound[], folder: string): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('~')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0 && !/^(node_modules|AppData|\$Recycle)/i.test(e.name)) await walk(p, depth - 1, since, out, folder); continue; }
    if (!e.isFile() || !recExtensionOk(e.name)) continue;
    try {
      const st = await fs.stat(p);
      if (st.mtimeMs >= since && st.size >= MIN_BYTES) out.push({ path: p, name: e.name, size: st.size, mtime: st.mtimeMs, folder });
    } catch { /* gone meanwhile */ }
  }
}

export async function findRecordings(home: string, now = Date.now()): Promise<RecFound[]> {
  const since = now - DAYS * 86_400_000;
  const out: RecFound[] = [];
  const seen = new Set<string>();
  for (const dir of await recordingFolders(home)) {
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    await walk(dir, 2, since, out, path.relative(home, dir) || dir);
  }
  const unique = new Map(out.map(f => [f.path.toLowerCase(), f]));
  return [...unique.values()].sort((a, b) => b.mtime - a.mtime).slice(0, MAX);
}
