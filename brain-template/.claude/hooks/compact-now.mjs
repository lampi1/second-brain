// SessionStart hook, matcher "compact" (Claude Code): right after a conversation is compacted, the chat is told to
// refresh its now.md line before going on, so an abandoned chat still says where it is (AGENTS.md rule 7; OpenClaw's
// memory flush before compaction, D4 of reviews/2026-10-10-architettura-agenti.md). A PreCompact hook cannot talk to
// the model, SessionStart(compact) can (additionalContext). The chat title comes from the transcript ("custom-title"),
// so the command is ready to run. Installed by {{OWNER}} in ~/.claude/settings.json; never blocks: any error → no output.
// Cursor has no equivalent here (its preCompact output is not shown to the model).
import { claudeTitle } from '../../ops/tools/inbox.mjs';

let raw = '';
process.stdin.on('data', d => (raw += d)).on('end', () => {
  try {
    const input = JSON.parse(raw.replace(/^\uFEFF/, '').trim() || '{}');
    if (input.source && input.source !== 'compact') return;
    const title = claudeTitle(input.transcript_path);
    if (!title || /^regia\b/i.test(title)) return; // the Regia has no line of its own to refresh
    const label = title.replace(/"/g, '');
    const text = `[compattazione] La conversazione è stata appena compattata. Prima di continuare, se questa chat ha una riga in now.md, ` +
      `aggiornala in una chiamata (stato e prossimo passo di adesso): node "{{BRAIN}}/ops/tools/mem.mjs" now me ` +
      `--label "${label}" --file <testo scritto con Write> (--file: PowerShell 5.1 a volte non avvia node con "·" nel --text). ` +
      'Se eri in ascolto della posta tra chat (inbox.mjs wait) e il comando non è più in corso, rilancialo. Poi riprendi il lavoro.';
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
  } catch { /* never block */ }
});
