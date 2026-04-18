"use client"

import { useLocaleCopy } from "@lib/locale-context"
import FilterRadioGroup from "@modules/common/components/filter-radio-group"

export type SortOptions = "price_asc" | "price_desc" | "created_at"

type SortProductsProps = {
  sortBy: SortOptions
  setQueryParams: (name: string, value: SortOptions) => void
  "data-testid"?: string
}

const sortOptions = [
  {
    value: "created_at",
    label: "Mới nhất",
  },
  {
    value: "price_asc",
    label: "Giá: Thấp đến Cao",
  },
  {
    value: "price_desc",
    label: "Giá: Cao đến Thấp",
  },
]

const SortProducts = ({
  "data-testid": dataTestId,
  sortBy,
  setQueryParams,
}: SortProductsProps) => {
  const copy = useLocaleCopy()
  const sortOptions = [
    {
      value: "created_at",
      label: copy.sort.latest,
    },
    {
      value: "price_asc",
      label: copy.sort.priceLowHigh,
    },
    {
      value: "price_desc",
      label: copy.sort.priceHighLow,
    },
  ]

  const handleChange = (value: SortOptions) => {
    setQueryParams("sortBy", value)
  }

  return (
    <FilterRadioGroup
      title={copy.sort.title}
      items={sortOptions}
      value={sortBy}
      handleChange={handleChange}
      data-testid={dataTestId}
    />
  )
}

export default SortProducts
