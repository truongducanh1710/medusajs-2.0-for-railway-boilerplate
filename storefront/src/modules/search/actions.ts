"use server"

import { SEARCH_INDEX_NAME, searchClient } from "@lib/search-client"

interface Hits {
  readonly objectID?: string
  id?: string
  [x: string | number | symbol]: unknown
}

/**
 * Search products bằng Postgres full-text qua adapter searchClient.
 */
export async function search(query: string) {
  const queries = [{ params: { query }, indexName: SEARCH_INDEX_NAME }]
  const { results } = (await searchClient.search(queries)) as Record<string, any>
  const { hits } = results[0] as { hits: Hits[] }
  return hits
}
