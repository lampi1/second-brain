// What the maintenance research may see of the user's text, and what a public issue may carry (ADR 0257; split out of
// research.ts): the brain's and the app's folders, the home folder, the user name, e-mails and secrets are replaced by
// placeholders. Pinned by test/unit/brainmodel/research.test.ts (scrub).

/** Removes from a public text what would identify the user: the brain's and the app's folders (wherever they are), the
 *  home folder, the user name, e-mails, tokens. */
export function scrub(text: string, privacy: { home: string; user: string; paths?: readonly { path: string; as: string }[] }): string {
  let t = text;
  for (const p of [...(privacy.paths ?? [])].sort((a, b) => b.path.length - a.path.length)) {
    if (p.path.length > 3) for (const v of new Set([p.path, p.path.replace(/\\/g, '/'), p.path.replace(/\//g, '\\')])) t = t.split(v).join(p.as);
  }
  const homes = [privacy.home, privacy.home.replace(/\\/g, '/')].filter(h => h.length > 3);
  for (const h of homes) t = t.split(h).join('~');
  t = t.replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s'"`]+/gi, '~').replace(/\/(?:home|Users)\/[^/\s'"`]+/g, '~');
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>');
  t = t.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, '<token>');
  // secrets in command lines and errors (a work thread's tools are read too, ADR 0257): auth headers, JWTs, the password
  // of a connection string, and the value of any key named like a secret
  t = t.replace(/\b(Authorization|Proxy-Authorization)(["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic|Token)\s+)?[^\s"'&;,]+/gi, '$1$2<secret>')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer <secret>')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '<token>')
    .replace(/(\/\/[^\s:/@]+:)[^\s@/]+@/g, '$1<secret>@')
    .replace(/(--?(?:passw(?:or)?d|pwd|secret|token|api-key|access-key|client-secret)\s+)[^\s-][^\s]*/gi, '$1<secret>')
    .replace(/\b([\w-]*(?:passw(?:or)?d|pwd|secret|token|api[_-]?key|access[_-]?key|account[_-]?key|private[_-]?key|sig)[\w-]*)(["']?\s*[:=]\s*["']?)[^\s"'&;,]+/gi, '$1$2<secret>');
  if (privacy.user.length > 2) t = t.replace(new RegExp(`\\b${privacy.user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '<user>');
  return t;
}
