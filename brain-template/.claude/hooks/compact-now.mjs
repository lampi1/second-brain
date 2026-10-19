// SessionStart hook, matcher "compact" (Claude Code): right after a conversation is compacted, the chat is told to
// refresh its now.md line before going on, so an abandoned chat still says where it is (AGENTS.md rule 7; OpenClaw's
// memory flush before compaction, D4 of reviews/2026-10-10-architettura-agenti.md). A PreCompact hook cannot talk to
// the model, SessionStart(compact) can (additionalContext). The chat title comes from the transcript ("custom-title"),
// so the command is ready to run. Installed by {{OWNER}} in ~/.claude/settings.json; never blocks: any error → no output.
// Cursor has no equivalent here (its preCompact output is not shown to the model).
// It also names the .md files of the chat's first prompt (its brief): compaction keeps only what is re-injected, and a
// file read with Read is summarised away (docs code.claude.com "context-window"; reviews/2026-10-16-brain-standard, P3/4).
import fs from 'node:fs';
import { claudeTitle } from '../../ops/tools/inbox.mjs';

// .md paths written in the first typed message of the transcript (tool results excluded), at most 6.
export function briefFiles(transcript) {
  try {
    for (const l of fs.readFileSync(transcript, 'utf8').split('\n')) {
      if (!l.includes('"type":"user"')) continue;
      let r; try { r = JSON.parse(l); } catch { continue; }
      const c = r.message?.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x?.type === 'text').map(x => x.text).join('\n') : '';
      if (!text) continue;
      return [...new Set(text.match(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'`<>|*?,;]+?\.md\b/g) || [])].slice(0, 6);
    }
  } catch { /* no transcript → no files */ }
  return [];
}

let raw = '';
process.stdin.on('data', d => (raw += d)).on('end', () => {
  try {
    const input = JSON.parse(raw.replace(/^\uFEFF/, '').trim() || '{}');
    if (input.source && input.source !== 'compact') return;
    const title = claudeTitle(input.transcript_path);
    if (!title || /^(regia|orchestrator)\b/i.test(title)) return; // the Orchestrator has no line of its own to refresh
    const label = title.replace(/"/g, '');
    const files = briefFiles(input.transcript_path);
    const text = `[compattazione] La conversazione è stata appena compattata. Prima di continuare, se questa chat ha una riga in now.md, ` +
      `aggiornala in una chiamata (stato e prossimo passo di adesso): node "{{BRAIN}}/ops/tools/mem.mjs" now me ` +
      `--label "${label}" --file <testo scritto con Write> (--file: PowerShell 5.1 a volte non avvia node con "·" nel --text). ` +
      'Se eri in ascolto della posta tra chat (inbox.mjs wait) e il comando non è più in corso, rilancialo. ' +
      'Le regole lette con Read prima della compattazione non ci sono più: rileggi ' +
      (files.length ? `il tuo brief (${files.join(', ')}) e i file che ti fa leggere` : 'i file che il tuo primo messaggio ti ha fatto leggere') +
      ", più il piano del progetto se lavori a uno lungo (docs/tasks/<id>-<nome>/ del ramo, code.md). Poi riprendi il lavoro.";
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
  } catch { /* never block */ }
});
