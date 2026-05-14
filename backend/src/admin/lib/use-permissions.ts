import { useEffect, useState } from "react"

let cache: { perms: string[] | "*"; loadedAt: number } | null = null

export function useCurrentPermissions() {
  const [perms, setPerms] = useState<string[] | "*" | null>(cache?.perms ?? null)
  const [loading, setLoading] = useState(!cache)

  useEffect(() => {
    if (cache && Date.now() - cache.loadedAt < 60_000) return
    fetch("/admin/permissions/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        cache = { perms: d.permissions, loadedAt: Date.now() }
        setPerms(d.permissions)
      })
      .catch(() => {
        setPerms([])
      })
      .finally(() => setLoading(false))
  }, [])

  return {
    perms,
    loading,
    has: (p: string) => perms === "*" || (Array.isArray(perms) && perms.includes(p)),
  }
}

export function invalidatePermissionsCache() {
  cache = null
}
