"""Independent reference values used to validate AstroPlanner's astronomy.

USNO values were fetched on 2026-11-02T19:30Z from the U.S. Naval Observatory
Astronomical Applications API (apiversion 4.0.1):
  https://aa.usno.navy.mil/api/rstt/oneday?date=YYYY-MM-DD&coords=LAT,LON&tz=OFFSET
  https://aa.usno.navy.mil/api/moon/phases/date?date=2026-10-01&nump=8
USNO publishes times rounded to the minute; its rise/set convention (Sun/Moon
centre at -0.833 deg incl. refraction) and twilight definitions (centre at -6
deg) match ours, so agreement within ~1.5 min is expected.

Meeus reference: J. Meeus, *Astronomical Algorithms* (2nd ed., 1998),
Example 13.b — horizontal coordinates of Venus seen from Washington DC.
"""

PHILADELPHIA = (39.9526, -75.1652)
SYDNEY = (-33.8688, 151.2093)
TROMSO = (69.6496, 18.9560)

# (lat, lon, tz, night_date, {event: local "YYYY-MM-DD HH:MM"})
USNO_SUN_CASES = [
    # Night after DST ends in the US (Nov 1, 2026): plain EST evening and morning
    (*PHILADELPHIA, "America/New_York", "2026-11-01", {
        "sunset_utc": "2026-11-01 16:58",
        "civil_dusk_utc": "2026-11-01 17:26",
        "civil_dawn_utc": "2026-11-02 06:03",
        "sunrise_utc": "2026-11-02 06:31",
    }),
    # Fall-back night: evening in EDT, morning in EST (25-hour local span)
    (*PHILADELPHIA, "America/New_York", "2026-10-31", {
        "sunset_utc": "2026-10-31 17:59",
        "civil_dusk_utc": "2026-10-31 18:27",
        "civil_dawn_utc": "2026-11-01 06:02",
        "sunrise_utc": "2026-11-01 06:30",
    }),
    # Spring-forward night: evening in EST, morning in EDT (23-hour local span)
    (*PHILADELPHIA, "America/New_York", "2026-03-07", {
        "sunset_utc": "2026-03-07 17:59",
        "civil_dusk_utc": "2026-03-07 18:26",
        "civil_dawn_utc": "2026-03-08 06:56",
        "sunrise_utc": "2026-03-08 07:23",
    }),
    # Southern-hemisphere winter solstice
    (*SYDNEY, "Australia/Sydney", "2026-06-21", {
        "sunset_utc": "2026-06-21 16:54",
        "civil_dusk_utc": "2026-06-21 17:22",
        "civil_dawn_utc": "2026-06-22 06:32",
        "sunrise_utc": "2026-06-22 07:00",
    }),
]

# (lat, lon, tz, night_date, event, local time) — Moon rise/set within the night span
USNO_MOON_CASES = [
    (*PHILADELPHIA, "America/New_York", "2026-11-01", "moonrise", "2026-11-01 23:21"),
    (*SYDNEY, "Australia/Sydney", "2026-06-21", "moonset", "2026-06-21 23:39"),
]

# USNO: Tromsø 2026-06-21 "Object continuously above the Horizon"; lower transit 00:46 (UTC+2).
TROMSO_MIDNIGHT_SUN = (*TROMSO, "Europe/Oslo", "2026-06-21", "2026-06-22 00:46")

# USNO primary Moon phases (UTC)
USNO_MOON_PHASES_UTC = [
    ("2026-10-10T15:50:00", "new"),
    ("2026-10-18T16:12:00", "first_quarter"),
    ("2026-10-26T04:12:00", "full"),
    ("2026-11-01T20:28:00", "last_quarter"),
]

# Meeus Example 13.b
MEEUS_13B = {
    "utc": "1987-04-10T19:21:00",
    "lat": 38 + 55 / 60 + 17 / 3600,
    "lon": -(77 + 3 / 60 + 56 / 3600),
    "ra_hms": (23, 9, 16.641),  # apparent RA of date
    "dec_dms": (-6, 43, 11.61),  # apparent Dec of date
    "alt_deg": 15.1249,  # geometric altitude (no refraction)
    "az_deg_from_south_westward": 68.0337,
}
