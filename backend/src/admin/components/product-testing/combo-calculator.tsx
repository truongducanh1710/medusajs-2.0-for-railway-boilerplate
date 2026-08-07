import { useEffect, useMemo, useState } from "react";
import { money, NumberField } from "./format";

type ComboState = {
  sale: number[];
  cost: number[];
  mix: number[];
  returnRate: number;
  shipFee: number;
  codFee: number;
  packFee: number;
  targetLng: number;
};

function storageKey(caseId: string) {
  return `pt-combo-calc:${caseId}`;
}

function loadSaved(caseId: string, seedCost1: number): ComboState {
  const fallback: ComboState = {
    sale: [0, 0, 0],
    cost: [seedCost1, seedCost1 * 2, seedCost1 * 3],
    mix: [80, 18, 2],
    returnRate: 15,
    shipFee: 16000,
    codFee: 0,
    packFee: 5300,
    targetLng: 20,
  };
  try {
    const raw = window.localStorage.getItem(storageKey(caseId));
    if (!raw) return fallback;
    const saved = JSON.parse(raw);
    return { ...fallback, ...saved };
  } catch {
    return fallback;
  }
}

// This *is* how Giá bán and Combo get decided now — there's no separate
// manual field for either. sale_price = the weighted-average Giá bán trung
// bình below; combo_json = an auto-generated three-line summary of the same
// tiers. Every keystroke recalculates; onResult only fires once you press
// Lưu đề xuất (the parent wires it into that save call), so typing here
// never silently overwrites a value you haven't chosen to commit yet.
// costHint seeds "Giá vốn đơn 1" from the landed cost Purchasing already
// entered in Check giá, since that's the real unit cost.
//
// State survives a reload: every change is mirrored to localStorage under
// a key scoped to this case, since these numbers can take a while to dial
// in and losing them to an accidental refresh would mean redoing the work.
export function ComboCalculator({
  caseId,
  costHint,
  savedSalePrice,
  onResult,
}: {
  caseId: string;
  costHint: number | null;
  savedSalePrice: number | null;
  onResult: (salePrice: number, comboSummary: string) => void;
}) {
  const seedCost1 = costHint && costHint > 0 ? Math.round(costHint) : 0;
  const [state, setState] = useState<ComboState>(() =>
    loadSaved(caseId, seedCost1),
  );
  const { sale, cost, mix, returnRate, shipFee, codFee, packFee, targetLng } =
    state;

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(caseId), JSON.stringify(state));
    } catch {
      // Best-effort only — a full/blocked localStorage must not break typing.
    }
  }, [caseId, state]);

  const calc = useMemo(() => {
    const mixSum = mix.reduce((a, b) => a + b, 0) || 1;
    const w = mix.map((m) => m / mixSum);
    const saleAvg = sale[0] * w[0] + sale[1] * w[1] + sale[2] * w[2];
    const costAvg = cost[0] * w[0] + cost[1] * w[1] + cost[2] * w[2];
    const returnCost = (returnRate / 100) * saleAvg;
    const grossMinusVar =
      saleAvg - returnCost - costAvg - shipFee - codFee - packFee;
    const cpqcMaxPct =
      saleAvg > 0 ? grossMinusVar / saleAvg - targetLng / 100 : 0;
    const cpqcMaxVnd = cpqcMaxPct * saleAvg;
    const mixTotal = mix.reduce((a, b) => a + b, 0);
    return { w, saleAvg, costAvg, returnCost, grossMinusVar, cpqcMaxPct, cpqcMaxVnd, mixTotal };
  }, [sale, cost, mix, returnRate, shipFee, codFee, packFee, targetLng]);

  const tierLabel = ["Đơn 1", "Đơn đôi", "Đơn ba"];
  const comboSummary = tierLabel
    .map((label, i) => (sale[i] > 0 ? `${label}: ${money(sale[i])}` : null))
    .filter(Boolean)
    .join(" – ");

  // "Unsaved" means the calculator currently disagrees with what's on the
  // proposal — either nothing has been applied yet, or the numbers moved
  // since the last apply. Comparing computed vs. saved (not a dirty flag)
  // means a value that happens to match after a reload doesn't false-alarm.
  const unsaved =
    calc.saleAvg > 0 &&
    Math.round(calc.saleAvg) !== Math.round(savedSalePrice || 0);

  const setAt = (key: "sale" | "cost" | "mix", i: number, v: string) => {
    const next = [...state[key]];
    next[i] = v === "" ? 0 : Number(v);
    setState({ ...state, [key]: next });
  };

  return (
    <div className="pt-combo">
      <div className="pt-combo-head">
        <span>🧮 Tạm tính combo</span>
        {unsaved ? (
          <small className="pt-combo-unsaved">
            ⚠ Chưa áp dụng vào Giá bán — bấm "Lưu đề xuất" để lưu
          </small>
        ) : (
          <small>Số liệu tự lưu ở máy này, không mất khi tải lại trang</small>
        )}
      </div>

      <div className="pt-combo-tri-head">
        <span />
        {tierLabel.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <div className="pt-combo-row">
        <span>Giá bán / đơn</span>
        {sale.map((v, i) => (
          <NumberField
            key={i}
            value={v || ""}
            onChange={(value) => setAt("sale", i, value)}
          />
        ))}
      </div>
      <div className="pt-combo-row">
        <span>Giá vốn / đơn</span>
        {cost.map((v, i) => (
          <NumberField
            key={i}
            value={v || ""}
            onChange={(value) => setAt("cost", i, value)}
          />
        ))}
      </div>
      <div className="pt-combo-row">
        <span>Tỷ lệ mix %</span>
        {mix.map((v, i) => (
          <input
            key={i}
            type="number"
            value={v || ""}
            onChange={(e) => setAt("mix", i, e.target.value)}
          />
        ))}
      </div>
      {Math.abs(calc.mixTotal - 100) > 0.5 && (
        <div className="pt-combo-warn">
          Tổng mix đang {calc.mixTotal.toFixed(0)}% — tự quy về 100% khi tính (
          {calc.w.map((w, i) => `${tierLabel[i]} ${(w * 100).toFixed(0)}%`).join(" / ")}
          ).
        </div>
      )}

      <div className="pt-combo-2col">
        <label>
          <span>Tỷ lệ hoàn/huỷ %</span>
          <input
            type="number"
            value={returnRate || ""}
            onChange={(e) =>
              setState({ ...state, returnRate: Number(e.target.value) || 0 })
            }
          />
        </label>
        <label>
          <span>Phí ship (đ)</span>
          <NumberField
            value={shipFee || ""}
            onChange={(value) =>
              setState({ ...state, shipFee: Number(value) || 0 })
            }
          />
        </label>
        <label>
          <span>Phí thu hộ COD (đ)</span>
          <NumberField
            value={codFee || ""}
            onChange={(value) =>
              setState({ ...state, codFee: Number(value) || 0 })
            }
          />
        </label>
        <label>
          <span>Phí đóng gói/lưu kho (đ)</span>
          <NumberField
            value={packFee || ""}
            onChange={(value) =>
              setState({ ...state, packFee: Number(value) || 0 })
            }
          />
        </label>
        <label>
          <span>Target LN gộp %</span>
          <input
            type="number"
            value={targetLng || ""}
            onChange={(e) =>
              setState({ ...state, targetLng: Number(e.target.value) || 0 })
            }
          />
        </label>
      </div>

      <div className="pt-combo-out">
        <div>
          <span>Giá bán trung bình</span>
          <b
            className="pt-formula"
            title={`Công thức: ${sale.map((s, i) => `${money(s)}×${(calc.w[i] * 100).toFixed(0)}%`).join(" + ")}`}
          >
            {money(calc.saleAvg)}
          </b>
        </div>
        <div>
          <span>Giá vốn trung bình</span>
          <b
            className="pt-formula"
            title={`Công thức: ${cost.map((c, i) => `${money(c)}×${(calc.w[i] * 100).toFixed(0)}%`).join(" + ")}`}
          >
            {money(calc.costAvg)}
          </b>
        </div>
        <div>
          <span>Hàng hoàn</span>
          <b
            className="pt-formula"
            title={`Công thức: ${returnRate}% × ${money(calc.saleAvg)} (giá bán TB)`}
          >
            {money(calc.returnCost)}
          </b>
        </div>
        <div>
          <span>LN gộp − CP biến đổi</span>
          <b
            className="pt-formula"
            title={`Công thức: ${money(calc.saleAvg)} − ${money(calc.returnCost)} − ${money(calc.costAvg)} − ${money(shipFee)} − ${money(codFee)} − ${money(packFee)}`}
          >
            {money(calc.grossMinusVar)}
          </b>
        </div>
      </div>

      <div className={`pt-combo-hero${calc.cpqcMaxPct < 0 ? " warn" : ""}`}>
        <div>
          <span>%CPQC tối đa để đạt target</span>
          <small>
            {calc.cpqcMaxPct < 0
              ? "Âm — ngay cả 0đ ads cũng không đạt target. Tăng giá bán, giảm giá vốn/phí, hoặc hạ target."
              : "Chi phí ads được phép đốt / đơn để vẫn đạt target LN gộp."}
          </small>
        </div>
        <div className="pt-combo-hero-num">
          <b>{(calc.cpqcMaxPct * 100).toFixed(1)}%</b>
          <small>{money(Math.max(calc.cpqcMaxVnd, 0))} / đơn</small>
        </div>
      </div>

      {calc.saleAvg > 0 && (
        <div className="pt-combo-apply">
          <button
            type="button"
            className={unsaved ? "pt-drawer-primary" : "pt-ghost"}
            onClick={() => onResult(Math.round(calc.saleAvg), comboSummary)}
          >
            {unsaved
              ? `Áp dụng ${money(calc.saleAvg)} vào Giá bán ↓`
              : "Đã áp dụng vào Giá bán ✓"}
          </button>
        </div>
      )}
    </div>
  );
}
