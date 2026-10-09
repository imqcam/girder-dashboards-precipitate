# Testing, verification and CI

The detail behind the short Commands section in `../CLAUDE.md`.

## Test-suite gotchas

- **Two plugins have to be installed and built.** Loading this one loads `girder-dashboards`, and
  `registerPluginStaticContent` md5-hashes every listed file at load time — so a missing
  `web_client/dist` in *either* package makes `load()` raise `FileNotFoundError` and errors out
  every test using the `server` fixture. The pure-algorithm tests still pass, which makes the cause
  easy to misread.
- Tests that need a server are marked `pytestmark = pytest.mark.plugin("dashboards_precipitate")`.
  That is the *plugin* name from the `girder.plugin` entry point, not the dashboard key.
- `tests/conftest.py::cleanRegistry` is `autouse` and snapshots/restores
  `girder_dashboards.registry`'s module-level state. It is the neighbouring package's global, but a
  test here that unregisters this dashboard would leak into every later test without it.
- `pytest-girder` resets `plugin._pluginRegistry` per test, so `load()` (and therefore the
  provisioning upsert) re-runs against each test's fresh database. That is why the
  `precipitateDashboard` fixture can just `findOne` the document.
- The `micrograph` fixture loads `test/browser/micrograph.py` **by path** rather than copying it, so
  the pytest suite and the browser harness analyse the same synthetic image. That generator is
  stdlib-only (it hand-writes an uncompressed TIFF) because `seed.py` must stay dependency-free.
- `micrograph.write(panel=True)` writes a second fixture (`micrographWithPanel`, and
  `fixtures/micrograph-tescan.tif` for the browser): the same specimen plus an info panel with a
  drawn scale bar, and a TESCAN header in tag 50431. `header=False` writes a third
  (`micrograph-stripped.tif`) with the vendor tags left off — the state an image editor leaves a
  file in, where the drawn bar is all there is to go on, and the case four of the six real samples
  were in. Every expected number in `test_scale.py` is one the generator put there — the panel is
  `PANEL_HEIGHT` tall and the bar is `BAR_PIXELS` post-to-post, which is 1 µm at the `PixelSizeX`
  the header states. The panel's stand-in "text" is deliberately **precipitate-sized dots, not
  blocks**: with blocks the shape gates rejected it all and "excluding the panel changes the
  numbers" quietly held for the wrong reason. It now costs 31 spurious particles, as the real ones
  do.
- `test_a_run_completes_end_to_end_without_a_worker` waits on a job that a *background thread* is
  running. It polls to a terminal status, which also keeps the thread from touching the database
  after the `db` fixture tears it down.
- The suite takes about a minute (measured twice at 58 s and 62 s); most of that is real
  detection passes over synthetic micrographs, so expect it to scale with the machine.

## Local smoke run

```bash
GIRDER_MONGO_URI=mongodb://localhost:27017/girder_precip_smoke \
  uv run girder serve --host 127.0.0.1 --port 8989
```

The installed girder wheel serves the built core web client at `/`, so the whole UI is reachable.
First `POST /api/v1/user` creates a site admin.

## Browser verification

`test/browser/verify.cjs` drives headless Chrome through the whole dashboard: the card in the
gallery, the anonymous sign-in banner, a complete analysis run and its failure path, and the
scale/panel detection on three synthetic micrographs. It **fails on any console error, page error
or failed request**, which is how both 401 defects were caught.

The core gallery/config/layout checks are `../girder-dashboards/test/browser/verify.cjs`'s job. Run
both; they are independent and each leaves the instance as it found it.

```bash
# one-off: install the harness's own playwright (or reuse the sibling repo's)
(cd test/browser && npm ci && npx playwright install chromium)

# then, against a running Girder:
python3 test/browser/seed.py       # admin, assetstore, dashboard enabled, micrograph fixtures
node test/browser/verify.cjs
```

`seed.py` is stdlib-only (no venv needed) and idempotent, so it works on a fresh *or* dirty
instance. It also creates a **filesystem assetstore** (under `build/assetstore`) — a fresh Girder
has none, and without one the micrograph upload 500s.

To drive the **Celery** path instead of the in-process fallback, start Girder and a worker against
the same broker before seeding:

```bash
export GIRDER_WORKER_BROKER=redis://127.0.0.1:6379/1 GIRDER_WORKER_BACKEND=redis://127.0.0.1:6379/1
uv run girder serve --host 127.0.0.1 --port 8989 > girder.log 2>&1 &
uv run celery -A girder_worker.app worker -Q local -c 2 -l INFO > worker.log 2>&1 &
```

The harness asserts on the dashboard's own "where this runs" line, so it passes either way and the
log says which path was exercised. Both paths pass at 74/74 and produce identical numbers.

Two things are worth checking in `worker.log` rather than trusting the green count, because a
misconfigured worker makes Girder fall back to the in-process path *silently* and the harness still
passes:

1. The worker's startup `[tasks]` list contains
   `girder_dashboards_precipitate.worker_plugin.tasks.prepareRun` and `.analyzeRun`. If it does
   not, the `girder_worker_plugins` entry point is not being discovered — reinstall the package so
   its metadata is regenerated.
2. The job documents say `handler: celery_handler`. `GET /api/v1/job` shows it. `local` there means
   `workerAvailable()` said no and nothing was proved about Celery at all.

Configure via `GIRDER_URL` / `GIRDER_ADMIN` / `GIRDER_PASSWORD`, plus `SHOTS` for screenshots, which
land in `test/browser/screenshots/` (gitignored). **Read the screenshots** — DOM assertions alone
won't catch a collapsed grid or a stretched chart, which is exactly how the spacing-map defect was
found.

`playwright` resolves from `test/browser/node_modules` automatically; `PLAYWRIGHT_PATH` overrides,
and the sibling `girder-dashboards` and `girder/girder/web` copies are the fallbacks. The script
prefers the system Chrome and falls back to playwright's bundled chromium, logging which one it
used. Either way it is a throwaway profile, never the user's own Chrome session.

## The fidelity check

`test/fidelity/compare_to_original.py` imports the original research modules and compares every
reported statistic against this port. It needs the research repo and OpenCV, so it cannot run in
CI — run it by hand after touching detection or statistics:

```bash
pip install opencv-python-headless pandas   # reference only, never a plugin dependency
python3 test/fidelity/compare_to_original.py /path/to/research/repo
```

## CI

`.github/workflows/build-test.yaml`, two jobs on `ubuntu-24.04` with a `mongo:4.4` service. Both
have to build **two** web clients, since `girder-dashboards` is a dependency whose bundle must exist
before either plugin loads.

- **`test`** — build both web clients, then `tox -e lint` and `tox -e pytest`. The build steps are
  load-bearing, not cosmetic; see the warning above. The numpy/scipy/scikit-image stack the analysis
  tests need arrives with the package itself, so no extra is declared.
- **`browser`** — `uv pip install --system -e .`, build both web clients, `npm ci` + `playwright
  install chromium` in `test/browser`, start `girder serve` on 8989 with a wait loop, `seed.py`,
  then `verify.cjs`. Screenshots and `girder.log` upload as an artifact on every run
  (`if: always()`). There is no broker in CI, so this job exercises the in-process fallback; the
  Celery path has to be driven locally.

Until `girder-dashboards` 0.2 is on PyPI, both jobs install it from the sibling checkout — the
workflow clones it. Swap that for a plain version pin once it is published.
