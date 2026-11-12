import { useEffect, type ReactNode } from "react";

/** Sets the tab title while the page is mounted, as the site pages do. */
export function useDocTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · AstroPlanner`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

interface Props {
  title: string;
  lede: ReactNode;
  image: { src: string; width: number; height: number; caption: string };
  children: ReactNode;
}

/** The sign-in pages: the form on the left, one of the developer's own pictures on the right; stacked on phones. */
export function AuthSplit({ title, lede, image, children }: Props) {
  return (
    <div className="auth-split">
      <div className="auth-col">
        <div className="auth-inner">
          <h1 className="landing-h1 auth-h1">{title}</h1>
          <p className="landing-lede auth-lede">{lede}</p>
          {children}
        </div>
      </div>
      <figure className="auth-photo">
        {/* The caption names the picture; the image itself adds nothing a screen reader needs. */}
        <img src={image.src} width={image.width} height={image.height} alt="" decoding="async" />
        <figcaption>{image.caption}</figcaption>
      </figure>
    </div>
  );
}
