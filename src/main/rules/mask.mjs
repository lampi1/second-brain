// mask: hide secrets in chat text printed by the readers (harness/cursor/chats.mjs, ops/tools/session-find.mjs).
// Labels may be markdown (`**Password:** \`x\``, `**Password**: x`; a real password leaked that way, review 10/10).
export const mask = s => String(s)
  // any name ending in key/secret/password/pwd/token/sig (AccountKey, SharedAccessKey, clientSecret...) = value
  .replace(/\b(\w*(?:key|secret|password|passwd|pwd|token|sig))((?:\*\*|__|`)?\s*(?:[:=]|"\s*:)\s*(?:\*\*|__)?\s*["'`]?)[^\s;,"'&`*]+/gi, '$1$2***')
  // secrets passed as a flag value: -P x (sqlcmd), -p / --password x (az login), -Password 'x' (PowerShell)
  .replace(/(\s-(?:p|P|-password|Password|ClientSecret|Secret|Token))(\s+)(["']?)[^\s"']+\3/g, '$1$2$3***$3')
  .replace(/\bBearer\s+[\w.~+/-]+=*/gi, 'Bearer ***')
  // long base64/hex/Entra secrets (~ included); a path (has . or -, or starts with /subscriptions/) stays readable
  .replace(/(?<![\w\\-])[A-Za-z0-9+/_=~]{40,}(?![\w\\-])/g, m => (/^\/subscriptions\//i.test(m) ? m : '***'));
