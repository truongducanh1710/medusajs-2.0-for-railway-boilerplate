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
export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("vi-VN");
}
export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : `${d.toLocaleDateString("vi-VN")} ${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
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

// Native <input type="number"> never shows thousands separators — that's a
// browser limitation, not a styling choice — so every numeric field in this
// module renders as a text input that formats with dots as you type, while
// onChange still hands back a plain numeric string like a number input would.
export function formatThousands(raw: string): string {
  const negative = raw.trim().startsWith("-");
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return negative ? "-" : "";
  const withDots = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return negative ? `-${withDots}` : withDots;
}
export function unformatThousands(display: string): string {
  const negative = display.trim().startsWith("-");
  const digits = display.replace(/[^0-9]/g, "");
  return digits ? (negative ? `-${digits}` : digits) : "";
}

export function NumberField({
  value,
  onChange,
  disabled,
  className,
}: {
  value: any;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      className={className}
      value={formatThousands(String(value ?? ""))}
      disabled={disabled}
      onChange={(e) => onChange(unformatThousands(e.target.value))}
    />
  );
}

export function isUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Link fields type freely (paste-then-adjust is common), but flag an
// invalid value once typing settles, and surface a real "open" link the
// moment the value parses as http(s) — not only once the field is locked.
export function LinkField({
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
  const trimmed = (value ?? "").trim();
  const valid = !trimmed || isUrl(trimmed);
  return (
    <label className="pt-field">
      <span>
        {label}
        {isUrl(value) && (
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
      <input
        type="url"
        placeholder="https://..."
        className={valid ? "" : "pt-field-invalid"}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {!valid && <small className="pt-field-error">Link không hợp lệ — cần bắt đầu bằng http:// hoặc https://</small>}
    </label>
  );
}
