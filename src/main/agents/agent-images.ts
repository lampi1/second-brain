// The user's own pictures for the roles (shared/agent-images.ts): `<userData>/agent-images/<roleId>.png`, one per
// role. Main never trusts the renderer's bytes: a picture must be a PNG within AGENT_IMAGE_BYTES, decode (Electron's
// nativeImage, injected so the tests pass a fake), be square and small, and is re-encoded at AGENT_IMAGE_SIDE before
// it is written (no metadata, no extra chunks survive). Ids are checked against the fixed roles, so a name can never
// leave the folder (ADR 0182). Used by index.ts ('avatars:get' / 'avatars:set' / 'avatars:reset'); unit tests in
// test/unit/agent-images.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { AGENT_IMAGE_BYTES, AGENT_IMAGE_SIDE, type AgentImages } from '../../shared/agent-images';
import { ROLE_IDS, isRoleId, type RoleId } from '../../shared/roles';
import { log } from '../log';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Decodes the bytes and returns them re-encoded as a PNG of side × side, or null when they are not a usable image. */
export type Reencode = (bytes: Buffer, side: number) => Buffer | null;

export class AgentImageStore {
  private cache: AgentImages | null = null;
  constructor(private readonly dir: string, private readonly reencode: Reencode, private readonly changed: (images: AgentImages) => void = () => {}) {}

  get(): AgentImages {
    if (this.cache) return this.cache;
    const out: AgentImages = {};
    for (const id of ROLE_IDS) {
      try { out[id] = `data:image/png;base64,${fs.readFileSync(this.file(id)).toString('base64')}`; } catch { /* no picture: the character */ }
    }
    return (this.cache = out);
  }

  set(id: unknown, bytes: unknown): AgentImages {
    const role = this.role(id);
    if (!(bytes instanceof Uint8Array) || bytes.length < PNG_SIGNATURE.length || bytes.length > AGENT_IMAGE_BYTES || !PNG_SIGNATURE.every((v, i) => bytes[i] === v)) {
      throw new Error('AGENT_IMAGE_INVALID: serve un PNG di al massimo 600 KB');
    }
    const png = this.reencode(Buffer.from(bytes), AGENT_IMAGE_SIDE);
    if (!png) throw new Error('AGENT_IMAGE_INVALID: immagine non leggibile');
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file(role)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, png);
    fs.renameSync(tmp, this.file(role));
    log.info('agents', 'role picture set', { data: { role, bytes: png.length } });
    return this.update();
  }

  reset(id: unknown): AgentImages {
    const role = this.role(id);
    fs.rmSync(this.file(role), { force: true });
    log.info('agents', 'role picture reset', { data: { role } });
    return this.update();
  }

  private update(): AgentImages {
    this.cache = null;
    const images = this.get();
    this.changed(images);
    return images;
  }
  private role(id: unknown): RoleId {
    if (!isRoleId(id)) throw new Error('AGENT_IMAGE_ROLE: ruolo sconosciuto');
    return id;
  }
  private file(id: RoleId): string { return path.join(this.dir, `${id}.png`); }
}

/** The real decoder: Electron's nativeImage (main process only). A picture that is not about square, or larger than
 *  4096 px a side, is refused: the renderer already crops and scales to AGENT_IMAGE_SIDE. */
export function nativeReencode(nativeImage: { createFromBuffer(b: Buffer): { isEmpty(): boolean; getSize(): { width: number; height: number }; resize(o: { width: number; height: number; quality: 'best' }): { toPNG(): Buffer } } }): Reencode {
  return (bytes, side) => {
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    if (width < 16 || height < 16 || width > 4096 || height > 4096 || Math.abs(width - height) > 2) return null;
    return image.resize({ width: side, height: side, quality: 'best' }).toPNG();
  };
}
