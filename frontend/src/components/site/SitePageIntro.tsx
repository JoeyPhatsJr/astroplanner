import { useEffect } from "react";

/** Left-aligned heading block shared by the public site pages. Sets the tab title while mounted. */
export function SitePageIntro({ eyebrow, title, lede, meta, docTitle }: { eyebrow: string; title: string; lede: string; meta?: string; docTitle: string }) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${docTitle} · AstroPlanner`;
    return () => {
      document.title = previous;
    };
  }, [docTitle]);
  return (
    <div className="site-doc">
      <p className="landing-eyebrow site-eyebrow">{eyebrow}</p>
      <h1 className="landing-h1 site-h1">{title}</h1>
      <p className="landing-lede">{lede}</p>
      {meta && <p className="site-meta">{meta}</p>}
    </div>
  );
}
