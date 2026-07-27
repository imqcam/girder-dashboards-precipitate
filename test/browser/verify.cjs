/*
 * Browser verification for girder-dashboards-precipitate.
 *
 * Drives headless Chrome against a running Girder and exercises the whole
 * Precipitate Analysis dashboard: the anonymous sign-in banner, a complete
 * analysis run (upload → regions → job → numbers), and the scale/info-panel
 * detection on three synthetic micrographs whose right answers are known by
 * construction. Also fails on any console error, page error or failed request.
 *
 * The core gallery/config/layout checks belong to girder-dashboards and live in
 * that repo's harness; this one assumes they pass and only covers this dashboard.
 *
 * Prerequisites: a Girder with this plugin (and therefore girder-dashboards)
 * loaded, both web clients built, an admin account, this dashboard enabled, and
 * the micrograph fixtures written. `seed.py` does all but the first. See CLAUDE.md.
 *
 *   python3 test/browser/seed.py && node test/browser/verify.cjs
 *
 * Environment:
 *   GIRDER_URL       default http://127.0.0.1:8989
 *   GIRDER_ADMIN     default admin
 *   GIRDER_PASSWORD  default adminpassword
 *   SHOTS            screenshot output directory (default test/browser/screenshots)
 *   PLAYWRIGHT_PATH  where to resolve playwright from, if not installed here
 */
const fs = require('fs');
const path = require('path');

// This repo has no node dependency of its own, so fall back to the playwright in
// the sibling girder checkout, which ships it for the core client's own tests.
const PW_CANDIDATES = [
    process.env.PLAYWRIGHT_PATH,
    'playwright',
    path.resolve(__dirname, '../../../girder-dashboards/test/browser/node_modules/playwright'),
    path.resolve(__dirname, '../../../girder/girder/web/node_modules/playwright')
].filter(Boolean);

let chromium;
for (const candidate of PW_CANDIDATES) {
    try {
        ({ chromium } = require(candidate));
        break;
    } catch (e) { /* try the next candidate */ }
}
if (!chromium) {
    console.error(`Could not resolve playwright. Tried:\n  ${PW_CANDIDATES.join('\n  ')}`);
    console.error('Set PLAYWRIGHT_PATH, or `npm i -D playwright`.');
    process.exit(2);
}

const BASE = (process.env.GIRDER_URL || 'http://127.0.0.1:8989').replace(/\/$/, '');
const ADMIN = process.env.GIRDER_ADMIN || 'admin';
const PASSWORD = process.env.GIRDER_PASSWORD || 'adminpassword';
const SHOTS = process.env.SHOTS || path.resolve(__dirname, 'screenshots');
const KEY = 'precipitate-analysis';
//: The synthetic micrograph seed.py writes; uploaded through the UI below.
const FIXTURE = process.env.MICROGRAPH ||
    path.resolve(__dirname, 'fixtures', 'micrograph.tif');
//: The same specimen with an instrument info panel and a TESCAN header, for the
//: scale detection and panel exclusion. Its right answers are known by
//: construction: see PANEL_HEIGHT and BAR_PIXELS in micrograph.py.
const TESCAN_FIXTURE = process.env.MICROGRAPH_TESCAN ||
    path.resolve(__dirname, 'fixtures', 'micrograph-tescan.tif');
//: The same again with the vendor header stripped — an image editor's leavings,
//: and the state four of the six real sample micrographs were in. Only the drawn
//: bar is left, which gives pixels but not the length printed beside them.
const STRIPPED_FIXTURE = process.env.MICROGRAPH_STRIPPED ||
    path.resolve(__dirname, 'fixtures', 'micrograph-stripped.tif');
const PANEL_HEIGHT = 64;
const BAR_PIXELS = 128;

fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
let failures = 0;

function check(name, ok, detail) {
    results.push({ name, ok: !!ok, detail });
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}

async function newPage(browser, token) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    if (token) {
        await context.addInitScript((t) => {
            window.localStorage.setItem('girderToken', t);
        }, token);
    }
    const page = await context.newPage();
    const problems = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    page.on('requestfailed', (req) => problems.push(`requestfailed: ${req.url()}`));
    return { context, page, problems };
}

// Girder's Backbone router does not re-run a route when only the hash changes on
// an already-loaded page in some cases, so each step does a full goto.
async function go(page, hash, waitFor) {
    await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' });
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 15000 });
}

