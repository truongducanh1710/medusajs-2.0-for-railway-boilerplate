/**
 * Search client adapter — Postgres full-text qua Medusa native /store/products?q=
 *
 * Thay thế MeiliSearch để tiết kiệm chi phí. Giữ nguyên interface mà
 * react-instantsearch-hooks-web mong đợi nên KHÔNG cần sửa SearchModal,
 * SearchBox, Hits, Hit components.
 *
 * Interface phải implement (theo InstantSearch JS client spec):
 *   searchClient.search(requests) → Promise<{ results: SearchResponse[] }>
 *
 * Mỗi SearchResponse cần các field core:
 *   { hits, nbHits, page, nbPages, hitsPerPage, processingTimeMS, query }
 */

import { sdk } from "@lib/config"

export const SEARCH_INDEX_NAME = "products"

const SEARCH_LIMIT = 20

type InstantSearchRequest = {
  indexName: string
  params?: {
    query?: string
    hitsPerPage?: number
    page?: number
  }
}

type ProductHit = {
  objectID: string
  id: string
  title: string
  handle: string
  description: string | null
  thumbnail: string | null
}

async function fetchProductsByQuery(query: string, limit: number, offset: number): Promise<{ hits: ProductHit[]; total: number }> {
  if (!query || !query.trim()) {
    return { hits: [], total: 0 }
  }

  try {
    // Medusa JS SDK gọi /store/products với param q → Postgres ILIKE/FTS trên title/handle/description
    const res = await sdk.store.product.list({
      q: query,
      limit,
      offset,
      fields: "id,title,handle,description,thumbnail",
    })

    const products = (res?.products ?? []) as any[]
    const total = (res as any)?.count ?? products.length

    const hits: ProductHit[] = products.map((p) => ({
      objectID: p.id,
      id: p.id,
      title: p.title ?? "",
      handle: p.handle ?? "",
      description: p.description ?? null,
      thumbnail: p.thumbnail ?? null,
    }))

    return { hits, total }
  } catch (err) {
    console.error("[search-client] fetch error", err)
    return { hits: [], total: 0 }
  }
}

export const searchClient = {
  async search(requests: InstantSearchRequest[]) {
    const results = await Promise.all(
      requests.map(async (req) => {
        const query = req.params?.query ?? ""
        const hitsPerPage = req.params?.hitsPerPage ?? SEARCH_LIMIT
        const page = req.params?.page ?? 0
        const offset = page * hitsPerPage

        const t0 = Date.now()
        const { hits, total } = await fetchProductsByQuery(query, hitsPerPage, offset)
        const processingTimeMS = Date.now() - t0

        return {
          hits,
          nbHits: total,
          page,
          nbPages: Math.max(1, Math.ceil(total / hitsPerPage)),
          hitsPerPage,
          processingTimeMS,
          query,
          params: "",
          exhaustiveNbHits: true,
          index: req.indexName,
        }
      })
    )
    return { results }
  },

  // InstantSearch còn gọi searchForFacetValues khi có Filter component — stub trả về rỗng
  async searchForFacetValues() {
    return [{ facetHits: [], exhaustiveFacetsCount: true, processingTimeMS: 0 }]
  },
}
