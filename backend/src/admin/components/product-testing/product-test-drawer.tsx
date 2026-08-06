import { useEffect, useState } from "react";
import type { ProductTestingClient } from "./client";
import type {
  ProductTestCaseRecord,
  ProductTestDailyResult,
  ProductTestProposal,
  ProductTestPurchaseCheck,
} from "./types";

const ACTION_LABELS: Record<string, string> = {
  submit_purchase_check: "Gửi Mua hàng check",
  approve_purchase_check: "Duyệt check giá",
  request_purchase_changes: "Yêu cầu bổ sung",
  submit_test_proposal: "Gửi duyệt đề xuất",
  approve_testing: "Duyệt chạy test",
  request_proposal_changes: "Yêu cầu sửa đề xuất",
  submit_test_results: "Gửi leader kết luận",
  request_more_testing: "Yêu cầu test thêm",
  approve_import: "Duyệt nhập",
  reject_import: "Không nhập",
  reassign_marketer: "Chuyển MKT phụ trách",
};
const COMMENT_ACTIONS = new Set([
  "request_purchase_changes",
  "request_proposal_changes",
  "request_more_testing",
  "approve_import",
  "reject_import",
  "reassign_marketer",
]);

const emptyPurchase: ProductTestPurchaseCheck = {
  supplier_link: "",
  supplier_name: "",
  description: "",
  specification: "",
  moq: null,
  source_price: null,
  currency: "CNY",
  exchange_rate: null,
  weight_kg: null,
  size: "",
  quantity_per_carton: null,
  shipping_fee: null,
  other_cost: null,
  landed_cost: null,
  landed_price_per_unit: null,
  conclusion: "",
  note: "",
  image_urls: [],
  representative_image_url: "",
  checked_by: "",
  checked_at: "",
};
const emptyProposal: ProductTestProposal = {
  usp: "",
  combo_json: "",
  sale_price: null,
  gift_name: "",
  promo_title: "",
  ad_content: "",
  reference_link: "",
  landing_url: "",
  note: "",
  approved_by: "",
  approved_at: "",
};

