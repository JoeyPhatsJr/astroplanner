import { Link } from "react-router-dom";
import { SitePageIntro } from "../../components/site/SitePageIntro";
import { CONTACT_URL } from "../../lib/contact";

export function TermsPage() {
  return (
    <div className="site-page">
      <SitePageIntro
        docTitle="Terms"
        eyebrow="Terms"
        title="Plain terms."
        lede="AstroPlanner is free, for personal use, and offered as it is."
        meta="Updated 28 Nov 2026"
      />
      <div className="site-doc">
        <p>
          These terms cover your use of AstroPlanner at astroplanner-lake.vercel.app, a free, non-commercial project run by one student
          developer. Using the site, or creating an account, means you accept them and the <Link to="/privacy">Privacy</Link> page.
        </p>
        <h2 className="site-h3">Free, and staying that way</h2>
        <p>
          The forecasts come from Open-Meteo’s free service, which is for non-commercial use, and several data sources allow personal or
          non-profit use only. So AstroPlanner has no ads, subscriptions or paid features, and can’t be sold or used commercially.
        </p>
        <h2 className="site-h3">Who can use it</h2>
        <p>
          You need to be 13 or older to create an account. One account is for one person; keep your password to yourself, since there is no
          email reset yet.
        </p>
        <h2 className="site-h3">Planning help, not a promise</h2>
        <p>
          Scores, windows and forecasts are estimates. Forecasts are weather models, not measurements; scores are rules of thumb. Skies
          change, forecasts are wrong, and your own site may differ. Check conditions yourself, especially before travelling to a dark site.
          You’re responsible for decisions you make with it, including travel and your safety at night.
        </p>
        <h2 className="site-h3">Your files are your own</h2>
        <p>
          You keep every right to your pictures and data. You let AstroPlanner store and process what you upload only to run the app for
          you, as described in Privacy. Only upload pictures and files you have the right to use.
        </p>
        <h2 className="site-h3">Fair use of a shared, free service</h2>
        <p>
          Don’t use AstroPlanner to break the law, upload anything illegal or harmful, try to get into other people’s accounts, probe or
          overload the service, or scrape it with automated bulk requests (they use up the free forecast allowance everyone shares).
          Accounts or content that break these terms may be removed.
        </p>
        <h2 className="site-h3">Availability</h2>
        <p>
          AstroPlanner runs on free hosting. It may be slow to wake up, change, be unavailable, or have features switched off (sky survey
          pictures are off on this site for now). There’s no promise of uptime or backups, so keep your own copies of anything important.
        </p>
        <h2 className="site-h3">As it is</h2>
        <p>
          AstroPlanner is provided as it is and as available, without warranties of any kind, including accuracy and fitness for a
          particular purpose. As far as the law allows, its developer isn’t liable for any loss or damage from using it or relying on it.
        </p>
        <h2 className="site-h3">Other services’ terms</h2>
        <p>
          Data from Open-Meteo, OpenNGC, the Digitized Sky Survey and AAVSO VSX is used under their own terms, listed on{" "}
          <Link to="/credits">Credits &amp; data</Link>.
        </p>
        <h2 className="site-h3">Law, contact and changes</h2>
        <p>
          These terms are governed by the laws of Pennsylvania, USA. Questions:{" "}
          <a href={CONTACT_URL} target="_blank" rel="noreferrer">
            open an issue on GitHub
          </a>
          . If these terms change, the date at the top changes too, and using the site after that means you accept the new terms.
        </p>
      </div>
    </div>
  );
}
