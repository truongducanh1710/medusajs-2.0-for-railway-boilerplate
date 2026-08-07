import type { MedusaRequest } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { resolveUserPerms } from "../../middlewares";
import { broadcastToChannel } from "../mkt-chat/_lib";

export type ProductTestActor = {
  id: string;
  email: string;
  name: string;
  permissions: string[];
  is_super: boolean;
};

export const PRODUCT_TEST_PERMS = {
  view: "page.product-test.view",
  marketing: "page.product-test.marketing",
  purchasing: "page.product-test.purchasing",
  approve: "page.product-test.approve",
} as const;

export async function getProductTestActor(
  req: MedusaRequest,
): Promise<ProductTestActor | null> {
  const auth = (req as any).auth_context;
  if (auth?.actor_type !== "user" || !auth?.actor_id) return null;

  const userModule = req.scope.resolve(Modules.USER) as any;
  const user = await userModule.retrieveUser(auth.actor_id, {
    select: ["id", "email", "first_name", "last_name", "metadata"],
  });
  const email = normalizeEmail(user?.email);
  if (!email) return null;

  const isSuper = email === normalizeEmail(process.env.SUPER_ADMIN_EMAIL);
  const permissions = isSuper
    ? Object.values(PRODUCT_TEST_PERMS)
    : resolveUserPerms(user.metadata);
  return {
    id: user.id,
    email,
    name: [user.first_name, user.last_name].filter(Boolean).join(" ") || email,
    permissions,
    is_super: isSuper,
  };
}

export function actorHas(actor: ProductTestActor, permission: string): boolean {
  return actor.is_super || actor.permissions.includes(permission);
}

export function requireActorPermission(
  actor: ProductTestActor,
  permission: string,
): void {
  if (!actorHas(actor, permission)) {
    const error: any = new Error("Không có quyền thực hiện thao tác này");
    error.status = 403;
    throw error;
  }
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function cleanText(value: unknown, max = 10_000): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

export function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number =
    typeof value === "string"
      ? Number(value.replace(/,/g, "").trim())
      : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function integerVnd(value: unknown): number | null {
  const number = optionalNumber(value);
  return number === null ? null : Math.round(number);
}

export function parseVersion(value: unknown): number | null {
  const version = Number(value);
  return Number.isInteger(version) && version >= 1 ? version : null;
}

export function rejectBodyFields(body: unknown, fields: string[]): void {
  if (!body || typeof body !== "object") return;
  const found = fields.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );
  if (found.length) {
    const error: any = new Error(
      `Không được sửa trường liên kết hoặc trạng thái tại đây: ${found.join(", ")}`,
    );
    error.status = 400;
    throw error;
  }
}

export function apiError(res: any, error: any) {
  if (error?.code === "23505" && error?.constraint === "uq_product_test_case_name") {
    return res
      .status(409)
      .json({ error: "Tên sản phẩm này đã có hồ sơ test khác, vui lòng đặt tên khác" });
  }
  const status = Number(error?.status) || (error?.code === "23505" ? 409 : 500);
  return res.status(status).json({ error: error?.message || "Lỗi hệ thống" });
}

export async function notifyProductTestTransition(
  req: MedusaRequest,
  input: {
    case_id: string;
    code: string;
    product_name: string;
    action: string;
    actor: ProductTestActor;
    comment?: string | null;
  },
): Promise<void> {
  try {
    const notificationModule = req.scope.resolve(Modules.NOTIFICATION) as any;
    await notificationModule.createNotifications({
      channel: "feed",
      template: "admin-ui",
      to: "admin",
      data: {
        title: `Test sản phẩm: ${input.product_name}`,
        description: `${input.actor.name} · ${input.action}${input.comment ? ` · ${input.comment}` : ""}`,
        url: `/app/test-san-pham?case=${input.case_id}`,
      },
    });
  } catch {
    // Notification providers are optional and must never roll back workflow state.
  }

  try {
    const svc = req.scope.resolve("mktTaskModule") as any;
    const channels = await svc.listMktChannels({
      name: "Test sản phẩm",
      deleted_at: null,
    });
    let channel = channels?.[0];
    if (!channel) {
      const userModule = req.scope.resolve(Modules.USER) as any;
      const users = await userModule.listUsers(
        {},
        { select: ["email", "metadata"] },
      );
      const now = new Date().toISOString();
      const members = users
        .filter((user: any) => {
          const email = normalizeEmail(user.email);
          return (
            email &&
            (email === normalizeEmail(process.env.SUPER_ADMIN_EMAIL) ||
              resolveUserPerms(user.metadata).includes(PRODUCT_TEST_PERMS.view))
          );
        })
        .map((user: any) => ({
          user_id: normalizeEmail(user.email),
          role: "member",
          joined_at: now,
        }));

      channel = await svc.createMktChannels({
        name: "Test sản phẩm",
        description: "Thông báo tự động từ quy trình test sản phẩm",
        created_by: input.actor.email,
        members,
        is_private: false,
        is_announcement: true,
      });
    }

    const content = `🧪 ${input.code} · ${input.product_name}\n${input.action} · ${input.actor.name}${input.comment ? `\n${input.comment}` : ""}`;
    const message = await svc.createMktMessages({
      channel_id: channel.id,
      author_id: input.actor.email,
      content,
      msg_type: "product_test_event",
      metadata: {
        case_id: input.case_id,
        code: input.code,
        action: input.action,
        url: `/app/test-san-pham?case=${input.case_id}`,
      },
      reactions: {},
      mentions: [],
      reply_count: 0,
    });
    broadcastToChannel(channel.id, "message.created", { message });
    broadcastToChannel(channel.id, "channel.updated", {});
  } catch {
    // Chat is best-effort for the same reason as Admin notifications.
  }
}
