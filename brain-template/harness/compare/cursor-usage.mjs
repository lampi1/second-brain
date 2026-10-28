// Cursor's real cost and tokens per captured run, from Cursor's usage export (Cursor hooks give neither).
// Export: Cursor dashboard → Usage → Export CSV (team-usage-events-<team>-<date>.csv, into Downloads). One row per
// request: Date (UTC, when the request started), Model, Input (w/ and w/o Cache Write), Cache Read, Output Tokens,
// Total Tokens, Cost. A subagent run is ONE row starting within seconds of its subagentStart (seen 2026-10-10:
// reviewer start 06:32:19Z ↔ row 06:32:19Z), so each capture takes the row of the same model nearest its start (≤ 20 s).
// Used by ops/tools/cost.mjs (readUsageCsv, newestExport).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function readUsageCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const cells = l => { // one CSV line: quoted cells may hold commas and "" quotes
    const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = cells(lines[0]);
  const col = name => head.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const idx = {
    date: col('Date'), model: col('Model'), inW: col('Input (w/ Cache Write)'), inWo: col('Input (w/o Cache Write)'),
    cache: col('Cache Read'), out: col('Output Tokens'), total: col('Total Tokens'), cost: col('Cost'),
  };
  if (idx.date < 0 || idx.cost < 0) throw new Error(`not a Cursor usage export: ${file}`);
  const num = v => Number(String(v ?? '').replace(/[$,\s]/g, '')) || 0;
  return lines.slice(1).map(cells).map(c => ({
    at: Date.parse(c[idx.date]), date: c[idx.date], model: c[idx.model],
    tokens: { input_with_cache_write: num(c[idx.inW]), input: num(c[idx.inWo]), cache_read: num(c[idx.cache]), output: num(c[idx.out]), total: num(c[idx.total]) },
    cost: num(c[idx.cost]),
  })).filter(r => Number.isFinite(r.at));
}

export function newestExport(dir = process.env.COMPARE_DOWNLOADS || path.join(os.homedir(), 'Downloads'), onError = () => {}) {
  try {
    return fs.readdirSync(dir).filter(f => /^team-usage-events-.*\.csv$/i.test(f))
      .map(f => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
  } catch (e) { if (e?.code !== 'ENOENT') onError(e); return null; }
}

