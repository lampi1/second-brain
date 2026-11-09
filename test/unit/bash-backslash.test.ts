// #342: a Bash command that writes a file with text holding backslashes is refused; the same without a backslash, and
// commands that only read, pass. Pure strings.
import { describe, expect, it } from 'vitest';
import { backslashWrite } from '../../src/main/rules/bash-backslash';

describe('backslashWrite', () => {
  it('refuses the three ways agents lost backslashes', () => {
    expect(backslashWrite("cat > src/a.js <<'EOF'\nconst re = /\\d+/;\nEOF")).toMatch(/Write or Edit/);
    expect(backslashWrite("node -e \"const fs=require('fs');fs.writeFileSync('a.ts', s.replace('x','a\\\\nb'))\"")).toMatch(/Write or Edit/);
    expect(backslashWrite("node <<'EOF'\nconst fs = require('fs');\nfs.writeFileSync('a.ts', t.replace(/\\s+/g, ' '));\nEOF")).toMatch(/Write or Edit/);
    expect(backslashWrite("sed -i 's/a\\.b/c/' src/x.ts")).toMatch(/Write or Edit/);
    expect(backslashWrite("perl -pi -e 's/\\t/  /g' x.md")).toMatch(/Write or Edit/);
    expect(backslashWrite("python3 -c \"open('x.py','w').write('a\\\\n')\"")).toMatch(/Write or Edit/);
    expect(backslashWrite("tee out.txt <<EOF\nC:\\temp\nEOF")).toMatch(/Write or Edit/);
  });
  it('lets the same writes without a backslash, and reads with one, pass', () => {
    expect(backslashWrite("cat > src/a.js <<'EOF'\nconst a = 1;\nEOF")).toBeNull();
    expect(backslashWrite("sed -i 's/a/b/' src/x.ts")).toBeNull();
    expect(backslashWrite("grep 'a\\\\b' file")).toBeNull();
    expect(backslashWrite("rg -n 'foo\\(' src 2>/dev/null")).toBeNull();
    expect(backslashWrite("sed -n 's/\\./x/p' file")).toBeNull();
    expect(backslashWrite("node -e \"console.log(require('path').join('a','b').replace(/\\\\/g,'/'))\"")).toBeNull();
    expect(backslashWrite('git commit -m "fix: a\\nb"')).toBeNull();
    expect(backslashWrite("git log --format='%h\\t%s' > /dev/null")).toBeNull();
  });
});
