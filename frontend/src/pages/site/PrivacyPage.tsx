import { ArrowUpRight, Check, Circle, X } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { SitePageIntro } from "../../components/site/SitePageIntro";
import { CONTACT_URL } from "../../lib/contact";

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="site-card">
      <h2>
        <span className="site-card-icon" aria-hidden="true">
          {icon}
        </span>
        {title}
      </h2>
      <ul>{children}</ul>
    </section>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export function PrivacyPage() {
  return (
    <div className="site-page">
      <SitePageIntro
        docTitle="Privacy"
        eyebrow="Privacy"
        title="Your pictures stay yours."
        lede="What AstroPlanner reads, what it keeps, where it keeps it, and the few things it sends anywhere else."
        meta="Describes AstroPlanner as it runs at astroplanner-lake.vercel.app. Updated 28 Nov 2026."
      />

      <div className="site-cards">
        <Card icon={<Check size={16} />} title="Read in your browser, sent only in part">
          <li>
            Importing a night: your browser reads each Seestar FITS or Canon CR2 frame and sends only the start of the file, which holds
            its header, to the AstroPlanner server. The image data stays on your computer
          </li>
          <li>Siril’s working folders: only the small .seq and conversion text files are sent; their frame names and counts are kept</li>
          <li>
            Site coordinates in your files: sent to match one of your places, then dropped. They’re kept only if you choose to save them
            as a place
          </li>
        </Card>
        <Card icon={<Circle size={10} />} title="What it keeps">
          <li>Your account: your email and a password hash</li>
          <li>Your places and equipment, visible only to your account</li>
          <li>Session plans and nights</li>
          <li>Facts from file headers, and the file names: target, times, exposure, device</li>
          <li>Your custom target names</li>
          <li>Processing Coach progress: Siril’s frame counts and the frames you chose</li>
          <li>A small, metadata-free preview of each final picture</li>
          <li>Numbers measured from a stack, and a small preview</li>
        </Card>
        <Card icon={<ArrowUpRight size={16} />} title="Sent to other services">
          <li>
            <b>Open-Meteo</b>: the coordinates of the place you’re planning, for the forecast. Your browser asks directly, so Open-Meteo
            sees your IP address; if that fails, the AstroPlanner server asks instead. City names you search for are sent from the server.
            Open-Meteo says it keeps request logs, which may include coordinates, for up to 90 days
          </li>
          <li>
            <b>Vercel</b> (hosts this site and passes requests on), <b>Render</b> (runs the AstroPlanner server) and <b>Supabase</b>{" "}
            (stores the database and picture previews): each sees your IP address and the requests you make, including the coordinates
            being planned, and keeps its own logs
          </li>
        </Card>
        <Card icon={<X size={16} />} title="Not in AstroPlanner">
          <li>No ads, analytics or tracking scripts</li>
          <li>No fonts or scripts loaded from other sites</li>
          <li>No selling or sharing of your data, and no emails sent to you</li>
          <li>Your browser location only if you press “Use my current position” in Settings</li>
        </Card>
      </div>

      <div className="site-doc">
        <h2 className="landing-h2 site-h2">Where it’s kept</h2>
        <p>
          Your account and everything it owns are kept in a database and a private file store run by Supabase, in Oregon, USA. The
          AstroPlanner server runs on Render, also in the USA, and the site is served by Vercel. Only the server can read the database and
          the file store; your browser never talks to them directly.
        </p>
        <h2 className="landing-h2 site-h2">Pictures and stacks</h2>
        <p>
          When you add a final picture or a Siril stack, the whole file is uploaded to the AstroPlanner server, up to the size limit shown
          when you choose it. For a picture, the server makes a preview at most 1,600 pixels on its longest side and a 400 pixel thumbnail,
          removes the picture’s metadata, stores those two and discards the original. A stack is measured in memory (star size, noise,
          background, colour) and only the numbers and a small preview are kept.
        </p>
        <h2 className="landing-h2 site-h2">Your account</h2>
        <p>
          An account stores your email, a password hash (never the password itself) and your sign-in sessions, in AstroPlanner’s database.
          Deleting your account on the <Link to="/account">Account page</Link> removes it, its sign-in sessions, your places and equipment,
          your session plans and nights, your AstroLog library, your processing notes and their previews. Your original files are never
          touched.
        </p>
        <h2 className="landing-h2 site-h2">Without an account</h2>
        <p>
          You can plan a night without signing in. The place you pick is kept only in your browser, and planning sends its coordinates with
          each request so the server can work out the sky. Nothing is saved on the server for you.
        </p>
        <h2 className="landing-h2 site-h2">Cookies and browser storage</h2>
        <p>
          Signing in sets one cookie, astroplanner_session: it holds a random token (the server keeps only a hash of it), can’t be read by
          scripts on the page, is sent only over HTTPS, lasts 30 days and renews while you use the site. Your browser also keeps a few
          preferences in this site’s storage (your chosen place, equipment, night, minimum altitude, darkness, plan, night vision and
          sidebar), and a random id for this tab that lets the server hold the forecast your browser fetched for 30 minutes. There are no
          tracking or advertising cookies. The <Link to="/cookies">Cookies</Link> page lists each item and how long it lasts.
        </p>
        <h2 className="landing-h2 site-h2">How long it’s kept</h2>
        <p>
          Account data is kept until you delete it. Sign-in sessions end after 30 days without use. A forecast your browser sends is held in
          memory for 30 minutes. After too many wrong sign-in tries, the email or address involved is held in memory for about 15 minutes.
          Vercel, Render, Supabase and Open-Meteo keep their own logs and backups for limited periods under their own terms.
        </p>
        <h2 className="landing-h2 site-h2">Security</h2>
        <p>
          Passwords are hashed with Argon2id, only a hash of each sign-in token is stored, every connection uses HTTPS, the file store is
          private and its key stays on the server. No system is perfectly secure, so don’t reuse a password you use elsewhere.
        </p>
        <h2 className="landing-h2 site-h2">Children</h2>
        <p>
          AstroPlanner isn’t meant for children under 13, and accounts are for people 13 or older. If you think a child under 13 has made an
          account, get in touch and it will be deleted.
        </p>
        <h2 className="landing-h2 site-h2">Deleting</h2>
        <p>
          Delete your account on the Account page and everything above that belongs to it is removed right away; copies may stay in the
          hosting services’ logs and backups for a limited time. Clearing this site’s data in your browser removes the saved preferences in
          your browser.
        </p>
        <h2 className="landing-h2 site-h2">Questions and changes</h2>
        <p>
          AstroPlanner is a free project run by one student developer. For questions, or if you can’t sign in to delete your account,{" "}
          <Ext href={CONTACT_URL}>open an issue on GitHub</Ext>. Issues are public, so don’t include your password or anything private;
          say you need a private reply. If this page changes, the date at the top changes too.
        </p>
      </div>
    </div>
  );
}
