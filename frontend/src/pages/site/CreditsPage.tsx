import { SitePageIntro } from "../../components/site/SitePageIntro";

/** Must stay identical to DSS_ACKNOWLEDGMENT in backend/app/api.py (whitespace aside); backend/tests/test_site_copy.py checks it. */
const DSS_ACKNOWLEDGMENT = `Investigators using these scans are requested to include these acknowledgments in any publications as appropriate.
The Digitized Sky Surveys were produced at the Space Telescope Science Institute under U.S. Government grant NAG W-2166. The images of these surveys are based on photographic data obtained using the Oschin Schmidt Telescope on Palomar Mountain and the UK Schmidt Telescope. The plates were processed into the present compressed digital form with the permission of these institutions.
The National Geographic Society - Palomar Observatory Sky Atlas (POSS-I) was made by the California Institute of Technology with grants from the National Geographic Society.
The Second Palomar Observatory Sky Survey (POSS-II) was made by the California Institute of Technology with funds from the National Science Foundation, the National Geographic Society, the Sloan Foundation, the Samuel Oschin Foundation, and the Eastman Kodak Corporation.
The Oschin Schmidt Telescope is operated by the California Institute of Technology and Palomar Observatory.
The UK Schmidt Telescope was operated by the Royal Observatory Edinburgh, with funding from the UK Science and Engineering Research Council (later the UK Particle Physics and Astronomy Research Council), until 1988 June, and thereafter by the Anglo-Australian Observatory. The blue plates of the southern Sky Atlas and its Equatorial Extension (together known as the SERC-J), as well as the Equatorial Red (ER), and the Second Epoch [red] Survey (SES) were all taken with the UK Schmidt.
All data are subject to the copyright given in the copyright summary. Copyright information specific to individual plates is provided in the downloaded FITS headers.
Supplemental funding for sky-survey work at the ST ScI is provided by the European Southern Observatory.`;

interface Credit {
  name: string;
  license: string;
  text: string;
  link?: { href: string; label: string };
}

const DATA: Credit[] = [
  {
    name: "OpenNGC",
    license: "CC BY-SA 4.0",
    text: "Positions, types, sizes and magnitudes for the 58 deep-sky targets. AstroPlanner’s target list is shared under the same license.",
    link: { href: "https://github.com/mattiaverga/OpenNGC", label: "github.com/mattiaverga/OpenNGC" },
  },
  {
    name: "Open-Meteo",
    license: "Data CC BY 4.0 · free tier non-commercial",
    text: "Hourly cloud and rain forecasts, and city search. Model forecasts, not measurements at your site.",
    link: { href: "https://open-meteo.com", label: "open-meteo.com" },
  },
  {
    name: "Digitized Sky Survey (STScI)",
    license: "Non-profit use, with credit",
    text: "Red-plate survey pictures on target cards, fetched once per target and kept locally. © AURA and the plate copyright holders.",
    link: { href: "https://archive.stsci.edu/dss/", label: "archive.stsci.edu/dss" },
  },
  {
    name: "AAVSO VSX",
    license: "Personal, non-commercial use",
    text: "Type and brightness range for the four curated variable stars. Catalog data: International Variable Star Index (VSX), operated at AAVSO, Cambridge, Massachusetts, USA.",
    link: { href: "https://vsx.aavso.org", label: "vsx.aavso.org" },
  },
];

const SOFTWARE: Credit[] = [
  { name: "Astropy", license: "BSD-3-Clause", text: "Every Sun, Moon and target position." },
  { name: "photutils", license: "BSD-3-Clause", text: "Star size in stack measurements." },
  { name: "timezonefinder", license: "MIT", text: "Your timezone from coordinates, worked out on the AstroPlanner server." },
  {
    name: "Siril",
    license: "GPL-3.0 · run by you, not bundled",
    text: "The Processing Coach writes Siril scripts and reads Siril’s own text output.",
  },
];

const EQUIPMENT: Credit[] = [
  {
    name: "ZWO Seestar S30",
    license: "Manufacturer specifications",
    text: "30 mm aperture, 150 mm focal length, 2.46° field (axis not stated). The original S30, not the S30 Pro.",
    link: { href: "https://us.seestar.com/products/seestar-s30-all-in-one-smart-telescope", label: "Manufacturer product page" },
  },
];

function CreditGroup({ title, items }: { title: string; items: Credit[] }) {
  return (
    <>
      <h2 className="site-h2">{title}</h2>
      {items.map((c) => (
        <div key={c.name} className="site-credit">
          <h3 className="site-credit-name">{c.name}</h3>
          <span className="site-credit-lic">{c.license}</span>
          <p>{c.text}</p>
          {c.link && (
            <a href={c.link.href} target="_blank" rel="noreferrer">
              {c.link.label}
            </a>
          )}
        </div>
      ))}
    </>
  );
}

export function CreditsPage() {
  return (
    <div className="site-page">
      <SitePageIntro
        eyebrow="Credits & data"
        title="Built on open science."
        lede="Every catalog, forecast and library AstroPlanner uses, with its license and terms."
      />
      <div className="site-doc">
        <CreditGroup title="Data" items={DATA} />
        <CreditGroup title="Software" items={SOFTWARE} />
        <CreditGroup title="Equipment" items={EQUIPMENT} />
        <h2 className="site-h2">Digitized Sky Survey acknowledgment</h2>
        <p className="site-ack">{DSS_ACKNOWLEDGMENT}</p>
      </div>
    </div>
  );
}
