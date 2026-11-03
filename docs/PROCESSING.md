# Processing Coach: methods and sources

_Skeleton created in Phase 4 Task 1 (gate G1). Later tasks add the method sections: the `.seq` reader, the night
report, selection options, the generated scripts, stack measurement and the advice rules._

AstroPlanner writes Siril scripts and reads Siril's output files. It copies no Siril source code or documentation
text (Siril is GPL-3.0; its documentation has its own licence). Facts below are recorded in our own words in
`docs/superpowers/specs/2026-11-03-processing-coach-design.md` section 2a.

## Sources

Read on 2026-11-03 for Siril 1.4.5:

- Siril command reference ("stable", headed 1.4.4; the installed 1.4.5 `help <command>` output was compared and
  gives the same syntax): <https://siril.readthedocs.io/en/stable/Commands.html>
- `.seq` read/write code and format history, tag 1.4.5:
  <https://gitlab.com/free-astro/siril/-/blob/1.4.5/src/io/seqfile.c>
- Frame filter code (literal, percent and k-sigma rules), tag 1.4.5:
  <https://gitlab.com/free-astro/siril/-/blob/1.4.5/src/core/sequence_filtering.c>
- Registration code (how unaligned frames are recorded), tag 1.4.5:
  <https://gitlab.com/free-astro/siril/-/blob/1.4.5/src/registration/global.c>
- Apply-registration code (how the `r_` sequence is written), tag 1.4.5:
  <https://gitlab.com/free-astro/siril/-/blob/1.4.5/src/registration/applyreg.c>
- Release tag listing: <https://gitlab.com/free-astro/siril/-/tree/1.4.5>
- Local probe: `siril-cli` 1.4.5 run on a synthetic 40-frame night in a scratch folder (nothing from the
  developer's real observing folders).

Python dependency:

- photutils 3.0.0 (BSD-3-Clause): <https://photutils.readthedocs.io/>. Checked by installing it and importing
  `photutils.psf.fit_fwhm` and `photutils.detection.DAOStarFinder`; the documentation pages were not read in
  this task.
