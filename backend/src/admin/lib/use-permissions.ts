import { useEffect, useState } from "react"

type CacheData = {
  perms: string[] | "*"
  mkt_code: string | null
  mkt_codes: string[]
  is_super: boolean
  email: string
  loadedAt: number
}

let cache: CacheData | null = null

export function useCurrentPermissions() {
  const [data, setData] = useState<Omit<CacheData, "loadedAt"> | null>(
    cache ? { perms: cache.perms, mkt_code: cache.mkt_code, mkt_codes: cache.mkt_codes, is_super: cache.is_super, email: cache.email } : null
  )
  const [loading, setLoading] = useState(!cache)

  useEffect(() => {
    if (cache && Date.now() - cache.loadedAt < 30_000) return
    fetch("/admin/permissions/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const mktCode = d.mkt_code ?? null
        const mktCodes: string[] = Array.isArray(d.mkt_codes) ? d.mkt_codes : (mktCode ? [mktCode] : [])
        cache = {
          perms: d.permissions,
          mkt_code: mktCode,
          mkt_codes: mktCodes,
          is_super: !!d.is_super,
          email: d.email ?? "",
          loadedAt: Date.now(),
        }
        setData({ perms: cache.perms, mkt_code: cache.mkt_code, mkt_codes: cache.mkt_codes, is_super: cache.is_super, email: cache.email })
      })
      .catch(() => {
        setData({ perms: [], mkt_code: null, mkt_codes: [], is_super: false, email: "" })
      })
      .finally(() => setLoading(false))
  }, [])

  return {
    perms: data?.perms ?? null,
    mktCode: data?.mkt_code ?? null,
    mktCodes: data?.mkt_codes ?? [],
    isSuper: data?.is_super ?? false,
    email: data?.email ?? "",
    loading,
    has: (p: string) => data?.perms === "*" || (Array.isArray(data?.perms) && data.perms.includes(p)),
  }
}

export function invalidatePermissionsCache() {
  cache = null
}
