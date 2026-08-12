import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";

// Medusa's own error boundary swallows the error and renders a generic
// "An unexpected error occurred" with nothing in the console — which makes a
// render crash on a live page effectively undebuggable. Wrapping a page in
// this boundary keeps the failure visible: the message, the component stack
// and the last few API calls all stay on screen and in the console.

type ApiLogEntry = {
  at: string;
  url: string;
  status: number | string;
  ok: boolean;
  bodyPreview: string;
};

// Ring buffer of recent admin API calls, filled by api-client so the boundary
// can show what the page received right before it broke.
const API_LOG: ApiLogEntry[] = [];
const API_LOG_MAX = 25;

export function recordApiCall(entry: ApiLogEntry) {
  API_LOG.push(entry);
  if (API_LOG.length > API_LOG_MAX) API_LOG.shift();
}

export function getApiLog(): ApiLogEntry[] {
  return [...API_LOG];
}

type Props = { name: string; children: ReactNode };
type State = { error: Error | null; stack: string };

export class DebugBoundary extends Component<Props, State> {
  state: State = { error: null, stack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const stack = info.componentStack || "";
    this.setState({ stack });
    // Log loudly: this is the output that was missing while debugging blank
    // pages, so keep it grouped and include the API calls that preceded it.
    console.error(`[${this.props.name}] render crashed:`, error);
    console.error(`[${this.props.name}] component stack:`, stack);
    console.table?.(getApiLog());
    (window as any).__lastAdminError = {
      page: this.props.name,
      message: error?.message,
      stack: error?.stack,
      componentStack: stack,
      apiLog: getApiLog(),
    };
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children as any;

    const apiLog = getApiLog();
    const report = JSON.stringify(
      {
        page: this.props.name,
        message: error?.message,
        stack: error?.stack,
        componentStack: stack,
        apiLog,
        url: window.location.href,
        at: new Date().toISOString(),
      },
      null,
      2,
    );

    return (
      <div style={S.wrap}>
        <h2 style={S.title}>Trang bị lỗi khi hiển thị</h2>
        <p style={S.sub}>
          Gửi nội dung dưới đây cho kỹ thuật để xử lý nhanh.
        </p>

        <div style={S.box}>
          <div style={S.label}>Lỗi</div>
          <pre style={S.pre}>{error?.message || String(error)}</pre>
        </div>

        {stack && (
          <div style={S.box}>
            <div style={S.label}>Vị trí trong giao diện</div>
            <pre style={S.pre}>{stack.trim().split("\n").slice(0, 12).join("\n")}</pre>
          </div>
        )}

        {!!apiLog.length && (
          <div style={S.box}>
            <div style={S.label}>API gọi gần nhất</div>
            <pre style={S.pre}>
              {apiLog
                .slice(-8)
                .map((e) => `${e.status}  ${e.url}\n      ${e.bodyPreview}`)
                .join("\n")}
            </pre>
          </div>
        )}

        <div style={S.actions}>
          <button
            style={S.primary}
            onClick={() => {
              navigator.clipboard?.writeText(report);
            }}
          >
            Copy báo cáo lỗi
          </button>
          <button style={S.ghost} onClick={() => window.location.reload()}>
            Tải lại trang
          </button>
        </div>
      </div>
    );
  }
}

export function withDebugBoundary<P extends object>(
  name: string,
  Wrapped: ComponentType<P>,
) {
  const Guarded = (props: P) => (
    <DebugBoundary name={name}>
      <Wrapped {...props} />
    </DebugBoundary>
  );
  Guarded.displayName = `withDebugBoundary(${name})`;
  return Guarded;
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: 24, font: "14px Inter,ui-sans-serif,system-ui,sans-serif", color: "#1f2937" },
  title: { margin: "0 0 4px", fontSize: 19, color: "#b91c1c" },
  sub: { margin: "0 0 16px", color: "#6b7280", fontSize: 13 },
  box: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 6 },
  pre: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, lineHeight: 1.5, fontFamily: "ui-monospace,Menlo,monospace", color: "#111827" },
  actions: { display: "flex", gap: 8 },
  primary: { background: "#2563eb", color: "#fff", border: 0, borderRadius: 8, padding: "9px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" },
  ghost: { background: "#fff", color: "#4b5563", border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer" },
};
