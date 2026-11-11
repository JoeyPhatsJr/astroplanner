import { Link } from "react-router-dom";
import { SitePageIntro } from "../../components/site/SitePageIntro";

export function TermsPage() {
  return (
    <div className="site-page">
      <SitePageIntro
        eyebrow="Terms"
        title="Plain terms."
        lede="AstroPlanner is free, for personal use, and offered as it is."
        meta="Updated 10 Nov 2026"
      />
      <div className="site-doc">
        <span className="site-draft">Draft: plain-language summary, not legal advice. Review before a public launch.</span>
        <h3 className="site-h3">Free, and staying that way</h3>
        <p>
          The forecasts come from Open-Meteo’s free service, which is for non-commercial use, and several data sources allow personal or
          non-profit use only. So AstroPlanner can’t be sold or used commercially.
        </p>
        <h3 className="site-h3">Planning help, not a promise</h3>
        <p>
          Scores, windows and forecasts are estimates. Skies change, forecasts are wrong, and your own site may differ. Check conditions
          yourself, especially before travelling to a dark site.
        </p>
        <h3 className="site-h3">Your files are your own</h3>
        <p>
          You keep every right to your pictures and data. AstroPlanner only stores the previews and facts described in Privacy, to show
          them back to you.
        </p>
        <h3 className="site-h3">Other services’ terms</h3>
        <p>
          Data from Open-Meteo, OpenNGC, the Digitized Sky Survey and AAVSO VSX is used under their own terms, listed on <Link to="/credits">Credits &amp; data</Link>.
        </p>
        <h3 className="site-h3">Changes</h3>
        <p>If these terms change, the date at the top changes too.</p>
      </div>
    </div>
  );
}
