// The German UI dictionary, the same keys as it.ts, built from the area files under i18n/areas. Used by the
// renderer's t() when the language is German; the i18n unit tests check it covers every Italian key.
import { flowsDe } from './areas/flows.de';
import { routineDe } from './areas/routine.de';
import { routinesDe } from './areas/routines.de';
import { suggestDe } from './areas/suggest.de';
import { appTextDe } from './areas/app-text.de';
import { brainTextDe } from './areas/brain-text.de';
import { learningReviewDe } from './areas/learning-review.de';
import { brainModelDe } from './areas/brain-model.de';
import { memoryDe } from './areas/memory.de';
import { memoryHubDe } from './areas/memory-hub.de';
import { statsDe } from './areas/stats.de';
import { costsDe } from './areas/costs.de';
import { auditDe } from './areas/audit.de';
import { auditExpressionsDe } from './areas/audit-expressions.de';
import { componentsDe } from './areas/components.de';
import { catalogDe } from './areas/catalog.de';
import { connectorsDe } from './areas/connectors.de';
// The German UI texts (de-AT, ADR 0117): the same keys as it.ts, typed by it (a missing key fails the typecheck). Plain
// German with "du", short like the Italian. Used through t() (i18n/index.ts).
import { genuiRequestDe } from './areas/genui-request.de';
import { voiceDe } from './areas/voice.de';
import { recDe } from './areas/rec.de';
import { imparaDe } from './areas/impara.de';
import { imparaStudioDe } from './areas/impara-studio.de';
import { imparaV3De } from './areas/impara-v3.de';
import { studioDe } from './areas/studio.de';
import { permissionsDe } from './areas/permissions.de';
import { langSwitchDe } from './areas/lang-switch.de';
import type { Dict } from './index';
import { chatDe } from './areas/chat.de';
import { visualsDe } from './areas/visuals.de';
import { dialogsDe } from './areas/dialogs.de';
import { toolsDe } from './areas/tools.de';
import { brainPagesDe } from './areas/brainPages.de';
import { brainLibDe } from './areas/brainLib.de';
import { SYS_DE } from '@shared/sys';
import { productDe } from './areas/product.de';
import { agentsGridDe } from './areas/agents-grid.de';
import { levelsDe } from './areas/levels.de';
import { explainDe } from './areas/explain.de';
import { agentDetailDe } from './areas/agent-detail.de';
import { agentImageDe } from './areas/agent-image.de';
import { proposalsDe } from './areas/proposals.de';
import { settingsDe } from './areas/settings.de';
import { settingsShellDe } from './areas/settings-shell.de';
import { mcpAddDe } from './areas/mcp-add.de';
import { profileDe } from './areas/profile.de';
import { homeDe } from './areas/home.de';
import { guideDe } from './areas/guide.de';
import { pbrowserDe } from './areas/pbrowser.de';
import { treeDe } from './areas/tree.de';
import { aliveDe } from './areas/alive.de';
import { queriesDe } from './areas/queries.de';
import { lampoDe } from './areas/lampo.de';
import { awayDe } from './areas/away.de';
import { learningDe } from './areas/learning.de';
import { andamentoDe } from './areas/andamento.de';
import { estimateDe } from './areas/estimate.de';
import { logDe } from './areas/log.de';
import { reviewedContextDe } from './areas/reviewed-context.de';
import { setupDe } from './areas/setup.de';
import { viewerOverlayDe } from './areas/viewer-overlay.de';

export const de: Dict = {
  ...flowsDe,
  ...routineDe,
  ...routinesDe,
  ...learningReviewDe,
  ...auditDe,
  ...auditExpressionsDe,
  ...componentsDe,
  ...catalogDe,
  ...costsDe,
  ...connectorsDe,
  ...reviewedContextDe,
  ...setupDe,
  ...viewerOverlayDe,
  ...homeDe,
  ...guideDe,
  ...pbrowserDe,
  ...treeDe,
  ...aliveDe,
  ...queriesDe,
  ...lampoDe,
  ...awayDe,
  ...learningDe,
  ...andamentoDe,
  ...estimateDe,
  ...logDe,
  ...genuiRequestDe,
  ...voiceDe,
  ...recDe,
  ...imparaDe,
  ...imparaStudioDe,
  ...imparaV3De,
  'genui.request.question': 'Frage',
  'genui.request.permission': 'Berechtigung',
  'genui.request.from': ({ kind, chat, title }) => `${kind} von ${chat ?? 'einem Chat'}: ${title}`,
  'genui.choice.preview': "Vorschau und Details",
  'genui.cards.pros': "Vorteile",
  'genui.cards.cons': "Nachteile",
  'genui.table.region': "Datentabelle, scrolle, um alle Spalten zu lesen",
  'genui.table.links': "Links",
  'genui.chart.data': "Diagrammdaten",
  'genui.chart.label': "Bezeichnung",
  'genui.chart.value': "Wert",
  'genui.chart.note': "Notiz",
  'genui.permission.once': 'Nur dieses Mal',
  'genui.permission.session': 'Für die ganze Sitzung',
  'genui.permission.deny': 'Nicht ausführen',
  ...studioDe,
  ...permissionsDe,
  ...langSwitchDe,
  ...brainModelDe,
  ...memoryDe,
  ...memoryHubDe,
  ...statsDe,
  ...productDe,
  ...agentsGridDe,
  ...levelsDe,
  ...explainDe,
  ...agentDetailDe,
  ...agentImageDe,
  ...proposalsDe,
  ...settingsDe,
  ...settingsShellDe,
  ...mcpAddDe,
  ...profileDe,
  ...chatDe,
  ...visualsDe,
  ...dialogsDe,
  ...toolsDe,
  ...brainPagesDe,
  ...brainLibDe,
  ...brainTextDe,
  ...appTextDe,
  ...suggestDe,
  ...SYS_DE,
  'common.close': 'Schließen',
  'common.cancel': 'Abbrechen',
  'common.save': 'Speichern',
  'settings.language': 'Sprache',
  'settings.language.system': 'Wie das System',
  'settings.language.it': 'Italiano',
  'settings.language.en': 'English',
  'settings.language.de': 'Deutsch',
};
