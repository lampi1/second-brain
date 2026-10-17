// The Italian UI texts (ADR 0057): the source dictionary. Every key the UI shows lives here; en.ts must have the same
// keys (its type is this object's: a missing or extra key fails the typecheck). Keys are "area.what"; a value is a
// string or, when it needs numbers or names, a function of one params object. Each area has its own pair of files in
// areas/ (<area>.it.ts, <area>.en.ts), spread here. Used through t() (i18n/index.ts).
import {studioIt}from'./areas/studio.it';
import { chatIt } from './areas/chat.it';
import { dialogsIt } from './areas/dialogs.it';
import { toolsIt } from './areas/tools.it';
import { brainPagesIt } from './areas/brainPages.it';
import { brainLibIt } from './areas/brainLib.it';
import { SYS_IT } from '@shared/sys';
import {productIt}from'./areas/product.it';
import {settingsIt}from'./areas/settings.it';

export const it = {
  ...studioIt,
  ...productIt,
  ...settingsIt,
  ...chatIt,
  ...dialogsIt,
  ...toolsIt,
  ...brainPagesIt,
  ...brainLibIt,
  ...SYS_IT,
  'common.close': 'Chiudi',
  'common.cancel': 'Annulla',
  'common.save': 'Salva',
  'settings.language': 'Lingua',
  'settings.languageDesc': 'Lingua dell’interfaccia. Come il sistema = italiano se Windows è in italiano, altrimenti inglese.',
  'settings.language.system': 'Come il sistema',
  'settings.language.it': 'Italiano',
  'settings.language.en': 'English',
};
