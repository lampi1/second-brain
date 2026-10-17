// Creates a personal brain from the verified template of this installed release. Main supplies the picked local
// destination; the renderer cannot supply a script/repo/runtime or enable global hooks/settings. Wired by main only.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { Harness } from '../../shared/contract';
import { runNode, type NodeRunner } from './node';

export interface CreateBrainFields { name: string; role: string; language: 'it' | 'en'; harness: Harness }
export interface BrainCreationCapability { available: boolean; reason?: string }
export interface BrainCreatorOptions { appPath: string; node: NodeRunner; run?: typeof runNode }
const REQUIRED = ['install.mjs', 'AGENTS.md', 'me.template.md', 'ops/tools/mem.mjs', 'ops/tools/ctx.mjs', 'ops/tools/chat-prompt.mjs', 'ops/tools/brain-site.mjs'];
const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const within = (root: string, file: string) => { const relative = path.relative(root, file); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative); };

/** libuv rename can replace an existing regular file even for a directory source on Windows. Directory.Move is the
 * native no-replace operation. Its command is constant; paths are environment data, never shell text or PATH lookups. */
export async function publishNewBrain(source: string, destination: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Creazione disponibile solo su Windows.');
  const exe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = "$ErrorActionPreference = 'Stop'; [System.IO.Directory]::Move($env:SB_CREATE_SOURCE, $env:SB_CREATE_DESTINATION)";
  await new Promise<void>((resolve, reject) => {
    execFile(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      shell: false, windowsHide: true, timeout: 15000,
      env: { ...process.env, SB_CREATE_SOURCE: source, SB_CREATE_DESTINATION: destination },
    }, error => error ? reject(new Error('La destinazione esiste o non è accessibile. La memoria preparata viene conservata separatamente.')) : resolve());
  });
}

function regularTree(root: string): string[] {
  const result: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink() || !samePath(fs.realpathSync(file), file)) throw new Error('Il template contiene collegamenti non consentiti.');
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) result.push(path.relative(root, file).split(path.sep).join('/'));
      else throw new Error('Il template contiene un tipo di file non supportato.');
    }
  };
  walk(root);
  return result;
}

export class BrainCreator {
  constructor(private readonly options: BrainCreatorOptions) {}

  private verifiedTemplate(): string {
    if (process.platform !== 'win32') throw new Error('La creazione da questa versione è disponibile solo su Windows. Collega una memoria esistente.');
    const app = path.resolve(this.options.appPath);
    if (fs.existsSync(path.join(app, '.git')) || !samePath(fs.realpathSync(app), app)) throw new Error('La creazione richiede un template della versione installata.');
    const release = JSON.parse(fs.readFileSync(path.join(app, 'release.json'), 'utf8')) as { id?: string; templateManifestSha256?: string };
    if (!release.id || path.basename(app) !== release.id || !/^[a-f0-9]{64}$/.test(release.templateManifestSha256 ?? '')) throw new Error('Template della versione installata non verificabile.');
    const manifestFile = path.join(app, 'brain-template.manifest.json');
    if (fs.lstatSync(manifestFile).isSymbolicLink() || hash(manifestFile) !== release.templateManifestSha256) throw new Error('Il manifest del template non corrisponde alla versione installata.');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as { schema?: number; files?: Record<string, string> };
    if (manifest.schema !== 1 || !manifest.files || Array.isArray(manifest.files) || typeof manifest.files !== 'object') throw new Error('Manifest del template non supportato.');
    const template = path.join(app, 'brain-template');
    if (fs.lstatSync(template).isSymbolicLink() || !samePath(fs.realpathSync(template), template)) throw new Error('Il template non può essere un collegamento.');
    const actual = regularTree(template).sort();
    const names = Object.keys(manifest.files).sort();
    if (JSON.stringify(actual) !== JSON.stringify(names) || REQUIRED.some(file => !names.includes(file))) throw new Error('Il template installato è incompleto.');
    for (const file of actual) {
      const target = path.resolve(template, file);
      if (!within(template, target) || !/^[a-f0-9]{64}$/.test(manifest.files[file] ?? '') || hash(target) !== manifest.files[file]) throw new Error('Verifica dei file del template non riuscita.');
    }
    return template;
  }

