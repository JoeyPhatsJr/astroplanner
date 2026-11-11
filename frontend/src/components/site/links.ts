/** Tonight is not listed: the header's "See tonight’s sky" button already goes there. */
export const NAV_LINKS: { to: string; label: string }[] = [
  { to: "/explore", label: "Explore" },
  { to: "/astrolog", label: "AstroLog" },
  { to: "/variables", label: "Variable stars" },
];

/** Footer "About" pages, in order: How it works, Privacy, Credits & data, Terms. Each page's task appends its entry. */
export const ABOUT_LINKS: { to: string; label: string }[] = [
  { to: "/how-it-works", label: "How it works" },
  { to: "/privacy", label: "Privacy" },
  { to: "/credits", label: "Credits & data" },
  { to: "/terms", label: "Terms" },
];
