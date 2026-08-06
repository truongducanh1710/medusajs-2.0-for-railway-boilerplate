import { defineRouteConfig } from "@medusajs/admin-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { withRouteGuard } from "../../components/route-guard";
import { createProductTestingClient } from "../../components/product-testing/client";
import type {
  ProductTestFilters,
  ProductTestStatus,
  ProductTestSummary,
  ProductTestTab,
  ProductTestViewMode,
} from "../../components/product-testing/types";
import { ProductTestDrawer } from "../../components/product-testing/product-test-drawer";
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
const STATUS: Record<ProductTestStatus, string> = {
  draft: "Nháp",
  awaiting_purchase_check: "Chờ check giá",
  purchase_changes_requested: "Cần bổ sung check giá",
  proposal_draft: "Soạn đề xuất",
  awaiting_test_approval: "Chờ duyệt test",
  proposal_changes_requested: "Cần sửa đề xuất",
  testing: "Đang test",
  awaiting_final_decision: "Chờ kết luận",
  import_approved: "Duyệt nhập",
  import_rejected: "Không nhập",
};
const TABS: Array<{ id: ProductTestTab; label: string }> = [
  { id: "overview", label: "Tổng quan" },
  { id: "purchase", label: "Check giá" },
  { id: "proposal", label: "Đề xuất test" },
  { id: "results", label: "Kết quả test" },
  { id: "concluded", label: "Đã kết luận" },
];

const tabStatuses: Record<ProductTestTab, ProductTestStatus[] | null> = {
  overview: null,
  purchase: ["draft", "awaiting_purchase_check", "purchase_changes_requested"],
  proposal: [
    "proposal_draft",
    "awaiting_test_approval",
    "proposal_changes_requested",
  ],
  results: ["testing", "awaiting_final_decision"],
  concluded: ["import_approved", "import_rejected"],
};

