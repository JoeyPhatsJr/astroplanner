import { ArrowUpRight, Check, Circle, X } from "lucide-react";
import type { ReactNode } from "react";
import { SitePageIntro } from "../../components/site/SitePageIntro";

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="site-card">
      <h3>
        <span className="site-card-icon" aria-hidden="true">
          {icon}
        </span>
        {title}
      </h3>
      <ul>{children}</ul>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <div className="site-page">
      <SitePageIntro
        eyebrow="Privacy"
        title="Your pictures stay yours."
        lede="What AstroPlanner reads, what it keeps, and the few things it sends anywhere else."
        meta="Describes the app as it runs today, on your own computer. Updated 10 Nov 2026."
      />

      <div className="site-cards">
        <Card icon={<Check size={16} />} title="Never leaves your computer">
          <li>The image data in your Seestar FITS and Canon CR2 files: only each file’s header is read, in your browser</li>
          <li>Siril’s working folders: only its small text files are read</li>
          <li>Location coordinates inside your files: used to match a saved place, never stored</li>
        </Card>
        <Card icon={<Circle size={10} />} title="What it keeps">
          <li>Saved places and equipment</li>
          <li>Session plans</li>
          <li>Facts from file headers: target, times, exposure, device</li>
          <li>A small, metadata-free preview of each final picture</li>
          <li>Numbers measured from a stack, and a small preview</li>
        </Card>
        <Card icon={<ArrowUpRight size={16} />} title="Sent to other services">
          <li>
            <b>Open-Meteo</b>: your saved place’s coordinates, for the forecast; a city name you search for
          </li>
          <li>
            <b>STScI Digitized Sky Survey</b>: a target’s position in the sky (not yours), once per target
          </li>
        </Card>
        <Card icon={<X size={16} />} title="Not in AstroPlanner">
          <li>No ads, analytics or tracking scripts</li>
          <li>No fonts or scripts loaded from other sites</li>
          <li>Your browser location only if you press “Use my location” in Settings</li>
        </Card>
      </div>

      <div className="site-doc">
        <h2 className="landing-h2 site-h2">Pictures and stacks</h2>
        <p>
          When you add a final picture, AstroPlanner makes a preview about 1,600 pixels wide and a thumbnail, removes the picture’s
          metadata, and keeps only those. When you add a Siril stack, it is measured in memory (star size, noise, background, colour) and
          only the numbers and a small preview are kept.
        </p>
        <h2 className="landing-h2 site-h2">Deleting</h2>
        <p>
          Everything AstroPlanner keeps about you sits in one database file and one preview folder on your computer, plus a few saved
          preferences in your browser. Deleting them, and clearing this site's data in your browser, removes it all. (If you point
          AstroPlanner at your own database with DATABASE_URL, it lives there instead.) A third folder caches the survey pictures of
          targets; nothing in it is yours.
        </p>
      </div>
    </div>
  );
}
