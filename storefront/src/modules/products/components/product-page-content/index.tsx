import Script from "next/script"
import { parseGrapesContent } from "@lib/grapes"

/**
 * Mobile-first overrides for GrapesJS page builder blocks.
 * These rules run AFTER the saved HTML+CSS, so they fix stale layouts
 * from blocks that were saved before responsive CSS was added.
 * All rules use !important to beat inline/saved styles.
 *
 * Class map (pvb-* = page-builder scoped):
 *   .pvb-how   = how-to-use steps
 *   .pvb-ps    = pain/solution
 *   .pvb-ben   = benefits grid
 *   .pvb-gal   = image gallery
 *   .pvb-itl   = image-text-left
 *   .pvb-itr   = image-text-right (text left, image right)
 *   .pvb-hero  = hero banner
 *   .pvb-cmp   = comparison table
 *   .pvb-rev   = reviews cards
 *   .pvb-trust = trust badges
 *   .pvb-cd    = countdown
 *   .pvb-promo = promo banner
 *   .pvb-spec  = specs table
 */
const MOBILE_OVERRIDE_CSS = `

/* TikTok Gallery — ẩn admin panel trên storefront */
.pvb-tkg .admin-panel { display: none !important; }

/* Card entrance transition */
.pvb-tkg .card { transition: opacity .4s ease, transform .4s ease, box-shadow .2s ease; }
.pvb-tkg .card:active { transform: scale(0.96) !important; }

/* Popup slide-up */
.pvb-tkg-pop .pop-inner { transition: transform .3s cubic-bezier(.32,1,.45,1); }

/* Play hint fade */
.pvb-tkg .play-hint {
  position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  background: rgba(0,0,0,0.55); color: #fff; font-size: 11px; font-weight: 700;
  padding: 4px 10px; border-radius: 20px; white-space: nowrap;
  opacity: 1; transition: opacity 1s; pointer-events: none; z-index: 2;
}
.pvb-tkg .card.hint-gone .play-hint { opacity: 0; }
.pvb-tkg .card.has-video .overlay { display: none !important; }

/* Popup full redesign */
.pvb-tkg-pop {
  align-items: flex-end !important;
  background: rgba(0,0,0,0) !important;
  transition: background .25s !important;
}
.pvb-tkg-pop.open { background: rgba(0,0,0,0.88) !important; }
.pvb-tkg-pop .pop-inner {
  border-radius: 20px 20px 0 0 !important;
  overflow: hidden !important;
  max-width: 420px !important;
  height: 85vh !important;
  background: #000 !important;
}
.pvb-tkg-pop .tkg-close {
  position: absolute; top: 12px; right: 12px;
  width: 36px; height: 36px;
  background: rgba(0,0,0,0.6) !important;
  border-radius: 50% !important;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px !important; z-index: 10;
}
.pvb-tkg-pop .tkg-handle {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
  width: 40px; height: 4px; background: rgba(255,255,255,0.35);
  border-radius: 2px; z-index: 10;
}
@media (min-width: 768px) {
  .pvb-tkg-pop { align-items: center !important; }
  .pvb-tkg-pop .pop-inner { border-radius: 16px !important; height: 80vh !important; }
}



/* ────────────────────────────────────────────
   MOBILE  ≤ 639px  (phones — 320px to 639px)
   ──────────────────────────────────────────── */
@media(max-width:639px){

  /* Global: all pvb sections get breathing room */
  [class^="pvb-"],[class*=" pvb-"]{
    padding-left:16px!important;
    padding-right:16px!important;
  }

  /* ── How-to-use ── */
  /* Old saved CSS: grid 4-col. Force flex column. */
  .pvb-how .steps{
    display:flex!important;
    flex-direction:column!important;
    grid-template-columns:unset!important;
    gap:10px!important;
  }
  .pvb-how .step{
    display:flex!important;
    flex-direction:row!important;
    align-items:center!important;
    gap:14px!important;
    text-align:left!important;
    padding:14px 16px!important;
    width:100%!important;
  }
  .pvb-how .num{
    min-width:40px!important;
    width:40px!important;
    height:40px!important;
    font-size:16px!important;
    flex-shrink:0!important;
    margin:0!important;
  }
  .pvb-how h3{font-size:14px!important;margin-bottom:2px!important}
  .pvb-how p{font-size:12px!important;margin:0!important}

  /* ── Pain / Solution ── */
  /* Old saved: grid 2-col. Force 1-col. */
  .pvb-ps .inner{
    display:flex!important;
    flex-direction:column!important;
    grid-template-columns:unset!important;
    gap:14px!important;
  }
  .pvb-ps .box{width:100%!important;padding:18px 16px!important}
  .pvb-ps h3{font-size:18px!important}
  .pvb-ps ul{font-size:14px!important}

  /* ── Benefits grid ── */
  /* Default 2-col is fine. Old saved: 4-col. Force 2-col. */
  .pvb-ben .grid{
    grid-template-columns:1fr 1fr!important;
    gap:10px!important;
  }
  .pvb-ben .card{padding:14px 10px!important}
  .pvb-ben .icon{font-size:24px!important}
  .pvb-ben h4{font-size:13px!important}
  .pvb-ben p{font-size:12px!important}

  /* ── Gallery ── */
  /* Old saved: 3-col. Keep 2-col. */
  .pvb-gal .grid{
    grid-template-columns:1fr 1fr!important;
    gap:8px!important;
  }

  /* ── Image-text left / right ── */
  /* On mobile: image stacks above text, full width. */
  .pvb-itl .inner,.pvb-itr .inner{
    display:flex!important;
    flex-direction:column!important;
    grid-template-columns:unset!important;
    gap:0!important;
  }
  .pvb-itl img.img{
    width:100%!important;
    margin-bottom:20px!important;
    margin-top:0!important;
    min-height:220px!important;
    border-radius:14px!important;
  }
  .pvb-itr img.img{
    width:100%!important;
    margin-top:20px!important;
    margin-bottom:0!important;
    min-height:220px!important;
    border-radius:14px!important;
    order:2!important;
  }
  .pvb-itr .inner > div:first-child{order:1!important}
  .pvb-itl .btn,.pvb-itr .btn{
    display:block!important;
    width:100%!important;
    text-align:center!important;
    box-sizing:border-box!important;
  }

  /* ── Hero banner ── */
  /* Image goes below text on mobile. */
  .pvb-hero .inner{
    display:flex!important;
    flex-direction:column!important;
    grid-template-columns:unset!important;
    gap:20px!important;
  }
  .pvb-hero h2{font-size:clamp(22px,7vw,32px)!important}
  .pvb-hero p{font-size:14px!important}
  .pvb-hero .btns{flex-direction:column!important;gap:8px!important}
  .pvb-hero .btn-white,.pvb-hero .btn-outline{
    display:block!important;
    width:100%!important;
    text-align:center!important;
    box-sizing:border-box!important;
  }
  .pvb-hero img.img{
    width:100%!important;
    min-height:200px!important;
    border-radius:14px!important;
  }

  /* ── Comparison table ── */
  /* Keep horizontal scroll — already has .wrap{overflow-x:auto} but ensure. */
  .pvb-cmp .wrap{
    overflow-x:auto!important;
    -webkit-overflow-scrolling:touch!important;
    border-radius:12px!important;
  }
  .pvb-cmp table{
    min-width:340px!important;
    font-size:12px!important;
  }
  .pvb-cmp th,.pvb-cmp td{
    padding:10px 10px!important;
    font-size:12px!important;
  }

  /* ── Reviews cards ── */
  /* Old saved: 3-col grid. Force 1-col. */
  .pvb-rev .grid{
    display:flex!important;
    flex-direction:column!important;
    grid-template-columns:unset!important;
    gap:12px!important;
  }
  .pvb-rev .card{padding:16px!important}

  /* ── Specs table ── */
  .pvb-spec table{font-size:13px!important}
  .pvb-spec td{padding:11px 12px!important}
  .pvb-spec td:first-child{width:40%!important;font-size:12px!important}

  /* ── Trust badges ── */
  /* Old saved: 5-col. Keep 3-col on mobile, 5-col ≥480px (block already has that). */
  .pvb-trust .grid{
    grid-template-columns:repeat(3,1fr)!important;
    gap:8px!important;
  }
  .pvb-trust .badge{padding:12px 6px!important}
  .pvb-trust .icon{font-size:20px!important;margin-bottom:4px!important}
  .pvb-trust span{font-size:11px!important}

  /* ── Countdown ── */
  .pvb-cd .unit{min-width:52px!important;padding:10px 10px!important}
  .pvb-cd .num{font-size:clamp(24px,8vw,36px)!important}
  .pvb-cd .sep{font-size:20px!important}

  /* ── Promo banner ── */
  .pvb-promo .box{
    display:flex!important;
    flex-direction:column!important;
    padding:20px 16px!important;
    gap:12px!important;
  }
  .pvb-promo h2{font-size:clamp(18px,5vw,24px)!important}
  .pvb-promo .btn{
    display:block!important;
    width:100%!important;
    text-align:center!important;
    box-sizing:border-box!important;
  }
  .pvb-promo .code{font-size:18px!important}

  /* ── CTA button ── */
  .pvb-cta a{
    display:block!important;
    width:100%!important;
    max-width:100%!important;
    box-sizing:border-box!important;
    text-align:center!important;
    min-height:52px!important;
    font-size:16px!important;
  }
}

/* ────────────────────────────────────────────
   SMALL TABLET  480–639px
   ──────────────────────────────────────────── */
@media(min-width:480px) and (max-width:639px){
  /* Trust badges → 5-col possible if viewport wide enough */
  .pvb-trust .grid{grid-template-columns:repeat(5,1fr)!important}
  /* How-to-use → 2-col grid on wider phones */
  .pvb-how .steps{display:grid!important;grid-template-columns:1fr 1fr!important;flex-direction:unset!important}
  .pvb-how .step{flex-direction:column!important;text-align:center!important;align-items:center!important}
  .pvb-how .num{margin-bottom:8px!important}
}

/* ────────────────────────────────────────────
   TABLET  640–1023px
   ──────────────────────────────────────────── */
@media(min-width:640px) and (max-width:1023px){
  /* Benefits: 4-col is too wide on 768px tablet. Keep 2-col. */
  .pvb-ben .grid{grid-template-columns:1fr 1fr!important;gap:14px!important}
  /* Reviews: 3-col too tight on tablet. 2-col. */
  .pvb-rev .grid{grid-template-columns:1fr 1fr!important}
  /* How-to-use: 2×2 grid on tablet */
  .pvb-how .steps{
    display:grid!important;
    grid-template-columns:1fr 1fr!important;
    flex-direction:unset!important;
    gap:12px!important;
  }
  .pvb-how .step{
    flex-direction:column!important;
    align-items:center!important;
    text-align:center!important;
  }
  .pvb-how .num{margin-bottom:8px!important;margin-right:0!important}
}
`

