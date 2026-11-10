/**
 * Landing page copy and pictures, kept as data so every claim is reviewable in one place.
 *
 * Accuracy rules (CLAUDE.md): every sentence describes shipped behaviour, and every time below comes from
 * the saved example night the screenshots show (Philadelphia, PA, night of Mon 2 Nov 2026: sunset 16:57,
 * astronomical darkness from 18:28, sunrise 06:32). None of it is presented as live data.
 */

export const EXAMPLE_NIGHT_LABEL = "Times from an example night in Philadelphia, 2 Nov";

/** Twilight band shown behind the page while a chapter is in view (theme tokens, so night vision turns them red). */
export type Sky = "civil" | "nautical" | "astronomical" | "dark";

export interface Chapter {
  id: string;
  /** Clock face: a local time from the example night, or a word once the night is over. */
  time: string;
  moment: string;
  eyebrow: string;
  title: string;
  body: string;
  shot: { src: string; alt: string };
  link?: { to: string; label: string };
  sky: Sky;
  /** How far through the story this chapter is, 0–100, for the progress line. */
  progress: number;
}

export const CHAPTERS: Chapter[] = [
  {
    id: "tonight",
    time: "16:57",
    moment: "Sunset",
    eyebrow: "Before it’s dark",
    title: "Know if tonight is worth it.",
    body: "Clouds, rain, the Moon and real darkness for your exact spot, each one shown and each one labelled forecast or calculated. No mystery score.",
    shot: {
      src: "/landing/tonight-desktop.jpg",
      alt: "The Tonight screen: a score with its four parts, cards for clouds, rain, the Moon and darkness, and a dusk-to-dawn chart.",
    },
    link: { to: "/tonight", label: "Open Tonight" },
    sky: "civil",
    progress: 8,
  },
  {
    id: "targets",
    time: "18:28",
    moment: "Astronomical darkness",
    eyebrow: "The sky goes dark",
    title: "Know what to point at, and when.",
    body: "58 deep-sky targets ranked for your sky tonight, with the hours each one is high enough to shoot and how it fits the Seestar S30’s field.",
    shot: {
      src: "/landing/target-detail-desktop.jpg",
      alt: "Explore with a target open: its altitude through the night, rise and set times, and why it scored as it did.",
    },
    link: { to: "/explore", label: "Browse targets" },
    sky: "astronomical",
    progress: 30,
  },
  {
    id: "astrolog",
    time: "06:32",
    moment: "Sunrise, pack up",
    eyebrow: "The morning after",
    title: "Every night, remembered.",
    body: "Drop in the Seestar’s folder. AstroLog reads the file headers, not your pictures, and files the night under each target you shot.",
    shot: {
      src: "/landing/astrolog-library-desktop.jpg",
      alt: "The AstroLog library: one tile per target with its picture and time captured.",
    },
    link: { to: "/astrolog", label: "Open AstroLog" },
    sky: "dark",
    progress: 62,
  },
  {
    id: "processing",
    time: "Later",
    moment: "At your desk",
    eyebrow: "At your desk",
    title: "Learn to process it yourself.",
    body: "A ten-step coach for Siril, written for your exact files, that ends with your stack beside the Seestar’s own, measured the same way.",
    shot: {
      src: "/landing/processing-compare-desktop.jpg",
      alt: "The processing coach on its last step, comparing a Siril stack with the Seestar’s stack using measured numbers.",
    },
    sky: "astronomical",
    progress: 84,
  },
  {
    id: "variables",
    time: "Next",
    moment: "Your next clear night",
    eyebrow: "What’s next",
    title: "Then watch a star change.",
    body: "Four curated variable stars a Seestar can follow, with tonight’s window for each and links to AAVSO’s records.",
    shot: {
      src: "/landing/variable-hunter-star-desktop.jpg",
      alt: "A Variable Hunter star page for SS Cygni with its brightness range, tonight’s window and missions.",
    },
    link: { to: "/variables", label: "Meet the stars" },
    sky: "nautical",
    progress: 100,
  },
];

export interface Photo {
  src: string;
  alt: string;
  name: string;
  detail: string;
  /** Where to centre the crop in a portrait tile. */
  focus: string;
}

/** The developer's own captures. Captions name the object only: no scope, exposure or date is claimed. */
export const HERO_PHOTO = {
  src960: "/landing/m31-960.jpg",
  src1920: "/landing/m31-1920.jpg",
  alt: "The Andromeda Galaxy, a bright tilted spiral, with its two small companion galaxies.",
  name: "Andromeda Galaxy (M31)",
  detail: "with its companions M32 and M110",
};

export const GALLERY: Photo[] = [
  { src: "/landing/eagle.jpg", alt: "The Eagle Nebula, a red cloud of gas with dark pillars at its centre.", name: "Eagle Nebula", detail: "M16 · Serpens", focus: "55% 62%" },
  { src: "/landing/veil.jpg", alt: "The Eastern Veil Nebula, a long curved thread of red and teal gas.", name: "Eastern Veil Nebula", detail: "NGC 6992 · Cygnus", focus: "62% 58%" },
  { src: "/landing/dumbbell.jpg", alt: "The Dumbbell Nebula, a blue-green glowing cloud with red edges.", name: "Dumbbell Nebula", detail: "M27 · Vulpecula", focus: "50% 50%" },
  { src: "/landing/ngc7000.jpg", alt: "The North America Nebula region, faint red clouds across a dense star field.", name: "North America Nebula", detail: "NGC 7000 · Cygnus · mosaic", focus: "60% 55%" },
];

export const NAV_LINKS = [
  { to: "/tonight", label: "Tonight" },
  { to: "/explore", label: "Explore" },
  { to: "/astrolog", label: "AstroLog" },
  { to: "/variables", label: "Variable stars" },
];
