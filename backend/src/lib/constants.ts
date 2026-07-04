import { loadEnv } from '@medusajs/framework/utils'

import { assertValue } from 'utils/assert-value'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

/**
 * Is development environment
 */
export const IS_DEV = process.env.NODE_ENV === 'development'

/**
 * Public URL for the backend
 */
export const BACKEND_URL = process.env.BACKEND_PUBLIC_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN_VALUE ?? 'http://localhost:9000'

/**
 * Database URL for Postgres instance used by the backend
 */
export const DATABASE_URL = assertValue(
  process.env.DATABASE_URL,
  'Environment variable for DATABASE_URL is not set',
)

/**
 * (optional) Redis URL for Redis instance used by the backend
 */
export const REDIS_URL = process.env.REDIS_URL;

/**
 * Admin CORS origins
 */
export const ADMIN_CORS = process.env.ADMIN_CORS;

/**
 * Auth CORS origins
 */
export const AUTH_CORS = process.env.AUTH_CORS;

/**
 * Store/frontend CORS origins
 */
export const STORE_CORS = process.env.STORE_CORS;

/**
 * JWT Secret used for signing JWT tokens
 */
export const JWT_SECRET = assertValue(
  process.env.JWT_SECRET,
  'Environment variable for JWT_SECRET is not set',
)

/**
 * Cookie secret used for signing cookies
 */
export const COOKIE_SECRET = assertValue(
  process.env.COOKIE_SECRET,
  'Environment variable for COOKIE_SECRET is not set',
)

/**
 * (optional) Minio configuration for file storage
 */
export const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT;
export const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY;
export const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY;
export const MINIO_BUCKET = process.env.MINIO_BUCKET; // Optional, if not set bucket will be called: medusa-media

/**
 * (optional) Resend API Key and from Email - do not set if using SendGrid
 */
export const RESEND_API_KEY = process.env.RESEND_API_KEY;
export const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM;

/**
 * (optionl) SendGrid API Key and from Email - do not set if using Resend
 */
export const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
export const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || process.env.SENDGRID_FROM;

/**
 * (optional) Stripe API key and webhook secret
 */
export const STRIPE_API_KEY = process.env.STRIPE_API_KEY;
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * (optional) Meilisearch configuration
 */
export const MEILISEARCH_HOST = process.env.MEILISEARCH_HOST;
export const MEILISEARCH_ADMIN_KEY =
  process.env.MEILISEARCH_ADMIN_KEY || process.env.MEILISEARCH_MASTER_KEY;

/**
 * (optional) Pancake POS configuration
 */
export const PANCAKE_API_KEY = process.env.PANCAKE_API_KEY || ''
export const PANCAKE_SHOP_ID = process.env.PANCAKE_SHOP_ID || ''
export const PANCAKE_WAREHOUSE_ID = process.env.PANCAKE_WAREHOUSE_ID || ''
export const PANCAKE_API_BASE = 'https://pos.pages.fm/api/v1'
export const PANCAKE_WEBHOOK_SECRET = process.env.PANCAKE_WEBHOOK_SECRET || ''

/**
 * Multi-shop Pancake config. `market` là khóa định danh thị trường dùng trong DB
 * (`pancake_order.market`) — 1 market có thể gồm NHIỀU shop Pancake (vd Malaysia có
 * TikTok Shop + Shopee, mỗi sàn là 1 shop_id riêng nhưng cùng currency/kho MY).
 * Phân biệt sàn qua field `source` trên đơn (auto-detect từ order_sources_name).
 */
export type PancakeShopConfig = {
  market: string
  shopId: string
  apiKey: string
  warehouseId?: string
  currency: string
  label: string
  platform?: string   // 'tiktok' | 'shopee' | ... — chỉ để log/nhận diện, không lưu DB
}

export const PANCAKE_SHOPS: PancakeShopConfig[] = [
  {
    market: 'VN',
    shopId: PANCAKE_SHOP_ID,
    apiKey: PANCAKE_API_KEY,
    warehouseId: PANCAKE_WAREHOUSE_ID,
    currency: 'VND',
    label: 'Việt Nam',
  },
  {
    market: 'MY',
    shopId: process.env.PANCAKE_MY_SHOP_ID || '120193131',
    apiKey: process.env.PANCAKE_MY_API_KEY || '',
    warehouseId: process.env.PANCAKE_MY_WAREHOUSE_ID || '',
    currency: 'MYR',
    label: 'Malaysia (TikTok)',
    platform: 'tiktok',
  },
  {
    market: 'MY',
    shopId: process.env.PANCAKE_SHOPEE_MY_SHOP_ID || '6018352',
    apiKey: process.env.PANCAKE_SHOPEE_MY_API_KEY || '',
    warehouseId: process.env.PANCAKE_SHOPEE_MY_WAREHOUSE_ID || '',
    currency: 'MYR',
    label: 'Malaysia (Shopee)',
    platform: 'shopee',
  },
]

/** Lấy shop đầu tiên của 1 market (dùng cho currency/kho — các shop cùng market chung currency). */
export function getPancakeShop(market: string): PancakeShopConfig {
  const shop = PANCAKE_SHOPS.find(s => s.market === market)
  if (!shop) throw new Error(`Unknown Pancake market: ${market}`)
  return shop
}

/** Tất cả shop của 1 market (Malaysia có nhiều sàn). */
export function getPancakeShopsForMarket(market: string): PancakeShopConfig[] {
  return PANCAKE_SHOPS.filter(s => s.market === market)
}

/**
 * Tỷ giá quy đổi MYR → VND cho hiển thị báo cáo — admin tự chỉnh qua env khi cần,
 * không dùng API tỷ giá real-time (theo yêu cầu: đơn giản, đủ dùng cho báo cáo tham khảo).
 */
export const MYR_TO_VND_RATE = Number(process.env.MYR_TO_VND_RATE || '5800')

/**
 * (optional) Sepay configuration
 */
export const SEPAY_API_TOKEN = process.env.SEPAY_API_TOKEN
export const SEPAY_ACCOUNT_NUMBER = process.env.SEPAY_ACCOUNT_NUMBER
export const SEPAY_BANK = process.env.SEPAY_BANK
export const SEPAY_API_URL = process.env.SEPAY_API_URL

/**
 * (optional) Facebook Pages configuration — dùng cho Marketing Hub (đăng bài + đọc data page).
 * FB_USER_TOKEN là long-lived user token (60 ngày) quản lý các Pages.
 * Fallback sang FB_ACCESS_TOKEN nếu chưa set riêng — token Ads hiện tại đã có đủ
 * quyền Pages (pages_manage_posts...) nên dùng chung được.
 */
export const FB_USER_TOKEN = process.env.FB_SYSTEM_TOKEN || process.env.FB_USER_TOKEN || process.env.FB_ACCESS_TOKEN || ''
export const FB_GRAPH_VERSION = process.env.FB_GRAPH_VERSION || 'v25.0'
export const FB_GRAPH_BASE = `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION || 'v25.0'}`

/**
 * Worker mode
 */
export const WORKER_MODE =
  (process.env.MEDUSA_WORKER_MODE as 'worker' | 'server' | 'shared' | undefined) ?? 'shared'

/**
 * Disable Admin
 */
export const SHOULD_DISABLE_ADMIN = process.env.MEDUSA_DISABLE_ADMIN === 'true'
