import LoopVideo from "./loop-video"
import { formatVND } from "./format"

/**
 * Story landing for one ICEgel product, driven by product.metadata.icegel_landing (JSON) so copy
 * and media can change without a deploy. Flow: who it's for → the problem → how it solves it →
 * proof points (USP) → in daily life → vs alternatives → how to use → quality → cautions.
 * Copy must stay inside the announced intended use (see GHI_CHU / hồ sơ công bố).
 */
export type Media = { video?: string; poster?: string; image?: string; alt: string }
export type LandingData = {
  hero: { kicker: string; headline: string; sub: string; chips: string[]; media: Media }
  forWho?: { title: string; items: { icon: string; title: string; text: string }[] }
  problem?: { title: string; text?: string; bullets: string[]; media?: Media }
  solution?: { title: string; text: string; media?: Media }
  usps?: { title: string; items: { big: string; label: string; text: string }[]; footnote?: string }
  moments?: { title: string; items: { media: Media; caption: string }[] }
  compare?: { title: string; columns: string[]; rows: [string, ...string[]][] }
  steps?: { title: string; items: { image: string; title: string; text: string }[]; tip?: string }
  quality?: { title: string; image?: string; points: string[] }
  cautions?: { title: string; items: string[] }
  faq?: [string, string][]
}

export function parseLanding(raw: unknown): LandingData | null {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw
    return value && typeof value === "object" && (value as any).hero ? (value as LandingData) : null
  } catch {
    return null
  }
}

function MediaBox({ media, eager, className = "" }: { media: Media; eager?: boolean; className?: string }) {
  const cls = `w-full h-full object-cover ${className}`
  return media.video
    ? <LoopVideo src={media.video} poster={media.poster} alt={media.alt} eager={eager} className={cls} />
    : <img src={media.image || media.poster} alt={media.alt} loading={eager ? "eager" : "lazy"} className={cls} />
}

function SectionTitle({ kicker, children }: { kicker?: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      {kicker && <p className="text-[11px] font-black tracking-widest uppercase text-sky-600">{kicker}</p>}
      <h2 className="text-[22px] sm:text-2xl font-black text-gray-900 leading-tight">{children}</h2>
    </div>
  )
}

