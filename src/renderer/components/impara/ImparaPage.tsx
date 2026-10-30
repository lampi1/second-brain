// The Impara page (ADR 0185; owner 2026-10-29: «una sezione di apprendimento … che usa la voce dell'app, schemi e
// disegni per spiegarmi le cose», style A chosen on the proposal's card): the start (ImparaStart.tsx: what to learn, a
// PR of the Task page or a GitHub link, a topic, a pasted text, how deep, how much the user knows already, the two
// voices; the saved lessons) or, with the page's argument, one lesson (ImparaPlayer.tsx). Mounted by App.tsx's
// PageFrame; the address is impara/<lesson id>, so back and forward move between the list and a lesson; impara/ripasso
// (today's review) and impara/ripasso:<subject> (a subject's quiz) open a review session (ImparaReview.tsx, ADR 0189);
// impara/quiz:<lesson id> plays that lesson's «Studio» quiz the same way (ADR 0205).
import { ui } from '../../store/ui';
import { readReviewArg, startImpara } from '../../lib/impara';
import { t } from '../../i18n';
import { ImparaPlayer } from './ImparaPlayer';
import { ImparaStart } from './ImparaStart';
import { ImparaReview } from './ImparaReview';
import '../../styles/impara.css';
import '../../styles/impara-studio.css';

export function ImparaPage() {
  startImpara();
  const arg = ui.use(s => s.pageArg);
  const review = readReviewArg(arg);
  return (
    <div className="bx bx-page bx-scroll ip-page" data-testid="impara-page" role="region" aria-label={t('brainPages.nav.impara')}>
      <div className="bx-inner ip-inner">{review ? <ImparaReview key={arg} subject={review.subject} lesson={review.lesson} /> : arg ? <ImparaPlayer key={arg} id={arg} /> : <ImparaStart />}</div>
    </div>
  );
}
