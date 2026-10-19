// Demo scripts and changelog (SB_DEMO=1, ADR 0076): a small made-up brain folder in the demo's userData with a few
// scripts in scripts/ and a changelog.md, read by the real BrainScripts and BrainChangelog, so the Script and Changelog
// pages and their e2e screenshots work without the user's brain. Generic content only. File dates and changelog stamps
// are relative to `now` (frozen demo: the same every run). Used by demo-wiring.ts.
import fs from 'node:fs';
import path from 'node:path';
import { stampOf } from './changelog';

const DAY = 24 * 3600e3;
let base = Date.now();
function day(ago: number): string { return new Date(base - ago * DAY).toISOString().slice(0, 10); }

/** name → [content, age in days] */
const SCRIPTS: Record<string, [string, number]> = {
  'backup-note.mjs': [`// @title Backup delle note
// @description Crea uno zip datato della cartella brain (senza .git) in una cartella di backup; tiene gli ultimi 10.
// @usage node scripts/backup-note.mjs <cartella-backup>
// @tags backup, zip, brain
// @tested ${day(0)} ok: 214 file, zip da 3,1 MB, rotazione a 10 copie verificata

import { execFileSync } from 'node:child_process';
const dest = process.argv[2];
if (!dest) { console.error('uso: node scripts/backup-note.mjs <cartella-backup>'); process.exit(2); }
const name = \`brain-\${new Date().toISOString().slice(0, 10)}.zip\`;
execFileSync('tar', ['-a', '-cf', \`\${dest}/\${name}\`, '--exclude=.git', '.'], { stdio: 'inherit' });
console.log('creato', name);
`, 0],
  'export-ticket.py': [`# @title Esporta i ticket aperti in CSV
# @description Legge i ticket aperti dal tracker tramite la sua API e scrive un CSV con titolo, stato, assegnatario ed età in giorni.
# @usage python scripts/export-ticket.py --project DEMO --out ticket.csv
# @tags ticket, csv, report
# @tested ${day(2)} ok: 37 ticket esportati, colonne verificate in Excel

import csv, os, sys, json, urllib.request
token = os.environ.get("TRACKER_TOKEN")  # letto dall'ambiente, mai scritto qui
`, 2],
  'pulisci-branch.ps1': [`# @title Pulisci i branch già uniti
# @description Elenca i branch locali già uniti in main e li elimina dopo conferma; non tocca main né il branch corrente.
# @usage pwsh scripts/pulisci-branch.ps1 -Repo C:\\progetti\\app
# @tags git, pulizia
# @tested ${day(5)} ok: 12 branch rimossi, main intatto

param([string]$Repo = ".")
git -C $Repo branch --merged main | Where-Object { $_ -notmatch '^\\*|main' } | ForEach-Object { $_.Trim() }
`, 5],
  'conta-righe-log.sh': [`#!/usr/bin/env bash
# @title Conta gli errori nei log di oggi
# @description Conta le righe ERROR e WARN nei log dell'app di oggi, raggruppate per modulo.
# @usage bash scripts/conta-righe-log.sh <cartella-log>
# @tags log, errori
# @tested ${day(1)} failed: il formato data dei log è cambiato, da correggere

grep -hE 'ERROR|WARN' "$1"/*.log | awk '{print $3}' | sort | uniq -c | sort -rn
`, 1],
};

/** changelog lines: [days ago, hh:mm, kind, action, target, by, summary] */
const LOG: [number, string, string, string, string, string, string][] = [
  [0, '10:42', 'script', 'added', 'scripts/backup-note.mjs', 'Orchestrator', 'Backup datato del brain con rotazione a 10 copie'],
  [0, '09:15', 'rule', 'edited', 'rules/git.md', 'Orchestrator', 'Aggiunta la regola: mai push diretto su main'],
  [1, '18:03', 'script', 'edited', 'scripts/conta-righe-log.sh', 'Orchestrator', 'Il test di oggi fallisce: nuovo formato data nei log, da correggere'],
  [2, '16:20', 'script', 'added', 'scripts/export-ticket.py', 'Orchestrator', 'Export CSV dei ticket aperti per la riunione del lunedì'],
  [3, '11:47', 'script', 'deleted', 'scripts/export-ticket-vecchio.py', 'Orchestrator', 'Sostituito da export-ticket.py (copia in scripts/.deleted/)'],
  [4, '14:05', 'skill', 'added', 'skills/rilasci/SKILL.md', 'Orchestrator', 'Skill per pubblicare una versione in test'],
  [5, '10:30', 'script', 'fixed', 'scripts/pulisci-branch.ps1', 'Orchestrator', 'Non elimina più il branch corrente'],
  [6, '08:55', 'note', 'edited', 'now.md', 'Orchestrator', 'Aggiornate le priorità della settimana'],
];

/** Write the demo folder (scripts/ and changelog.md) under `dir`; returns `dir`, the demo's brain root for these pages. */
export function writeDemoScripts(dir: string, now: number): string {
  base = now;
  const scripts = path.join(dir, 'scripts');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(scripts, { recursive: true });
  // the texts call day() at module load with Date.now(): rebuild them for this `now`
  for (const [name, [, age]] of Object.entries(SCRIPTS)) {
    const text = SCRIPTS[name]![0].replace(/@tested \d{4}-\d\d-\d\d/, `@tested ${day(age)}`);
    const f = path.join(scripts, name);
    fs.writeFileSync(f, text, 'utf8');
    const t = new Date(now - age * DAY - 3600e3);
    fs.utimesSync(f, t, t);
  }
  const lines = LOG.map(([ago, hm, kind, action, target, by, summary]) => `- ${stampOf(new Date(now - ago * DAY)).slice(0, 10)} ${hm} · ${kind} · ${action} · ${target} · ${by} · ${summary}`);
  fs.writeFileSync(path.join(dir, 'changelog.md'), `# Changelog del brain\n\nOgni cambiamento al brain fatto dagli agenti o dall’app, il più recente in alto.\n\n${lines.join('\n')}\n`, 'utf8');
  return dir;
}
