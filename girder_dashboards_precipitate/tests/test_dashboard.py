"""This plugin's contribution to girder-dashboards: one declared dashboard.

The card metadata and the settings defaults are what an admin sees before they
change anything, so they are asserted here rather than left to the browser pass.
"""

import pytest
from girder_dashboards.models.dashboard import Dashboard as DashboardModel
from pytest_girder.assertions import assertStatusOk

from girder_dashboards_precipitate import DEFAULT_SETTINGS, KEY

pytestmark = pytest.mark.plugin("dashboards_precipitate")


def test_the_dashboard_is_provisioned(server, db):
    doc = DashboardModel().findOne({"key": KEY})

    assert doc is not None
    assert doc["name"] == "Precipitate Analysis"
    assert doc["image"].startswith("data:image/svg+xml;base64,")
    assert doc["settings"] == DEFAULT_SETTINGS
    # Disabled until an admin opts in, but readable by everyone once enabled.
    assert doc["enabled"] is False
    assert doc["public"] is True


def test_it_credits_the_authors_of_the_research_code(server, db):
    doc = DashboardModel().findOne({"key": KEY})

    assert doc["authors"] == ["Hasan Al Jame", "Mohadeseh Taheri-Mousavi"]


def test_it_is_offered_in_the_gallery_once_enabled(server, precipitateDashboard):
    resp = server.request(path="/dashboard", method="GET")
    assertStatusOk(resp)

    listed = {d["key"]: d for d in resp.json}
    assert KEY in listed
    # `available` is computed from the client-side-facing registry, so a False
    # here means the declaration did not survive plugin load.
    assert listed[KEY]["available"] is True


def test_loading_this_plugin_brings_the_core_one_with_it(server, db):
    """`plugin.py` calls getPlugin("dashboards").load(info) before registering.

    Without it the registry we declare into would not exist, and the browser
    would load our bundle before the one that defines
    `girder.plugins.dashboards.registerDashboard`.
    """
    resp = server.request(path="/system/plugin_static_files", method="GET")
    assertStatusOk(resp)

    js = resp.json["js"]
    core = next(i for i, u in enumerate(js) if "girder-plugin-dashboards.umd.cjs" in u)
    ours = next(
        i for i, u in enumerate(js) if "girder-plugin-dashboards-precipitate" in u
    )
    assert core < ours, js
