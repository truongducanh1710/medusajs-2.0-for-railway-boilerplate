import { defineRouteConfig } from "@medusajs/admin-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { withRouteGuard } from "../../components/route-guard";
import { withDebugBoundary } from "../../components/debug-boundary";
import { createProductTestingClient } from "../../components/product-testing/client";
import { STATUS_LABELS } from "../../components/product-testing/types";
import type {
  ProductTestFilters,
  ProductTestStatus,
  ProductTestSummary,
  ProductTestTab,
  ProductTestViewMode,
} from "../../components/product-testing/types";
import { ProductTestDrawer } from "../../components/product-testing/product-test-drawer";
import { FormulaCell, formatDate, money, number, ratio } from "../../components/product-testing/format";
import { useCurrentPermissions } from "../../lib/use-permissions";

const client = createProductTestingClient();
const EMPTY_FILTERS: ProductTestFilters = {
  q: "",
  marketer: "",
  assignee: "",
  status: "",
  from: "",
  to: "",
};
const STATUS = STATUS_LABELS;
// Check giá and Đề xuất are one stage now (both happen in draft, in parallel),
// so they share a single tab instead of two that would list identical rows.
const TABS: Array<{ id: ProductTestTab; label: string }> = [
  { id: "overview", label: "Tổng quan" },
  { id: "purchase", label: "Đang chuẩn bị" },
  { id: "results", label: "Đang test" },
  { id: "concluded", label: "Đã kết luận" },
];

// Retired statuses stay listed so any row the migration missed still appears
// somewhere rather than vanishing from every tab.
const tabStatuses: Record<ProductTestTab, ProductTestStatus[] | null> = {
  overview: null,
  purchase: [
    "draft",
    "awaiting_purchase_check",
    "purchase_changes_requested",
    "proposal_draft",
    "awaiting_test_approval",
    "proposal_changes_requested",
  ],
  proposal: [
    "draft",
    "proposal_draft",
    "awaiting_test_approval",
    "proposal_changes_requested",
  ],
  results: ["testing", "awaiting_final_decision"],
  concluded: ["import_approved", "import_rejected"],
};

