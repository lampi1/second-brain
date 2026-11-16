// The folders a relative path in a message may live in (ADR 0316, the owner 2026-11-15: «al momento non posso vedere i
// file esterni all'app»: `air_mcp\tools.py`, written by the Orchestrator about an agent's project, read as a file of the
// brain and was «non disponibile»). Best first: the chat's own folder (the brain when none), the folders of the chats it
// delegated, the project maps' folders, every other chat's folder (latest first), the brain, then one level above each
// (a chat that works in a subfolder of the project). The viewer opens the first of them where the path is a file
// (file-view.ts rootFor); it already reads any local file by its absolute path, so nothing new becomes readable. Used by
// ipc-handlers/app.ts (app:readFile, app:readFileDiff); pinned by test/unit/file-roots.test.ts.
import path from 'node:path';

export const FILE_ROOTS_MAX = 60;

interface ChatLike { id: string; cwd: string; parentId?: string; updatedAt: number }

export function fileRoots(o: { chatId?: string; chats: readonly ChatLike[]; mapRoots: readonly (string | undefined)[]; brainRoot?: string | null },
  platform: NodeJS.Platform = process.platform): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const chat = o.chatId ? o.chats.find(c => c.id === o.chatId) : undefined;
  const below = new Set<string>();
  if (chat) for (let grew = true; grew;) { grew = false; for (const c of o.chats) if (c.parentId && !below.has(c.id) && (c.parentId === chat.id || below.has(c.parentId))) { below.add(c.id); grew = true; } }
  const latest = [...o.chats].sort((a, b) => b.updatedAt - a.updatedAt);
  const direct = [chat?.cwd ?? o.brainRoot, ...latest.filter(c => below.has(c.id)).map(c => c.cwd), ...o.mapRoots, ...latest.map(c => c.cwd), o.brainRoot];
  const seen = new Set<string>(), out: string[] = [];
  const add = (d: string | null | undefined) => {
    if (!d || !p.isAbsolute(d)) return;
    const n = p.normalize(d), k = platform === 'win32' || platform === 'darwin' ? n.toLowerCase() : n;
    if (!seen.has(k)) { seen.add(k); out.push(n); }
  };
  for (const d of direct) add(d);
  for (const d of [...out]) { const up = p.dirname(d); if (up !== d) add(up); }
  return out.slice(0, FILE_ROOTS_MAX);
}
