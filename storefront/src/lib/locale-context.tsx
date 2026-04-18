"use client"

import type { ReactNode } from "react"
import { createContext, useContext } from "react"

import { getCopy, localeFromCountryCode, Locale } from "./i18n"

const LocaleContext = createContext<Locale>("en")

export const LocaleProvider = ({
  locale,
  children,
}: {
  locale: Locale
  children: ReactNode
}) => {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  )
}

export const useLocale = () => useContext(LocaleContext)

export const useLocaleCopy = () => {
  const locale = useLocale()
  return getCopy(locale)
}

export const getLocaleFromCountryCode = localeFromCountryCode