export function ProductTestDrawer({
  caseId,
  client,
  onClose,
  onChanged,
}: {
  caseId: string;
  client: ProductTestingClient;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<any>(null);
  const [purchase, setPurchase] =
    useState<ProductTestPurchaseCheck>(emptyPurchase);
  const [proposal, setProposal] = useState<ProductTestProposal>(emptyProposal);
  const [daily, setDaily] = useState<any>({
    test_date: new Date().toISOString().slice(0, 10),
    tester_name: "",
    campaign_name: "",
    ad_spend: "",
    impressions: "",
    clicks: "",
    leads: "",
    orders: "",
    cancelled_orders: "",
    revenue: "",
  });
  const [comment, setComment] = useState("");
  const [assigneeEmail, setAssigneeEmail] = useState("");
  const [assigneeName, setAssigneeName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setError("");
      const data = await client.get(caseId);
      setDetail(data);
      setPurchase({ ...emptyPurchase, ...(data.case.purchase_check || {}) });
      setProposal({ ...emptyProposal, ...(data.case.proposal || {}) });
      setDaily((current: any) => ({
        ...current,
        tester_name: data.case.assignee_name || "",
      }));
      setAssigneeEmail(data.case.assignee_email || "");
      setAssigneeName(data.case.assignee_name || "");
    } catch (err: any) {
      setError(err?.message || "Không tải được hồ sơ");
    }
  }
  useEffect(() => {
    load();
  }, [caseId]);

  async function run(label: string, operation: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    try {
      await operation();
      await load();
      await onChanged();
    } catch (err: any) {
      setError(err?.message || "Không lưu được dữ liệu");
    } finally {
      setBusy("");
    }
  }

  if (!detail)
    return (
      <div className="pt-drawer-backdrop" onMouseDown={onClose}>
        <aside className="pt-drawer" onMouseDown={(e) => e.stopPropagation()}>
          <style>{DRAWER_CSS}</style>
          <div className="pt-drawer-loading">{error || "Đang tải hồ sơ…"}</div>
        </aside>
      </div>
    );
  const record = detail.case as ProductTestCaseRecord;
  const permissions = detail.permissions;
  const purchaseEditable =
    permissions.can_edit_purchase &&
    record.status === "awaiting_purchase_check";
  const proposalEditable =
    permissions.can_edit_marketing &&
    ["proposal_draft", "proposal_changes_requested"].includes(record.status);
  const dailyEditable =
    permissions.can_edit_marketing && record.status === "testing";

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy("upload");
    setError("");
    try {
      const urls = await client.uploadImages(Array.from(files));
      setPurchase((current) => ({
        ...current,
        image_urls: [...current.image_urls, ...urls].slice(0, 12),
        representative_image_url:
          current.representative_image_url || urls[0] || "",
      }));
    } catch (err: any) {
      setError(err?.message || "Không tải được ảnh");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="pt-drawer-backdrop" onMouseDown={onClose}>
      <aside className="pt-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <style>{DRAWER_CSS}</style>
        <header className="pt-drawer-head">
          <div>
            <small>{record.code}</small>
            <h2>{record.product_name}</h2>
            <p>
              {record.assignee_name} · v{record.version}
            </p>
          </div>
          <button onClick={onClose}>×</button>
        </header>
        {error && <div className="pt-drawer-error">{error}</div>}
        <div className="pt-drawer-body">
          <section className="pt-section">
            <div className="pt-section-title">
              <div>
                <span>1</span>
                <h3>Check giá</h3>
              </div>
              <small>Ảnh gốc được quản lý tại bước này</small>
            </div>
            <div className="pt-images">
              {purchase.image_urls.map((url) => (
                <button
                  title="Chọn làm ảnh đại diện"
                  key={url}
                  className={
                    purchase.representative_image_url === url ? "selected" : ""
                  }
                  onClick={() =>
                    purchaseEditable &&
                    setPurchase({ ...purchase, representative_image_url: url })
                  }
                >
                  <img src={url} alt="Ảnh sản phẩm" />
                </button>
              ))}
              {purchaseEditable && (
                <label className="pt-upload">
                  + Ảnh
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={(e) => upload(e.target.files)}
                  />
                </label>
              )}
            </div>
            <div className="pt-form-grid">
              <Field
                label="Nhà cung cấp"
                value={purchase.supplier_name}
                disabled={!purchaseEditable}
                onChange={(value) =>
                  setPurchase({ ...purchase, supplier_name: value })
                }
              />
              <Field
                label="Link nguồn hàng"
                value={purchase.supplier_link}
                disabled={!purchaseEditable}
                onChange={(value) =>
                  setPurchase({ ...purchase, supplier_link: value })
                }
              />
              <Field
                label="Giá nguồn"
                type="number"
                value={purchase.source_price}
                disabled={!purchaseEditable}
                onChange={(value) =>
                  setPurchase({ ...purchase, source_price: toNumber(value) })
                }
              />
              <Field
                label="Tỷ giá"
                type="number"
                value={purchase.exchange_rate}
                disabled={!purchaseEditable}
                onChange={(value) =>
                  setPurchase({ ...purchase, exchange_rate: toNumber(value) })
                }
              />
              <Field
                label="Phí vận chuyển"
                type="number"
                value={purchase.shipping_fee}
                disabled={!purchaseEditable}
                onChange={(value) =>
                  setPurchase({ ...purchase, shipping_fee: toNumber(value) })
                }
              />
              <Field
                label="Giá vốn / sản phẩm"
                type="number"
                value={purchase.landed_price_per_unit}
                disabled={!purchaseEditable}
                onChange={(value) =>
                  setPurchase({
                    ...purchase,
                    landed_price_per_unit: toNumber(value),
                  })
                }
              />
            </div>
            <TextArea
              label="Mô tả / quy cách"
              value={purchase.description}
              disabled={!purchaseEditable}
              onChange={(value) =>
                setPurchase({ ...purchase, description: value })
              }
            />
            <TextArea
              label="Kết luận check giá"
              value={purchase.conclusion}
              disabled={!purchaseEditable}
              onChange={(value) =>
                setPurchase({ ...purchase, conclusion: value })
              }
            />
            {purchaseEditable && (
              <div className="pt-save-row">
                <button
                  className="pt-drawer-primary"
                  disabled={!!busy}
                  onClick={() =>
                    run("purchase", () =>
                      client.updatePurchaseCheck(record.id, {
                        ...purchase,
                        version: record.version,
                      }),
                    )
                  }
                >
                  Lưu Check giá
                </button>
              </div>
            )}
          </section>

          <section className="pt-section">
            <div className="pt-section-title">
              <div>
                <span>2</span>
                <h3>Đề xuất test</h3>
              </div>
              <small>Không dùng cột ngân sách</small>
            </div>
            <TextArea
              label="USP sản phẩm"
              value={proposal.usp}
              disabled={!proposalEditable}
              onChange={(value) => setProposal({ ...proposal, usp: value })}
            />
            <TextArea
              label="Combo"
              value={proposal.combo_json}
              disabled={!proposalEditable}
              onChange={(value) =>
                setProposal({ ...proposal, combo_json: value })
              }
            />
            <div className="pt-form-grid">
              <Field
                label="Giá bán"
                type="number"
                value={proposal.sale_price}
                disabled={!proposalEditable}
                onChange={(value) =>
                  setProposal({ ...proposal, sale_price: toNumber(value) })
                }
              />
              <Field
                label="Landing page"
                value={proposal.landing_url}
                disabled={!proposalEditable}
                onChange={(value) =>
                  setProposal({ ...proposal, landing_url: value })
                }
              />
            </div>
            <TextArea
              label="Nội dung quảng cáo"
              value={proposal.ad_content}
              disabled={!proposalEditable}
              onChange={(value) =>
                setProposal({ ...proposal, ad_content: value })
              }
            />
            {proposalEditable && (
              <div className="pt-save-row">
                <button
                  className="pt-drawer-primary"
                  disabled={!!busy}
                  onClick={() =>
                    run("proposal", () =>
                      client.updateProposal(record.id, {
                        ...proposal,
                        version: record.version,
                      }),
                    )
                  }
                >
                  Lưu đề xuất
                </button>
              </div>
            )}
          </section>

          <section className="pt-section">
            <div className="pt-section-title">
              <div>
                <span>3</span>
                <h3>Kết quả test nhiều ngày</h3>
              </div>
              <small>Một sản phẩm có thể có nhiều dòng cùng ngày</small>
            </div>
            <div className="pt-linked">
              <LinkedImage
                url={
                  purchase.representative_image_url || purchase.image_urls[0]
                }
              />
              <div>
                <b>Combo (nối từ Đề xuất)</b>
                <p>{proposal.combo_json || "Chưa có"}</p>
              </div>
              <div>
                <b>Landing (nối từ Đề xuất)</b>
                {proposal.landing_url ? (
                  <a
                    href={proposal.landing_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {proposal.landing_url}
                  </a>
                ) : (
                  <p>Chưa có</p>
                )}
              </div>
              <span>Chỉ đọc</span>
            </div>
            {dailyEditable && (
              <div className="pt-daily-form">
                <div className="pt-form-grid three">
                  <Field
                    label="Ngày test"
                    type="date"
                    value={daily.test_date}
                    onChange={(value) =>
                      setDaily({ ...daily, test_date: value })
                    }
                  />
                  <Field
                    label="Người test"
                    value={daily.tester_name}
                    onChange={(value) =>
                      setDaily({ ...daily, tester_name: value })
                    }
                  />
                  <Field
                    label="Tên campaign"
                    value={daily.campaign_name}
                    onChange={(value) =>
                      setDaily({ ...daily, campaign_name: value })
                    }
                  />
                  <Field
                    label="Chi phí ads"
                    type="number"
                    value={daily.ad_spend}
                    onChange={(value) =>
                      setDaily({ ...daily, ad_spend: value })
                    }
                  />
                  <Field
                    label="Lead"
                    type="number"
                    value={daily.leads}
                    onChange={(value) => setDaily({ ...daily, leads: value })}
                  />
                  <Field
                    label="Đơn"
                    type="number"
                    value={daily.orders}
                    onChange={(value) => setDaily({ ...daily, orders: value })}
                  />
                  <Field
                    label="Đơn hủy"
                    type="number"
                    value={daily.cancelled_orders}
                    onChange={(value) =>
                      setDaily({ ...daily, cancelled_orders: value })
                    }
                  />
                  <Field
                    label="Doanh thu"
                    type="number"
                    value={daily.revenue}
                    onChange={(value) => setDaily({ ...daily, revenue: value })}
                  />
                  <Field
                    label="Click"
                    type="number"
                    value={daily.clicks}
                    onChange={(value) => setDaily({ ...daily, clicks: value })}
                  />
                </div>
                <button
                  className="pt-drawer-primary"
                  disabled={!!busy}
                  onClick={() =>
                    run("daily", () =>
                      client.createDailyResult(record.id, {
                        ...daily,
                        version: record.version,
                      }),
                    )
                  }
                >
                  + Thêm dòng test
                </button>
              </div>
            )}
            <div className="pt-daily-table">
              <table>
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Campaign</th>
                    <th>Ads</th>
                    <th>Lead</th>
                    <th>Đơn</th>
                    <th>Doanh thu</th>
                    <th>CPL</th>
                    <th>Đánh giá leader</th>
                  </tr>
                </thead>
                <tbody>
                  {record.daily_results.length ? (
                    record.daily_results.map((row) => (
                      <DailyResultRow
                        key={row.id}
                        row={row}
                        canEvaluate={permissions.can_approve}
                        recordId={record.id}
                        client={client}
                        onRun={run}
                      />
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8}>Chưa có kết quả test.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="pt-section pt-actions">
            <div className="pt-section-title">
              <div>
                <span>✓</span>
                <h3>Hành động tiếp theo</h3>
              </div>
            </div>
            {detail.available_actions.some((item: any) =>
              COMMENT_ACTIONS.has(item.id),
            ) && (
              <TextArea
                label="Nhận xét / lý do"
                value={comment}
                onChange={setComment}
              />
            )}
            {detail.available_actions.some(
              (item: any) => item.id === "reassign_marketer",
            ) && (
              <div className="pt-form-grid">
                <Field
                  label="Email MKT mới"
                  value={assigneeEmail}
                  onChange={setAssigneeEmail}
                />
                <Field
                  label="Tên MKT mới"
                  value={assigneeName}
                  onChange={setAssigneeName}
                />
              </div>
            )}
            <div className="pt-action-buttons">
              {detail.available_actions.map((action: any) => (
                <button
                  key={action.id}
                  className={
                    action.id === "reject_import"
                      ? "danger"
                      : action.id.includes("approve")
                        ? "success"
                        : ""
                  }
                  disabled={
                    !!busy ||
                    (COMMENT_ACTIONS.has(action.id) && !comment.trim())
                  }
                  onClick={() =>
                    run(action.id, () =>
                      client.transitionCase(record.id, {
                        action: action.id,
                        comment,
                        version: record.version,
                        ...(action.id === "reassign_marketer"
                          ? {
                              assignee_email: assigneeEmail,
                              assignee_name: assigneeName,
                            }
                          : {}),
                      }),
                    )
                  }
                >
                  {ACTION_LABELS[action.id] || action.id}
                </button>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

function DailyResultRow({
  row,
  canEvaluate,
  recordId,
  client,
  onRun,
}: {
  row: ProductTestDailyResult;
  canEvaluate: boolean;
  recordId: string;
  client: ProductTestingClient;
  onRun: (label: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [evaluation, setEvaluation] = useState(row.evaluation || "");
  const [note, setNote] = useState(row.leader_note || "");
  const cpl = row.leads ? Number(row.ad_spend || 0) / row.leads : null;
  return (
    <tr>
      <td>{new Date(row.test_date).toLocaleDateString("vi-VN")}</td>
      <td>{row.campaign_name || "—"}</td>
      <td>{vnMoney(row.ad_spend)}</td>
      <td>{row.leads ?? "—"}</td>
      <td>{row.orders ?? "—"}</td>
      <td>{vnMoney(row.revenue)}</td>
      <td>{vnMoney(cpl)}</td>
      <td>
        {canEvaluate ? (
          <div className="pt-evaluate">
            <select
              value={evaluation}
              onChange={(e) => setEvaluation(e.target.value)}
            >
              <option value="">Chọn đánh giá</option>
              <option>Đạt</option>
              <option>Cần test thêm</option>
              <option>Không đạt</option>
            </select>
            <input
              placeholder="Ghi chú"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              disabled={!evaluation}
              onClick={() =>
                onRun(`eval-${row.id}`, () =>
                  client.evaluateDailyResult(recordId, row.id, {
                    evaluation,
                    leader_note: note,
                    version: row.version,
                  }),
                )
              }
            >
              Lưu
            </button>
          </div>
        ) : (
          <>
            <b>{row.evaluation || "Chưa đánh giá"}</b>
            {row.leader_note && <small>{row.leader_note}</small>}
          </>
        )}
      </td>
    </tr>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  type = "text",
}: {
  label: string;
  value: any;
  onChange: (value: string) => void;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <label className="pt-field">
      <span>{label}</span>
      <input
        type={type}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function TextArea({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="pt-field">
      <span>{label}</span>
      <textarea
        value={value || ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function LinkedImage({ url }: { url?: string }) {
  return url ? (
    <img src={url} alt="Ảnh nối từ Check giá" />
  ) : (
    <div className="pt-linked-image">Chưa có ảnh</div>
  );
}
function toNumber(value: string) {
  return value === "" ? null : Number(value);
}
function vnMoney(value: number | null | undefined) {
  return value == null
    ? "—"
    : `${new Intl.NumberFormat("vi-VN").format(Math.round(value))}đ`;
}

const DRAWER_CSS = `
.pt-drawer-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.32);z-index:900;display:flex;justify-content:flex-end}.pt-drawer{height:100%;width:min(900px,94vw);background:#f7f8fa;box-shadow:-10px 0 40px rgba(15,23,42,.18);overflow:auto;color:#1f2937;font:14px Inter,ui-sans-serif,system-ui,sans-serif}.pt-drawer *{box-sizing:border-box}.pt-drawer-head{position:sticky;top:0;z-index:2;background:#fff;border-bottom:1px solid #e5e7eb;padding:17px 20px;display:flex;justify-content:space-between}.pt-drawer-head small,.pt-drawer-head p{color:#6b7280}.pt-drawer-head h2{font-size:20px;margin:2px 0}.pt-drawer-head p{margin:0}.pt-drawer-head>button{border:0;background:#f3f4f6;border-radius:7px;width:34px;height:34px;font-size:22px;cursor:pointer}.pt-drawer-body{padding:16px}.pt-drawer-loading{padding:50px;text-align:center}.pt-drawer-error{position:sticky;top:85px;z-index:3;margin:10px 16px;background:#fef2f2;color:#b91c1c;padding:10px;border-radius:7px}.pt-section{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:14px}.pt-section-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.pt-section-title>div{display:flex;align-items:center;gap:8px}.pt-section-title span{display:grid;place-items:center;width:24px;height:24px;border-radius:99px;background:#dbeafe;color:#1d4ed8;font-weight:700}.pt-section-title h3{margin:0;font-size:16px}.pt-section-title small{color:#6b7280}.pt-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.pt-form-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}.pt-field{display:grid;gap:5px;margin:9px 0;color:#4b5563;font-weight:600;font-size:12px}.pt-field input,.pt-field textarea,.pt-evaluate input,.pt-evaluate select{width:100%;border:1px solid #d1d5db;border-radius:7px;background:#fff;color:#111827;padding:8px;font:13px inherit}.pt-field textarea{min-height:74px;resize:vertical}.pt-field input:disabled,.pt-field textarea:disabled{background:#f6f7f8;color:#6b7280}.pt-images{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.pt-images button,.pt-upload{width:64px;height:64px;border:1px solid #d1d5db;border-radius:8px;background:#f9fafb;padding:2px;cursor:pointer}.pt-images button.selected{border:2px solid #2563eb}.pt-images img{width:100%;height:100%;object-fit:cover;border-radius:5px}.pt-upload{display:grid;place-items:center;color:#2563eb;font-weight:600}.pt-upload input{display:none}.pt-save-row{display:flex;justify-content:flex-end;margin-top:12px}.pt-drawer-primary{border:0;border-radius:7px;background:#2563eb;color:#fff;padding:9px 13px;font-weight:600;cursor:pointer}.pt-linked{display:grid;grid-template-columns:70px 1fr 1fr auto;gap:12px;align-items:center;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:10px;margin-bottom:14px}.pt-linked img,.pt-linked-image{width:60px;height:60px;border-radius:7px;object-fit:cover;background:#e5e7eb}.pt-linked-image{display:grid;place-items:center;text-align:center;font-size:10px;color:#6b7280}.pt-linked b{display:block;font-size:12px}.pt-linked p,.pt-linked a{display:block;margin:4px 0 0;color:#6b7280;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pt-linked a{color:#2563eb}.pt-linked>span{font-size:11px;background:#e5e7eb;color:#6b7280;border-radius:99px;padding:4px 7px}.pt-daily-form{background:#f8fafc;padding:12px;border-radius:8px;margin-bottom:12px}.pt-daily-form>.pt-drawer-primary{margin-top:8px}.pt-daily-table{overflow:auto}.pt-daily-table table{border-collapse:collapse;width:100%;min-width:780px}.pt-daily-table th,.pt-daily-table td{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:12px}.pt-daily-table th{color:#6b7280;background:#f9fafb}.pt-daily-table td:last-child{min-width:250px}.pt-daily-table td small{display:block;color:#6b7280;margin-top:3px}.pt-evaluate{display:grid;grid-template-columns:110px 1fr auto;gap:5px}.pt-evaluate button,.pt-action-buttons button{border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:6px;padding:7px 9px;cursor:pointer;font-weight:600}.pt-action-buttons{display:flex;gap:8px;flex-wrap:wrap}.pt-action-buttons button.success{background:#ecfdf5;color:#047857;border-color:#a7f3d0}.pt-action-buttons button.danger{background:#fef2f2;color:#b91c1c;border-color:#fecaca}.pt-action-buttons button:disabled{opacity:.45;cursor:not-allowed}@media(max-width:700px){.pt-form-grid,.pt-form-grid.three{grid-template-columns:1fr}.pt-linked{grid-template-columns:60px 1fr}.pt-linked>span{display:none}}
`;
