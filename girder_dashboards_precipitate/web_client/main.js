/*
 * Entry point. Registers the Precipitate Analysis view against the key the Python
 * half declares (`girder_dashboards_precipitate.KEY`).
 *
 * `girder.plugins.dashboards` is read at module scope, so the dashboards bundle
 * must already have run. That is guaranteed by `plugin.py` calling
 * `getPlugin("dashboards").load(info)` before registering our static content:
 * plugin scripts are injected in registration order, one after the other.
 */
import PrecipitateDashboard from './PrecipitateDashboard';

const { registerDashboard } = girder.plugins.dashboards;

registerDashboard('precipitate-analysis', { view: PrecipitateDashboard });
