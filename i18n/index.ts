import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import de from './locales/de.json';
import en from './locales/en.json';
import fr from './locales/fr.json';
import it from './locales/it.json';
import es from './locales/es.json';
import pt from './locales/pt.json';
import nl from './locales/nl.json';
import pl from './locales/pl.json';
import cs from './locales/cs.json';
import sk from './locales/sk.json';
import hu from './locales/hu.json';
import ro from './locales/ro.json';
import bg from './locales/bg.json';
import hr from './locales/hr.json';
import sr from './locales/sr.json';
import bs from './locales/bs.json';
import sl from './locales/sl.json';
import sq from './locales/sq.json';
import el from './locales/el.json';
import tr from './locales/tr.json';
import ru from './locales/ru.json';
import mk from './locales/mk.json';
import ar from './locales/ar.json';
import ja from './locales/ja.json';
import zh from './locales/zh.json';
import sw from './locales/sw.json';

const resources = {
  de: { translation: de },
  en: { translation: en },
  fr: { translation: fr },
  it: { translation: it },
  es: { translation: es },
  pt: { translation: pt },
  nl: { translation: nl },
  pl: { translation: pl },
  cs: { translation: cs },
  sk: { translation: sk },
  hu: { translation: hu },
  ro: { translation: ro },
  bg: { translation: bg },
  hr: { translation: hr },
  sr: { translation: sr },
  bs: { translation: bs },
  sl: { translation: sl },
  sq: { translation: sq },
  el: { translation: el },
  tr: { translation: tr },
  ru: { translation: ru },
  mk: { translation: mk },
  ar: { translation: ar },
  ja: { translation: ja },
  zh: { translation: zh },
  sw: { translation: sw },
};

const LANGUAGE_KEY = '@furtgo_language';

const getDeviceLanguage = (): string => {
  const locales = getLocales();
  const deviceLang = locales[0]?.languageCode ?? 'de';
  return resources[deviceLang as keyof typeof resources] ? deviceLang : 'de';
};

export const initI18n = async () => {
  let savedLang: string | null = null;
  try {
    savedLang = await AsyncStorage.getItem(LANGUAGE_KEY);
  } catch {}

  const lng = savedLang || getDeviceLanguage();

  await i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: 'de',
    interpolation: { escapeValue: false },
  });
};

export const changeLanguage = async (lang: string) => {
  await i18n.changeLanguage(lang);
  try {
    await AsyncStorage.setItem(LANGUAGE_KEY, lang);
  } catch {}
};

export const supportedLanguages: { code: string; label: string }[] = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'cs', label: 'Čeština' },
  { code: 'sk', label: 'Slovenčina' },
  { code: 'hu', label: 'Magyar' },
  { code: 'ro', label: 'Română' },
  { code: 'bg', label: 'Български' },
  { code: 'hr', label: 'Hrvatski' },
  { code: 'sr', label: 'Српски' },
  { code: 'bs', label: 'Bosanski' },
  { code: 'sl', label: 'Slovenščina' },
  { code: 'sq', label: 'Shqip' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'ru', label: 'Русский' },
  { code: 'mk', label: 'Македонски' },
  { code: 'ar', label: 'العربية' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
  { code: 'sw', label: 'Kiswahili' },
];

export default i18n;
