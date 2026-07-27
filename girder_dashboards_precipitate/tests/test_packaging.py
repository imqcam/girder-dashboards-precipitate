"""The dependency probe and the packaging metadata have to agree.

``missingRequirements()`` is what makes the dashboard say "this Girder cannot run
the analysis" instead of failing a job with an ImportError. It only works if its
list of modules matches the requirements that install them — so that correspondence
is asserted rather than maintained by hand.
"""

import pathlib
import re

from girder_dashboards_precipitate import REQUIREMENTS, missingRequirements

SETUP_PY = pathlib.Path(__file__).resolve().parents[2] / "setup.py"


def _analysisRequirements():
    """The distribution names in ANALYSIS_REQUIREMENTS, from setup.py.

    Parsed rather than imported: importing setup.py would run setup().
    """
    source = SETUP_PY.read_text()
    marker = "ANALYSIS_REQUIREMENTS = ["
    block = source[source.index(marker) + len(marker) :]
    block = block[: block.index("]")]
    # 'scikit-image>=0.21' -> 'scikit-image'
    return {
        re.split(r"[<>=!~]", name)[0].strip()
        for name in re.findall(r'"([^"]+)"', block)
    }


def test_probe_covers_every_packaged_dependency():
    assert set(REQUIREMENTS.values()) == _analysisRequirements()


def test_the_analysis_stack_is_installed_unconditionally():
    """The scientific stack is a requirement, not an extra.

    A dashboard that can only report that it cannot compute anything is no use, and
    deployment tooling that runs a plain ``pip install -e .`` silently skipped the
    extra this used to be.
    """
    source = SETUP_PY.read_text()
    assert "+ ANALYSIS_REQUIREMENTS" in source
    assert "extras_require" not in source


def test_probe_finds_the_installed_stack():
    # The suite cannot run at all without these, so anything missing here means
    # the probe is looking for the wrong import name.
    assert missingRequirements() == []
