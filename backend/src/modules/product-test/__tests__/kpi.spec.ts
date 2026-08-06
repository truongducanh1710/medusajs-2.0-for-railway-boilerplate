import { aggregateMetrics, calculateKpis, safeRatio } from "../kpi";

describe("product test KPI calculations", () => {
  it("returns null when a denominator is zero", () => {
    expect(safeRatio(100, 0)).toBeNull();
    expect(calculateKpis({ ad_spend: 100, leads: 0 }).cpl).toBeNull();
  });

  it("calculates daily KPI values", () => {
    expect(
      calculateKpis({
        ad_spend: 1_000,
        impressions: 2_000,
        clicks: 100,
        leads: 20,
        orders: 10,
        cancelled_orders: 2,
        revenue: 5_000,
      }),
    ).toEqual({
      cpl: 50,
      cpo: 100,
      ctr: 0.05,
      ad_ratio: 0.2,
      cancellation_ratio: 0.2,
    });
  });

  it("aggregates multiple rows even when they belong to the same date", () => {
    const totals = aggregateMetrics([
      { ad_spend: 100, leads: 2, orders: 1, revenue: 500 },
      { ad_spend: 200, leads: 3, orders: 2, revenue: 1_000 },
    ]);
    expect(totals).toMatchObject({
      ad_spend: 300,
      leads: 5,
      orders: 3,
      revenue: 1_500,
      cpl: 60,
      cpo: 100,
      ad_ratio: 0.2,
    });
  });

  it("normalizes negative and invalid input to zero", () => {
    expect(
      aggregateMetrics([{ ad_spend: -100, orders: Number.NaN }]),
    ).toMatchObject({ ad_spend: 0, orders: 0, cpo: null });
  });
});
