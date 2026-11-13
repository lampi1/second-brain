// The user's own pictures for the roles, renderer half (shared/agent-images.ts): one shared copy of main's map for
// every AgentAvatar on screen (loaded on the first badge, kept fresh by 'avatars:changed'), and the step that turns
// a chosen file into the square PNG main accepts: format and header size checked before any decoding (avatar-raster.ts),
// then the centre square drawn at AGENT_IMAGE_SIDE. Main checks and re-encodes it again. Used by AgentAvatar.tsx and
// AgentImagePicker.tsx; unit tests in test/unit/agent-images.test.ts.
import { useSyncExternalStore } from 'react';
import { AGENT_IMAGE_SIDE, type AgentImages } from '@shared/agent-images';
import { avatarRasterSize } from './avatar-raster';

let images: AgentImages = {};
let started = false;
const listeners = new Set<() => void>();
export const publishAgentImages = (next: AgentImages) => { images = next; for (const l of [...listeners]) l(); };

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const sb = typeof window !== 'undefined' ? window.sb : undefined;
  if (!started && sb) {
    started = true;
    sb.on('avatars:changed', publishAgentImages);
    void sb.invoke('avatars:get', undefined).then(publishAgentImages, () => { /* no pictures: the characters */ });
  }
  return () => { listeners.delete(fn); };
}

/** role id → its picture, for every badge (a role without one draws its character) */
export const useAgentImages = (): AgentImages => useSyncExternalStore(subscribe, () => images, () => images);

/** a phone photo is a few MB; larger is not a picture anyone picks for a badge */
export const PICK_BYTES = 15 * 1024 * 1024;
export const PICK_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type PickError = 'format' | 'size';
export class AgentImageError extends Error { constructor(readonly code: PickError) { super(code); } }

/** The centre square of a width × height picture (the part a round badge shows). */
export function centreSquare(width: number, height: number): { x: number; y: number; side: number } {
  const side = Math.min(width, height);
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side };
}

/** The chosen file as the square PNG bytes main stores (AgentImageError 'format' / 'size' when it cannot be one). */
export async function squarePng(file: File): Promise<Uint8Array> {
  if (!(PICK_TYPES as readonly string[]).includes(file.type)) throw new AgentImageError('format');
  if (file.size === 0 || file.size > PICK_BYTES) throw new AgentImageError('size');
  const header = avatarRasterSize(new Uint8Array(await file.arrayBuffer()), file.type, { min: 16, max: 8192 });
  if (!header) throw new AgentImageError('size');
  const bitmap = await createImageBitmap(file).catch(() => { throw new AgentImageError('format'); });
  try {
    const { x, y, side } = centreSquare(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(AGENT_IMAGE_SIDE, AGENT_IMAGE_SIDE);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AgentImageError('format');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, x, y, side, side, 0, 0, AGENT_IMAGE_SIDE, AGENT_IMAGE_SIDE);
    return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } finally { bitmap.close(); }
}
