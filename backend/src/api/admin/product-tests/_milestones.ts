import type { MedusaRequest } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";

/** Anything that can resolve modules — a request scope or a job container. */
type Scope = { resolve: (key: any) => any };
import { resolveUserPerms } from "../../middlewares";
import { broadcastToChannel } from "../mkt-chat/_lib";
import { aggregateMetrics } from "../../../modules/product-test/kpi";
import {
  normalizeEmail,
  PRODUCT_TEST_PERMS,
  type ProductTestActor,
} from "./_lib";

// Milestones replace the old per-transition notifications. The workflow no
// longer has approval gates to hang messages off, so the chat card is driven
// by data reaching a meaningful state instead of by someone pressing a button.
export const PRODUCT_TEST_MILESTONES = {
  created: "created",
  cost_ready: "cost_ready",
  testing_started: "testing_started",
  first_result: "first_result",
  more_testing: "more_testing",
  stalled: "stalled",
  concluded: "concluded",
} as const;

export type ProductTestMilestone =
  (typeof PRODUCT_TEST_MILESTONES)[keyof typeof PRODUCT_TEST_MILESTONES];

const MILESTONE_TITLES: Record<ProductTestMilestone, string> = {
  created: "🆕 Hồ sơ test mới",
  cost_ready: "💰 Đã có giá vốn",
  testing_started: "🚀 Bắt đầu test",
  first_result: "📊 Kết quả ngày đầu",
  more_testing: "🔁 Cần test thêm",
  stalled: "⏳ Test đang ỳ",
  concluded: "🏁 Đã kết luận",
};

const CHANNEL_NAME = "Test sản phẩm";

export type MilestonePayload = {
  case_id: string;
  code: string;
  product_name: string;
  milestone: ProductTestMilestone;
  actor?: Pick<ProductTestActor, "email" | "name"> | null;
  comment?: string | null;
  image_url?: string | null;
  // Rendered as a two-column table inside the chat card, in this order.
  facts?: { label: string; value: string }[];
};

export function vnd(value: unknown): string | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return `${Math.round(number).toLocaleString("vi-VN")}đ`;
}

function ratio(value: unknown, digits = 2): string | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number.toFixed(digits);
}

function percent(value: unknown): string | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return `${(number * 100).toFixed(1)}%`;
}

/** Facts block for a case that has finished (or is mid-) testing. */
export function metricsFacts(dailyRows: any[]): { label: string; value: string }[] {
  const totals = aggregateMetrics(dailyRows);
  const facts: { label: string; value: string }[] = [
    { label: "Số ngày test", value: String(dailyRows.length) },
    { label: "Tổng chi ads", value: vnd(totals.ad_spend) || "0đ" },
    { label: "Đơn", value: String(totals.orders || 0) },
    { label: "Doanh thu", value: vnd(totals.revenue) || "0đ" },
  ];
  const cpo = vnd(totals.cpo);
  if (cpo) facts.push({ label: "Giá/đơn (CPO)", value: cpo });
  // ad_ratio is spend ÷ revenue — the team reads it as "tỉ lệ chi ads".
  const adRatio = percent(totals.ad_ratio);
  if (adRatio) facts.push({ label: "Tỉ lệ chi ads", value: adRatio });
  const cancel = percent(totals.cancellation_ratio);
  if (cancel) facts.push({ label: "Tỉ lệ huỷ", value: cancel });
  return facts;
}

/** Facts block for a single day's numbers. */
export function dailyFacts(row: any): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  if (row.test_date) facts.push({ label: "Ngày", value: String(row.test_date) });
  const spend = vnd(row.ad_spend);
  if (spend) facts.push({ label: "Chi ads", value: spend });
  if (row.leads !== null && row.leads !== undefined)
    facts.push({ label: "Lead", value: String(row.leads) });
  if (row.orders !== null && row.orders !== undefined)
    facts.push({ label: "Đơn", value: String(row.orders) });
  const revenue = vnd(row.revenue);
  if (revenue) facts.push({ label: "Doanh thu", value: revenue });
  const cpo = vnd(
    Number(row.orders) > 0 ? Number(row.ad_spend) / Number(row.orders) : NaN,
  );
  if (cpo) facts.push({ label: "Giá/đơn", value: cpo });
  return facts;
}

/**
 * Plain-text fallback. Older clients — and the channel-list preview — read
 * `content`, so the card must degrade to something readable without metadata.
 */
function buildContent(input: MilestonePayload): string {
  const lines = [
    `${MILESTONE_TITLES[input.milestone]} · ${input.code}`,
    input.product_name,
  ];
  for (const fact of input.facts || []) lines.push(`${fact.label}: ${fact.value}`);
  if (input.actor?.name) lines.push(`— ${input.actor.name}`);
  if (input.comment) lines.push(input.comment);
  return lines.join("\n");
}

async function resolveChannel(scope: Scope, actorEmail: string) {
  const svc = scope.resolve("mktTaskModule") as any;
  const channels = await svc.listMktChannels({
    name: CHANNEL_NAME,
    deleted_at: null,
  });
  const existing = channels?.[0];
  if (existing) return { svc, channel: existing };

  const userModule = scope.resolve(Modules.USER) as any;
  const users = await userModule.listUsers({}, { select: ["email", "metadata"] });
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
    .map((user: any) => ({ user_id: normalizeEmail(user.email), role: "member", joined_at: now }));

  const channel = await svc.createMktChannels({
    name: CHANNEL_NAME,
    description: "Thông báo tự động từ quy trình test sản phẩm",
    created_by: actorEmail,
    members,
    is_private: false,
    is_announcement: true,
  });
  return { svc, channel };
}

/**
 * Posts a product-test card into the "Test sản phẩm" channel. Best-effort by
 * design: chat delivery must never roll back the data write that triggered it,
 * so every failure is swallowed.
 */
export async function postMilestone(
  source: MedusaRequest | Scope,
  input: MilestonePayload,
): Promise<void> {
  // Routes pass the request; scheduled jobs pass the container directly.
  const scope: Scope = (source as MedusaRequest).scope
    ? (source as MedusaRequest).scope
    : (source as Scope);
  const actorEmail = input.actor?.email || "system";
  try {
    const { svc, channel } = await resolveChannel(scope, actorEmail);
    const message = await svc.createMktMessages({
      channel_id: channel.id,
      author_id: actorEmail,
      content: buildContent(input),
      msg_type: "product_test_event",
      metadata: {
        case_id: input.case_id,
        code: input.code,
        product_name: input.product_name,
        milestone: input.milestone,
        title: MILESTONE_TITLES[input.milestone],
        facts: input.facts || [],
        image_url: input.image_url || null,
        actor_name: input.actor?.name || null,
        comment: input.comment || null,
        url: `/app/test-san-pham?case=${input.case_id}`,
      },
      reactions: {},
      mentions: [],
      reply_count: 0,
    });
    broadcastToChannel(channel.id, "message.created", { message });
    broadcastToChannel(channel.id, "channel.updated", {});
  } catch {
    // Chat is an observer of the workflow, never a gate on it.
  }

  try {
    const notificationModule = scope.resolve(Modules.NOTIFICATION) as any;
    await notificationModule.createNotifications({
      channel: "feed",
      template: "admin-ui",
      to: "admin",
      data: {
        title: `${MILESTONE_TITLES[input.milestone]}: ${input.product_name}`,
        description: input.actor?.name || input.comment || input.code,
        url: `/app/test-san-pham?case=${input.case_id}`,
      },
    });
  } catch {
    // Notification providers are optional.
  }
}
