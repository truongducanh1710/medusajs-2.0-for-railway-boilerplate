import { IUserModuleService } from '@medusajs/framework/types'
import { Modules } from '@medusajs/framework/utils'
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'

// User mới luôn được cấp quyền xem chat MKT mặc định (page.mkt-chat.view),
// để không phải bật thủ công cho từng người sau khi tạo tài khoản.
const DEFAULT_PERMISSIONS = ['page.mkt-chat.view']

export default async function userCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<any>) {
  const userModuleService: IUserModuleService = container.resolve(Modules.USER)

  try {
    const user = await userModuleService.retrieveUser(data.id, { select: ['id', 'metadata'] })
    const existingPerms: string[] = Array.isArray((user.metadata as any)?.permissions)
      ? (user.metadata as any).permissions
      : []
    const merged = [...new Set([...existingPerms, ...DEFAULT_PERMISSIONS])]
    if (merged.length === existingPerms.length) return

    await userModuleService.updateUsers({
      id: data.id,
      metadata: { ...(user.metadata || {}), permissions: merged },
    })
  } catch (error) {
    console.error('[user-created] Không gán được quyền mkt-chat mặc định:', error)
  }
}

export const config: SubscriberConfig = {
  event: ['user.created'],
}
