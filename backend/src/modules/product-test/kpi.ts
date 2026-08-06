export type ProductTestMetrics = {
  ad_spend?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  leads?: number | null;
  orders?: number | null;
  cancelled_orders?: number | null;
  revenue?: number | null;
};

function nonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function safeRatio(
  numerator: unknown,
  denominator: unknown,
): number | null {
  const top = nonNegative(numerator);
  const bottom = nonNegative(denominator);
  return bottom > 0 ? top / bottom : null;
}

export function calculateKpis(metrics: ProductTestMetrics) {
  return {
    cpl: safeRatio(metrics.ad_spend, metrics.leads),
    cpo: safeRatio(metrics.ad_spend, metrics.orders),
    ctr: safeRatio(metrics.clicks, metrics.impressions),
    ad_ratio: safeRatio(metrics.ad_spend, metrics.revenue),
    cancellation_ratio: safeRatio(metrics.cancelled_orders, metrics.orders),
  };
}

export function aggregateMetrics(rows: ProductTestMetrics[]) {
  const totals = rows.reduce(
    (r, row) => ({
      ad_spend: r.ad_spend + nonNegative(row.ad_spend),
      impressions: r.impressions + nonNegative(row.impressions),
      clicks: r.clicks + nonNegative(row.clicks),
      leads: r.leads + nonNegative(row.leads),
      orders: r.orders + nonNegative(row.orders),
      cancelled_orders: r.cancelled_orders + nonNegative(row.cancelled_orders),
      revenue: r.revenue + nonNegative(row.revenue),
    }),
    {
      ad_spend: 0,
      impressions: 0,
      clicks: 0,
      leads: 0,
      orders: 0,
      cancelled_orders: 0,
      revenue: 0,
    },
  );
  return { ...totals, ...calculateKpis(totals) };
}
