"use client"

import { useLocaleCopy } from "@lib/locale-context"
import { Heading, Text } from "@medusajs/ui"

import InteractiveLink from "@modules/common/components/interactive-link"

const EmptyCartMessage = () => {
  const copy = useLocaleCopy()

  return (
    <div className="py-48 px-2 flex flex-col justify-center items-start" data-testid="empty-cart-message">
      <Heading
        level="h1"
        className="flex flex-row text-3xl-regular gap-x-2 items-baseline"
      >
        {copy.cart.emptyTitle}
      </Heading>
      <Text className="text-base-regular mt-4 mb-6 max-w-[32rem]">
        {copy.cart.emptyDescription}
      </Text>
      <div>
        <InteractiveLink href="/store">{copy.cart.exploreProducts}</InteractiveLink>
      </div>
    </div>
  )
}

export default EmptyCartMessage
