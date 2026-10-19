// Recognises a brain folder by its signature (a product brain's brain.json, or a legacy brain's index and data server).
// The rule a brain folder is recognised by, as the guide's brain card states it (tested in rules-tools and fresh-brain);
// the first setup links an existing brain only through the native folder picker, it never searches for one.
import fs from 'node:fs';
import path from 'node:path';
import { isProduct } from '../rules/tools';

/** A product brain is recognised by its brain.json alone (a fresh one has no AGENTS.md, ADR 0072); a legacy brain by
 * its index and data server. */
export const isBrainFolder = (dir: string): boolean =>
  isProduct(dir) || (fs.existsSync(path.join(dir, 'AGENTS.md')) && fs.existsSync(path.join(dir, 'ops', 'tools', 'brain-site.mjs')));
