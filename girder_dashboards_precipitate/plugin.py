"""Composition root: the Girder plugin that installs the dashboard.

Kept out of ``__init__`` so that importing the declaration or the algorithm — which
is what a Celery worker does — does not import Girder's plugin machinery.
"""

from pathlib import Path

from girder.plugin import GirderPlugin, getPlugin, registerPluginStaticContent


class PrecipitatePlugin(GirderPlugin):
    DISPLAY_NAME = "Precipitate Analysis Dashboard"

    def load(self, info):
        # Both must be loaded before we register anything, and in this order:
        #
        # * 'dashboards' owns the registry we declare into, and the client-side
        #   registry our bundle calls at module scope. Loading it here is what
        #   puts its <script> ahead of ours, since plugin static content is served
        #   in the order it was registered.
        # * 'jobs' backs the progress reporting for both execution paths, and its
        #   web client is what the job status polling talks to.
        getPlugin("jobs").load(info)
        getPlugin("dashboards").load(info)

        # Imported here rather than at module scope so this module stays cheap for
        # anything that only wants the plugin class.
        from . import registerPrecipitateDashboard
        from .rest import Precipitate as PrecipitateResource

        registerPrecipitateDashboard()

        info["apiRoot"].precipitate = PrecipitateResource()

        registerPluginStaticContent(
            plugin="dashboards_precipitate",
            css=["/style.css"],
            js=["/girder-plugin-dashboards-precipitate.umd.cjs"],
            staticDir=Path(__file__).parent / "web_client" / "dist",
            tree=info["serverRoot"],
        )
