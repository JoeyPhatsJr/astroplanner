/**
 * The credit Open-Meteo's geocoding API asks for: its place names and coordinates come from GeoNames (CC BY 4.0).
 * Shown wherever a place search result is shown or used.
 */
export function GeoNamesCredit() {
  return (
    <>
      Location data based on{" "}
      <a href="https://www.geonames.org/" target="_blank" rel="noreferrer" className="text-ice underline underline-offset-2">
        GeoNames
      </a>
    </>
  );
}
