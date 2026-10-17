// Thin mounted wizard boundary: uses the app's modal/locale and the existing offline interview as fallback.
import { useMemo } from 'react';
import type { SetupState } from '../../shared/agents';
import { Modal } from '../../renderer/components/ui';
import { closeModal } from '../../renderer/store/ui';
import { lang } from '../../renderer/i18n';
import { createAiSetupPort } from './port';
import { AiSetupScreen } from './Screen';
import { aiCopy } from './i18n';
export function AiFirstGate({ setup, onFallback }: { setup: SetupState; onFallback: () => void }) {
  const language = lang(), port = useMemo(() => createAiSetupPort(setup, language), []);
  return <Modal onClose={closeModal} label={aiCopy[language].title} className="modal-ai-first" testid="ai-first-modal"><div className="modal-body"><AiSetupScreen port={port} language={language} guide={setup.preferences.guide} onFallback={onFallback}/></div></Modal>;
}
