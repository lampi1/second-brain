// #342: a Bash command that writes a file with text holding backslashes is refused; the same without a backslash, and
// commands that only read or print, pass. Pure strings.
import { describe, expect, it } from 'vitest';
import { backslashWrite } from '../../src/main/rules/bash-backslash';
import { guard } from '../../src/main/rules/guards';
import type { RuleContext } from '../../src/main/rules/types';

const refused = (c: string) => expect(backslashWrite(c), c).toMatch(/Write or Edit/);
const passes = (c: string) => expect(backslashWrite(c), c).toBeNull();

describe('backslashWrite', () => {
  it('refuses the ways agents lost backslashes', () => {
    refused("cat > src/a.js <<'EOF'\nconst re = /\\d+/;\nEOF");
    refused("node -e \"const fs=require('fs');fs.writeFileSync('a.ts', s.replace('x','a\\\\nb'))\"");
    refused("node <<'EOF'\nconst fs = require('fs');\nfs.writeFileSync('a.ts', t.replace(/\\s+/g, ' '));\nEOF");
    refused("sed -i 's/a\\.b/c/' src/x.ts");
    refused("perl -pi -e 's/\\t/  /g' x.md");
    refused("python3 -c \"open('x.py','w').write('a\\\\n')\"");
    refused("tee out.txt <<EOF\nC:\\temp\nEOF");
  });
  it('finds the heredoc on any line, the in-place flags and the inline forms', () => {
    refused("cd /repo\ncat > a.js <<'EOF'\nconst r=/\\d/\nEOF");
    refused("set -e\nnode <<'EOF'\nrequire('fs').writeFileSync('a', '\\\\d')\nEOF");
    refused("cat <<EOF | node\nrequire('fs').writeFileSync('a','\\\\n')\nEOF");
    refused("perl -0pi -e 's/\\t//' x");
    refused("sed -ie \"s/\\t//\" x");
    refused("sed -E -i 's/\\t//' x");
    refused("node -e\"require('fs').writeFileSync('a','\\\\n')\"");
    refused("npx tsx -e \"require('fs').writeFileSync('a','\\\\n')\"");
    refused("node <<< \"require('fs').writeFileSync('a','\\\\n')\"");
  });
  it('lets the same writes without a backslash, and reads with one, pass', () => {
    passes("cat > src/a.js <<'EOF'\nconst a = 1;\nEOF");
    passes("sed -i 's/a/b/' src/x.ts");
    passes("grep 'a\\\\b' file");
    passes("rg -n 'foo\\(' src 2>/dev/null");
    passes("sed -n 's/\\./x/p' file");
    passes("node -e \"console.log(require('path').join('a','b').replace(/\\\\/g,'/'))\"");
    passes('git commit -m "fix: a\\nb"');
    passes("git log --format='%h\\t%s' > /dev/null");
  });
  it('does not read quoted text, other lines or printing scripts as writes', () => {
    passes("npm test > out.txt\ngit commit -F - <<'EOF'\na\\b\nEOF");
    passes("gh pr create --title \"Fix node build\" --body-file - <<'EOF'\nC:\\path\nEOF");
    passes("gh pr create --title \"a => b\" --body-file - <<'EOF'\nC:\\path\nEOF");
    passes("rg 'sed -i' docs | grep '\\d'");
    passes("python3 - <<'EOF'\nimport re\nprint(re.sub(r'\\d','x','a1'))\nEOF");
    passes("node <<'EOF'\nprocess.stdout.write('a\\\\b')\nEOF");
    passes("docker run -e FOO=1 node -e x\\y");
  });
  it('is checked by the hook guard for Bash only (PowerShell keeps its backslashes)', () => {
    const ctx = {} as RuleContext, command = "cat > a.js <<'EOF'\nconst r=/\\d/\nEOF";
    expect(guard(ctx, { hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_input: { command } })).toMatch(/Write or Edit/);
    expect(guard(ctx, { hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'PowerShell', tool_input: { command } })).toBeUndefined();
  });
});
