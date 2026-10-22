// Unit tests switch the UI language synchronously (setLang('en') then t()): the app loads English and German as their
// own chunks on demand (i18n/index.ts loadLang), so every test run gets both dictionaries up front.
import { registerLang } from '../../src/renderer/i18n';
import { en } from '../../src/renderer/i18n/en';
import { de } from '../../src/renderer/i18n/de';

registerLang('en', en);
registerLang('de', de);
