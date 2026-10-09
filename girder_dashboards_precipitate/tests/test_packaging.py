"""The dependency probe and the packaging metadata have to agree.

``missingRequirements()`` is what makes the dashboard say "this Girder cannot run
the analysis" instead of failing a job with an ImportError. It only works if its
list of modules matches the requirements that install them — so that correspondence
is asserted rather than maintained by hand.
"""

import pathlib
import re

from girder_dashboards_precipitate import REQUIREMENTS, missingRequirements

PYPROJECT = pathlib.Path(__file__).resolve().parents[2] / "pyproject.toml"


def _analysisRequirements():
    """The distribution names in the ANALYSIS_REQUIREMENTS block of pyproject.toml.

    PEP 621 ``dependencies`` is one flat array, so the analysis stack is fenced
    off inside it by comment markers and read back out of the raw text here --
    the installed metadata would not say which requirements are the analysis.
    """
    source = PYPROJECT.read_text()
    marker = "# ANALYSIS_REQUIREMENTS:"
    block = source[source.index(marker) + len(marker) :]
    block = block[: block.index("# end ANALYSIS_REQUIREMENTS")]
    # Requirement strings only -- the fence also carries prose comments, and
    # prose can quote things.
    block = "\n".join(
        line for line in block.splitlines() if not line.lstrip().startswith("#")
    )
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
    source = PYPROJECT.read_text()
    dependencies = source[source.index("dependencies = [") :]
    dependencies = dependencies[: dependencies.index("\n]")]
    assert "# ANALYSIS_REQUIREMENTS:" in dependencies
    assert "optional-dependencies" not in source


def test_probe_finds_the_installed_stack():
    # The suite cannot run at all without these, so anything missing here means
    # the probe is looking for the wrong import name.
    assert missingRequirements() == []
