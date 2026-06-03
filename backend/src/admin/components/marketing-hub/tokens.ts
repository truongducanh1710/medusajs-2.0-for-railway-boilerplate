// Design tokens dùng chung cho Marketing Hub (port từ .design_bundle).
// Inject 1 lần ở route cha qua <style>{MH_TOKENS_CSS}</style>, các section dùng class .mh-scope.
export const MH_TOKENS_CSS = `
.mh-scope {
  --bg:#F4F5F9; --bg-card:#FFFFFF; --bg-subtle:#F0F1F5; --bg-hover:rgba(0,0,0,0.035);
  --border:#E5E7EB; --border-strong:#D1D5DB;
  --text-1:#111827; --text-2:#4B5563; --text-3:#9CA3AF;
  --accent:#1877F2; --accent-hover:#1461D1; --accent-subtle:#EBF3FF; --accent-text:#1654B8;
  --shadow-sm:0 1px 3px rgba(0,0,0,0.07),0 1px 2px rgba(0,0,0,0.04);
  --shadow-md:0 4px 16px rgba(0,0,0,0.10),0 2px 4px rgba(0,0,0,0.05);
  --s-need:#6B7280; --s-need-bg:#F3F4F6; --s-doing:#2563EB; --s-doing-bg:#DBEAFE;
  --s-wait:#D97706; --s-wait-bg:#FEF3C7; --s-done:#16A34A; --s-done-bg:#DCFCE7;
  --s-post:#059669; --s-post-bg:#D1FAE5; --s-err:#DC2626; --s-err-bg:#FEE2E2;
  color:var(--text-1);
}
.mh-scope .line-clamp-1{overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;}
.mh-scope .line-clamp-2{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
.mh-scope .line-clamp-3{overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;}
.mh-scope .hover-bg:hover{background:var(--bg-hover) !important;}
.mh-scope .hover-lift:hover{transform:translateY(-2px);box-shadow:var(--shadow-md) !important;}
`

export type NavTo = (section: "fb-content", params: Record<string, string>) => void
