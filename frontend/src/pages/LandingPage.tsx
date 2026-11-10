import { useCallback, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { CitySearch } from "../components/landing/CitySearch";
import { GALLERY, HERO_PHOTO, NAV_LINKS, type Sky } from "../components/landing/content";
import { StoryChapters } from "../components/landing/StoryChapters";
import { usePageSky } from "../components/landing/useChapterProgress";
import { Logo } from "../components/layout/Logo";

const delay = (ms: number) => ({ "--landing-delay": `${ms}ms` }) as CSSProperties;

/**
 * The homescreen at /: tells the story first (header, then the developer's own photo), then walks one
 * night through the app, then shows real results and hands off to Tonight. No live data is shown here.
 */
export function LandingPage() {
  const [sky, setSky] = useState<Sky>("civil");
  usePageSky(sky);
  const onSky = useCallback((s: Sky) => setSky(s), []);

  return (
    <div className="min-h-dvh overflow-x-clip text-ink">
      <a href="#landing-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 btn btn-primary">
        Skip to content
      </a>

      <header className="sticky top-0 z-20 bg-night/45 backdrop-blur-md">
        <nav aria-label="Site" className="flex items-center justify-between gap-4 px-4 py-4 sm:px-10">
          <Link to="/" aria-label="AstroPlanner home" className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[1.1rem] font-semibold tracking-tight">AstroPlanner</span>
          </Link>
          <ul className="m-0 hidden list-none gap-7 p-0 text-sm text-ink-2 md:flex">
            {NAV_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="hover:text-ink">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/tonight" className="btn landing-pill landing-cta-primary !py-2 text-[0.8125rem]">
            Open the app
          </Link>
        </nav>
      </header>

      <main id="landing-main">
        {/* 1 · Header first */}
        <section className="mx-auto max-w-[1160px] px-4 pt-14 text-center sm:px-10 sm:pt-28" aria-labelledby="landing-title">
          <p className="landing-eyebrow landing-rise">Astrophotography, made easy</p>
          <h1 id="landing-title" className="landing-h1 landing-rise mx-auto mt-4 mb-6 max-w-[24ch]" style={delay(80)}>
            <span>One night. One picture.</span> <span>Everything in between.</span>
          </h1>
          <p className="landing-lede landing-rise mx-auto mb-8 max-w-[44ch]" style={delay(160)}>
            From sunset to a finished image: what to point at, when to point it, and how to turn a thousand frames into
            something you’re proud of.
          </p>
          <div className="landing-rise flex flex-wrap justify-center gap-2.5" style={delay(240)}>
            <Link to="/tonight" className="btn landing-pill landing-cta-primary">
              See tonight’s sky
            </Link>
            <a href="#story" className="btn landing-pill">
              Follow one night ↓
            </a>
          </div>
        </section>

        {/* 2 · Then the picture */}
        <figure className="mx-auto mt-14 mb-0 max-w-[1320px] px-4 sm:mt-24 sm:px-8">
          <div className="landing-hero-photo">
            <img
              src={HERO_PHOTO.src1920}
              srcSet={`${HERO_PHOTO.src960} 960w, ${HERO_PHOTO.src1920} 1920w`}
              sizes="(max-width: 1320px) 100vw, 1320px"
              width={1920}
              height={1080}
              alt={HERO_PHOTO.alt}
              fetchPriority="high"
              decoding="async"
            />
          </div>
          <figcaption className="mt-3.5 px-1 text-[0.8125rem] text-muted">
            <span className="font-semibold text-ink-2">{HERO_PHOTO.name}</span> {HERO_PHOTO.detail}
          </figcaption>
        </figure>

        <div className="mx-auto max-w-[1160px] px-4 sm:px-10">
          {/* 3 · One night, scrolled */}
          <section aria-labelledby="story-title">
            <div id="story" className="scroll-mt-16 pt-32 pb-5 text-center sm:pt-36">
              <p className="landing-eyebrow">How a night goes</p>
              <h2 id="story-title" className="landing-h2 mx-auto mt-3 max-w-[20ch]">
                Here’s what happens between sunset and that picture.
              </h2>
            </div>
            <StoryChapters onSky={onSky} />
          </section>

          {/* 4 · Real results */}
          <section className="pt-28" aria-labelledby="gallery-title">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
              <div>
                <p className="landing-eyebrow">Real nights</p>
                <h2 id="gallery-title" className="landing-h2 mt-2.5">
                  What one night can look like.
                </h2>
              </div>
              <p className="landing-lede m-0 max-w-[40ch]">Every picture on this page is a real capture, not a stock photo.</p>
            </div>
            <ul className="m-0 grid list-none grid-cols-2 gap-3.5 p-0 lg:grid-cols-4">
              {GALLERY.map((p) => (
                <li key={p.src}>
                  <figure className="m-0">
                    <div className="landing-photo">
                      <img src={p.src} alt={p.alt} loading="lazy" decoding="async" style={{ objectPosition: p.focus }} />
                    </div>
                    <figcaption className="mt-2.5 text-sm font-semibold">
                      {p.name}
                      <span className="mt-0.5 block text-xs font-normal text-muted">{p.detail}</span>
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </section>

          {/* 5 · Hand off to Tonight */}
          <section className="pt-36 text-center" aria-labelledby="close-title">
            <h2 id="close-title" className="landing-h2 mb-6">
              Clear skies tonight?
            </h2>
            <CitySearch />
          </section>
        </div>
      </main>

      <footer className="mx-auto mt-28 max-w-[1160px] border-t border-line-soft px-4 pt-7 pb-16 text-xs leading-relaxed text-muted sm:px-10">
        <p>
          Photos are the developer’s own captures. App screens show a saved example night (Philadelphia, 2 Nov), not live
          data. Targets:{" "}
          <a className="underline decoration-line underline-offset-2 hover:text-ink" href="https://github.com/mattiaverga/OpenNGC" target="_blank" rel="noreferrer">
            OpenNGC
          </a>{" "}
          (CC BY-SA 4.0) · Weather:{" "}
          <a className="underline decoration-line underline-offset-2 hover:text-ink" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
            Open-Meteo
          </a>{" "}
          (CC BY 4.0, non-commercial) · Positions computed with Astropy.
        </p>
      </footer>
    </div>
  );
}
