import { Text } from "@medusajs/ui"

import { getCopy, Locale } from "@lib/i18n"
import Medusa from "../../../common/icons/medusa"
import NextJs from "../../../common/icons/nextjs"

const MedusaCTA = ({ locale }: { locale: Locale }) => {
  const copy = getCopy(locale)

  return (
    <Text className="flex gap-x-2 txt-compact-small-plus items-center">
      {copy.footer.poweredBy}
      <a href="https://www.medusajs.com" target="_blank" rel="noreferrer">
        <Medusa fill="#9ca3af" className="fill-[#9ca3af]" />
      </a>
      &
      <a href="https://nextjs.org" target="_blank" rel="noreferrer">
        <NextJs fill="#9ca3af" />
      </a>
    </Text>
  )
}

export default MedusaCTA
