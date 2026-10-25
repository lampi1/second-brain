// Stable brain identity shared by the runtime and file-proposal boundary. Callers supply the canonical root.
// Comparing this identity prevents a file read from switching brains after the authenticated service was selected.
import { createHash } from 'node:crypto';
export const flowBrainContextKey = (canonicalRoot: string): string => createHash('sha256').update(process.platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot).digest('hex');
