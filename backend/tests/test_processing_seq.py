import dataclasses

import pytest

from app.processing.seq import (
    KeptMappingError,
    RegData,
    SeqParseError,
    kept_mask,
    parse_conversion,
    parse_seq,
)
from tests.processing_fixtures import synthetic_conversion, synthetic_seq


def rd(fwhm=2.25, wfwhm=3.66, roundness=0.81, quality=0.0, background=0.0154, stars=44):
    return RegData(fwhm, wfwhm, roundness, quality, background, stars)


def test_parse_seq_header_and_rows():
    text = synthetic_seq(
        "light_",
        [(True, rd()), (True, rd(roundness=0.83)), (True, rd()), (False, None)],
    )
    seq = parse_seq(text)
    assert seq.name == "light_"
    assert seq.nb_images == 4
    assert seq.nb_selected == 3
    assert seq.version == 6
    assert seq.reference == 0
    assert seq.images[1].reg.roundness == 0.83
    assert seq.images[1].reg.stars == 44
    assert seq.images[3].reg is None
    assert [i.filenum for i in seq.images] == [1, 2, 3, 4]


def test_parse_seq_rejects_unknown_version():
    with pytest.raises(SeqParseError) as e:
        parse_seq(synthetic_seq("light_", [(True, rd())], version=7))
    assert "version 7" in str(e.value) and "1.4.5" in str(e.value)


def test_parse_seq_rejects_garbage():
    with pytest.raises(SeqParseError, match="Not a Siril sequence file"):
        parse_seq("hello\nthis is not a sequence\n")


def test_conversion_keeps_basenames_only():
    names = [
        "Light_NGC 7635_10.0s_LP_20260911-231147.fit",
        "Light_NGC 7635_10.0s_LP_20260911-231158.fit",
    ]
    out = parse_conversion(synthetic_conversion(names))
    assert out == {1: names[0], 2: names[1]}
    for v in out.values():
        assert "/" not in v and "ZZ_PATH" not in v


def _six():
    return [(True, rd(fwhm=2.0 + i, stars=40 + i)) for i in range(6)]


def test_kept_mask_by_filenum():
    # identical statistics in different positions must still map by filenum
    rows = [(True, rd()) for _ in range(6)]
    reg = parse_seq(synthetic_seq("pp_light_", rows))
    kept_rows = [(True, rd(quality=0.5)) for _ in range(3)]
    # quality differs (ignored); statistics identical for every frame
    kept = parse_seq(synthetic_seq("r_pp_light_", [(True, rd()) for _ in range(3)], filenums=[1, 3, 4]))
    assert kept_mask(reg, kept) == [True, False, True, True, False, False]
    kept_q = parse_seq(synthetic_seq("r_pp_light_", kept_rows, filenums=[2, 5, 6]))
    assert kept_mask(reg, kept_q) == [False, True, False, False, True, True]


def test_kept_mask_stale_sequence():
    reg = parse_seq(synthetic_seq("pp_light_", _six()))
    rows = _six()
    # missing filenum
    with pytest.raises(KeptMappingError):
        kept_mask(reg, parse_seq(synthetic_seq("r", rows[:2], filenums=[1, 9])))
    # statistic differs for same filenum
    for field, val in [("fwhm", 9.9), ("wfwhm", 9.9), ("roundness", 0.1), ("background", 1.0), ("stars", 99)]:
        bad = rd(fwhm=2.0, stars=40)
        bad = dataclasses.replace(bad, **{field: val})
        with pytest.raises(KeptMappingError):
            kept_mask(reg, parse_seq(synthetic_seq("r", [(True, bad)], filenums=[1])))
    # not increasing
    with pytest.raises(KeptMappingError):
        kept_mask(reg, parse_seq(synthetic_seq("r", [rows[2], rows[1]], filenums=[3, 2])))
    with pytest.raises(KeptMappingError):
        kept_mask(reg, parse_seq(synthetic_seq("r", [rows[1], rows[1]], filenums=[2, 2])))


def test_unaligned_frame_is_all_zero_line():
    text = "\n".join(
        [
            "#c",
            "#c",
            "S 'x' 1 1 0 5 0 6 0 0 0",
            "L 3",
            "I 1 0",
            "R1 0 0 0 0 0 0 H 0 0 0 0 0 0 0 0 0",
        ]
    )
    seq = parse_seq(text)
    assert seq.images[0].reg is None and seq.images[0].selected is False
    rows = [(True, rd()), (False, None)]
    a = parse_seq(synthetic_seq("p", rows, layer=1))
    b = parse_seq(synthetic_seq("p", rows, layer=0))
    assert a.images == b.images
    none = parse_seq(synthetic_seq("p", rows, layer=None))
    assert all(i.reg is None for i in none.images)
