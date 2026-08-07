import { useEffect, useState } from "react";
import type { ProductTestingClient } from "./client";
import { STATUS_LABELS } from "./types";
import type {
  ProductTestCaseRecord,
  ProductTestDailyResult,
  ProductTestProposal,
  ProductTestPurchaseCheck,
} from "./types";
import {
  FormulaCell,
  LinkField,
  NumberField,
  isUrl,
  money as vnMoney,
  formatDateTime as vnDateTime,
} from "./format";
import { ComboCalculator } from "./combo-calculator";
import { calculateKpis } from "../../../modules/product-test/kpi";

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
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  // Deleting closes the drawer, so it must not run() → load() the case that
  // was just removed — that would 404 right before onClose() unmounts it.
  async function runDelete() {
    setBusy("delete");
    setError("");
    try {
      await client.deleteCase(record.id);
      await onChanged();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Không xoá được hồ sơ");
      setBusy("");
    }
  }
  // MKT phụ trách and Purchasing may both edit Check giá/Đề xuất at any open
  // stage; only the two terminal decisions lock the case for good.
  const isConcluded = ["import_approved", "import_rejected"].includes(
    record.status,
  );
  const purchaseEditable =
    !isConcluded &&
    (permissions.can_edit_purchase || permissions.can_edit_marketing);
  const proposalEditable =
    !isConcluded &&
    (permissions.can_edit_purchase || permissions.can_edit_marketing);
  const dailyEditable =
    permissions.can_edit_marketing && record.status === "testing";

  // proposal.sale_price only reflects what's typed in the form, not what's
  // saved on record.proposal — comparing against the latter is what makes
  // "close without saving" catchable, since a re-fetch after Lưu updates
  // both to match.
  const hasUnsavedProposal =
    proposalEditable &&
    (proposal.sale_price !== (record.proposal?.sale_price ?? null) ||
      proposal.combo_json !== (record.proposal?.combo_json || ""));
  function handleClose() {
    if (
      hasUnsavedProposal &&
      !window.confirm(
        "Đề xuất có thay đổi chưa lưu (Giá bán/Combo). Đóng mà không lưu?",
      )
    ) {
      return;
    }
    onClose();
  }

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
    <div className="pt-drawer-backdrop" onMouseDown={handleClose}>
      <aside className="pt-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <style>{DRAWER_CSS}</style>
        <header className="pt-drawer-head">
          <div>
            <small>{record.code}</small>
            <h2>{record.product_name}</h2>
            <p>
              <span className={`pt-status s-${record.status}`}>
                {STATUS_LABELS[record.status] || record.status}
              </span>
              <span>MKT: {record.assignee_name}</span>
              <span>v{record.version}</span>
            </p>
          </div>
          <div className="pt-drawer-head-actions">
            {permissions.can_approve &&
              (confirmDelete ? (
                <div className="pt-delete-confirm">
                  <span>Xoá hồ sơ này?</span>
                  <button className="danger" disabled={!!busy} onClick={runDelete}>
                    Xoá
                  </button>
                  <button onClick={() => setConfirmDelete(false)}>Huỷ</button>
                </div>
              ) : (
                <button
                  className="pt-delete-trigger"
                  title="Xoá hồ sơ (chỉ Leader)"
                  onClick={() => setConfirmDelete(true)}
                >
                  🗑
                </button>
              ))}
            <button onClick={handleClose}>×</button>
          </div>
        </header>
        {error && <div className="pt-drawer-error">{error}</div>}
        <div className="pt-drawer-body">
          <section
            className={`pt-section${purchaseEditable ? "" : " is-locked"}`}
          >
            <div className="pt-section-title">
              <div>
                <span className="pt-step">1</span>
                <h3>Check giá</h3>
              </div>
              <OwnerBadge
                editable={purchaseEditable}
                editableLabel={
                  permissions.can_edit_purchase
                    ? "Bạn đang nhập (Mua hàng)"
                    : "Bạn đang nhập (MKT)"
                }
                lockedLabel="Hồ sơ đã kết luận, không sửa được nữa"
              />
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
              <LinkField
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
                  disabled={
                    !!busy ||
                    (!!purchase.supplier_link.trim() &&
                      !isUrl(purchase.supplier_link))
                  }
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

          <section
            className={`pt-section${proposalEditable ? "" : " is-locked"}`}
          >
            <div className="pt-section-title">
              <div>
                <span className="pt-step">2</span>
                <h3>Đề xuất test</h3>
              </div>
              <OwnerBadge
                editable={proposalEditable}
                editableLabel={
                  permissions.can_edit_purchase
                    ? "Bạn đang nhập (Mua hàng)"
                    : "Bạn đang nhập (MKT)"
                }
                lockedLabel="Hồ sơ đã kết luận, không sửa được nữa"
              />
            </div>
            <TextArea
              label="USP sản phẩm"
              value={proposal.usp}
              disabled={!proposalEditable}
              onChange={(value) => setProposal({ ...proposal, usp: value })}
            />
            {proposalEditable ? (
              <ComboCalculator
                caseId={record.id}
                costHint={purchase.landed_price_per_unit}
                savedSalePrice={proposal.sale_price}
                onResult={(salePrice, comboSummary) =>
                  setProposal({
                    ...proposal,
                    sale_price: salePrice,
                    combo_json: comboSummary,
                  })
                }
              />
            ) : (
              <div className="pt-combo-locked">
                <span>Combo đã chốt</span>
                <b>{proposal.combo_json || "Chưa có"}</b>
                <small>Giá bán trung bình: {vnMoney(proposal.sale_price)}</small>
              </div>
            )}
            <div className="pt-form-grid">
              <LinkField
                label="Landing page"
                value={proposal.landing_url}
                disabled={!proposalEditable}
                onChange={(value) =>
                  setProposal({ ...proposal, landing_url: value })
                }
              />
              <TextArea
                label="Nội dung quảng cáo"
                value={proposal.ad_content}
                disabled={!proposalEditable}
                onChange={(value) =>
                  setProposal({ ...proposal, ad_content: value })
                }
              />
            </div>
            {proposalEditable && (
              <div className="pt-save-row">
                <button
                  className="pt-drawer-primary"
                  disabled={
                    !!busy ||
                    (!!proposal.landing_url.trim() &&
                      !isUrl(proposal.landing_url))
                  }
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

          <section className={`pt-section${dailyEditable ? "" : " is-locked"}`}>
            <div className="pt-section-title">
              <div>
                <span className="pt-step">3</span>
                <h3>Kết quả test nhiều ngày</h3>
              </div>
              <OwnerBadge
                editable={dailyEditable}
                editableLabel="Bạn đang nhập (MKT)"
                lockedLabel="Mở khi camp bắt đầu chạy"
              />
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
                    <th title="Công thức: Chi phí ads ÷ Số lead">CPL ⨍</th>
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

          <section className="pt-section">
            <div className="pt-section-title">
              <div>
                <span className="pt-step">🕓</span>
                <h3>Lịch sử</h3>
              </div>
              <small>{record.events.length} sự kiện</small>
            </div>
            {record.events.length ? (
              <ul className="pt-history">
                {record.events.map((event) => (
                  <li key={event.id}>
                    <div className="pt-history-when">
                      {vnDateTime(event.created_at)}
                    </div>
                    <div className="pt-history-body">
                      <b>{ACTION_LABELS[event.action] || event.action}</b>
                      <span> · {event.actor}</span>
                      {event.comment && <p>{event.comment}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pt-history-empty">Chưa có lịch sử thay đổi.</p>
            )}
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
  // Same formula as the backend's kpi.ts, reused here so a single row can
  // show its CPL before the whole case is re-fetched from the server.
  const { cpl } = calculateKpis(row);
  return (
    <tr>
      <td>{new Date(row.test_date).toLocaleDateString("vi-VN")}</td>
      <td>{row.campaign_name || "—"}</td>
      <td>{vnMoney(row.ad_spend)}</td>
      <td>{row.leads ?? "—"}</td>
      <td>{row.orders ?? "—"}</td>
      <td>{vnMoney(row.revenue)}</td>
      <td>
        <FormulaCell
          formula={`${vnMoney(row.ad_spend)} chi phí ads ÷ ${row.leads ?? 0} lead`}
          display={vnMoney(cpl)}
        />
      </td>
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
  // A locked field holding a URL should still be openable — a greyed-out
  // input isn't clickable, so surface a real link alongside it.
  const showLink = disabled && isUrl(value);
  return (
    <label className="pt-field">
      <span>
        {label}
        {showLink && (
          <a
            className="pt-field-link"
            href={value}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            Mở link ↗
          </a>
        )}
      </span>
      {type === "number" ? (
        <NumberField value={value} onChange={onChange} disabled={disabled} />
      ) : (
        <input
          type={type}
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
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
// Tells the reader at a glance whether this step is theirs to fill in right
// now, and if not, who it is waiting on.
function OwnerBadge({
  editable,
  editableLabel,
  lockedLabel,
}: {
  editable: boolean;
  editableLabel: string;
  lockedLabel: string;
}) {
  return (
    <span className={`pt-owner ${editable ? "editable" : "locked"}`}>
      {editable ? `✎ ${editableLabel}` : `🔒 ${lockedLabel}`}
    </span>
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

// Colours come from Medusa's admin design tokens so the drawer follows the
// active light/dark theme instead of hardcoding its own palette.
const DRAWER_CSS = `
@keyframes ptDrawerIn{from{transform:translateX(24px);opacity:.6}to{transform:none;opacity:1}}
.pt-drawer-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.42);z-index:900;display:flex;justify-content:flex-end;backdrop-filter:blur(1px)}
.pt-drawer{height:100%;width:min(940px,96vw);background:var(--bg-subtle,#f7f8fa);box-shadow:-10px 0 40px rgba(15,23,42,.18);overflow:auto;color:var(--fg-base,#1f2937);font:14px Inter,ui-sans-serif,system-ui,sans-serif;animation:ptDrawerIn .22s cubic-bezier(.21,1.02,.73,1)}
.pt-drawer *{box-sizing:border-box}
.pt-drawer-head{position:sticky;top:0;z-index:2;background:var(--bg-base,#fff);border-bottom:1px solid var(--border-base,#e5e7eb);padding:16px 20px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.pt-drawer-head small{color:var(--fg-muted,#6b7280);font-size:11px;letter-spacing:.04em;text-transform:uppercase}
.pt-drawer-head h2{font-size:19px;margin:3px 0 4px;color:var(--fg-base,#111827);line-height:1.3}
.pt-drawer-head p{margin:0;color:var(--fg-subtle,#6b7280);font-size:12px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.pt-drawer-head-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.pt-drawer-head-actions>button{border:0;background:var(--bg-field,#f3f4f6);color:var(--fg-subtle,#6b7280);border-radius:7px;width:32px;height:32px;font-size:20px;line-height:1;cursor:pointer;flex-shrink:0}
.pt-drawer-head-actions>button:hover{background:var(--bg-field-hover,#e5e7eb)}
.pt-delete-trigger{font-size:15px!important}
.pt-delete-trigger:hover{background:#fef2f2!important;color:#dc2626!important}
.pt-delete-confirm{display:flex;align-items:center;gap:8px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:6px 10px}
.pt-delete-confirm>span{font-size:12px;color:#991b1b;font-weight:600;white-space:nowrap}
.pt-delete-confirm button{border:0;border-radius:6px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;width:auto!important;height:auto!important}
.pt-delete-confirm button.danger{background:#dc2626;color:#fff}
.pt-delete-confirm button.danger:hover{background:#b91c1c}
.pt-delete-confirm button:not(.danger){background:var(--bg-field,#f3f4f6);color:var(--fg-subtle,#4b5563)}
.pt-drawer-body{padding:16px}
.pt-drawer-loading{padding:50px;text-align:center;color:var(--fg-muted,#6b7280)}
.pt-drawer-error{position:sticky;top:88px;z-index:3;margin:10px 16px;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;padding:10px 12px;border-radius:8px;font-size:13px}
.pt-section{background:var(--bg-base,#fff);border:1px solid var(--border-base,#e5e7eb);border-radius:10px;padding:16px;margin-bottom:14px}
.pt-section.is-locked{opacity:.72}
.pt-section-title{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.pt-section-title>div{display:flex;align-items:center;gap:8px}
.pt-section-title span.pt-step{display:grid;place-items:center;width:23px;height:23px;border-radius:99px;background:#dbeafe;color:#1d4ed8;font-weight:700;font-size:12px;flex-shrink:0}
.pt-section-title h3{margin:0;font-size:15px;color:var(--fg-base,#111827)}
.pt-section-title small{color:var(--fg-muted,#6b7280);font-size:12px}
.pt-owner{font-size:11px;border-radius:99px;padding:3px 9px;font-weight:600;white-space:nowrap}
.pt-owner.editable{background:#ecfdf5;color:#047857}
.pt-owner.locked{background:var(--bg-field,#f3f4f6);color:var(--fg-muted,#6b7280)}
.pt-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.pt-form-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.pt-field{display:grid;gap:5px;margin:9px 0;color:var(--fg-subtle,#4b5563);font-weight:600;font-size:12px}
.pt-field>span{display:flex;align-items:center;justify-content:space-between;gap:8px}
.pt-field-link{color:#2563eb;font-weight:600;text-decoration:none;flex-shrink:0}
.pt-field-link:hover{text-decoration:underline}
.pt-field input.pt-field-invalid{border-color:#fca5a5;background:#fef2f2}
.pt-field input.pt-field-invalid:focus{border-color:#f87171;box-shadow:0 0 0 3px rgba(248,113,113,.16)}
.pt-field-error{color:#dc2626;font-weight:600;font-size:11px}
.pt-field input,.pt-field textarea,.pt-evaluate input,.pt-evaluate select{width:100%;border:1px solid var(--border-base,#d1d5db);border-radius:7px;background:var(--bg-field,#fff);color:var(--fg-base,#111827);padding:8px;font:13px inherit;font-weight:400;outline:none;transition:border-color .12s,box-shadow .12s}
.pt-field input:focus,.pt-field textarea:focus{border-color:#60a5fa;box-shadow:0 0 0 3px rgba(59,130,246,.16)}
.pt-field textarea{min-height:74px;resize:vertical;line-height:1.5}
.pt-field input:disabled,.pt-field textarea:disabled{background:var(--bg-disabled,#f6f7f8);color:var(--fg-muted,#9ca3af);cursor:not-allowed}
.pt-images{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.pt-images button,.pt-upload{width:64px;height:64px;border:1px solid var(--border-base,#d1d5db);border-radius:8px;background:var(--bg-field,#f9fafb);padding:2px;cursor:pointer}
.pt-images button.selected{border:2px solid #2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.16)}
.pt-images img{width:100%;height:100%;object-fit:cover;border-radius:5px;display:block}
.pt-upload{display:grid;place-items:center;color:#2563eb;font-weight:600;font-size:12px}
.pt-upload input{display:none}
.pt-save-row{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px}
.pt-hint{color:var(--fg-muted,#6b7280);font-size:12px;margin-right:auto}
.pt-drawer-primary{border:0;border-radius:7px;background:#2563eb;color:#fff;padding:9px 14px;font-weight:600;font-size:13px;cursor:pointer;transition:background .12s}
.pt-drawer-primary:hover:not(:disabled){background:#1d4ed8}
.pt-drawer-primary:disabled{opacity:.5;cursor:not-allowed}
.pt-linked{display:grid;grid-template-columns:70px 1fr 1fr auto;gap:12px;align-items:center;background:var(--bg-subtle,#f8fafc);border:1px dashed var(--border-strong,#cbd5e1);border-radius:8px;padding:10px;margin-bottom:14px}
.pt-linked img,.pt-linked-image{width:60px;height:60px;border-radius:7px;object-fit:cover;background:var(--bg-field,#e5e7eb)}
.pt-linked-image{display:grid;place-items:center;text-align:center;font-size:10px;color:var(--fg-muted,#6b7280)}
.pt-linked b{display:block;font-size:12px;color:var(--fg-base,#374151)}
.pt-linked p,.pt-linked a{display:block;margin:4px 0 0;color:var(--fg-muted,#6b7280);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pt-linked a{color:#2563eb}
.pt-linked>span{font-size:11px;background:var(--bg-field,#e5e7eb);color:var(--fg-muted,#6b7280);border-radius:99px;padding:4px 8px;white-space:nowrap}
.pt-daily-form{background:var(--bg-subtle,#f8fafc);border:1px solid var(--border-base,#e5e7eb);padding:12px;border-radius:8px;margin-bottom:12px}
.pt-daily-form>.pt-drawer-primary{margin-top:10px}
.pt-daily-table{overflow:auto;border:1px solid var(--border-base,#e5e7eb);border-radius:8px}
.pt-daily-table table{border-collapse:collapse;width:100%;min-width:780px}
.pt-daily-table th,.pt-daily-table td{padding:9px;border-bottom:1px solid var(--border-base,#eef0f2);text-align:left;font-size:12px}
.pt-daily-table tr:last-child td{border-bottom:0}
.pt-daily-table th{color:var(--fg-muted,#6b7280);background:var(--bg-subtle,#f9fafb);font-weight:600;white-space:nowrap}
.pt-daily-table td:last-child{min-width:250px}
.pt-daily-table td small{display:block;color:var(--fg-muted,#6b7280);margin-top:3px}
.pt-formula{color:#92400e;background:#fef3c7;border-radius:5px;padding:2px 6px;font-weight:600;cursor:help;border-bottom:1px dashed #d97706}
.pt-daily-table th[title]{cursor:help;border-bottom:1px dashed var(--fg-muted,#9ca3af)}
.pt-evaluate{display:grid;grid-template-columns:110px 1fr auto;gap:5px}
.pt-evaluate button,.pt-action-buttons button{border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:7px;padding:8px 11px;cursor:pointer;font-weight:600;font-size:13px;transition:filter .12s}
.pt-evaluate button:hover:not(:disabled),.pt-action-buttons button:hover:not(:disabled){filter:brightness(.96)}
.pt-action-buttons{display:flex;gap:8px;flex-wrap:wrap}
.pt-action-buttons button.success{background:#ecfdf5;color:#047857;border-color:#a7f3d0}
.pt-action-buttons button.danger{background:#fef2f2;color:#b91c1c;border-color:#fecaca}
.pt-action-buttons button:disabled{opacity:.45;cursor:not-allowed}
.pt-combo{background:var(--bg-subtle,#f8fafc);border:1px solid var(--border-base,#e5e7eb);border-radius:9px;padding:14px;margin:14px 0}
.pt-combo-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.pt-combo-head>span{font-weight:700;font-size:13px;color:var(--fg-base,#111827)}
.pt-combo-head>small{color:var(--fg-muted,#6b7280);font-size:11px}
.pt-combo-tri-head{display:grid;grid-template-columns:38% repeat(3,1fr);gap:8px;padding:0 0 4px}
.pt-combo-tri-head span{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--fg-muted,#9ca3af);text-align:center}
.pt-combo-row{display:grid;grid-template-columns:38% repeat(3,1fr);gap:8px;align-items:center;margin:6px 0}
.pt-combo-row>span{color:var(--fg-subtle,#4b5563);font-size:12px;font-weight:600}
.pt-combo-row input{width:100%;border:1px solid var(--border-base,#d1d5db);border-radius:6px;background:var(--bg-field,#eff6ff);color:#1d4ed8;padding:6px 7px;font:600 12.5px ui-monospace,Menlo,Consolas,monospace;text-align:right;outline:none}
.pt-combo-row input:focus{border-color:#60a5fa;box-shadow:0 0 0 3px rgba(59,130,246,.16)}
.pt-combo-warn{font-size:11px;color:#b91c1c;background:#fef2f2;border-radius:6px;padding:6px 9px;margin:6px 0}
.pt-combo-2col{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 14px;margin:12px 0}
.pt-combo-2col label{display:grid;gap:4px;font-size:11.5px;font-weight:600;color:var(--fg-subtle,#4b5563)}
.pt-combo-2col input{border:1px solid var(--border-base,#d1d5db);border-radius:6px;background:var(--bg-field,#eff6ff);color:#1d4ed8;padding:7px 8px;font:600 12.5px ui-monospace,Menlo,Consolas,monospace;text-align:right;outline:none}
.pt-combo-2col input:focus{border-color:#60a5fa;box-shadow:0 0 0 3px rgba(59,130,246,.16)}
.pt-combo-out{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0}
.pt-combo-out>div{display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--bg-base,#fff);border:1px solid var(--border-base,#e5e7eb);border-radius:7px;padding:8px 10px}
.pt-combo-out>div>span{font-size:11.5px;color:var(--fg-muted,#6b7280)}
.pt-combo-out b.pt-formula{font-size:12.5px;padding:4px 8px}
.pt-combo-hero{display:flex;justify-content:space-between;align-items:center;gap:12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px 14px}
.pt-combo-hero.warn{background:#fef2f2;border-color:#fecaca}
.pt-combo-hero>div:first-child span{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#374151;margin-bottom:2px}
.pt-combo-hero>div:first-child small{display:block;font-size:11px;color:#6b7280;max-width:260px}
.pt-combo-hero-num{text-align:right;flex-shrink:0}
.pt-combo-hero-num b{display:block;font:800 22px ui-monospace,Menlo,Consolas,monospace;color:#059669}
.pt-combo-hero.warn .pt-combo-hero-num b{color:#dc2626}
.pt-combo-hero-num small{font-size:11px;color:#6b7280}
.pt-combo-apply{display:flex;justify-content:flex-end;margin-top:10px}
.pt-combo-unsaved{color:#b45309!important;font-weight:700}
.pt-combo-locked{background:var(--bg-subtle,#f8fafc);border:1px dashed var(--border-strong,#cbd5e1);border-radius:9px;padding:12px 14px;margin:14px 0;display:grid;gap:3px}
.pt-combo-locked span{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--fg-muted,#9ca3af)}
.pt-combo-locked b{font-size:13px;color:var(--fg-base,#111827)}
.pt-combo-locked small{font-size:12px;color:var(--fg-subtle,#4b5563)}
.pt-history{list-style:none;margin:0;padding:0;display:grid;gap:0}
.pt-history li{display:grid;grid-template-columns:130px 1fr;gap:12px;padding:9px 0;border-bottom:1px solid var(--border-base,#eef0f2)}
.pt-history li:last-child{border-bottom:0}
.pt-history-when{font-size:11.5px;color:var(--fg-muted,#9ca3af);white-space:nowrap;padding-top:1px}
.pt-history-body b{font-size:12.5px;color:var(--fg-base,#111827)}
.pt-history-body span{font-size:12px;color:var(--fg-subtle,#6b7280)}
.pt-history-body p{margin:4px 0 0;font-size:12px;color:var(--fg-subtle,#4b5563);background:var(--bg-subtle,#f8fafc);border-radius:6px;padding:6px 8px}
.pt-history-empty{color:var(--fg-muted,#9ca3af);font-size:12.5px;margin:0}
@media(max-width:700px){.pt-form-grid,.pt-form-grid.three{grid-template-columns:1fr}.pt-linked{grid-template-columns:60px 1fr}.pt-linked>span{display:none}.pt-combo-2col{grid-template-columns:1fr}.pt-combo-out{grid-template-columns:1fr}}
`;
