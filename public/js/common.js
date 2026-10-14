// Helpers shared by the ClosestGeo pages: map loading and drawing, units, requests and history.
const ClosestGeo = (() => {
    const COLORS = {
        ink: '#2f2a24',
        paper: '#fdfaf3',
        country: '#c4553a',
        accent: '#2f6b73'
    };

    // Muted map colors: parchment land, soft blue-green sea, no roads or businesses
    const MAP_STYLE = [
        { elementType: 'geometry', stylers: [{ color: '#efe3c4' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#5b4636' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#f5ecd5' }] },
        { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#eadab4' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#a9c6c3' }] },
        { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4c6d70' }] },
        { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#8a6a4f' }, { weight: 1.2 }] },
        { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#b89c7d' }, { weight: 0.6 }] },
        { featureType: 'road', stylers: [{ visibility: 'off' }] },
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] }
    ];

    // Teardrop map pin, 24 x 36 with its tip at the bottom
    const PIN_PATH = 'M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z';
    const MAP_LOAD_ERROR = 'The map failed to load. Check your connection and try again.';

    let mapsPromise;

    // Loads the Google Maps script once, with the key the server provides
    function loadGoogleMaps() {
        if (!mapsPromise) {
            mapsPromise = fetch('/config')
                .then(response => {
                    if (!response.ok) throw new Error(MAP_LOAD_ERROR);
                    return response.json();
                })
                .then(({ mapsApiKey }) => new Promise((resolve, reject) => {
                    window.closestGeoMapsLoaded = () => resolve(window.google.maps);
                    const script = document.createElement('script');
                    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapsApiKey)}&loading=async&callback=closestGeoMapsLoaded`;
                    script.async = true;
                    script.onerror = () => reject(new Error(MAP_LOAD_ERROR));
                    document.head.appendChild(script);
                }))
                .catch(() => {
                    throw new Error(MAP_LOAD_ERROR);
                });
        }
        return mapsPromise;
    }

    function createMap(element, options = {}) {
        return new google.maps.Map(element, {
            center: { lat: 20, lng: 0 },
            zoom: 2,
            styles: MAP_STYLE,
            mapTypeControl: false,
            streetViewControl: false,
            backgroundColor: '#eadab4',
            ...options
        });
    }

    function pinMarker(map, position, label, title) {
        return new google.maps.Marker({
            position,
            map,
            title,
            zIndex: 4,
            label: { text: label, color: '#ffffff', fontWeight: '600', fontSize: '13px' },
            icon: {
                path: PIN_PATH,
                fillColor: COLORS.ink,
                fillOpacity: 1,
                strokeColor: COLORS.paper,
                strokeWeight: 2,
                scale: 1.2,
                anchor: new google.maps.Point(12, 36),
                labelOrigin: new google.maps.Point(12, 12)
            }
        });
    }

    function dotMarker(map, position) {
        return new google.maps.Marker({
            position,
            map,
            clickable: false,
            zIndex: 3,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 5,
                fillColor: COLORS.ink,
                fillOpacity: 1,
                strokeColor: COLORS.paper,
                strokeWeight: 2
            }
        });
    }

    // Dashed great-circle line between two points
    function dashedLine(map, a, b) {
        return new google.maps.Polyline({
            path: [a, b],
            geodesic: true,
            map,
            strokeOpacity: 0,
            zIndex: 2,
            icons: [{
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: COLORS.ink, strokeWeight: 3, scale: 3 },
                offset: '0',
                repeat: '14px'
            }]
        });
    }

    function countryPolygon(map, rings, options = {}) {
        return new google.maps.Polygon({
            paths: rings,
            map,
            strokeColor: COLORS.country,
            strokeWeight: 2,
            fillColor: COLORS.country,
            fillOpacity: 0.3,
            zIndex: 1,
            ...options
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ---------- Units ----------

    const KM_PER_MILE = 1.609344;
    const UNIT_KEY = 'closestgeo-unit';

    function getUnit() {
        try {
            return localStorage.getItem(UNIT_KEY) === 'km' ? 'km' : 'mi';
        } catch {
            return 'mi';
        }
    }

    function setUnit(unit) {
        try {
            localStorage.setItem(UNIT_KEY, unit);
        } catch {
            // Storage unavailable (private mode); the choice just won't be remembered
        }
    }

    // Wires up the page's mi/km buttons; onChange runs after the unit changes
    function setUpUnitToggle(onChange) {
        const buttons = document.querySelectorAll('.unit-toggle button');
        const update = () => buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.unit === getUnit())));
        buttons.forEach(button => button.addEventListener('click', () => {
            setUnit(button.dataset.unit);
            update();
            onChange();
        }));
        update();
    }

    const toUnit = (miles, unit) => Math.round(unit === 'km' ? miles * KM_PER_MILE : miles);

    // "942 mi" / "1,516 km"
    function formatDistance(miles, unit = getUnit()) {
        return `${toUnit(miles, unit).toLocaleString()} ${unit}`;
    }

    // "1 mile" / "12 miles" / "19 km", for sentences
    function distanceWords(miles, unit = getUnit()) {
        const value = toUnit(miles, unit);
        if (unit === 'km') return `${value.toLocaleString()} km`;
        return `${value.toLocaleString()} ${value === 1 ? 'mile' : 'miles'}`;
    }

    // ---------- Requests ----------

    async function postJson(url, body) {
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } catch {
            throw new Error("Couldn't reach the server. Check that it's running and try again.");
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'Something went wrong. Please try again.');
        }
        return data;
    }

    // ---------- Search history ----------

    const HISTORY_KEY = 'closestgeo-history';
    const MAX_HISTORY = 8;

    function loadHistory() {
        try {
            const history = JSON.parse(localStorage.getItem(HISTORY_KEY));
            return Array.isArray(history) ? history : [];
        } catch {
            return [];
        }
    }

    function addToHistory(entry) {
        const history = [entry, ...loadHistory().filter(item => item.url !== entry.url)].slice(0, MAX_HISTORY);
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        } catch {
            // Storage unavailable; history just won't be kept
        }
    }

    function clearHistory() {
        try {
            localStorage.removeItem(HISTORY_KEY);
        } catch {
            // Nothing to clear
        }
    }

    return {
        COLORS, loadGoogleMaps, createMap, pinMarker, dotMarker, dashedLine, countryPolygon, escapeHtml,
        getUnit, setUnit, setUpUnitToggle, formatDistance, distanceWords, postJson, loadHistory, addToHistory, clearHistory
    };
})();
