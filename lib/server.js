// The ClosestGeo web app. createApp() takes its dependencies so tests can pass fakes.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { search, countries } = require('./search');
const { renderPreview } = require('./preview');
const { createLimiter } = require('./rate-limit');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const boundaries = require('../countries/boundaries.json');
const facts = require('../countries/facts.json');
const countriesWithFacts = countries.map(c => ({ ...c, facts: facts[c.countryCode.toUpperCase()] || null }));
const MAX_CACHED_PREVIEWS = 200;

const escapeAttribute = (text) => String(text).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

// The search fields carried in a results link
function searchInput(query) {
    const { address1, address2, lat1, lng1, lat2, lng2, distanceOption } = query;
    return { address1, address2, lat1, lng1, lat2, lng2, distanceOption };
}

function sendError(res, error) {
    if (error.status) {
        if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
        res.status(error.status).json({ error: error.message });
        return;
    }
    console.error('Error during search:', error); // Log the error
    res.status(500).json({ error: 'Something went wrong looking up those addresses. Please try again in a moment.' });
}

// geocode(address, ip) -> { lat, lng } | null; mapsApiKey is sent to the browser; stats records usage
function createApp({ geocode, mapsApiKey, stats }) {
    const app = express();
    const resultsPage = fs.readFileSync(path.join(PUBLIC_DIR, 'results.html'), 'utf8');
    const previewCache = new Map();
    const statsLimiter = createLimiter({ max: 300, windowMs: 60 * 60 * 1000, message: () => 'Too many requests.' });

    app.use(express.json());

    // Results page, with link preview tags so shared links show a title and a map image
    app.get('/results.html', (req, res) => {
        const input = searchInput(req.query);
        let tags = '';
        if (input.address1 && input.address2) {
            const query = new URLSearchParams(Object.entries(input).filter(([, value]) => typeof value === 'string'));
            const origin = `${req.protocol}://${req.get('host')}`;
            const title = `${input.address1} → ${input.address2} | ClosestGeo`;
            const description = 'Which country is as long as the distance between these two places?';
            tags = [
                `<meta property="og:title" content="${escapeAttribute(title)}">`,
                `<meta property="og:description" content="${escapeAttribute(description)}">`,
                `<meta property="og:image" content="${escapeAttribute(`${origin}/preview.png?${query}`)}">`,
                '<meta property="og:image:width" content="1200">',
                '<meta property="og:image:height" content="630">',
                '<meta name="twitter:card" content="summary_large_image">'
            ].join('\n    ');
        }
        res.type('html').send(resultsPage.replace('<!-- link-preview-tags -->', tags));
    });

    app.use(express.static(PUBLIC_DIR));

    // Settings the browser needs to load Google Maps
    app.get('/config', (req, res) => {
        res.json({ mapsApiKey });
    });

    // Every country with its spans and facts, for the results card and quiz
    app.get('/countries', (req, res) => {
        res.json(countriesWithFacts);
    });

    // Serve the boundary geometry for a single country
    app.get('/country-shape/:code', (req, res) => {
        const shape = boundaries[req.params.code.toUpperCase()];
        if (!shape) {
            res.status(404).json({ error: 'Shape not found' });
            return;
        }
        res.json(shape);
    });

    // Endpoint handler for finding the closest country
    app.post('/find-country', async (req, res) => {
        const body = req.body || {};
        try {
            const result = await search(searchInput(body), geocode, req.ip);
            // Quiz rounds aren't real searches, so they're left out of the stats
            if (body.source !== 'quiz') {
                stats.recordSearch({ countryCode: result.countryCode, distanceMiles: result.distanceMiles, distanceOption: body.distanceOption });
            }
            res.json(result);
        } catch (error) {
            sendError(res, error);
        }
    });

    // Image shown when a results link is shared
    app.get('/preview.png', async (req, res) => {
        const input = searchInput(req.query);
        const key = JSON.stringify(input);
        try {
            let image = previewCache.get(key);
            if (!image) {
                image = renderPreview(await search(input, geocode, req.ip));
                previewCache.set(key, image);
                if (previewCache.size > MAX_CACHED_PREVIEWS) previewCache.delete(previewCache.keys().next().value);
            }
            res.type('png').set('Cache-Control', 'public, max-age=86400').send(image);
        } catch (error) {
            res.status(error.status || 500).end();
            if (!error.status) console.error('Error drawing preview:', error);
        }
    });

    // Quiz results reported by the browser: { type: 'answer', difficulty, correct } or { type: 'daily', score }
    app.post('/stats/quiz', (req, res) => {
        try {
            statsLimiter.use(req.ip);
        } catch (error) {
            sendError(res, error);
            return;
        }
        const body = req.body || {};
        const ok = body.type === 'daily' ? stats.recordDailyResult(body) : stats.recordQuizAnswer(body);
        res.status(ok ? 204 : 400).end();
    });

    app.get('/stats.json', (req, res) => {
        res.json(stats.summary());
    });

    return app;
}

module.exports = { createApp };
