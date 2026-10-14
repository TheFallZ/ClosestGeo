const express = require('express');
const fs = require('fs');
const path = require('path');
const { createGeocoder } = require('./lib/geocode');
const { search, countries } = require('./lib/search');
const { renderPreview } = require('./lib/preview');
const app = express();

// Load settings from .env (see .env.example) when the file exists
try {
    process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
    // No .env file; fall back to real environment variables
}

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
// Optional separate key for the browser map, so it can be restricted to your website
const GOOGLE_MAPS_BROWSER_KEY = process.env.GOOGLE_MAPS_BROWSER_KEY || GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
    console.error('Missing GOOGLE_API_KEY. Copy .env.example to .env and add your Google API key.');
    process.exit(1);
}

const { geocode } = createGeocoder(GOOGLE_API_KEY);

// Load country boundary geometries (GeoJSON, keyed by uppercase country code)
const boundaries = require('./countries/boundaries.json');

const RESULTS_PAGE = fs.readFileSync(path.join(__dirname, 'public', 'results.html'), 'utf8');
const MAX_CACHED_PREVIEWS = 200;
const previewCache = new Map();

app.use(express.json());

const escapeAttribute = (text) => String(text).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

// The search fields carried in a results link
function searchInput(query) {
    const { address1, address2, lat1, lng1, lat2, lng2, distanceOption } = query;
    return { address1, address2, lat1, lng1, lat2, lng2, distanceOption };
}

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
    res.type('html').send(RESULTS_PAGE.replace('<!-- link-preview-tags -->', tags));
});

app.use(express.static(path.join(__dirname, 'public')));

// Settings the browser needs to load Google Maps
app.get('/config', (req, res) => {
    res.json({ mapsApiKey: GOOGLE_MAPS_BROWSER_KEY });
});

// Every country with its spans, for the "how many fit" picker
app.get('/countries', (req, res) => {
    res.json(countries);
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
    try {
        const result = await search(searchInput(req.body || {}), geocode, req.ip);
        console.log('Search:', result.locations.map(l => l.address).join(' -> '), '=>', result.country);
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

function sendError(res, error) {
    if (error.status) {
        if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
        res.status(error.status).json({ error: error.message });
        return;
    }
    console.error('Error during search:', error); // Log the error
    res.status(500).json({ error: 'Something went wrong looking up those addresses. Please try again in a moment.' });
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
