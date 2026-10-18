import { agentPackEn } from './areas/agent-pack.en';
import { costsEn } from './areas/costs.en';
import { auditEn } from './areas/audit.en';
import { auditExpressionsEn } from './areas/audit-expressions.en';
import { componentsEn } from './areas/components.en';
import { catalogEn } from './areas/catalog.en';
import { agentCreateEn } from './areas/agent-create.en';
import { connectorsEn } from './areas/connectors.en';
// The English UI texts (ADR 0057): the same keys as it.ts, typed by it (a missing key fails the typecheck). Write plain
// English, short like the Italian. Used through t() (i18n/index.ts).
import { genuiRequestEn } from './areas/genui-request.en';
import {studioEn}from'./areas/studio.en';
import type { Dict } from './index';
import { chatEn } from './areas/chat.en';
import { dialogsEn } from './areas/dialogs.en';
import { toolsEn } from './areas/tools.en';
import { brainPagesEn } from './areas/brainPages.en';
import { brainLibEn } from './areas/brainLib.en';
import { SYS_EN } from '@shared/sys';
import {productEn}from'./areas/product.en';
import {lifecycleEn}from'./areas/lifecycle.en';
import { agentsGridEn } from './areas/agents-grid.en';
import { approvalsEn } from './areas/approvals.en';
import {settingsEn}from'./areas/settings.en';
import { profileEn } from './areas/profile.en';
import { homeEn } from './areas/home.en';
import { guideEn } from './areas/guide.en';
import { reviewedContextEn } from './areas/reviewed-context.en';

export const en: Dict = {
  ...auditEn,
  ...auditExpressionsEn,
  ...componentsEn,
  ...agentPackEn,
  ...catalogEn,
  ...agentCreateEn,
  ...costsEn,
  ...connectorsEn,
  ...reviewedContextEn,
  ...homeEn,
  ...guideEn,
  ...genuiRequestEn,
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
  'genui.permission.once': "Allow this operation only.",
  'genui.permission.session': "Allow for this session",
  'genui.permission.deny': "Do not authorize this operation.",
  ...studioEn,
  ...productEn,
  ...lifecycleEn,
  ...agentsGridEn,
  ...approvalsEn,
  ...settingsEn,
  ...profileEn,
  ...chatEn,
  ...dialogsEn,
  ...toolsEn,
  ...brainPagesEn,
  ...brainLibEn,
  ...SYS_EN,
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'settings.language': 'Language',
  'settings.languageDesc': 'The interface language. Same as the system = Italian when Windows is in Italian, English otherwise.',
  'settings.language.system': 'Same as the system',
  'settings.language.it': 'Italiano',
  'settings.language.en': 'English',
};
