import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { installDomTranslations, refreshDomTranslations } from "./dom";
import {
  formatMessage,
  translateKey,
  translateText,
  type Language,
  type LanguagePreference,
  type TranslationKey,
  type TranslationValues,
} from "./messages";

const LANGUAGE_STORAGE_KEY = "lovcode:settings:language";

interface I18nContextValue {
  activeLanguage: Language;
  languagePreference: LanguagePreference;
  locale: "en-US" | "zh-CN";
  setLanguagePreference: (preference: LanguagePreference) => void;
  systemLanguage: Language;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  translate: (text: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function normalizeLanguage(locale: string | null | undefined): Language | null {
  if (!locale) return null;
  const normalized = locale.toLowerCase();
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("en")) return "en";
  return null;
}

function detectSystemLanguage(): Language {
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const candidate of candidates) {
    const language = normalizeLanguage(candidate);
    if (language) return language;
  }
  return "en";
}

function readStoredPreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (value === "system" || value === "en" || value === "zh") return value;
  } catch {}
  return "system";
}

function resolveLanguage(preference: LanguagePreference, systemLanguage: Language): Language {
  return preference === "system" ? systemLanguage : preference;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [languagePreference, setLanguagePreferenceState] = useState<LanguagePreference>(readStoredPreference);
  const [systemLanguage, setSystemLanguage] = useState<Language>(detectSystemLanguage);

  const activeLanguage = resolveLanguage(languagePreference, systemLanguage);
  const locale = activeLanguage === "zh" ? "zh-CN" : "en-US";

  const setLanguagePreference = useCallback((preference: LanguagePreference) => {
    setLanguagePreferenceState(preference);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
    } catch {}
  }, []);

  useEffect(() => {
    const handleLanguageChange = () => setSystemLanguage(detectSystemLanguage());
    window.addEventListener("languagechange", handleLanguageChange);
    return () => window.removeEventListener("languagechange", handleLanguageChange);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    installDomTranslations(activeLanguage);
    refreshDomTranslations(activeLanguage);
  }, [activeLanguage, locale]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LANGUAGE_STORAGE_KEY) return;
      setLanguagePreferenceState(readStoredPreference());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const t = useCallback(
    (key: TranslationKey, values?: TranslationValues) => translateKey(key, activeLanguage, values),
    [activeLanguage],
  );

  const translate = useCallback((text: string) => translateText(text, activeLanguage), [activeLanguage]);

  const value = useMemo<I18nContextValue>(() => ({
    activeLanguage,
    languagePreference,
    locale,
    setLanguagePreference,
    systemLanguage,
    t,
    translate,
  }), [activeLanguage, languagePreference, locale, setLanguagePreference, systemLanguage, t, translate]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}

export { formatMessage, translateText };
export type { Language, LanguagePreference, TranslationKey, TranslationValues };