function ProductTestPage() {
  const { has, isSuper } = useCurrentPermissions();
  const [rows, setRows] = useState<ProductTestSummary[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [facets, setFacets] = useState<any>({
    by_marketer: [],
    by_assignee: [],
  });
  const [filters, setFilters] = useState<ProductTestFilters>(EMPTY_FILTERS);
  const [tab, setTab] = useState<ProductTestTab>("overview");
  const [view, setView] = useState<ProductTestViewMode>("table");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [productName, setProductName] = useState("");
  const [productHandle, setProductHandle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await client.list(filters);
      // Never trust the shape here: an expired session or an error payload
      // returns JSON without `cases`, and an undefined rows array throws in
      // visibleRows during render — which the error boundary turns into a
      // blank page with no clue what went wrong.
      setRows(Array.isArray(data?.cases) ? data.cases : []);
      setOverview(data?.overview ?? null);
      setFacets({
        by_marketer: Array.isArray(data?.facets?.by_marketer) ? data.facets.by_marketer : [],
        by_assignee: Array.isArray(data?.facets?.by_assignee) ? data.facets.by_assignee : [],
      });
    } catch (err: any) {
      setError(err?.message || "Không tải được dữ liệu");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const caseId = params.get("case");
    if (caseId) setSelectedId(caseId);
  }, []);

  const visibleRows = useMemo(() => {
    const allowed = tabStatuses[tab];
    return allowed ? rows.filter((row) => allowed.includes(row.status)) : rows;
  }, [rows, tab]);

  async function createCase() {
    if (!productName.trim()) return;
    try {
      const data = await client.createCase({
        product_name: productName.trim(),
        product_handle: productHandle.trim() || undefined,
      });
      setCreateOpen(false);
      setProductName("");
      setProductHandle("");
      await load();
      setSelectedId(data.case.id);
    } catch (err: any) {
      setError(err?.message || "Không tạo được hồ sơ");
    }
  }

  const cards = [
    [
      "Tổng hồ sơ",
      overview?.total_cases || 0,
      "Tất cả sản phẩm trong quy trình",
    ],
    [
      "Đang test",
      overview?.testing_cases || 0,
      `${number(overview?.orders || 0)} đơn ghi nhận`,
    ],
    [
      "Chờ kết luận",
      overview?.awaiting_leader_review || 0,
      "Đang test, còn dòng chưa đánh giá",
    ],
    [
      "Đã kết luận",
      overview?.concluded_cases || 0,
      `${money(overview?.spend || 0)} chi phí ads`,
    ],
  ];

  return (
    <div className="pt-page">
      <style>{PAGE_CSS}</style>
      <header className="pt-header">
        <div>
          <h1>Quản lý test sản phẩm</h1>
          <p>
            Check giá <span>→</span> Đề xuất test <span>→</span> Test nhiều ngày{" "}
            <span>→</span> Kết luận
          </p>
        </div>
        {(isSuper || has("page.product-test.marketing")) && (
          <button className="pt-primary" onClick={() => setCreateOpen(true)}>
            + Tạo sản phẩm test
          </button>
        )}
      </header>

      <section className="pt-kpis">
        {cards.map(([label, value, note]) => (
          <div className="pt-kpi" key={String(label)}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        ))}
      </section>

      <section className="pt-panel">
        <div className="pt-tabs">
          {TABS.map((item) => (
            <button
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
              key={item.id}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="pt-toolbar">
          <input
            className="pt-search"
            placeholder="Tìm mã hoặc tên sản phẩm…"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">Mọi trạng thái</option>
            {Object.entries(STATUS).map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={filters.marketer}
            onChange={(e) =>
              setFilters({ ...filters, marketer: e.target.value })
            }
          >
            <option value="">Mọi MKT</option>
            {facets.by_marketer?.map((item: any) => (
              <option key={item.marketer_email} value={item.marketer_email}>
                {item.marketer_name}
              </option>
            ))}
          </select>
          <button
            className="pt-ghost"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            Xóa lọc
          </button>
          <div className="pt-view-toggle">
            <button
              className={view === "table" ? "active" : ""}
              onClick={() => setView("table")}
            >
              Bảng
            </button>
            <button
              className={view === "kanban" ? "active" : ""}
              onClick={() => setView("kanban")}
            >
              Kanban
            </button>
          </div>
        </div>
        {error && <div className="pt-error">{error}</div>}
        {loading ? (
          <div className="pt-empty">Đang tải dữ liệu…</div>
        ) : view === "table" ? (
          <ProductTable rows={visibleRows} onOpen={setSelectedId} />
        ) : (
          <ProductKanban rows={visibleRows} onOpen={setSelectedId} />
        )}
      </section>

      {selectedId && (
        <ProductTestDrawer
          caseId={selectedId}
          client={client}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}
      {createOpen && (
        <div
          className="pt-modal-backdrop"
          onMouseDown={() => setCreateOpen(false)}
        >
          <div className="pt-modal" onMouseDown={(e) => e.stopPropagation()}>
            <h2>Tạo sản phẩm test</h2>
            <label>
              Tên sản phẩm
              <input
                autoFocus
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
              />
            </label>
            <label>
              Handle sản phẩm (nếu có)
              <input
                value={productHandle}
                onChange={(e) => setProductHandle(e.target.value)}
              />
            </label>
            <div className="pt-modal-actions">
              <button className="pt-ghost" onClick={() => setCreateOpen(false)}>
                Hủy
              </button>
              <button
                className="pt-primary"
                disabled={!productName.trim()}
                onClick={createCase}
              >
                Tạo hồ sơ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductTable({
  rows,
  onOpen,
}: {
  rows: ProductTestSummary[];
  onOpen: (id: string) => void;
}) {
  if (!rows.length)
    return <div className="pt-empty">Chưa có sản phẩm trong nhóm này.</div>;
  return (
    <div className="pt-table-wrap">
      <table className="pt-table">
        <thead>
          <tr>
            <th>Sản phẩm</th>
            <th>Ngày tạo</th>
            <th>Trạng thái</th>
            <th>MKT</th>
            <th>Giá vốn</th>
            <th>Giá bán</th>
            <th>Ngày test</th>
            <th>Chi phí ads</th>
            <th>Đơn</th>
            <th>Doanh thu</th>
            <th title="Công thức: Chi phí ads ÷ Số lead">CPL ⨍</th>
            <th title="Công thức: Chi phí ads ÷ Doanh thu">% ads ⨍</th>
            <th>Đánh giá</th>
            <th>Bước tiếp</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} onClick={() => onOpen(row.id)}>
              <td>
                <div className="pt-product">
                  {row.card_image_url ? (
                    <img src={row.card_image_url} alt="" />
                  ) : (
                    <div className="pt-no-image">Ảnh</div>
                  )}
                  <div>
                    <strong>{row.product_name}</strong>
                    <small>{row.code}</small>
                  </div>
                </div>
              </td>
              <td>{formatDate(row.created_at)}</td>
              <td>
                <span className={`pt-status s-${row.status}`}>
                  {STATUS[row.status]}
                </span>
              </td>
              <td>{row.assignee_name}</td>
              <td>{money(row.landed_cost)}</td>
              <td>{money(row.sale_price)}</td>
              <td>{row.test_days}</td>
              <td>{money(row.spend)}</td>
              <td>{number(row.orders)}</td>
              <td>{money(row.revenue)}</td>
              <td>
                <FormulaCell
                  formula={`${money(row.spend)} chi phí ads ÷ ${number(row.orders)} lead`}
                  display={money(row.cpl)}
                />
              </td>
              <td>
                <FormulaCell
                  formula={`${money(row.spend)} chi phí ads ÷ ${money(row.revenue)} doanh thu`}
                  display={ratio(row.ad_ratio)}
                />
              </td>
              <td>{row.last_evaluation || "Chưa đánh giá"}</td>
              <td>
                <b className="pt-next">{row.next_action}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductKanban({
  rows,
  onOpen,
}: {
  rows: ProductTestSummary[];
  onOpen: (id: string) => void;
}) {
  // Three columns matching the three real stages of a case.
  const columns = [
    {
      id: "prepare",
      label: "Đang chuẩn bị",
      statuses: [
        "draft",
        "awaiting_purchase_check",
        "purchase_changes_requested",
        "proposal_draft",
        "awaiting_test_approval",
        "proposal_changes_requested",
      ],
    },
    {
      id: "testing",
      label: "Đang test",
      statuses: ["testing", "awaiting_final_decision"],
    },
    {
      id: "done",
      label: "Đã kết luận",
      statuses: ["import_approved", "import_rejected"],
    },
  ];
  return (
    <div className="pt-kanban">
      {columns.map((column) => {
        const items = rows.filter((row) =>
          column.statuses.includes(row.status),
        );
        return (
          <div className="pt-column" key={column.id}>
            <h3>
              {column.label}
              <span>{items.length}</span>
            </h3>
            {items.map((row) => (
              <button
                className="pt-card"
                key={row.id}
                onClick={() => onOpen(row.id)}
              >
                <div className="pt-card-title">
                  {row.card_image_url ? (
                    <img src={row.card_image_url} alt="" />
                  ) : (
                    <div className="pt-no-image">Ảnh</div>
                  )}
                  <div>
                    <strong>{row.product_name}</strong>
                    <small>{row.code}</small>
                  </div>
                </div>
                <span className={`pt-status s-${row.status}`}>
                  {STATUS[row.status]}
                </span>
                <dl>
                  <div>
                    <dt>Tạo</dt>
                    <dd>{formatDate(row.created_at)}</dd>
                  </div>
                  <div>
                    <dt>MKT</dt>
                    <dd>{row.assignee_name}</dd>
                  </div>
                  <div>
                    <dt>Test</dt>
                    <dd>
                      {row.test_days} ngày · {number(row.orders)} đơn
                    </dd>
                  </div>
                  <div>
                    <dt>Ads</dt>
                    <dd>{money(row.spend)}</dd>
                  </div>
                </dl>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// Colours come from Medusa's admin design tokens so the page follows the
// active light/dark theme instead of hardcoding its own palette.
const PAGE_CSS = `
.pt-page{min-height:100%;background:var(--bg-subtle,#f7f8fa);color:var(--fg-base,#1f2937);padding:24px;font:14px Inter,ui-sans-serif,system-ui,sans-serif}
.pt-page *{box-sizing:border-box}
.pt-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px;flex-wrap:wrap}
.pt-header h1{font-size:23px;line-height:31px;margin:0;color:var(--fg-base,#111827)}
.pt-header p{margin:4px 0 0;color:var(--fg-subtle,#6b7280);font-size:13px}
.pt-header p span{color:#2563eb;margin:0 5px}
.pt-primary,.pt-ghost,.pt-view-toggle button,.pt-tabs button{border:0;cursor:pointer;font:inherit}
.pt-primary{background:#2563eb;color:#fff;border-radius:8px;padding:9px 14px;font-weight:600;font-size:13px;transition:background .12s}
.pt-primary:hover:not(:disabled){background:#1d4ed8}
.pt-primary:disabled{opacity:.5;cursor:not-allowed}
.pt-ghost{background:var(--bg-base,#fff);color:var(--fg-subtle,#4b5563);border:1px solid var(--border-base,#d1d5db)!important;border-radius:7px;padding:8px 11px;font-size:13px}
.pt-ghost:hover{background:var(--bg-base-hover,#f9fafb)}
.pt-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}
.pt-kpi{background:var(--bg-base,#fff);border:1px solid var(--border-base,#e5e7eb);border-radius:10px;padding:16px}
.pt-kpi span,.pt-kpi small{display:block;color:var(--fg-muted,#6b7280);font-size:12px}
.pt-kpi strong{display:block;font-size:25px;line-height:32px;margin:5px 0;color:var(--fg-base,#111827)}
.pt-panel{background:var(--bg-base,#fff);border:1px solid var(--border-base,#e5e7eb);border-radius:10px;overflow:hidden}
.pt-tabs{display:flex;border-bottom:1px solid var(--border-base,#e5e7eb);padding:0 16px;overflow-x:auto}
.pt-tabs button{background:none;color:var(--fg-muted,#6b7280);padding:14px 13px;border-bottom:2px solid transparent;white-space:nowrap;font-size:13px}
.pt-tabs button:hover{color:var(--fg-base,#374151)}
.pt-tabs button.active{color:#2563eb;border-color:#2563eb;font-weight:600}
.pt-toolbar{display:flex;gap:8px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border-base,#eef0f2);flex-wrap:wrap}
.pt-toolbar input,.pt-toolbar select,.pt-modal input{height:36px;border:1px solid var(--border-base,#d1d5db);border-radius:7px;background:var(--bg-field,#fff);padding:0 10px;color:var(--fg-base,#111827);font:13px inherit;outline:none;transition:border-color .12s,box-shadow .12s}
.pt-toolbar input:focus,.pt-toolbar select:focus,.pt-modal input:focus{border-color:#60a5fa;box-shadow:0 0 0 3px rgba(59,130,246,.16)}
.pt-search{width:280px;max-width:100%}
.pt-view-toggle{display:flex;margin-left:auto;border:1px solid var(--border-base,#d1d5db);border-radius:7px;overflow:hidden}
.pt-view-toggle button{background:var(--bg-base,#fff);padding:8px 11px;color:var(--fg-muted,#6b7280);font-size:13px}
.pt-view-toggle button.active{background:#eff6ff;color:#1d4ed8;font-weight:600}
.pt-error{margin:12px 16px;padding:10px 12px;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:7px;font-size:13px}
.pt-empty{padding:50px;text-align:center;color:var(--fg-muted,#6b7280)}
.pt-table-wrap{overflow:auto;max-height:calc(100vh - 340px)}
.pt-table{border-collapse:separate;border-spacing:0;width:100%;min-width:1540px}
.pt-table th{position:sticky;top:0;z-index:1;background:var(--bg-subtle,#f9fafb);color:var(--fg-muted,#6b7280);text-align:left;font-size:12px;font-weight:600;padding:10px;border-bottom:1px solid var(--border-base,#e5e7eb);white-space:nowrap}
.pt-table td{padding:10px;border-bottom:1px solid var(--border-base,#eef0f2);white-space:nowrap;font-size:13px}
.pt-table tbody tr{cursor:pointer;transition:background .1s}
.pt-table tbody tr:hover{background:var(--bg-base-hover,#f8fbff)}
.pt-product,.pt-card-title{display:flex;align-items:center;gap:10px}
.pt-product img,.pt-card-title img,.pt-no-image{width:38px;height:38px;border-radius:7px;object-fit:cover;background:var(--bg-field,#eef2f7);flex-shrink:0}
.pt-no-image{display:grid;place-items:center;color:var(--fg-muted,#9ca3af);font-size:10px}
.pt-product strong,.pt-product small,.pt-card-title strong,.pt-card-title small{display:block;max-width:210px;overflow:hidden;text-overflow:ellipsis}
.pt-product small,.pt-card-title small{color:var(--fg-muted,#9ca3af);margin-top:2px;font-size:11px}
.pt-status{display:inline-flex;border-radius:999px;padding:4px 9px;font-size:12px;background:var(--bg-field,#f3f4f6);color:var(--fg-subtle,#4b5563);white-space:nowrap}
.s-draft{background:#f1f5f9;color:#475569}
.s-testing{background:#dbeafe;color:#1d4ed8}
.s-awaiting_final_decision,.s-awaiting_test_approval,.s-awaiting_purchase_check{background:#fef3c7;color:#92400e}
.s-import_approved{background:#dcfce7;color:#166534}
.s-import_rejected,.s-purchase_changes_requested,.s-proposal_changes_requested{background:#fee2e2;color:#991b1b}
.pt-next{font-size:12px;color:#2563eb}
.pt-formula{color:#92400e;background:#fef3c7;border-radius:5px;padding:2px 6px;font-weight:600;cursor:help;border-bottom:1px dashed #d97706}
.pt-table th[title]{cursor:help;border-bottom:1px dashed var(--fg-muted,#9ca3af)}
.pt-kanban{display:grid;grid-template-columns:repeat(4,minmax(260px,1fr));gap:12px;padding:14px;overflow:auto}
.pt-column{background:var(--bg-subtle,#f5f6f8);border:1px solid var(--border-base,#e5e7eb);border-radius:9px;padding:10px;min-height:420px}
.pt-column h3{font-size:13px;margin:2px 2px 10px;color:var(--fg-base,#374151)}
.pt-column h3 span{float:right;background:var(--bg-field,#e5e7eb);border-radius:99px;padding:2px 8px;color:var(--fg-muted,#6b7280);font-size:11px}
.pt-card{display:block;width:100%;text-align:left;background:var(--bg-base,#fff);border:1px solid var(--border-base,#e5e7eb);border-radius:8px;padding:11px;margin-bottom:9px;cursor:pointer;transition:border-color .12s}
.pt-card:hover{border-color:#93c5fd}
.pt-card .pt-status{margin:10px 0}
.pt-card dl{margin:0;color:var(--fg-muted,#6b7280);font-size:12px}
.pt-card dl div{display:flex;justify-content:space-between;gap:8px;margin-top:5px}
.pt-card dd{margin:0;color:var(--fg-base,#374151)}
.pt-modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.42);display:grid;place-items:center;z-index:1000;backdrop-filter:blur(1px)}
.pt-modal{width:430px;max-width:94vw;background:var(--bg-base,#fff);border:1px solid var(--border-base,#e5e7eb);border-radius:12px;padding:22px;box-shadow:0 20px 50px rgba(15,23,42,.25)}
.pt-modal h2{margin:0 0 18px;font-size:17px;color:var(--fg-base,#111827)}
.pt-modal label{display:grid;gap:6px;margin:12px 0;font-weight:600;font-size:12px;color:var(--fg-subtle,#4b5563)}
.pt-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
@media(max-width:1200px){.pt-kpis{grid-template-columns:repeat(2,1fr)}.pt-page{padding:16px}.pt-toolbar{flex-wrap:wrap}.pt-view-toggle{margin-left:0}.pt-kanban{grid-template-columns:repeat(4,280px)}}
`;

export const config = defineRouteConfig({ label: "Test sản phẩm", rank: 6 });
export default withRouteGuard(
  withDebugBoundary("test-san-pham", ProductTestPage),
);
