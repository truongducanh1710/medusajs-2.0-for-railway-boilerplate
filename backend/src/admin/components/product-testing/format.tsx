// Shared formatters + the visual marker for cells the backend derives
// (kpi.ts) rather than cells a person typed in. Used by both the list page
// and the drawer so a formula always looks the same everywhere.
export function money(value: number | null | undefined) {
  return value == null
    ? "—"
    : `${new Intl.NumberFormat("vi-VN").format(Math.round(value))}đ`;
}
export function number(value: number | null | undefined) {
  return value == null
    ? "—"
    : new Intl.NumberFormat("vi-VN").format(Math.round(value));
}
export function ratio(value: number | null | undefined) {
  return value == null ? "—" : `${(value * 100).toFixed(0)}%`;
}

// Renders a computed value with a distinct color and a hover tooltip
// spelling out the formula and the numbers that produced it — so nobody
// mistakes it for a field they can type into.
export function FormulaCell({
  formula,
  display,
}: {
  formula: string;
  display: string;
}) {
  return (
    <span className="pt-formula" title={`Công thức: ${formula}`}>
      {display}
    </span>
  );
}
