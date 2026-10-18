// Validated single-line memory mutations for the product CLI; locks prevent lost updates between concurrent chats.
import { atomicWrite, locked, read } from './storage';

function line(text: string, cap: number): string {
  if (!text.trim() || /[\x00-\x1f\x7f]/.test(text) || text.length > cap) throw new Error(`Use one nonempty line of at most ${cap} characters, without control characters.`);
  return text.trim();
}
export function writeNow(root: string, label: string, text: string, cap = 250): void {
  label = line(label, 80);
  if (/[\[\]*]/.test(label)) throw new Error('Use a plain chat label.');
  const entry = line(`- **${label}** · ${line(text, cap)}`, cap);
  locked(root, 'now.md', () => {
    const before = read(root, 'now.md') || '# Open threads\n\n';
    const prefix = `- **${label}** · `;
    const rows = before.trimEnd().split('\n');
    const matches = rows.map((v, i) => v.startsWith(prefix) ? i : -1).filter(i => i >= 0);
    if (matches.length > 1) throw new Error('Duplicate chat labels: resolve them before updating.');
    if (matches.length) rows[matches[0]!] = entry; else rows.push(entry);
    atomicWrite(root, 'now.md', rows.join('\n') + '\n');
  });
}
export function writeError(root: string, text: string, agent: string): void {
  const entry = `- ${new Date().toISOString().slice(0, 10)} | ${line(agent, 80)} | ${line(text, 1000)}`;
  locked(root, 'ai-errors.md', () => {
    const before = read(root, 'ai-errors.md') || '# AI errors\n\nDate | agent | correction and prevention\n\n';
    atomicWrite(root, 'ai-errors.md', before.trimEnd() + '\n' + entry + '\n');
  });
}
