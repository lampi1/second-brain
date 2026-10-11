// PostToolUse hook on AskUserQuestion (P-041): a panel closed without an answer may never have reached {{OWNER}}.
let raw = '';
process.stdin.on('data', d => (raw += d)).on('end', () => {
  if (!/User dismissed/i.test(raw)) return;
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext:
    'The panel was closed without an answer: it may not have reached {{OWNER}} (he may be on another device). It is not a no: ' +
    'repeat now the same questions as plain text, numbered options, every draft or preview text written out in full.' } }));
});
