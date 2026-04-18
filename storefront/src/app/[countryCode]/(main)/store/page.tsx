import { Metadata } from "next"

import { getCopy, localeFromCountryCode } from "@lib/i18n"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"
import StoreTemplate from "@modules/store/templates"

type Params = {
  searchParams: {
    sortBy?: SortOptions
    page?: string
  }
  params: {
    countryCode: string
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const copy = getCopy(localeFromCountryCode(params.countryCode))

  return {
    title: copy.store.allProducts,
    description:
      localeFromCountryCode(params.countryCode) === "vi"
        ? "Khám phá tất cả sản phẩm của chúng tôi."
        : "Explore all of our products.",
  }
}

export default async function StorePage({ searchParams, params }: Params) {
  const { sortBy, page } = searchParams

  return (
    <StoreTemplate
      sortBy={sortBy}
      page={page}
      countryCode={params.countryCode}
    />
  )
}
