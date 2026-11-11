/** Left-aligned heading block shared by the public site pages. */
export function SitePageIntro({ eyebrow, title, lede, meta }: { eyebrow: string; title: string; lede: string; meta?: string }) {
  return (
    <div className="site-doc">
      <p className="landing-eyebrow site-eyebrow">{eyebrow}</p>
      <h1 className="landing-h1 site-h1">{title}</h1>
      <p className="landing-lede">{lede}</p>
      {meta && <p className="site-meta">{meta}</p>}
    </div>
  );
}
