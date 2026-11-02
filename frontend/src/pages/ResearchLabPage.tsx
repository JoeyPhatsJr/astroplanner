import { ExternalLink } from "lucide-react";

const LINKS = [
  { href: "https://vsx.aavso.org/vsx/", title: "AAVSO VSX", body: "The Variable Star Index: identities, types, periods and references for known variable stars." },
  { href: "https://aavso.org/search-and-download-data/", title: "AAVSO data search", body: "Historical observations and light curves, under AAVSO’s data-use guidelines." },
  { href: "https://aavso.org/stellar-photometry/", title: "AAVSO photometry guidance", body: "How to measure brightness carefully: comparison stars, calibration, uncertainty." },
  { href: "https://docs.astropy.org/projects/photutils/en/latest/user_guide/aperture.html", title: "photutils aperture photometry", body: "The Python library AstroPlanner plans to use for measurements in Phase 4." },
];

// Mirrors ROADMAP.md. Direction only: detailed requirements are set when each phase begins.
const ROADMAP = [
  { phase: "Phase 3", title: "Variable Hunter", body: "A small, reviewed list of variable stars with VSX identifiers, coordinates and references, real visibility windows for your location, and historical light curves where AAVSO terms allow." },
  { phase: "Phase 3", title: "AstroMissions", body: "Attach a science mission to a planned session. Prediction windows (e.g. eclipse times) appear only after ephemerides are validated." },
  { phase: "Phase 4", title: "FITS import and differential photometry", body: "Measure the target against comparison and check stars with uncertainties, saturation checks and quality flags, producing your own light curves." },
];

export function ResearchLabPage() {
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6">
      <div>
        <p className="badge border-gold/40 text-gold">Preview: Variable Hunter arrives in Phase 3</p>
        <h1 className="mt-3 font-serif text-3xl tracking-tight md:text-[2.4rem]">Research Lab</h1>
        <p className="mt-2 max-w-prose leading-relaxed text-ink-2">
          The Research Lab will help you go from pretty pictures to careful brightness measurements of variable stars. Nothing here is interactive yet: there are no missions,
          light curves or measurements until they can be backed by real data.
        </p>
      </div>

      <section className="panel p-5 md:p-6" aria-labelledby="rl-what">
        <h2 id="rl-what" className="font-serif text-xl">
          What variable-star work involves
        </h2>
        <div className="mt-3 grid gap-5 text-sm leading-relaxed text-ink-2 md:grid-cols-2">
          <p>
            Variable stars change in brightness: eclipsing binaries dim when one star passes in front of the other, pulsating stars swell and shrink. Amateur observations,
            collected over decades by groups like the AAVSO, are used in real research.
          </p>
          <p>
            <span className="text-ink">Differential photometry</span> compares the target with nearby comparison stars in the same image, so changes in sky and
            transparency largely cancel out. It needs unsaturated stars, calibration frames, and an honest uncertainty for every point.
          </p>
          <p>
            <span className="text-ink">Seestar S30 caveats:</span> the IMX662 is a colour (Bayer) sensor without standard photometric filters, and stacked JPEGs are
            processed images. Measurements will need raw FITS, careful channel choice and clear labelling as instrumental, not standardised, magnitudes.
          </p>
          <p>
            AstroPlanner will never label an automated result as “scientifically validated” or a discovery. Contributions to AAVSO follow their own submission and review
            process.
          </p>
        </div>
      </section>

      <section aria-labelledby="rl-roadmap">
        <h2 id="rl-roadmap" className="font-serif text-xl">
          Roadmap
        </h2>
        <ol className="mt-3 flex flex-col gap-2">
          {ROADMAP.map((r) => (
            <li key={r.title} className="panel flex flex-col gap-1 p-4 sm:flex-row sm:gap-5">
              <span className="w-24 shrink-0 text-sm font-semibold text-gold">{r.phase}</span>
              <span>
                <span className="font-medium text-ink">{r.title}</span>
                <span className="mt-0.5 block text-sm text-ink-2">{r.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="rl-links">
        <h2 id="rl-links" className="font-serif text-xl">
          Authoritative resources
        </h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noreferrer" className="panel flex h-full flex-col gap-1 p-4 hover:border-ice/40">
                <span className="inline-flex items-center gap-1.5 font-medium text-ice">
                  {l.title} <ExternalLink className="size-3.5" aria-hidden />
                </span>
                <span className="text-sm text-ink-2">{l.body}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
