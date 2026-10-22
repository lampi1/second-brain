import { appTextIt } from './areas/app-text.it';
import { brainTextIt } from './areas/brain-text.it';
import { learningReviewIt } from './areas/learning-review.it';
import { cloudIt } from './areas/cloud.it';
import { agentPackIt } from './areas/agent-pack.it';
import { brainModelIt } from './areas/brain-model.it';
import { memoryIt } from './areas/memory.it';
import { statsIt } from './areas/stats.it';
import { costsIt } from './areas/costs.it';
import { auditIt } from './areas/audit.it';
import { auditExpressionsIt } from './areas/audit-expressions.it';
import { componentsIt } from './areas/components.it';
import { catalogIt } from './areas/catalog.it';
import { connectorsIt } from './areas/connectors.it';
// The Italian UI texts (ADR 0057): the source dictionary. Every key the UI shows lives here; en.ts must have the same
// keys (its type is this object's: a missing or extra key fails the typecheck). Keys are "area.what"; a value is a
// string or, when it needs numbers or names, a function of one params object. Each area has its own pair of files in
// areas/ (<area>.it.ts, <area>.en.ts), spread here. Used through t() (i18n/index.ts).
import { genuiRequestIt } from './areas/genui-request.it';
import {studioIt}from'./areas/studio.it';
import { permissionsIt } from './areas/permissions.it';
import { langSwitchIt } from './areas/lang-switch.it';
import { chatIt } from './areas/chat.it';
import { dialogsIt } from './areas/dialogs.it';
import { toolsIt } from './areas/tools.it';
import { brainPagesIt } from './areas/brainPages.it';
import { brainLibIt } from './areas/brainLib.it';
import { SYS_IT } from '@shared/sys';
import {productIt}from'./areas/product.it';
import { agentsGridIt } from './areas/agents-grid.it';
import { explainIt } from './areas/explain.it';
import { agentDetailIt } from './areas/agent-detail.it';
import { agentImageIt } from './areas/agent-image.it';
import { approvalsIt } from './areas/approvals.it';
import {settingsIt}from'./areas/settings.it';
import { profileIt } from './areas/profile.it';
import { homeIt } from './areas/home.it';
import { guideIt } from './areas/guide.it';
import { treeIt } from './areas/tree.it';
import { aliveIt } from './areas/alive.it';
import { lampoIt } from './areas/lampo.it';
import { learningIt } from './areas/learning.it';
import { suggestIt } from './areas/suggest.it';
import { estimateIt } from './areas/estimate.it';
import { logIt } from './areas/log.it';
import { reviewedContextIt } from './areas/reviewed-context.it';
import { setupIt } from './areas/setup.it';

export const it = {
  ...learningReviewIt,
  ...auditIt,
  ...auditExpressionsIt,
  ...componentsIt,
  ...agentPackIt,
  ...catalogIt,
  ...costsIt,
  ...connectorsIt,
  ...reviewedContextIt,
  ...setupIt,
  ...homeIt,
  ...cloudIt,
  ...guideIt,
  ...treeIt,
  ...aliveIt,
  ...lampoIt,
  ...learningIt,
  ...suggestIt,
  ...estimateIt,
  ...logIt,
  ...genuiRequestIt,
  'genui.request.question': 'Domanda',
  'genui.request.permission': 'Permesso',
  'genui.request.from': ({ kind, chat, title }: { kind: string; chat?: string; title: string }) => `${kind} da ${chat ?? 'una chat'}: ${title}`,
  'genui.choice.preview': "Anteprima e dettagli",
  'genui.cards.pros': "Vantaggi",
  'genui.cards.cons': "Limiti",
  'genui.table.region': "Tabella dati, scorri per leggere tutte le colonne",
  'genui.table.links': "Collegamenti",
  'genui.chart.data': "Dati del grafico",
  'genui.chart.label': "Voce",
  'genui.chart.value': "Valore",
  'genui.chart.note': "Nota",
  'genui.permission.once': "Consenti solo questa operazione.",
  'genui.permission.session': "Consenti per questa sessione",
  'genui.permission.deny': "Non autorizzare questa operazione.",
  ...studioIt,
  ...permissionsIt,
  ...langSwitchIt,
  ...brainModelIt,
  ...memoryIt,
  ...statsIt,
  ...productIt,
  ...agentsGridIt,
  ...explainIt,
  ...agentDetailIt,
  ...agentImageIt,
  ...approvalsIt,
  ...settingsIt,
  ...profileIt,
  ...chatIt,
  ...dialogsIt,
  ...toolsIt,
  ...brainPagesIt,
  ...brainLibIt,
  ...brainTextIt,
  ...appTextIt,
  ...SYS_IT,
  'common.close': 'Chiudi',
  'common.cancel': 'Annulla',
  'common.save': 'Salva',
  'settings.language': 'Lingua',
  'settings.languageDesc': 'Lingua dell’interfaccia. Come il sistema = italiano o tedesco se Windows è in una delle due lingue, altrimenti inglese.',
  'settings.language.system': 'Come il sistema',
  'settings.language.it': 'Italiano',
  'settings.language.en': 'English',
  'settings.language.de': 'Deutsch',
};
