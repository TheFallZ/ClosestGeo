// Draws the 1200x630 image shown when a results link is shared in chat apps and social media:
// a simple map of the area with the matched country placed between the two places.

const { Resvg } = require('@resvg/resvg-js');
const Shape = require('../public/js/shape.js');
const boundaries = require('../countries/boundaries.json');
const basemap = require('../countries/basemap.json');

const WIDTH = 1200;
const HEIGHT = 630;
const PADDING = 70;
const CAPTION_HEIGHT = 130;
// Matches the site's default "Simple" map style
const COLORS = {
    water: '#c9dbe6',
    land: '#f2f2f0',
    border: '#b9bdc2',
    ink: '#2f2a24',
    paper: '#fdfaf3',
    country: '#c4553a'
};

const escapeXml = (text) => String(text).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

// Web Mercator, with longitudes unwrapped around the view's center so the antimeridian doesn't split shapes
function mercatorY(lat) {
    const clamped = Math.max(-85, Math.min(85, lat));
    return Math.log(Math.tan(Math.PI / 4 + clamped * Math.PI / 360)) * 180 / Math.PI;
}

function unwrap(lng, centerLng) {
    return lng - 360 * Math.round((lng - centerLng) / 360);
}

function renderPreview(result) {
    const [a, b] = result.locations.map(l => ({ lat: l.latitude, lng: l.longitude }));
    const prepared = Shape.prepare(boundaries[result.countryCode.toUpperCase()], result.distanceOptionUsed);
    const { center, rotation } = Shape.align(prepared, a, b);
    const country = Shape.place(prepared, center, rotation);
    const route = Array.from({ length: 65 }, (_, i) => Shape.interpolate(a, b, i / 64));

    // Fit the route and the country into the area above the caption
    const toXY = (p) => [unwrap(p.lng, center.lng), mercatorY(p.lat)];
    const points = [...route, ...country.rings.flat()].map(toXY);
    const minX = Math.min(...points.map(p => p[0]));
    const maxX = Math.max(...points.map(p => p[0]));
    const minY = Math.min(...points.map(p => p[1]));
    const maxY = Math.max(...points.map(p => p[1]));
    const mapHeight = HEIGHT - CAPTION_HEIGHT;
    const scale = Math.min((WIDTH - 2 * PADDING) / (maxX - minX || 1), (mapHeight - 2 * PADDING) / (maxY - minY || 1));
    const offsetX = WIDTH / 2 - (minX + maxX) / 2 * scale;
    const offsetY = mapHeight / 2 + (minY + maxY) / 2 * scale;
    const project = (p) => {
        const [x, y] = toXY(p);
        return [offsetX + x * scale, offsetY - y * scale];
    };
    const pathData = (ring) => 'M' + ring.map(p => project(p).map(n => n.toFixed(1)).join(',')).join('L') + 'Z';

    // Only draw basemap countries that overlap the view. Shapes that wrap around the whole globe
    // (Antarctica) can't be drawn on a flat map without stray lines, so they're skipped.
    const view = { left: -WIDTH * 0.2, right: WIDTH * 1.2, top: -HEIGHT * 0.2, bottom: HEIGHT * 1.2 };
    const land = basemap
        .map(ring => ring.map(([lng, lat]) => ({ lat, lng })))
        .filter(ring => {
            const lngs = ring.map(p => unwrap(p.lng, center.lng));
            if (Math.max(...lngs) - Math.min(...lngs) > 300) return false;
            const xy = ring.map(project);
            return Math.max(...xy.map(p => p[0])) > view.left && Math.min(...xy.map(p => p[0])) < view.right &&
                Math.max(...xy.map(p => p[1])) > view.top && Math.min(...xy.map(p => p[1])) < view.bottom;
        })
        .map(pathData)
        .join('');

    const [ax, ay] = project(a);
    const [bx, by] = project(b);
    const pin = (x, y, label) => `
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="17" fill="${COLORS.ink}" stroke="${COLORS.paper}" stroke-width="3"/>
        <text x="${x.toFixed(1)}" y="${(y + 6).toFixed(1)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" font-weight="bold" fill="#fff">${label}</text>`;
    const orientation = result.distanceOptionUsed === 'West-East' ? 'west–east' : 'north–south';
    const fromTo = `${result.locations[0].address} → ${result.locations[1].address}`;
    const title = fromTo.length > 48 ? fromTo.slice(0, 47) + '…' : fromTo;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
        <rect width="${WIDTH}" height="${HEIGHT}" fill="${COLORS.water}"/>
        <path d="${land}" fill="${COLORS.land}" stroke="${COLORS.border}" stroke-width="1"/>
        <path d="${country.rings.map(pathData).join('')}" fill="${COLORS.country}" fill-opacity="0.3" stroke="${COLORS.country}" stroke-width="3" fill-rule="evenodd"/>
        <polyline points="${route.map(p => project(p).map(n => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${COLORS.ink}" stroke-width="4" stroke-dasharray="12 9"/>
        ${pin(ax, ay, 'A')}
        ${pin(bx, by, 'B')}
        <rect y="${HEIGHT - CAPTION_HEIGHT}" width="${WIDTH}" height="${CAPTION_HEIGHT}" fill="${COLORS.paper}"/>
        <rect y="${HEIGHT - CAPTION_HEIGHT}" width="${WIDTH}" height="2" fill="${COLORS.border}"/>
        <text x="48" y="${HEIGHT - 76}" font-family="Georgia, serif" font-size="40" fill="${COLORS.ink}">${escapeXml(result.country)}</text>
        <text x="48" y="${HEIGHT - 36}" font-family="Arial, sans-serif" font-size="24" fill="#6f655a">${escapeXml(title)} · ${Math.round(result.distanceMiles).toLocaleString('en-US')} mi (${orientation} span ${result.countrySpanMiles.toLocaleString('en-US')} mi)</text>
        <text x="${WIDTH - 48}" y="${HEIGHT - 76}" text-anchor="end" font-family="Georgia, serif" font-size="28" fill="#6f655a">ClosestGeo</text>
    </svg>`;

    return new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Arial' } }).render().asPng();
}

module.exports = { renderPreview };
