import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {
  apiError,
  getProductTestActor,
  PRODUCT_TEST_PERMS,
  requireActorPermission,
} from "../_lib";
import { listPurchasers } from "../_tasks";

// Feeds the "Người mua hàng" picker. Resolved by effective permission rather
// than by metadata.role, so users who hold purchasing access through an
// explicit permissions list are selectable too.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const actor = await getProductTestActor(req);
    if (!actor) return res.status(401).json({ error: "Unauthenticated" });
    requireActorPermission(actor, PRODUCT_TEST_PERMS.view);
    return res.json({ purchasers: await listPurchasers(req) });
  } catch (error) {
    return apiError(res, error);
  }
}