export function LandingHero({ data, price, pack }: { data: LandingData; price: number; pack: string }) {
  const { hero } = data
  return (
    <section className="relative -mx-4 sm:mx-0 sm:rounded-3xl overflow-hidden bg-sky-950 sm:grid sm:grid-cols-2">
      {/* Clip stays unobstructed on top; copy sits below it (beside it on wide screens) */}
      <div className="aspect-square sm:aspect-auto relative">
        <MediaBox media={hero.media} eager />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-sky-950 to-transparent sm:hidden" />
      </div>
      <div className="relative">
        <div className="px-4 pb-5 pt-1 sm:p-8 text-white">
          <p className="text-[12px] font-black tracking-widest uppercase text-sky-200">{hero.kicker}</p>
          <h1 className="mt-1 text-[26px] sm:text-4xl font-black leading-[1.15]">{hero.headline}</h1>
          <p className="mt-2 text-[15px] text-sky-50/90 max-w-xl">{hero.sub}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {hero.chips.map((chip) => (
              <span key={chip} className="text-[12px] font-bold px-2.5 py-1 rounded-full bg-white/15 border border-white/25 backdrop-blur">{chip}</span>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <a href="#mua-kem" className="px-5 py-3 rounded-xl bg-orange-500 font-black text-[15px] shadow-lg active:scale-[0.98]">Chọn số hộp</a>
            <p className="leading-tight">
              <span className="block text-xl font-black">{formatVND(price)}</span>
              <span className="block text-[12px] text-sky-100">{pack}</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export function LandingBody({ data }: { data: LandingData }) {
  const { forWho, problem, solution, usps, moments, compare, steps, quality } = data
  return (
    <>
      {forWho && (
        <section className="mt-8">
          <SectionTitle kicker="Dành cho ai">{forWho.title}</SectionTitle>
          <ul className="grid grid-cols-2 gap-2.5">
            {forWho.items.map((item) => (
              <li key={item.title} className="rounded-2xl bg-white border border-gray-100 p-3">
                <p className="text-2xl" aria-hidden="true">{item.icon}</p>
                <p className="mt-1 font-black text-[14px] text-gray-900 leading-snug">{item.title}</p>
                <p className="mt-0.5 text-[13px] text-gray-600 leading-snug">{item.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {problem && (
        <section className="mt-8 rounded-3xl bg-white border border-gray-100 overflow-hidden sm:grid sm:grid-cols-2">
          {problem.media && <div className="aspect-[4/3] sm:aspect-auto bg-gray-100"><MediaBox media={problem.media} /></div>}
          <div className="p-4 sm:p-6">
            <SectionTitle kicker="Vấn đề">{problem.title}</SectionTitle>
            {problem.text && <p className="text-[15px] text-gray-700 leading-relaxed">{problem.text}</p>}
            <ul className="mt-3 space-y-2">
              {problem.bullets.map((bullet) => (
                <li key={bullet} className="flex gap-2 text-[14px] text-gray-800 leading-snug">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-red-50 text-red-500 text-[12px] font-black flex items-center justify-center flex-shrink-0" aria-hidden="true">✕</span>
                  {bullet}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {solution && (
        <section className="mt-8 rounded-3xl bg-gradient-to-br from-sky-600 to-cyan-500 text-white overflow-hidden sm:grid sm:grid-cols-2">
          <div className="p-4 sm:p-6 order-2 sm:order-1">
            <p className="text-[11px] font-black tracking-widest uppercase text-sky-100">Giải pháp</p>
            <h2 className="text-[22px] sm:text-2xl font-black leading-tight">{solution.title}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-white/95">{solution.text}</p>
          </div>
          {solution.media && <div className="aspect-[4/3] sm:aspect-auto order-1 sm:order-2"><MediaBox media={solution.media} /></div>}
        </section>
      )}

      {usps && (
        <section className="mt-8">
          <SectionTitle kicker="Điểm khác biệt">{usps.title}</SectionTitle>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {usps.items.map((item) => (
              <li key={item.label} className="rounded-2xl bg-white border border-sky-100 p-3">
                <p className="text-[26px] font-black text-sky-700 leading-none">{item.big}</p>
                <p className="mt-1 text-[13px] font-black text-gray-900 leading-snug">{item.label}</p>
                <p className="mt-0.5 text-[12px] text-gray-600 leading-snug">{item.text}</p>
              </li>
            ))}
          </ul>
          {usps.footnote && <p className="mt-2 text-[11px] text-gray-500">{usps.footnote}</p>}
        </section>
      )}

      {moments && (
        <section className="mt-8">
          <SectionTitle kicker="Trong một ngày của bạn">{moments.title}</SectionTitle>
          <div className="flex gap-2.5 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-4 px-4">
            {moments.items.map((item) => (
              <figure key={item.caption} className="snap-start flex-shrink-0 w-[68%] sm:w-[32%]">
                <div className="aspect-[4/5] rounded-2xl overflow-hidden bg-gray-100"><MediaBox media={item.media} /></div>
                <figcaption className="mt-1.5 text-[13px] font-bold text-gray-800">{item.caption}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {compare && (
        <section className="mt-8">
          <SectionTitle kicker="So sánh">{compare.title}</SectionTitle>
          <div className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left p-2.5 font-bold text-gray-500 w-[40%]"><span className="sr-only">Tiêu chí</span></th>
                  {compare.columns.map((column, index) => (
                    <th key={column} className={`p-2.5 font-black text-center ${index === 0 ? "text-sky-700 bg-sky-50" : "text-gray-600"}`}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compare.rows.map(([label, ...cells]) => (
                  <tr key={label} className="border-t border-gray-100">
                    <th scope="row" className="text-left p-2.5 font-semibold text-gray-800 leading-snug">{label}</th>
                    {cells.map((cell, index) => (
                      <td key={index} className={`p-2.5 text-center font-black ${index === 0 ? "bg-sky-50 text-sky-700" : cell === "✓" ? "text-gray-700" : "text-gray-300"}`}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {steps && (
        <section className="mt-8">
          <SectionTitle kicker="Cách dùng">{steps.title}</SectionTitle>
          <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {steps.items.map((step, index) => (
              <li key={step.title} className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
                <div className="aspect-square bg-gray-100 relative">
                  <img src={step.image} alt={step.title} loading="lazy" className="w-full h-full object-cover" />
                  <span className="absolute top-2 left-2 w-7 h-7 rounded-full bg-sky-700 text-white font-black text-[14px] flex items-center justify-center">{index + 1}</span>
                </div>
                <div className="p-2.5">
                  <p className="font-black text-[13px] text-gray-900 leading-snug">{step.title}</p>
                  <p className="mt-0.5 text-[12px] text-gray-600 leading-snug">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
          {steps.tip && <p className="mt-2.5 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-[13px] text-amber-900">💡 {steps.tip}</p>}
        </section>
      )}

      {quality && (
        <section className="mt-8 rounded-3xl bg-white border border-gray-100 p-4 flex gap-4 items-center">
          {quality.image && <img src={quality.image} alt="Chứng nhận ISO 13485 của nhà máy Biours" loading="lazy" className="w-24 sm:w-32 rounded-lg border border-gray-100 flex-shrink-0" />}
          <div>
            <h2 className="text-lg font-black text-gray-900 leading-snug">{quality.title}</h2>
            <ul className="mt-1.5 space-y-1">
              {quality.points.map((point) => (
                <li key={point} className="text-[13px] text-gray-700 leading-snug flex gap-1.5"><span className="text-sky-600 font-black" aria-hidden="true">✓</span>{point}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  )
}

export function LandingCautions({ data }: { data: LandingData }) {
  if (!data.cautions) return null
  return (
    <section className="mt-6 rounded-2xl bg-amber-50 border border-amber-100 p-4">
      <h2 className="font-black text-[15px] text-amber-900">{data.cautions.title}</h2>
      <ul className="mt-2 space-y-1 list-disc pl-5 text-[13px] text-amber-900/90 leading-snug">
        {data.cautions.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  )
}
