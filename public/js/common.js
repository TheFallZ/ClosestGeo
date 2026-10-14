// Helpers shared by the ClosestGeo pages: map loading and drawing, units, requests and history.
const ClosestGeo = (() => {
    // Dark mode follows the device setting, read once when the page loads
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    // ink: pins and route line; paper: outlines around them
    const COLORS = isDark
        ? { ink: '#ece4d6', paper: '#1f1c18', pinLabel: '#1f1c18', country: '#e0775c' }
        : { ink: '#2f2a24', paper: '#fdfaf3', pinLabel: '#ffffff', country: '#c4553a' };

    // Map styles visitors can pick from. Custom styles hide roads, businesses and transit so the
    // country outline stands out; Simple and Atlas each have a dark version for dark mode.
    const HIDE_CLUTTER = [
        { featureType: 'road', stylers: [{ visibility: 'off' }] },
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] }
    ];

    // Simple: light gray land, pale blue water
    const SIMPLE_STYLE = [
        { elementType: 'geometry', stylers: [{ color: '#f2f2f0' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#5f6368' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
        { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#ededea' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9dbe6' }] },
        { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#7a8f9c' }] },
        { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#9aa0a6' }, { weight: 1 }] },
        { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#c5c8cc' }, { weight: 0.6 }] },
        ...HIDE_CLUTTER
    ];

    const SIMPLE_STYLE_DARK = [
        { elementType: 'geometry', stylers: [{ color: '#262626' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#a8a8a8' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a1a' }] },
        { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#2b2b2b' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#1c2a33' }] },
        { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#6b8594' }] },
        { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#6b6f73' }, { weight: 1 }] },
        { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#45484b' }, { weight: 0.6 }] },
        ...HIDE_CLUTTER
    ];

    // Atlas: parchment land, soft blue-green sea
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

    // Atlas in dark mode: charcoal land, deep blue-green sea
    const MAP_STYLE_DARK = [
        { elementType: 'geometry', stylers: [{ color: '#2b2925' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#b8ab97' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#1f1c18' }] },
        { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#302d28' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#1b3134' }] },
        { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#6f9599' }] },
        { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#7a6a58' }, { weight: 1.2 }] },
        { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#544a3f' }, { weight: 0.6 }] },
        { featureType: 'road', stylers: [{ visibility: 'off' }] },
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] }
    ];

    const MAP_STYLES = {
        simple: { label: 'Simple', options: { mapTypeId: 'roadmap', styles: isDark ? SIMPLE_STYLE_DARK : SIMPLE_STYLE } },
        atlas: { label: 'Atlas', options: { mapTypeId: 'roadmap', styles: isDark ? MAP_STYLE_DARK : MAP_STYLE } },
        standard: { label: 'Standard', options: { mapTypeId: 'roadmap', styles: [] } },
        satellite: { label: 'Satellite', options: { mapTypeId: 'hybrid', styles: [], tilt: 0 } }
    };
    const MAP_STYLE_KEY = 'closestgeo-map-style';

    function getMapStyle() {
        try {
            const style = localStorage.getItem(MAP_STYLE_KEY);
            return MAP_STYLES[style] ? style : 'simple';
        } catch {
            return 'simple';
        }
    }

    function setMapStyle(style) {
        try {
            localStorage.setItem(MAP_STYLE_KEY, style);
        } catch {
            // Storage unavailable; the choice just won't be remembered
        }
    }

    // Adds the map style menu to a map's top-right corner
    function addStyleControl(map) {
        const select = document.createElement('select');
        select.className = 'map-style-select';
        select.setAttribute('aria-label', 'Map style');
        select.innerHTML = Object.entries(MAP_STYLES).map(([value, { label }]) => `<option value="${value}">${label}</option>`).join('');
        select.value = getMapStyle();
        select.addEventListener('change', () => {
            setMapStyle(select.value);
            map.setOptions(MAP_STYLES[select.value].options);
        });
        map.controls[google.maps.ControlPosition.TOP_RIGHT].push(select);
    }

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
        const map = new google.maps.Map(element, {
            center: { lat: 20, lng: 0 },
            zoom: 2,
            ...MAP_STYLES[getMapStyle()].options,
            mapTypeControl: false,
            streetViewControl: false,
            backgroundColor: isDark ? '#262626' : '#f2f2f0',
            ...options
        });
        addStyleControl(map);
        return map;
    }

    function pinMarker(map, position, label, title) {
        return new google.maps.Marker({
            position,
            map,
            title,
            zIndex: 4,
            label: { text: label, color: COLORS.pinLabel, fontWeight: '600', fontSize: '13px' },
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

    // Dashed great-circle line between two points, over a faint solid line so it stays visible
    // on any map style (including satellite imagery)
    function dashedLine(map, a, b) {
        const underlay = new google.maps.Polyline({
            path: [a, b],
            geodesic: true,
            map,
            strokeColor: COLORS.paper,
            strokeOpacity: 0.6,
            strokeWeight: 6,
            zIndex: 2,
            clickable: false
        });
        const dashes = new google.maps.Polyline({
            path: [a, b],
            geodesic: true,
            map,
            strokeOpacity: 0,
            zIndex: 2,
            clickable: false,
            icons: [{
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: COLORS.ink, strokeWeight: 3, scale: 3 },
                offset: '0',
                repeat: '14px'
            }]
        });
        // Removing the line (setMap(null)) removes both parts
        return { setMap: (target) => { underlay.setMap(target); dashes.setMap(target); } };
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
