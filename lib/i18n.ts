import { createInstance, type TOptions } from "i18next"
import { ru } from "./locales/ru"
import { en } from "./locales/en"

// Autonyms intentionally bypass translation so each language names itself.
export const nativeLanguageNames = { ru: "Русский", en: "English" } as const
export type Language = keyof typeof nativeLanguageNames
export const isLanguage = (value: unknown): value is Language => value === "ru" || value === "en"

// A bundled, synchronous instance works in popup, worker, offscreen and isolated frames.
// No DOM, React provider, storage access, remote backend or runtime eval is required.
export const i18n = createInstance()
void i18n.init({
  lng: "ru",
  fallbackLng: "ru",
  supportedLngs: ["ru", "en"],
  initAsync: false,
  keySeparator: false,
  nsSeparator: false,
  resources: { ru: { translation: ru }, en: { translation: en } },
  interpolation: { escapeValue: false },
  returnNull: false
})

export const getLanguage = (): Language => i18n.language === "en" ? "en" : "ru"
export function applyLanguage(language: Language) { void i18n.changeLanguage(language) }
export function subscribeLanguage(listener: () => void) {
  i18n.on("languageChanged", listener)
  return () => { i18n.off("languageChanged", listener) }
}

// Consumers render translations through React or textContent, never innerHTML.
type Variables<S extends string> = S extends `${string}{{${infer Name}}}${infer Rest}` ? Name | Variables<Rest> : never
export type TranslationKey = keyof typeof ru
export function t<K extends TranslationKey>(key: K, ...args: [Variables<(typeof ru)[K]>] extends [never] ? [options?: TOptions] : [options: Record<Variables<(typeof ru)[K]>, string | number> & TOptions]): string {
  return i18n.t(key as string, args[0] as TOptions)
}
