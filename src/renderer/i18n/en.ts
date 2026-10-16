// The English UI texts (ADR 0057): the same keys as it.ts, typed by it (a missing key fails the typecheck). Write plain
// English, short like the Italian. Used through t() (i18n/index.ts).
import type { Dict } from './index';
import { chatEn } from './areas/chat.en';
import { dialogsEn } from './areas/dialogs.en';
import { toolsEn } from './areas/tools.en';
import { brainPagesEn } from './areas/brainPages.en';
import { brainLibEn } from './areas/brainLib.en';
import { SYS_EN } from '@shared/sys';

export const en: Dict = {
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