/** The gallery card for a named dashboard, whatever order the cards are in. */
function cardFor(page, title) {
    return page.locator('.g-dashboard-card', {
        has: page.locator('.g-dashboard-card-title', { hasText: title })
    });
}

(async () => {
    // Log in via the API and hand the token to the browser through localStorage,
    // which is exactly where girder's auth.js keeps it.
    const loginResp = await fetch(`${BASE}/api/v1/user/authentication`, {
        headers: {
            Authorization: `Basic ${Buffer.from(`${ADMIN}:${PASSWORD}`).toString('base64')}`
        }
    });
    if (!loginResp.ok) {
        throw new Error(`admin login as "${ADMIN}" failed: ${loginResp.status}`);
    }
    const adminToken = (await loginResp.json()).authToken.token;

    const dashboards = await (await fetch(`${BASE}/api/v1/dashboard`)).json();
    const dashboard = dashboards.find((d) => d.key === KEY);
    if (!dashboard) {
        throw new Error(`dashboard "${KEY}" is not enabled — run seed.py first`);
    }
    const precipId = dashboard._id;

    for (const fixture of [FIXTURE, TESCAN_FIXTURE, STRIPPED_FIXTURE]) {
        if (!fs.existsSync(fixture)) {
            throw new Error(`missing micrograph fixture ${fixture} — run seed.py first`);
        }
    }

    // Prefer the system Chrome: the browser build cached for playwright may not
    // match the installed playwright version. Either way this is a throwaway
    // profile, never the user's own Chrome session.
    let browser;
    try {
        browser = await chromium.launch({ channel: 'chrome' });
        console.log('browser: system chrome');
    } catch (e) {
        browser = await chromium.launch();
        console.log(`browser: bundled chromium (system chrome unavailable: ${e.message.split('\n')[0]})`);
    }
    console.log(`target:  ${BASE}\n`);

    // -------------------------------------------------------------- the card
    // This plugin's contribution to the gallery: one more card, credited to the
    // authors of the research code, openable like any other.
    {
        const { context, page, problems } = await newPage(browser);

        await go(page, '#dashboards', '.g-dashboard-card');
        const card = cardFor(page, 'Precipitate Analysis');
        check('the dashboard has a card in the gallery', await card.count() === 1);
        const authors = (await card.locator('.g-dashboard-card-authors').innerText()).trim();
        check('the card credits both authors, in order',
            authors === 'Hasan Al Jame, Mohadeseh Taheri-Mousavi', authors);
        const imgOk = await card.locator('.g-dashboard-card-media img').evaluate(
            (el) => el.complete && el.naturalWidth > 0);
        check('the card image loaded', imgOk);
        check('the card offers an open action',
            (await card.locator('a.g-dashboard-run').getAttribute('href')) === `#dashboard/${precipId}`);
        await page.screenshot({ path: `${SHOTS}/20-precipitate-card.png`, fullPage: true });

        // Every endpoint is @access.user and runs live in the user's own folder,
        // so anonymously it must say so, not fire requests that 401.
        await go(page, `#dashboard/${precipId}`, '.g-precip-banner');
        const anonBanner = await page.locator('.g-precip-banner').innerText();
        check('an anonymous visitor is asked to sign in',
            /sign in/i.test(anonBanner), anonBanner.replace(/\s+/g, ' ').slice(0, 60));
        check('and offered a sign-in button',
            await page.locator('button.g-precip-login').count() === 1);
        check('and no anonymous API calls are made',
            !problems.some((p) => p.includes('401')), problems.join(' | ').slice(0, 200));
        await page.screenshot({ path: `${SHOTS}/21-precipitate-anon.png` });

        check('no console/page errors in the anonymous flow',
            problems.length === 0, problems.join(' | ').slice(0, 300));
        await context.close();
    }

    // ------------------------------------------------- precipitate analysis run
    // A whole analysis driven through the UI: upload a micrograph, select two
    // regions on it, run the job, and read the numbers back off the page.
    {
        const { context, page, problems } = await newPage(browser, adminToken);

        await go(page, `#dashboard/${precipId}`, '.g-precip-step');
        check('precipitate dashboard renders its steps',
            await page.locator('.g-precip-step').count() === 5,
            `${await page.locator('.g-precip-step').count()} steps`);
        const computeNote = (await page.locator('.g-precip-compute-note').innerText()).trim();
        check('dashboard says where the computation will run',
            /Celery task|Girder process/.test(computeNote), computeNote);
        check('no dependency warning on this instance',
            await page.locator('.g-precip-banner-error').count() === 0,
            await page.locator('.g-precip-banner').count()
                ? (await page.locator('.g-precip-banner').innerText()).slice(0, 120)
                : '');

        // Step 1: upload. The run folder is created as the upload starts.
        await page.setInputFiles('#g-files', FIXTURE);
        await page.locator('.g-start-upload').click();

        // While the prepare job runs the panel must not offer another upload:
        // choosing a file there would create a second run and orphan this one.
        // Caught by racing the preview — on a fast box the job is over quickly.
        const preparing = await Promise.race([
            page.waitForSelector('.g-precip-file-busy', { timeout: 120000 })
                .then(async () => ({
                    busy: true,
                    upload: await page.locator('.g-precip-upload-mount').count(),
                    reset: await page.locator('.g-precip-reset').isEnabled(),
                    note: (await page.locator('.g-precip-file-note').innerText()).trim()
                })),
            page.waitForSelector('.g-precip-image', { timeout: 120000 })
                .then(() => ({ busy: false }))
        ]);
        if (preparing.busy) {
            check('the upload widget is withdrawn while the micrograph is prepared',
                preparing.upload === 0 && preparing.reset === false,
                JSON.stringify(preparing));
            check('and the panel says what is being done to it',
                /Preparing the micrograph/.test(preparing.note), preparing.note);
        } else {
            check('the upload widget is withdrawn while the micrograph is prepared',
                true, 'prepare finished before it could be observed');
            check('and the panel says what is being done to it',
                true, 'prepare finished before it could be observed');
        }

        await page.waitForSelector('.g-precip-image', { timeout: 120000 });
        check('the upload widget stays withdrawn once the micrograph is ready',
            await page.locator('.g-precip-upload-mount').count() === 0 &&
                await page.locator('.g-precip-reset').isEnabled(),
            `${await page.locator('.g-precip-upload-mount').count()} upload mounts`);

        const image = await page.locator('.g-precip-image').evaluate((el) => ({
            complete: el.complete,
            naturalWidth: el.naturalWidth,
            naturalHeight: el.naturalHeight,
            src: el.getAttribute('src')
        }));
        check('the backend rendered a browsable preview',
            image.complete && image.naturalWidth === 512 && image.naturalHeight === 512,
            JSON.stringify(image).slice(0, 140));
        check('the preview is served from the run folder',
            /\/file\/[0-9a-f]{24}\/download(\?|$)/.test(image.src),
            image.src.replace(/token=[^&]+/, 'token=…'));
        const stageTitle = (await page.locator('.g-precip-stage-title').innerText()).trim();
        check('the stage names the image and its full resolution',
            stageTitle.includes('micrograph.tif') && stageTitle.includes('512 × 512'),
            stageTitle);
        await page.screenshot({ path: `${SHOTS}/10-precipitate-preview.png`, fullPage: true });

        // Step 4: drag two regions of interest onto the image.
        const box = await page.locator('.g-precip-stage').boundingBox();
        const drag = async (x1, y1, x2, y2) => {
            await page.mouse.move(box.x + x1, box.y + y1);
            await page.mouse.down();
            await page.mouse.move(box.x + (x1 + x2) / 2, box.y + (y1 + y2) / 2, { steps: 5 });
            await page.mouse.move(box.x + x2, box.y + y2, { steps: 5 });
            await page.mouse.up();
            await page.waitForTimeout(200);
        };
        await drag(10, 10, box.width * 0.45, box.height * 0.45);
        await drag(box.width * 0.55, box.height * 0.55, box.width - 10, box.height - 10);

        const regionRows = await page.locator('.g-precip-region-list li').count();
        check('dragging on the image selects a region', regionRows === 2, `${regionRows} regions`);
        const regionText = await page.locator('.g-precip-region-list li').first().innerText();
        check('the region is reported in full-resolution pixels',
            /\d+ × \d+ px at \d+, \d+/.test(regionText.replace(/\s+/g, ' ')),
            regionText.replace(/\s+/g, ' '));
        check('regions are drawn on the image',
            await page.locator('.g-precip-overlay rect').count() === 2);

        // Steps 2, 3 and 5: scale, spacing mode, preset.
        await page.fill('#g-precip-scale-microns', '1');
        await page.fill('#g-precip-scale-pixels', '129');
        const derived = (await page.locator('#g-precip-scale-derived').innerText()).trim();
        check('the scale is converted to µm/px and nm/px',
            derived.includes('0.007752 µm/px') && derived.includes('7.75 nm/px'), derived);
        await page.check('input[name="g-precip-spacing"][value="edge"]');
        await page.selectOption('#g-precip-preset', 'fine');
        await page.screenshot({ path: `${SHOTS}/11-precipitate-regions.png`, fullPage: true });

        // Run it. Requirement 5: the wait is visible while the job runs.
        await page.locator('#g-precip-run').click();
        // Dead on the click, not on the scheduling response: that response is a
        // round trip of its own, and a second click inside it starts a second
        // analysis of the same run.
        check('the Run button is disabled the moment it is pressed',
            !(await page.locator('#g-precip-run').isEnabled()));
        check('and the controls that describe the run are locked with it',
            !(await page.locator('#g-precip-preset').isEnabled()) &&
                !(await page.locator('#g-precip-scale-pixels').isEnabled()) &&
                await page.locator('.g-precip-stage-locked').count() === 1,
            `${await page.locator('.g-precip-stage-locked').count()} locked stages`);
        let progressText = '';
        try {
            await page.waitForSelector('.g-precip-job:not(.hide)', { timeout: 30000 });
            progressText = (await page.locator('.g-precip-job-title').innerText()).trim();
        } catch (e) { /* reported by the check below */ }
        check('a progress panel appears while the job runs',
            /precipitat/i.test(progressText), progressText);

        await page.waitForSelector('.g-precip-results', { timeout: 300000 });
        await page.waitForTimeout(1500);
        check('a finished run gives the controls back',
            await page.locator('#g-precip-run').isEnabled() &&
                await page.locator('#g-precip-preset').isEnabled() &&
                await page.locator('.g-precip-stage-locked').count() === 0);

        // Requirement 6: numbers, as plots and tables.
        const tiles = await page.locator('.g-precip-tile').evaluateAll((els) =>
            els.map((el) => [
                el.querySelector('.g-precip-tile-label').textContent.trim(),
                el.querySelector('.g-precip-tile-value').textContent.trim()
            ]));
        check('results show four headline numbers', tiles.length === 4, JSON.stringify(tiles));
        const particles = Number((tiles.find(([l]) => /Particles/.test(l)) || [])[1]);
        check('particles were detected', particles > 0, String(particles));
        check('every headline number is a real number',
            tiles.every(([, v]) => /^[\d,.]+$/.test(v)), JSON.stringify(tiles));
        check('the spacing tile names the mode that was chosen',
            tiles.some(([l]) => /edge-to-edge/i.test(l)), JSON.stringify(tiles.map(([l]) => l)));

        const canvases = await page.locator('.g-precip-results canvas').evaluateAll((els) =>
            els.map((el) => ({ id: el.id, w: el.width, h: el.height })));
        check('three plots were rendered', canvases.length === 3, JSON.stringify(canvases));
        check('every plot has a non-zero drawing surface',
            canvases.every((c) => c.w > 100 && c.h > 100), JSON.stringify(canvases));
        check('the spacing map keeps the image aspect ratio',
            Math.abs(canvases[2].w - canvases[2].h) <= 2, JSON.stringify(canvases[2]));
        // A blank canvas passes every DOM assertion, so check that ink reached it.
        const painted = await page.locator('#g-precip-diameter-chart').evaluate((el) => {
            const ctx = el.getContext('2d');
            const data = ctx.getImageData(0, 0, el.width, el.height).data;
            let coloured = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] > 0 && !(data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250)) {
                    coloured += 1;
                }
            }
            return coloured;
        });
        check('the histogram actually drew something', painted > 500, `${painted} px`);

        const statRows = await page.locator('.g-precip-table tbody tr').first()
            .locator('td').evaluateAll((els) => els.map((el) => el.textContent.trim()));
        check('the statistics table reports px and nm for d and s',
            statRows.length === 4 && statRows.every((v) => /^[\d,.]+$/.test(v)),
            JSON.stringify(statRows));
        const statLabels = await page.locator('.g-precip-table tbody th').evaluateAll(
            (els) => els.map((el) => el.textContent.trim()));
        check('the statistics table covers the published descriptors',
            ['Mean', 'Std dev', 'Median', 'Min', 'Max', 'SEM'].every((l) => statLabels.includes(l)),
            JSON.stringify(statLabels));
        const perRegion = await page.locator('.g-precip-panel', { hasText: 'Regions' })
            .locator('tbody tr').count();
        check('each region is reported separately', perRegion === 2, `${perRegion} rows`);

        // The detection overlay and nearest-neighbour map, over the micrograph.
        const circles = await page.locator('.g-precip-overlay circle').count();
        check('detected precipitates are circled on the image',
            circles === particles, `${circles} circles for ${particles} particles`);
        await page.check('#g-precip-show-links');
        await page.waitForTimeout(300);
        check('nearest-neighbour links can be overlaid',
            await page.locator('.g-precip-overlay path').count() === 2);
        await page.uncheck('#g-precip-show-detections');
        await page.waitForTimeout(300);
        check('the detection overlay can be turned off',
            await page.locator('.g-precip-overlay circle').count() === 0);
        await page.check('#g-precip-show-detections');

        // Scoping the charts and stats to one region.
        await page.selectOption('#g-precip-scope', { index: 1 });
        await page.waitForTimeout(1000);
        const scopedTitle = (await page.locator('.g-precip-panel', { hasText: 'Statistics' })
            .locator('h4').first().innerText()).trim();
        check('the results can be scoped to a single region',
            /Statistics: ROI 1/.test(scopedTitle), scopedTitle);
        const scopedParticles = Number(
            (await page.locator('.g-precip-tile').first()
                .locator('.g-precip-tile-value').innerText()).replace(/,/g, ''));
        check('scoping to a region reduces the particle count',
            scopedParticles > 0 && scopedParticles < particles,
            `${scopedParticles} of ${particles}`);
        await page.screenshot({ path: `${SHOTS}/12-precipitate-results.png`, fullPage: true });

        // Requirement: everything is stored in a folder of the user's own.
        const resultLink = await page.locator('a.g-precip-download').first().getAttribute('href');
        check('results.json is offered for download',
            /\/file\/[0-9a-f]{24}\/download(\?|$)/.test(resultLink),
            resultLink.replace(/token=[^&]+/, 'token=…'));
        const stored = await page.evaluate(async (url) => {
            const resp = await fetch(url);
            const body = await resp.json();
            return {
                ok: resp.ok,
                regions: body.regions.length,
                mode: body.spacingMode,
                total: body.pooled.nTotal,
                keys: Object.keys(body.regions[0].particles)
            };
        }, resultLink);
        check('the stored results are the numbers on screen',
            stored.ok && stored.total === particles && stored.regions === 2 &&
            stored.mode === 'edge-to-edge',
            JSON.stringify(stored).slice(0, 160));
        check('the stored results carry per-particle arrays',
            ['x', 'y', 'diameterNm', 'spacingNm', 'nnIndex'].every((k) => stored.keys.includes(k)),
            JSON.stringify(stored.keys));

        const folder = await page.evaluate(async () => {
            const token = window.localStorage.getItem('girderToken');
            const me = await (await fetch('/api/v1/user/me', {
                headers: { 'Girder-Token': token }
            })).json();
            const top = await (await fetch(
                `/api/v1/folder?parentType=user&parentId=${me._id}&limit=0`,
                { headers: { 'Girder-Token': token } })).json();
            const workspace = top.find((f) => f.name === 'Precipitate Analysis');
            if (!workspace) return { workspace: false };
            const runs = await (await fetch(
                `/api/v1/folder?parentType=folder&parentId=${workspace._id}&limit=0`,
                { headers: { 'Girder-Token': token } })).json();
            const items = await (await fetch(
                `/api/v1/item?folderId=${runs[0]._id}&limit=0`,
                { headers: { 'Girder-Token': token } })).json();
            return {
                workspace: true,
                public: workspace.public,
                runs: runs.length,
                contents: items.map((i) => i.name).sort()
            };
        });
        check('a dedicated folder was created in the user space',
            folder.workspace === true, JSON.stringify(folder).slice(0, 120));
        check('the dedicated folder is private',
            folder.public === false, String(folder.public));
        check('the run folder holds the input, the preview and the results',
            JSON.stringify(folder.contents) ===
                JSON.stringify(['micrograph.tif', 'preview.png', 'results.json']),
            JSON.stringify(folder.contents));

        const historyRows = await page.locator('.g-precip-history-table tbody tr').count();
        check('the run appears in the run history', historyRows >= 1, `${historyRows} rows`);
        const historyStatus = await page.locator('.g-precip-history-table tbody tr')
            .first().locator('.g-precip-status').innerText();
        check('the run history reports it as complete',
            historyStatus.trim() === 'Complete', historyStatus.trim());

        // Last, because it leaves this run failed: a run that finds nothing has to
        // say why and stay retryable. The coarse preset looks for large bright
        // precipitates, which this fixture has none of, so it fails on purpose.
        await page.selectOption('#g-precip-preset', 'coarse');
        await page.locator('#g-precip-run').click();
        await page.waitForSelector('.g-precip-job-error', { timeout: 300000 });
        const jobError = (await page.locator('.g-precip-job-error').innerText()).trim();
        check('a failed run explains itself',
            /No precipitates were validated|preset/i.test(jobError), jobError.slice(0, 120));
        check('a failed run leaves the Run button usable',
            await page.locator('#g-precip-run').isEnabled());
        check('and gives the rest of the controls back too',
            await page.locator('#g-precip-preset').isEnabled() &&
                await page.locator('.g-precip-stage-locked').count() === 0);
        const failedStatus = await page.locator('.g-precip-history-table tbody tr')
            .first().locator('.g-precip-status').innerText();
        check('the run history reports the failure',
            failedStatus.trim() === 'Failed', failedStatus.trim());
        await page.screenshot({ path: `${SHOTS}/13-precipitate-failure.png`, fullPage: true });

        check('no console/page errors in the precipitate flow',
            problems.length === 0, problems.join(' | ').slice(0, 300));
        await context.close();
    }

    // ------------------------------------ scale detection and panel exclusion
    // The same specimen, but as an instrument writes it: a scale bar and an info
    // panel across the bottom, and a header stating the pixel size. Neither of
    // those should have to be typed in, and the panel must not be analysed.
    {
        const { context, page, problems } = await newPage(browser, adminToken);
        await go(page, `#dashboard/${precipId}`, '.g-precip-step');

        await page.setInputFiles('#g-files', TESCAN_FIXTURE);
        await page.locator('.g-start-upload').click();
        await page.waitForSelector('.g-precip-image', { timeout: 120000 });

        const preview = await page.locator('.g-precip-image').evaluate((el) => ({
            width: el.naturalWidth, height: el.naturalHeight
        }));
        check('the preview keeps the info panel so the printed bar stays readable',
            preview.width === 512 && preview.height === 512 + PANEL_HEIGHT,
            JSON.stringify(preview));

        // The scale, read out of the file rather than typed in.
        const scale = await page.evaluate(() => ({
            microns: document.querySelector('#g-precip-scale-microns').value,
            pixels: document.querySelector('#g-precip-scale-pixels').value,
            derived: document.querySelector('#g-precip-scale-derived').textContent.trim()
        }));
        check('the scale is filled in from the image header',
            Number(scale.microns) === 1 && Number(scale.pixels) === BAR_PIXELS,
            JSON.stringify(scale));
        check('the derived pixel size follows from it',
            scale.derived.includes('7.81 nm/px'), scale.derived);

        const source = (await page.locator('.g-precip-detected-message').innerText()).trim();
        check('the dashboard says where the scale came from',
            /MIRA3/.test(source) && /PixelSizeX/.test(source), source.slice(0, 160));
        check('and cross-checks it against the bar drawn on the image',
            /spans 128 px/.test(source), source.slice(0, 160));
        check('the measured bar is marked on the image',
            await page.locator('.g-precip-overlay rect').count() >= 1);

        // The info panel, found and excluded.
        const exclusion = await page.evaluate(() => ({
            checked: document.querySelector('#g-precip-exclude-panel').checked,
            height: document.querySelector('#g-precip-exclude-px').value,
            note: document.querySelector('.g-precip-exclude-note').textContent.trim()
        }));
        check('the info panel was detected and is excluded by default',
            exclusion.checked && Number(exclusion.height) === PANEL_HEIGHT,
            JSON.stringify(exclusion).slice(0, 140));
        check('the note says how much of the image is being analysed',
            /Analysing the top 512 × 512 px/.test(exclusion.note),
            exclusion.note.slice(0, 200));
        await page.screenshot({ path: `${SHOTS}/14-precipitate-detected.png`, fullPage: true });

        // Restoring a detected value after the user has changed it.
        await page.fill('#g-precip-scale-pixels', '200');
        await page.waitForTimeout(200);
        const restore = page.locator('.g-precip-scale-restore');
        check('changing the scale offers the detected one back',
            await restore.isVisible() &&
                /128/.test((await restore.innerText())), (await restore.innerText()).trim());
        await restore.click();
        await page.waitForTimeout(200);
        check('and restores it when asked',
            Number(await page.locator('#g-precip-scale-pixels').inputValue()) === BAR_PIXELS,
            await page.locator('#g-precip-scale-pixels').inputValue());

        const readResults = async () => page.evaluate(async () => {
            const url = document.querySelector('a.g-precip-download').getAttribute('href');
            const body = await (await fetch(url)).json();
            return {
                total: body.pooled.nTotal,
                contentHeight: body.image.contentHeight,
                excluded: body.image.excludeBottomPx,
                lowest: Math.max(...body.regions[0].particles.y)
            };
        });

        await page.locator('#g-precip-run').click();
        await page.waitForSelector('.g-precip-results', { timeout: 300000 });
        await page.waitForTimeout(1000);
        const excluded = await readResults();
        check('the analysis stopped at the panel boundary',
            excluded.excluded === PANEL_HEIGHT && excluded.contentHeight === 512,
            JSON.stringify(excluded));
        check('and nothing was detected inside the panel',
            excluded.lowest < 512, `lowest particle at y=${excluded.lowest}`);

        // The claim this whole feature rests on: left in, the panel's text is
        // detected as precipitates and skews every number computed from them.
        await page.uncheck('#g-precip-exclude-panel');
        await page.waitForTimeout(200);
        check('unticking it puts the height field away',
            !(await page.locator('#g-precip-exclude-px').isVisible()));
        check('and takes the shading off the image',
            await page.locator('.g-precip-overlay text').count() === 0);
        check('unticking it says the whole image will be analysed',
            /whole image is being analysed/.test(
                await page.locator('.g-precip-exclude-note').innerText()));
        await page.locator('#g-precip-run').click();
        await page.waitForTimeout(1500);
        await page.waitForSelector('.g-precip-results', { timeout: 300000 });
        await page.waitForTimeout(1000);
        const included = await readResults();
        check('leaving the panel in finds precipitates that are not specimen',
            included.total > excluded.total && included.lowest > 512,
            `${included.total} with the panel against ${excluded.total} without, ` +
                `lowest y=${included.lowest}`);
        await page.screenshot({ path: `${SHOTS}/15-precipitate-panel-included.png`, fullPage: true });

        // The half-answer, on a file an image editor has been through: the bar is
        // still drawn but the header is gone, so the pixel count is measurable and
        // the length beside it — text — is not.
        await page.locator('.g-precip-reset').click();
        // Attached, not visible: the file input is styled out of sight, and
        // setInputFiles drives it regardless.
        await page.waitForSelector('#g-files', { state: 'attached', timeout: 15000 });
        await page.setInputFiles('#g-files', STRIPPED_FIXTURE);
        await page.locator('.g-start-upload').click();
        await page.waitForSelector('.g-precip-image', { timeout: 120000 });

        check('a stripped file still has its panel found',
            Number(await page.locator('#g-precip-exclude-px').inputValue()) === PANEL_HEIGHT &&
                await page.locator('#g-precip-exclude-panel').isChecked(),
            await page.locator('#g-precip-exclude-px').inputValue());
        check('and its drawn bar measured, in pixels',
            Number(await page.locator('#g-precip-scale-pixels').inputValue()) === BAR_PIXELS,
            await page.locator('#g-precip-scale-pixels').inputValue());
        const partial = await page.locator('.g-precip-detected-partial').count();
        const partialText = partial
            ? (await page.locator('.g-precip-detected-message').innerText()).trim() : '';
        check('and the dashboard asks for the length rather than inventing one',
            partial === 1 && /printed beside it/.test(partialText),
            partialText.slice(0, 160));
        await page.screenshot({ path: `${SHOTS}/16-precipitate-bar-only.png`, fullPage: true });

        check('no console/page errors in the detection flow',
            problems.length === 0, problems.join(' | ').slice(0, 300));
        await context.close();
    }
    await browser.close();

    console.log(`\n${results.length - failures}/${results.length} checks passed`);
    if (failures) {
        console.log('\nFAILURES:');
        results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.name} [${r.detail}]`));
    }
    process.exit(failures ? 1 : 0);
})().catch((err) => {
    console.error('HARNESS ERROR:', err);
    process.exit(2);
});
