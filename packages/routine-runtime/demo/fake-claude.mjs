// A stand-in for the Claude CLI, for the demo and its test: it reads the prompt on stdin, streams a few stream-json
// lines like `claude -p --output-format stream-json`, saves one evidence note and writes step-result.json into the
// step folder the runtime gives it (ROUTINE_STEP_DIR). It spends no tokens and needs no login.
import fs from 'node:fs';
import path from 'node:path';

let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { prompt += chunk; });
process.stdin.on('end', () => {
  const dir = process.env.ROUTINE_STEP_DIR;
  const step = path.basename(dir ?? 'step');
  const say = value => process.stdout.write(JSON.stringify(value) + '\n');
  say({ type: 'system', subtype: 'init', session_id: `demo-${step}` });
  say({ type: 'assistant', message: { content: [{ type: 'text', text: `Working on ${step} (${prompt.length} prompt chars)` }] } });
  if (!dir) { process.stderr.write('ROUTINE_STEP_DIR missing\n'); process.exit(2); }
  fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', 'notes.md'), `demo evidence for ${step}\n`);
  fs.writeFileSync(path.join(dir, 'step-result.json'), JSON.stringify({ outcome: 'done', summary: `demo ${step} done` }));
  say({ type: 'result', subtype: 'success', session_id: `demo-${step}` });
});
