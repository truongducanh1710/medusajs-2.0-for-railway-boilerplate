"use client"

import { useRouter } from "next/navigation"
import ChevronDown from "@modules/common/icons/chevron-down"

export default function BackButton({ backLabel, mobileLabel }: { backLabel: string; mobileLabel: string }) {
  const router = useRouter()
  return (
    <button
      onClick={() => router.back()}
      className="text-small-semi text-ui-fg-base flex items-center gap-x-2 uppercase flex-1 basis-0 bg-transparent border-0 cursor-pointer p-0"
      data-testid="back-to-cart-link"
    >
      <ChevronDown className="rotate-90" size={16} />
      <span className="mt-px hidden small:block txt-compact-plus text-ui-fg-subtle hover:text-ui-fg-base">
        {backLabel}
      </span>
      <span className="mt-px block small:hidden txt-compact-plus text-ui-fg-subtle hover:text-ui-fg-base">
        {mobileLabel}
      </span>
    </button>
  )
}
