import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateRegionsWorkflow } from "@medusajs/medusa/core-flows"

export default async function syncSePayRegion({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "payment_providers.*", "countries.*"],
  })

  const vnRegions = (regions ?? []).filter((region: any) => {
    const name = String(region?.name ?? "").toLowerCase()
    const hasVnCountry = region?.countries?.some(
      (country: any) => String(country?.iso_2 ?? "").toLowerCase() === "vn"
    )

    return name === "vn" || hasVnCountry
  })

  if (!vnRegions.length) {
    logger.info("[SePay sync] No VN region found, skipping")
    return
  }

  for (const region of vnRegions) {
    const existingProviders = (region.payment_providers ?? [])
      .map((provider: any) => provider?.id)
      .filter(Boolean)

    if (existingProviders.includes("sepay")) {
      logger.info("[SePay sync] Region already has sepay enabled", {
        regionId: region.id,
      })
      continue
    }

    const paymentProviders = Array.from(
      new Set([...existingProviders, "sepay"])
    )

    await updateRegionsWorkflow(container).run({
      input: {
        selector: { id: region.id },
        update: {
          payment_providers: paymentProviders,
        },
      },
    })

    logger.info("[SePay sync] Enabled sepay in region", {
      regionId: region.id,
      paymentProviders,
    })
  }
}
