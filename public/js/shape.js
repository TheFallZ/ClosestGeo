// True-size country placement, shared by the browser (results and quiz pages) and the server
// (link preview images). Points are plain { lat, lng } objects in degrees.
//
// A country is placed by its extreme points: northernmost/southernmost for North-South,
// westernmost/easternmost for West-East. Every vertex keeps its real distance from the shape's
// center, so the outline is shown at true size wherever it is moved instead of being stretched
// by the map projection.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Shape = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    const EARTH_RADIUS_METERS = 6371008.8;
    const METERS_PER_DEGREE_LAT = 111320;
    // Keep shapes away from the poles, where web maps can't display them
    const MAX_LAT = 80;

    const rad = (degrees) => degrees * Math.PI / 180;
    const deg = (radians) => radians * 180 / Math.PI;
    const wrapLng = (lng) => ((lng + 540) % 360) - 180;

    // Wraps an angle in degrees into the range [-180, 180)
    function normalizeAngle(angle) {
        return ((angle + 540) % 360) - 180;
    }

    function distance(a, b) {
        const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
        return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    // Initial bearing from a to b, in degrees clockwise from north
    function heading(a, b) {
        const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
        const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
            Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
        return deg(Math.atan2(y, x));
    }

    // The point reached by travelling `meters` from `from` along bearing `bearing`
    function offset(from, meters, bearing) {
        const d = meters / EARTH_RADIUS_METERS;
        const lat1 = rad(from.lat);
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(rad(bearing)));
        const lng2 = rad(from.lng) + Math.atan2(
            Math.sin(rad(bearing)) * Math.sin(d) * Math.cos(lat1),
            Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
        );
        return { lat: deg(lat2), lng: wrapLng(deg(lng2)) };
    }

    // The point a `fraction` of the way from a to b along the great circle
    function interpolate(a, b, fraction) {
        const d = distance(a, b) / EARTH_RADIUS_METERS;
        if (d === 0) return { lat: a.lat, lng: a.lng };
        const A = Math.sin((1 - fraction) * d) / Math.sin(d);
        const B = Math.sin(fraction * d) / Math.sin(d);
        const x = A * Math.cos(rad(a.lat)) * Math.cos(rad(a.lng)) + B * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng));
        const y = A * Math.cos(rad(a.lat)) * Math.sin(rad(a.lng)) + B * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng));
        const z = A * Math.sin(rad(a.lat)) + B * Math.sin(rad(b.lat));
        return { lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lng: deg(Math.atan2(y, x)) };
    }

    // The two extreme vertices of an outline: [north, south] or [west, east]
    function extremes(outline, orientation) {
        if (orientation === 'West-East') {
            // Measure longitudes continuously for outlines that cross the antimeridian
            const lngs = outline.map(p => p.lng);
            const crosses = Math.max(...lngs) - Math.min(...lngs) > 180;
            const unwrapped = (p) => (crosses && p.lng < 0 ? p.lng + 360 : p.lng);
            return [
                outline.reduce((a, b) => (unwrapped(b) < unwrapped(a) ? b : a)),
                outline.reduce((a, b) => (unwrapped(b) > unwrapped(a) ? b : a))
            ];
        }
        return [
            outline.reduce((a, b) => (b.lat > a.lat ? b : a)),
            outline.reduce((a, b) => (b.lat < a.lat ? b : a))
        ];
    }

    // Turns a GeoJSON (Multi)Polygon into distances and bearings from the midpoint of its extremes,
    // ready to be placed anywhere with place()
    function prepare(geometry, orientation) {
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
        const toPoint = ([lng, lat]) => ({ lat, lng });

        // Remote territories are already left out of the boundary data, so every outer ring counts
        const [first, second] = extremes(polygons.flatMap(polygon => polygon[0].map(toPoint)), orientation);
        const origin = interpolate(first, second, 0.5);
        const toOffset = (point) => ({ meters: distance(origin, point), bearing: heading(origin, point) });

        return {
            rings: polygons.flatMap(polygon => polygon.map(ring => ring.map(c => toOffset(toPoint(c))))),
            extremes: [toOffset(first), toOffset(second)],
            span: distance(first, second),
            axisBearing: heading(origin, second)
        };
    }

    // Moves the center toward the equator if the shape, at this rotation, would reach past MAX_LAT
    function clampCenter(prepared, center, rotation) {
        let reachNorth = 0;
        let reachSouth = 0;
        for (const ring of prepared.rings) {
            for (const { meters, bearing } of ring) {
                const northward = meters * Math.cos(rad(bearing + rotation)) / METERS_PER_DEGREE_LAT;
                reachNorth = Math.max(reachNorth, northward);
                reachSouth = Math.max(reachSouth, -northward);
            }
        }
        const lat = Math.min(MAX_LAT - reachNorth, Math.max(-MAX_LAT + reachSouth, center.lat));
        return { lat, lng: center.lng };
    }

    // The center and rotation that line the shape's extremes up with points a and b.
    // If the span doesn't match the distance exactly, the shape is centered between them so the
    // gap at each end is equal. Each extreme is matched to whichever point needs less rotation.
    function align(prepared, a, b) {
        const center = interpolate(a, b, 0.5);
        const rotations = [b, a].map(p => normalizeAngle(heading(center, p) - prepared.axisBearing));
        const rotation = Math.abs(rotations[0]) <= Math.abs(rotations[1]) ? rotations[0] : rotations[1];
        return { center: clampCenter(prepared, center, rotation), rotation };
    }

    // Places a prepared shape at `center`, turned by `rotation` degrees
    function place(prepared, center, rotation) {
        const at = ({ meters, bearing }) => offset(center, meters, bearing + rotation);
        return {
            rings: prepared.rings.map(ring => ring.map(at)),
            extremes: prepared.extremes.map(at)
        };
    }

    return { distance, heading, offset, interpolate, normalizeAngle, prepare, align, place, clampCenter };
});