type Props = {
  content: string
}

const TIKTOK_GALLERY_JS = `
(function(){
  /* ── CLOSE popup ── */
  function pvbClose(){
    var pop=document.getElementById('pvb-tkg-pop');
    var v=document.getElementById('pvb-tkg-video');
    if(!pop)return;
    var inner=pop.querySelector('.pop-inner');
    // Slide-down trước rồi mới ẩn
    if(inner)inner.style.transform='translateY(100%)';
    pop.style.background='rgba(0,0,0,0)';
    setTimeout(function(){
      pop.classList.remove('open');
      pop.style.display='none';
      if(v){v.pause();v.removeAttribute('src');v.load();}
      if(inner)inner.style.transform='';
      pop.style.background='';
      // Resume card previews
      document.querySelectorAll('.pvb-tkg .card video').forEach(function(cv){
        cv.play().catch(function(){});
      });
    },280);
  }

  /* ── OPEN popup ── */
  function pvbOpen(src){
    var pop=document.getElementById('pvb-tkg-pop');
    var v=document.getElementById('pvb-tkg-video');
    if(!pop||!v)return;
    // Pause card previews để giảm tải
    document.querySelectorAll('.pvb-tkg .card video').forEach(function(cv){cv.pause();});
    v.src=src;
    pop.style.display='flex';
    // Force reflow rồi add class để trigger CSS transition
    pop.getBoundingClientRect();
    pop.classList.add('open');
    v.play().catch(function(){});
  }

  /* ── INIT card previews ── */
  function initCardPreviews(){
    var cards=document.querySelectorAll('.pvb-tkg .card');
    if(!cards.length)return;

    cards.forEach(function(card,i){
      var src=card.getAttribute('data-src');

      // Entrance animation — stagger theo index
      setTimeout(function(){
        card.classList.add('tkg-visible');
      }, i * 120);

      if(!src)return;

      // Mark card có video
      card.classList.add('has-video');

      // Ẩn play-hint sau 2s
      setTimeout(function(){card.classList.add('hint-gone');}, 2000 + i*200);

      // Tạo video preview
      var vid=card.querySelector('video');
      if(!vid){
        vid=document.createElement('video');
        vid.muted=true;
        vid.loop=true;
        vid.setAttribute('playsinline','');
        vid.setAttribute('preload','metadata');
        vid.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block';
        card.insertBefore(vid,card.firstChild);
      }
      if(vid.getAttribute('data-loaded')!==src){
        vid.src=src;
        vid.load();
        vid.setAttribute('data-loaded',src);
      }

      // Play/pause theo viewport
      if('IntersectionObserver' in window){
        new IntersectionObserver(function(entries){
          entries.forEach(function(en){
            if(en.isIntersecting){vid.play().catch(function(){});}
            else{vid.pause();}
          });
        },{threshold:0.25}).observe(card);
      } else {
        vid.play().catch(function(){});
      }
    });
  }

  /* ── SWIPE to close (mobile) ── */
  function initSwipeClose(){
    var pop=document.getElementById('pvb-tkg-pop');
    if(!pop)return;
    var inner=pop.querySelector('.pop-inner');
    if(!inner)return;
    var startY=0,dragging=false;
    inner.addEventListener('touchstart',function(e){startY=e.touches[0].clientY;dragging=true;},{passive:true});
    inner.addEventListener('touchmove',function(e){
      if(!dragging)return;
      var dy=e.touches[0].clientY-startY;
      if(dy>0)inner.style.transform='translateY('+dy+'px)';
    },{passive:true});
    inner.addEventListener('touchend',function(e){
      dragging=false;
      var dy=e.changedTouches[0].clientY-startY;
      if(dy>80){pvbClose();}
      else{inner.style.transform='';}
    });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){initCardPreviews();initSwipeClose();});
  } else {
    setTimeout(function(){initCardPreviews();initSwipeClose();},100);
  }

  /* ── Click delegation ── */
  document.addEventListener('click',function(e){
    var t=e.target;
    while(t&&t!==document){
      if(t.classList&&t.classList.contains('card')&&t.closest&&t.closest('.pvb-tkg')){
        var src=t.getAttribute('data-src');
        if(src)pvbOpen(src);
        return;
      }
      if(t.id==='pvb-tkg-pop'||t.classList&&t.classList.contains('tkg-close')){pvbClose();return;}
      t=t.parentElement;
    }
  });

  window.pvbTkgClose=pvbClose;
})();
`

export default function ProductPageContent({ content }: Props) {
  const html = parseGrapesContent(content)

  if (!html) {
    return null
  }

  const hasTikTokGallery = html.includes('pvb-tkg')

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MOBILE_OVERRIDE_CSS }} />
      <div
        className="product-page-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {hasTikTokGallery && (
        <Script id="pvb-tkg-fns" strategy="afterInteractive">{TIKTOK_GALLERY_JS}</Script>
      )}
    </>
  )
}
