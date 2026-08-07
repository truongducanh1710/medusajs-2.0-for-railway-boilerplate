import { useEffect, useMemo, useState } from "react";
import { money, NumberField } from "./format";

// This *is* how Giá bán and Combo get decided now — there's no separate
// manual field for either. sale_price = the weighted-average Giá bán trung
// bình below; combo_json = an auto-generated three-line summary of the same
// tiers. Every keystroke recalculates and reports upward via onResult, so
// the proposal always reflects the calculator's current numbers.
// costHint seeds "Giá vốn đơn 1" from the landed cost Purchasing already
// entered in Check giá, since that's the real unit cost.
export function ComboCalculator({
  costHint,
  onResult,
}: {
  costHint: number | null;
  onResult: (salePrice: number, comboSummary: string) => void;
}) {
  const seedCost1 = costHint && costHint > 0 ? Math.round(costHint) : 0;
  const [sale, setSale] = useState([0, 0, 0]);
  const [cost, setCost] = useState([seedCost1, seedCost1 * 2, seedCost1 * 3]);
  const [mix, setMix] = useState([80, 18, 2]);
  const [returnRate, setReturnRate] = useState(15);
  const [shipFee, setShipFee] = useState(16000);
  const [codFee, setCodFee] = useState(0);
  const [packFee, setPackFee] = useState(5300);
  const [targetLng, setTargetLng] = useState(20);

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

  useEffect(() => {
    if (calc.saleAvg <= 0) return;
    const summary = tierLabel
      .map((label, i) => (sale[i] > 0 ? `${label}: ${money(sale[i])}` : null))
      .filter(Boolean)
      .join(" – ");
    onResult(Math.round(calc.saleAvg), summary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calc.saleAvg, sale[0], sale[1], sale[2]]);

  const setAt = (
    arr: number[],
    setter: (v: number[]) => void,
    i: number,
    v: string,
  ) => {
    const next = [...arr];
    next[i] = v === "" ? 0 : Number(v);
    setter(next);
  };

  return (
    <div className="pt-combo">
      <div className="pt-combo-head">
        <span>🧮 Tạm tính combo</span>
        <small>Chỉ để tính thử — không lưu vào hồ sơ</small>
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
            onChange={(value) => setAt(sale, setSale, i, value)}
          />
        ))}
      </div>
      <div className="pt-combo-row">
        <span>Giá vốn / đơn</span>
        {cost.map((v, i) => (
          <NumberField
            key={i}
            value={v || ""}
            onChange={(value) => setAt(cost, setCost, i, value)}
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
            onChange={(e) => setAt(mix, setMix, i, e.target.value)}
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
            onChange={(e) => setReturnRate(Number(e.target.value) || 0)}
          />
        </label>
        <label>
          <span>Phí ship (đ)</span>
          <NumberField
            value={shipFee || ""}
            onChange={(value) => setShipFee(Number(value) || 0)}
          />
        </label>
        <label>
          <span>Phí thu hộ COD (đ)</span>
          <NumberField
            value={codFee || ""}
            onChange={(value) => setCodFee(Number(value) || 0)}
          />
        </label>
        <label>
          <span>Phí đóng gói/lưu kho (đ)</span>
          <NumberField
            value={packFee || ""}
            onChange={(value) => setPackFee(Number(value) || 0)}
          />
        </label>
        <label>
          <span>Target LN gộp %</span>
          <input
            type="number"
            value={targetLng || ""}
            onChange={(e) => setTargetLng(Number(e.target.value) || 0)}
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

      <p className="pt-combo-sync">
        ✓ Giá bán và Combo trong đề xuất tự đồng bộ theo bảng này khi bạn Lưu.
      </p>
    </div>
  );
}
