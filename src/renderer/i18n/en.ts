import { flowsEn } from './areas/flows.en';
import { appTextEn } from './areas/app-text.en';
import { brainTextEn } from './areas/brain-text.en';
import { learningReviewEn } from './areas/learning-review.en';
import { cloudEn } from './areas/cloud.en';
import { brainModelEn } from './areas/brain-model.en';
import { memoryEn } from './areas/memory.en';
import { memoryHubEn } from './areas/memory-hub.en';
import { statsEn } from './areas/stats.en';
import { costsEn } from './areas/costs.en';
import { auditEn } from './areas/audit.en';
import { auditExpressionsEn } from './areas/audit-expressions.en';
import { componentsEn } from './areas/components.en';
import { catalogEn } from './areas/catalog.en';
import { connectorsEn } from './areas/connectors.en';
// The English UI texts (ADR 0057): the same keys as it.ts, typed by it (a missing key fails the typecheck). Write plain
// English, short like the Italian. Used through t() (i18n/index.ts).
import { genuiRequestEn } from './areas/genui-request.en';
import { voiceEn } from './areas/voice.en';
import {studioEn}from'./areas/studio.en';
import { permissionsEn } from './areas/permissions.en';
import { langSwitchEn } from './areas/lang-switch.en';
import type { Dict } from './index';
import { chatEn } from './areas/chat.en';
import { visualsEn } from './areas/visuals.en';
import { typingEn } from './areas/typing.en';
import { dialogsEn } from './areas/dialogs.en';
import { toolsEn } from './areas/tools.en';
import { brainPagesEn } from './areas/brainPages.en';
import { brainLibEn } from './areas/brainLib.en';
import { SYS_EN } from '@shared/sys';
import {productEn}from'./areas/product.en';
import { agentsGridEn } from './areas/agents-grid.en';
import { levelsEn } from './areas/levels.en';
import { explainEn } from './areas/explain.en';
import { agentDetailEn } from './areas/agent-detail.en';
import { agentImageEn } from './areas/agent-image.en';
import { proposalsEn } from './areas/proposals.en';
import {settingsEn}from'./areas/settings.en';
import { profileEn } from './areas/profile.en';
import { homeEn } from './areas/home.en';
import { guideEn } from './areas/guide.en';
import { pbrowserEn } from './areas/pbrowser.en';
import { treeEn } from './areas/tree.en';
import { aliveEn } from './areas/alive.en';
import { queriesEn } from './areas/queries.en';
import { lampoEn } from './areas/lampo.en';
import { learningEn } from './areas/learning.en';
import { suggestEn } from './areas/suggest.en';
import { estimateEn } from './areas/estimate.en';
import { logEn } from './areas/log.en';
import { reviewedContextEn } from './areas/reviewed-context.en';
import { setupEn } from './areas/setup.en';
import { viewerOverlayEn } from './areas/viewer-overlay.en';

export const en: Dict = {
  ...flowsEn,
  ...learningReviewEn,
  ...auditEn,
  ...auditExpressionsEn,
  ...componentsEn,
  ...catalogEn,
  ...costsEn,
  ...connectorsEn,
  ...reviewedContextEn,
  ...setupEn,
  ...viewerOverlayEn,
  ...homeEn,
  ...cloudEn,
  ...guideEn,
  ...pbrowserEn,
  ...treeEn,
  ...aliveEn,
  ...queriesEn,
  ...lampoEn,
  ...learningEn,
  ...suggestEn,
  ...estimateEn,
  ...logEn,
  ...genuiRequestEn,
  ...voiceEn,
  'genui.request.question': 'Question',
  'genui.request.permission': 'Permission',
  'genui.request.from': ({ kind, chat, title }) => `${kind} from ${chat ?? 'a chat'}: ${title}`,
  'genui.choice.preview': "Preview and details",
  'genui.cards.pros': "Benefits",
  'genui.cards.cons': "Tradeoffs",
  'genui.table.region': "Data table, scroll to read all columns",
  'genui.table.links': "Links",
  'genui.chart.data': "Chart data",
  'genui.chart.label': "Label",
  'genui.chart.value': "Value",
  'genui.chart.note': "Note",
  'genui.permission.once': 'Just this once',
  'genui.permission.session': 'For the whole session',
  'genui.permission.deny': 'Don’t do it',
  ...studioEn,
  ...permissionsEn,
  ...langSwitchEn,
  ...brainModelEn,
  ...memoryEn,
  ...memoryHubEn,
  ...statsEn,
  ...productEn,
  ...agentsGridEn,
  ...levelsEn,
  ...explainEn,
  ...agentDetailEn,
  ...agentImageEn,
  ...proposalsEn,
  ...settingsEn,
  ...profileEn,
  ...chatEn,
  ...visualsEn,
  ...typingEn,
  ...dialogsEn,
  ...toolsEn,
  ...brainPagesEn,
  ...brainLibEn,
  ...brainTextEn,
  ...appTextEn,
  ...SYS_EN,
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'settings.language': 'Language',
  'settings.language.system': 'Same as the system',
  'settings.language.it': 'Italiano',
  'settings.language.en': 'English',
  'settings.language.de': 'Deutsch',
};
