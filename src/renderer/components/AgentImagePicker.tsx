// "Cambia immagine" / "Immagine predefinita" under a role's badge on its page (AgentStudio.tsx): the user picks a
// PNG, JPG or WebP, the centre square becomes the role's picture everywhere (lib/agent-images.ts, main keeps it in
// userData); "Immagine predefinita" brings the role's character back. Only for the nine roles. Styles:
// styles/agent-studio.css (.ad-picture).
import { useRef, useState } from 'react';
import type { RoleId } from '@shared/roles';
import { AgentImageError, PICK_TYPES, publishAgentImages, squarePng, useAgentImages } from '../lib/agent-images';
import { t } from '../i18n';

export function AgentImagePicker({ id }: { id: RoleId }) {
  const custom = !!useAgentImages()[id];
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await work(); } catch (e) { setError(t(e instanceof AgentImageError ? `agentImage.err.${e.code}` : 'agentImage.err.save')); } finally { setBusy(false); }
  };
  const pick = (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (file) void run(async () => publishAgentImages(await window.sb.invoke('avatars:set', { id, bytes: await squarePng(file) })));
  };
  return <div className="ad-picture" data-testid="agent-picture" data-custom={custom ? 'true' : 'false'}>
    <input ref={input} type="file" accept={PICK_TYPES.join(',')} hidden onChange={e => pick(e.target.files?.[0])} data-testid="agent-picture-input" />
    <button type="button" className="link-btn" disabled={busy} title={t('agentImage.hint')} onClick={() => input.current?.click()} data-testid="agent-picture-change">{t('agentImage.change')}</button>
    {custom && <button type="button" className="link-btn" disabled={busy} onClick={() => void run(async () => publishAgentImages(await window.sb.invoke('avatars:reset', { id })))} data-testid="agent-picture-reset">{t('agentImage.reset')}</button>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