  capability(): BrainCreationCapability {
    try { this.verifiedTemplate(); return { available: true }; }
    catch (error) { return { available: false, reason: error instanceof Error ? error.message : 'Template non disponibile.' }; }
  }

  async create(destination: string, fields: CreateBrainFields): Promise<{ root: string }> {
    const template = this.verifiedTemplate();
    if (!fields || typeof fields.name !== 'string' || typeof fields.role !== 'string' || typeof fields.harness !== 'string' ||
        !['it', 'en'].includes(fields.language) || !fields.name.trim() || fields.name.length > 80 || fields.role.length > 240 ||
        /^[\s]*--/.test(fields.name) || /^[\s]*--/.test(fields.role) || /[\x00-\x1f\x7f]/.test(fields.name + fields.role) ||
        /["\\`${}<>]/.test(fields.name) || !/^[a-z][a-z0-9_-]{0,63}$/.test(fields.harness)) throw new Error('Nome, ruolo, lingua o motore non validi.');
    if (typeof destination !== 'string' || destination.length > 4096 || !path.isAbsolute(destination) || /^(?:\\\\|\/\/)/.test(destination) || /[\x00-\x1f]/.test(destination)) throw new Error('Scegli una nuova cartella locale con percorso assoluto.');
    const root = path.resolve(destination);
    const parent = path.dirname(root);
    if (!/^[\p{L}\p{N} ._-]+$/u.test(path.basename(root)) || /[. ]$/.test(path.basename(root))) throw new Error('Scegli un nome di cartella semplice, senza punto o spazio finale.');
    const parentStat = fs.lstatSync(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || !samePath(fs.realpathSync.native(parent), parent)) throw new Error('La cartella superiore deve essere locale e senza collegamenti.');
    if (fs.existsSync(root)) throw new Error('La destinazione esiste già: scegli una cartella nuova.');
    // Do not let a replacement of the picked destination redirect installer writes. Populate an unpredictable,
    // separately reserved sibling, then publish with a native Windows no-replace directory move.
    const stage = fs.mkdtempSync(path.join(parent, '.second-brain-create-'));
    const reserved = fs.lstatSync(stage);
    const owned = () => {
      try { const current = fs.lstatSync(stage); return !current.isSymbolicLink() && current.dev === reserved.dev && current.ino === reserved.ino && samePath(fs.realpathSync.native(stage), stage) && samePath(fs.realpathSync.native(parent), parent); } catch { return false; }
    };
    try {
      if (!owned()) throw new Error('La destinazione è cambiata durante la creazione.');
      const args = ['--yes', '--name', fields.name.trim(), '--dir', root, '--output-dir', stage, '--repos', parent, '--role', fields.role.trim() || 'professional', '--lang', fields.language === 'it' ? 'italiano' : 'English', '--harness', fields.harness];
      const node = { exe: this.options.node.exe, env: { ...this.options.node.env, ELECTRON_RUN_AS_NODE: '1' } };
      const result = await (this.options.run ?? runNode)(node, path.join(template, 'install.mjs'), args, template, 60000);
      if (result.code !== 0) throw new Error('Creazione della memoria non riuscita. La cartella parziale viene conservata.');
      if (!owned()) throw new Error('La destinazione è cambiata durante la creazione.');
      for (const file of ['AGENTS.md', 'me.md', 'ops/tools/brain-site.mjs']) {
        const target = path.join(stage, file);
        if (!samePath(fs.realpathSync(target), target) || !fs.lstatSync(target).isFile()) throw new Error('La memoria creata è incompleta.');
      }
      this.verifiedTemplate(); // do not report success if the source changed while the installer was copying
      regularTree(stage); // never publish links or special files created by an installer
      if (fs.existsSync(root)) throw new Error('La destinazione ora esiste: la memoria preparata viene conservata separatamente.');
      await publishNewBrain(stage, root);
      return { root };
    } catch (error) {
      // Remove only the still-owned EMPTY reservation. Nonempty data is retained; never recursively delete user files.
      if (owned()) {
        try { fs.rmdirSync(stage); }
        catch { throw new Error(`${error instanceof Error ? error.message : 'Creazione non riuscita.'} Cartella preparata: ${stage}`); }
      }
      throw error;
    }
  }
}
