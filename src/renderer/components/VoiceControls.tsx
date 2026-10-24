// Voice mode's controls (ADR 0152, mockup /mnt/project-files/ui-review/voce/mockup-voce.png): the mic button that takes
// the place of the «Invio» hint in the Orchestrator's and Flash's input (muted ↔ on, Ctrl+M), and the bar under that
// input while voice is on: a steady red dot «In ascolto», the volume bars while you talk, «Trascrivo…», «Ti sto
// rispondendo» (Esc silences), the first-time download. Used by ChatInput.tsx. State: lib/voice.ts.
import { stopSpeaking, toggleVoice, useVoice, type VoiceTarget } from '../lib/voice';
import { IconMic } from './Icons';
import { Kbd } from './ui';
import { t } from '../i18n';

export function MicButton({ target, testid }: { target: VoiceTarget; testid: string }) {
  const phase = useVoice(s => s.phase), mine = useVoice(s => s.target === target);
  const on = phase !== 'off' && mine;
  const label = on ? t('voice.off') : t('voice.on');
  return <button type="button" className={`mic-btn ${on ? 'on' : ''} ${on && phase === 'preparing' ? 'is-preparing' : ''}`} aria-pressed={on} aria-label={label} data-tip={`${label}|Ctrl M`}
    onClick={() => void toggleVoice(target)} data-testid={`${testid}-mic`}><IconMic size={14} /></button>;
}

const BARS = [0.45, 0.8, 1, 0.65, 0.9, 0.5];

export function VoiceBar({ target, testid }: { target: VoiceTarget; testid: string }) {
  const s = useVoice(v => v);
  if (s.phase === 'off' || s.target !== target) return null;
  const dl = s.engine?.downloading;
  const pct = dl && dl.total ? Math.round((dl.done / dl.total) * 100) : 0;
  const speaking = s.phase === 'speaking';
  return <div className={`voice-bar is-${s.phase}`} role="status" aria-live="polite" data-testid={`${testid}-voice`} data-phase={s.phase}>
    {speaking
      ? <span className="voice-wave" aria-hidden="true">{BARS.map((h, i) => <i key={i} style={{ animationDelay: `${i * 90}ms`, height: `${Math.round(h * 14)}px` }} />)}</span>
      : <span className={`voice-dot ${s.phase === 'preparing' ? 'is-wait' : ''}`} aria-hidden="true" />}
    {(s.phase === 'hearing' || s.phase === 'transcribing') && <span className="voice-level" aria-hidden="true">{BARS.map((h, i) => <i key={i} style={{ height: `${Math.max(3, Math.round(h * s.level * 14))}px` }} />)}</span>}
    <b>{s.phase === 'preparing' ? t('voice.preparing', { mb: s.engine?.missingMb ?? 0 })
      : s.phase === 'starting' ? t('voice.starting')
      : s.phase === 'hearing' ? t('voice.hearing')
      : s.phase === 'transcribing' ? t('voice.transcribing')
      : speaking ? t('voice.speaking')
      : s.question ? t('voice.listeningAnswer') : t('voice.listening')}</b>
    {s.phase === 'preparing' && dl && <span className="voice-dl" aria-label={`${pct}%`}><i style={{ width: `${pct}%` }} /></span>}
    <span className="sp" />
    {speaking
      ? <button type="button" className="voice-hint" onClick={() => stopSpeaking()} data-testid={`${testid}-voice-hush`}><Kbd>Esc</Kbd> {t('voice.hush')}</button>
      : s.phase === 'transcribing' ? <span className="voice-hint">{t('voice.sendsAlone')}</span>
      : <button type="button" className="voice-hint" onClick={() => void toggleVoice()} data-testid={`${testid}-voice-off`}><Kbd>Ctrl M</Kbd> {t('voice.offShort')}</button>}
  </div>;
}
