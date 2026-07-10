import { ExecArgs } from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"

// Chạy 1 lần: cấp page.mkt-chat.view cho mọi user hiện có chưa có quyền này.
// Usage: npx medusa exec ./src/scripts/backfill-mkt-chat-permission.ts
export default async function backfillMktChatPermission({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const userModule = container.resolve(Modules.USER)

  const users = await userModule.listUsers({}, { select: ["id", "email", "metadata"] })

  let updated = 0
  for (const user of users) {
    const existingPerms: string[] = Array.isArray((user.metadata as any)?.permissions)
      ? (user.metadata as any).permissions
      : []
    if (existingPerms.includes("page.mkt-chat.view")) continue

    await userModule.updateUsers({
      id: user.id,
      metadata: { ...(user.metadata || {}), permissions: [...existingPerms, "page.mkt-chat.view"] },
    })
    updated++
    logger.info(`[backfill-mkt-chat-permission] granted page.mkt-chat.view -> ${user.email}`)
  }

  logger.info(`[backfill-mkt-chat-permission] done. ${updated}/${users.length} users updated.`)
}
