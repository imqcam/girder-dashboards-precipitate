# girder-dashboards-precipitate

**Precipitate Analysis** — a dashboard for
[girder-dashboards](https://github.com/Xarthisius/girder-dashboards) that detects precipitates in
an SEM/TEM micrograph and measures their equivalent diameter and nearest-neighbour spacing.

An implementation of the pipeline from
[Taheri-Mousavi Laboratory / Image-analysis-precipitate-detection-and-particle-spacing-estimation](https://github.com/Taheri-Mousavi-Laboratory/Image-analysis-precipitate-detection-and-particle-spacing-estimation),
turned into something you can run from a browser.

## Installing

```bash
pip install girder-dashboards-precipitate
```

`girder-dashboards` comes along as a dependency; installing this plugin adds one more card to its
gallery. Like every dashboard it arrives **disabled** — a site admin enables it from
*Admin console → Plugins → Dashboards*.

The scientific stack the analysis needs (numpy/scipy/scikit-image/tifffile/…) comes with it — it is
a requirement rather than an extra, because a dashboard that can only report that it cannot compute
anything is no use. Install the package in **both** the Girder environment and the Celery worker
environment; the dashboard reports a missing dependency on its own page instead of failing a run.

There is no broker requirement: the computation runs as a Celery task on the `local` queue when a
worker is consuming it, and in a thread of the Girder process when none is — so a plain
`girder serve` works.

## What it does

1. **Upload** an SEM/TEM micrograph (TIFF, including the LZW and 16-bit variants instrument
   software emits). The backend reads what the file says about itself: the **pixel scale**, from
   the vendor header or from the scale bar drawn on the image, and the **info panel** across the
   bottom, which is excluded from the analysis (see below).
2. **Check the scale** — the length of the image's scale bar in µm and how many pixels it spans,
   filled in already if either could be read, with a note saying where it came from.
3. **Choose the spacing measure** — centre-to-centre or edge-to-edge.
4. **Select regions of interest** by dragging on the image, as many as you like, or select none
   and the whole image is analysed as one region. Each region is detected and measured on its
   own and then pooled, exactly as the original treated its three separate ROI files.
5. **Wait** — the computation is a Celery task, reported as a normal Girder job with progress.
6. **Read the numbers** — size and spacing histograms with mean/median rules, a spacing map, the
   detection and nearest-neighbour overlays on the micrograph itself, and pooled and per-region
   statistics tables. Everything is drawn in the browser from stored numbers; the backend
   produces no figures.

Every input and output is a Girder object in a folder of the user's own — `Precipitate
Analysis/<run>/` in their user space, holding the uploaded micrograph, the preview the backend
rendered for region selection, and `results.json`, which carries per-particle arrays
(`x`, `y`, `diameterNm`, `spacingNm`, `nnIndex`, …) plus per-region and pooled statistics.

## The scale, and the info panel

Both are things the instrument already recorded, so neither should have to be typed in.

**The scale** is looked for in two places, in order. A **vendor header** — TESCAN's private tag
50431, or FEI/Thermo's tag 34682 — states the pixel size outright, and the form is filled in
with the scale bar the image itself is printed with (`50 µm = 370.656 px`, not `1 µm = 7.4 px`),
so the number on screen is one you can check against the number on the image. Failing that, the
**bar drawn in the info panel** is measured: that gives the pixel count but not the length
printed beside it, which is text, so the pixel count is filled in and you are asked for the
length. Either way the dashboard says which happened, marks the bar it measured on the image,
and offers the detected value back if you change it. The standard TIFF resolution tags are
deliberately *not* consulted: on every real micrograph tested they held a leftover screen or
print DPI, which would be a confidently wrong answer.

**The info panel** — the strip of instrument readings across the bottom — is found from the same
header where it states one, and otherwise from the pixels, and excluded from the analysis by
default. It is not specimen: its text and drawn scale bar are the brightest, roundest, most
compact things in the file, and are detected as precipitates. On the sample micrograph the
research code ships, leaving it in invents 35 particles and shifts the mean diameter by 2.6%;
excluding it reproduces the hand-cropped file the published analysis used to within 0.02%. It is
also what decides the 0-255 stretch on a 16-bit image, which is why the crop happens before the
grey conversion rather than after. The panel is dimmed on the preview rather than hidden — it is
where the scale bar is printed — and the exclusion is a checkbox with an editable height.

The two detection tunings published with the research code are offered as presets: **fine** for
small dim precipitates (725 °C, 1 hr) and **coarse** for large bright ones (725 °C, 5 hr). The
port is numerically faithful — see `test/fidelity/compare_to_original.py`, which compares every
reported statistic against the original scripts.

## REST API

Under `/api/v1/precipitate`. Every route is `@access.user` **and** checks the dashboard document,
so disabling the dashboard from the config page disables the functionality, not just the card.

| Route | Purpose |
|---|---|
| `GET /precipitate/capability` | dependency probe, worker availability, presets, admin form defaults |
| `GET`/`POST /precipitate/run` | list runs; create a run folder (and the workspace on first use) |
| `GET`/`DELETE /precipitate/run/{id}` | run state; delete the folder |
| `POST /precipitate/run/{id}/prepare` | schedule decode + preview + scale/panel inspection |
| `POST /precipitate/run/{id}/analyze` | schedule the analysis; returns the job |

## Settings

Editable by an admin from the dashboard's settings dialog, and used as the pre-filled values in
its form:

| Key | Default | Meaning |
|---|---|---|
| `defaultScaleBarMicrons` | `1.0` | Scale bar length prefilled when nothing could be read |
| `defaultScaleBarPixels` | `129` | …and its pixel span |
| `defaultPreset` | `"fine"` | Which detection tuning is selected initially |
| `defaultEdgeToEdge` | `false` | Spacing measured edge-to-edge rather than centre-to-centre |
| `maxRegions` | `12` | Guard on how much work one run can ask for |

## Development

```bash
pip install -e .
(cd girder_dashboards_precipitate/web_client && npm install && npm run build)
pytest girder_dashboards_precipitate/tests -q
ruff check .
```

Build the web client before running the tests — with no bundle in `web_client/dist`, `load()`
raises `FileNotFoundError`. See `CLAUDE.md` and `docs/` for the rest.

## Licence

BSD-3-Clause.