function money(value: number | null | undefined) {
  return value == null
    ? "—"
    : `${new Intl.NumberFormat("vi-VN").format(Math.round(value))}đ`;
}
function number(value: number | null | undefined) {
  return value == null
    ? "—"
    : new Intl.NumberFormat("vi-VN").format(Math.round(value));
}
function ratio(value: number | null | undefined) {
  return value == null ? "—" : `${(value * 100).toFixed(0)}%`;
}

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
      setRows(data.cases);
      setOverview(data.overview);
      setFacets(data.facets);
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
      overview?.by_status?.awaiting_final_decision || 0,
      "Cần leader đánh giá",
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
            <th>Trạng thái</th>
            <th>MKT</th>
            <th>Giá vốn</th>
            <th>Giá bán</th>
            <th>Ngày test</th>
            <th>Chi phí ads</th>
            <th>Đơn</th>
            <th>Doanh thu</th>
            <th>CPL</th>
            <th>% ads</th>
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
              <td>{money(row.cpl)}</td>
              <td>{ratio(row.ad_ratio)}</td>
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
  const columns = [
    {
      id: "purchase",
      label: "Check giá",
      statuses: [
        "draft",
        "awaiting_purchase_check",
        "purchase_changes_requested",
      ],
    },
    {
      id: "proposal",
      label: "Đề xuất",
      statuses: [
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

const PAGE_CSS = `
.pt-page{min-height:100%;background:#f7f8fa;color:#1f2937;padding:24px;font:14px Inter,ui-sans-serif,system-ui,sans-serif}.pt-page *{box-sizing:border-box}.pt-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px}.pt-header h1{font-size:24px;line-height:32px;margin:0;color:#111827}.pt-header p{margin:4px 0 0;color:#6b7280}.pt-header p span{color:#2563eb;margin:0 5px}.pt-primary,.pt-ghost,.pt-view-toggle button,.pt-tabs button{border:0;cursor:pointer;font:inherit}.pt-primary{background:#2563eb;color:#fff;border-radius:8px;padding:9px 14px;font-weight:600}.pt-primary:disabled{opacity:.5}.pt-ghost{background:#fff;border:1px solid #d1d5db!important;border-radius:7px;padding:8px 11px}.pt-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.pt-kpi{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px}.pt-kpi span,.pt-kpi small{display:block;color:#6b7280}.pt-kpi strong{display:block;font-size:25px;line-height:32px;margin:5px 0;color:#111827}.pt-panel{background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden}.pt-tabs{display:flex;border-bottom:1px solid #e5e7eb;padding:0 16px}.pt-tabs button{background:none;color:#6b7280;padding:14px 13px;border-bottom:2px solid transparent}.pt-tabs button.active{color:#2563eb;border-color:#2563eb;font-weight:600}.pt-toolbar{display:flex;gap:8px;align-items:center;padding:12px 16px;border-bottom:1px solid #eef0f2}.pt-toolbar input,.pt-toolbar select,.pt-modal input{height:36px;border:1px solid #d1d5db;border-radius:7px;background:#fff;padding:0 10px;color:#111827}.pt-search{width:280px}.pt-view-toggle{display:flex;margin-left:auto;border:1px solid #d1d5db;border-radius:7px;overflow:hidden}.pt-view-toggle button{background:#fff;padding:8px 11px;color:#6b7280}.pt-view-toggle button.active{background:#eff6ff;color:#1d4ed8;font-weight:600}.pt-error{margin:12px 16px;padding:10px 12px;background:#fef2f2;color:#b91c1c;border-radius:7px}.pt-empty{padding:50px;text-align:center;color:#6b7280}.pt-table-wrap{overflow:auto;max-height:calc(100vh - 340px)}.pt-table{border-collapse:separate;border-spacing:0;width:100%;min-width:1540px}.pt-table th{position:sticky;top:0;background:#f9fafb;color:#6b7280;text-align:left;font-size:12px;font-weight:600;padding:10px;border-bottom:1px solid #e5e7eb;white-space:nowrap}.pt-table td{padding:10px;border-bottom:1px solid #eef0f2;white-space:nowrap}.pt-table tbody tr{cursor:pointer}.pt-table tbody tr:hover{background:#f8fbff}.pt-product,.pt-card-title{display:flex;align-items:center;gap:10px}.pt-product img,.pt-card-title img,.pt-no-image{width:38px;height:38px;border-radius:7px;object-fit:cover;background:#eef2f7}.pt-no-image{display:grid;place-items:center;color:#9ca3af;font-size:10px}.pt-product strong,.pt-product small,.pt-card-title strong,.pt-card-title small{display:block;max-width:210px;overflow:hidden;text-overflow:ellipsis}.pt-product small,.pt-card-title small{color:#9ca3af;margin-top:2px}.pt-status{display:inline-flex;border-radius:999px;padding:4px 8px;font-size:12px;background:#f3f4f6;color:#4b5563}.s-testing{background:#dbeafe;color:#1d4ed8}.s-awaiting_final_decision,.s-awaiting_test_approval{background:#fef3c7;color:#92400e}.s-import_approved{background:#dcfce7;color:#166534}.s-import_rejected,.s-purchase_changes_requested,.s-proposal_changes_requested{background:#fee2e2;color:#991b1b}.pt-next{font-size:12px;color:#2563eb}.pt-kanban{display:grid;grid-template-columns:repeat(4,minmax(260px,1fr));gap:12px;padding:14px;overflow:auto}.pt-column{background:#f5f6f8;border-radius:9px;padding:10px;min-height:420px}.pt-column h3{font-size:13px;margin:2px 2px 10px}.pt-column h3 span{float:right;background:#e5e7eb;border-radius:99px;padding:2px 7px;color:#6b7280}.pt-card{display:block;width:100%;text-align:left;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:11px;margin-bottom:9px;cursor:pointer}.pt-card:hover{border-color:#93c5fd}.pt-card .pt-status{margin:10px 0}.pt-card dl{margin:0;color:#6b7280;font-size:12px}.pt-card dl div{display:flex;justify-content:space-between;margin-top:5px}.pt-card dd{margin:0;color:#374151}.pt-modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.35);display:grid;place-items:center;z-index:1000}.pt-modal{width:430px;background:#fff;border-radius:12px;padding:22px;box-shadow:0 20px 50px rgba(15,23,42,.25)}.pt-modal h2{margin:0 0 18px}.pt-modal label{display:grid;gap:6px;margin:12px 0;font-weight:600}.pt-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}@media(max-width:1200px){.pt-kpis{grid-template-columns:repeat(2,1fr)}.pt-page{padding:16px}.pt-toolbar{flex-wrap:wrap}.pt-view-toggle{margin-left:0}.pt-kanban{grid-template-columns:repeat(4,280px)}}
`;

export const config = defineRouteConfig({ label: "Test sản phẩm", rank: 6 });
export default withRouteGuard(ProductTestPage);
