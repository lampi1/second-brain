// The two texts the file viewer compares on request (SPEC 22 V3): the file against git HEAD, against a commit or branch,
// or against another local file. Main reads both sides (read-only git, no shell); the renderer computes the diff (jsdiff).
export const DIFF_BYTES=2_000_000;
export type DiffAgainst={kind:'head'}|{kind:'ref';ref:string}|{kind:'file';path:string};
export type FileDiffReason='outside'|'missing'|'unsupported'|'binary'|'big'|'repo'|'untracked'|'ref'|'git';
export interface DiffSide{label:string;text:string}
export type FileDiffResult=
 |{kind:'diff';path:string;left:DiffSide;right:DiffSide}
 |{kind:'refused';reason:FileDiffReason};
/** A commit, branch or tag as typed by the user: what `git rev-parse` reads as one revision, never an option or a range. */
export const gitRefOk=(ref:string)=>/^[A-Za-z0-9][\w./@{}~^-]{0,199}$/.test(ref)&&!ref.includes('..');
