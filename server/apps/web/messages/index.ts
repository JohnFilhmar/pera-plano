import en from "./en.json" with { type: "json" };

/**
 * One locale today. The [locale] route segment and this list exist now so that adding
 * Filipino is a file drop plus one array entry, rather than moving every route file and
 * rewriting every internal link at the moment a translation is being legally reviewed.
 */
export const SUPPORTED_LOCALES = ["en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Derived from the English catalog, so `fil.json satisfies Messages` turns a missing
 * translation key into a TypeScript error instead of a runtime fallback nobody notices.
 */
export type Messages = typeof en;

const CATALOGS: Readonly<Record<Locale, Messages>> = { en };

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function getMessages(locale: Locale): Messages {
  return CATALOGS[locale];
}
