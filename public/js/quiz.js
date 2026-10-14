// Quiz: a country outline is drawn at true size between two cities; guess which country it is.
//   Daily:    five rounds, the same for everyone on a given day, with a shareable result.
//   Practice: endless rounds at a chosen difficulty, with a streak counter.
// Rounds use city coordinates, so no address lookups (and no API cost) are needed.
(() => {
    const { escapeHtml, formatDistance } = ClosestGeo;
    const $ = (id) => document.getElementById(id);

    const MIN_MILES = 250;
    const MAX_MILES = 3000;
    const CHOICES = 4;
    const DAILY_LAUNCH = '2026-10-14'; // Daily #1
    const DAILY_DIFFICULTIES = ['easy', 'easy', 'medium', 'medium', 'hard'];
    // Countries most people know, used for easy answers and easy wrong choices
    const FAMOUS = ['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'PE', 'CO', 'GB', 'IE', 'FR', 'ES', 'PT', 'IT', 'DE', 'NL',
        'BE', 'CH', 'AT', 'PL', 'SE', 'NO', 'FI', 'DK', 'GR', 'TR', 'UA', 'RU', 'EG', 'MA', 'NG', 'KE', 'ZA',
        'ET', 'SA', 'IR', 'IQ', 'IN', 'PK', 'CN', 'JP', 'KR', 'TH', 'VN', 'PH', 'ID', 'MY', 'AU', 'NZ', 'CU',
        'IS', 'MG', 'GL', 'MN', 'KZ'];

    // [name, latitude, longitude]
    const CITIES = [
        ['New York', 40.71, -74.01], ['Los Angeles', 34.05, -118.24], ['Chicago', 41.88, -87.63],
        ['Houston', 29.76, -95.37], ['Miami', 25.76, -80.19], ['Seattle', 47.61, -122.33],
        ['Denver', 39.74, -104.99], ['Atlanta', 33.75, -84.39], ['Toronto', 43.65, -79.38],
        ['Montreal', 45.50, -73.57], ['Vancouver', 49.28, -123.12], ['Mexico City', 19.43, -99.13],
        ['Havana', 23.11, -82.37], ['Bogotá', 4.71, -74.07], ['Lima', -12.05, -77.04],
        ['Santiago', -33.45, -70.67], ['Buenos Aires', -34.60, -58.38], ['São Paulo', -23.55, -46.63],
        ['Rio de Janeiro', -22.91, -43.17], ['London', 51.51, -0.13], ['Paris', 48.86, 2.35],
        ['Madrid', 40.42, -3.70], ['Lisbon', 38.72, -9.14], ['Rome', 41.90, 12.50],
        ['Berlin', 52.52, 13.40], ['Stockholm', 59.33, 18.07], ['Warsaw', 52.23, 21.01],
        ['Athens', 37.98, 23.73], ['Istanbul', 41.01, 28.98], ['Moscow', 55.76, 37.62],
        ['Cairo', 30.04, 31.24], ['Lagos', 6.52, 3.38], ['Nairobi', -1.29, 36.82],
        ['Addis Ababa', 9.03, 38.74], ['Johannesburg', -26.20, 28.05], ['Cape Town', -33.92, 18.42],
        ['Casablanca', 33.57, -7.59], ['Dubai', 25.20, 55.27], ['Riyadh', 24.71, 46.68],
        ['Tehran', 35.69, 51.39], ['Karachi', 24.86, 67.01], ['Delhi', 28.61, 77.21],
        ['Mumbai', 19.08, 72.88], ['Kolkata', 22.57, 88.36], ['Bangkok', 13.76, 100.50],
        ['Singapore', 1.35, 103.82], ['Jakarta', -6.21, 106.85], ['Manila', 14.60, 120.98],
        ['Hong Kong', 22.32, 114.17], ['Shanghai', 31.23, 121.47], ['Beijing', 39.90, 116.40],
        ['Seoul', 37.57, 126.98], ['Tokyo', 35.68, 139.69], ['Sydney', -33.87, 151.21],
        ['Melbourne', -37.81, 144.96], ['Perth', -31.95, 115.86], ['Auckland', -36.85, 174.76]
    ];

    const mode = new URLSearchParams(window.location.search).get('mode') === 'practice' ? 'practice' : 'daily';
    let map;
    let drawn = [];
    let countries = [];
    let current = null; // the round being played

    // ---------- Storage (all optional; the quiz works without it) ----------

    function load(key, fallback) {
        try {
            const value = JSON.parse(localStorage.getItem(key));
            return value === null ? fallback : value;
        } catch {
            return fallback;
        }
    }

    function save(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // Storage unavailable; progress just won't be remembered
        }
    }

    // ---------- Randomness ----------

    // Small seeded random number generator, so the daily rounds are the same for everyone
    function seededRandom(text) {
        let seed = 2166136261;
        for (const char of text) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
        return () => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    const shuffle = (items, random) => items
        .map(item => ({ item, sort: random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ item }) => item);

    // ---------- Rounds ----------

    const toPoint = ([, lat, lng]) => ({ lat, lng });
    const milesBetween = (a, b) => Shape.distance(toPoint(a), toPoint(b)) / 1609.344;

    // The same "closest span" rule the server uses, to check a round's answer before asking for it
    function closestCountry(miles) {
        const difference = (c) => Math.min(Math.abs(c.distance.westEast - miles), Math.abs(c.distance.northSouth - miles));
        return countries.reduce((best, c) => (difference(c) < difference(best) ? c : best));
    }

    // Two cities a sensible distance apart; easy rounds also need a well-known answer
    function pickCities(difficulty, random) {
        for (let attempt = 0; ; attempt++) {
            const [a, b] = shuffle(CITIES, random).slice(0, 2);
            const miles = milesBetween(a, b);
            if (miles < MIN_MILES || miles > MAX_MILES) continue;
            if (difficulty === 'easy' && attempt < 500 && !FAMOUS.includes(closestCountry(miles).countryCode)) continue;
            return [a, b];
        }
    }

    // The answer plus three wrong choices:
    //   easy   - well-known countries of clearly different length
    //   medium - any countries
    //   hard   - the next-closest matches, so every choice is about the same length
    function pickChoices(result, difficulty, random) {
        const answer = result.matches[0];
        const spanKey = answer.distanceOptionUsed === 'West-East' ? 'westEast' : 'northSouth';
        const asChoice = (c) => ({ country: c.name, countryCode: c.countryCode });
        let wrong;
        if (difficulty === 'hard') {
            wrong = shuffle(result.matches.slice(1), random);
        } else {
            const others = countries.filter(c => c.countryCode !== answer.countryCode);
            const pool = difficulty === 'easy'
                ? others.filter(c => FAMOUS.includes(c.countryCode) && Math.abs(c.distance[spanKey] / answer.spanMiles - 1) > 0.4)
                : others;
            wrong = shuffle(pool, random).map(asChoice);
        }
        return shuffle([answer, ...wrong.slice(0, CHOICES - 1)], random);
    }

    async function playRound({ difficulty, random, label }) {
        const [cityA, cityB] = pickCities(difficulty, random);
        $('loading').hidden = false;
        const result = await ClosestGeo.postJson('/find-country', {
            address1: cityA[0], lat1: cityA[1], lng1: cityA[2],
            address2: cityB[0], lat2: cityB[1], lng2: cityB[2],
            distanceOption: 'both',
            source: 'quiz'
        });
        const geometry = await (await fetch(`/country-shape/${result.countryCode}`)).json();
        current = { result, difficulty, label, answer: result.matches[0], choices: pickChoices(result, difficulty, random) };
        draw(result, geometry);
        renderQuestion();
        $('loading').hidden = true;
        $('quizCard').hidden = false;
    }

    function draw(result, geometry) {
        drawn.forEach(item => item.setMap(null));
        const [a, b] = result.locations.map(l => ({ lat: l.latitude, lng: l.longitude }));
        const prepared = Shape.prepare(geometry, result.distanceOptionUsed);
        const { center, rotation } = Shape.align(prepared, a, b);
        const placed = Shape.place(prepared, center, rotation);

        drawn = [
            ClosestGeo.pinMarker(map, a, 'A', result.locations[0].address),
            ClosestGeo.pinMarker(map, b, 'B', result.locations[1].address),
            ClosestGeo.dashedLine(map, a, b),
            ClosestGeo.countryPolygon(map, placed.rings)
        ];

        const bounds = new google.maps.LatLngBounds();
        [a, b, ...placed.rings.flat()].forEach(p => bounds.extend(p));
        const wide = window.matchMedia('(min-width: 721px)').matches;
        map.fitBounds(bounds, wide ? { top: 50, right: 50, bottom: 50, left: 380 } : 30);
    }

    function renderQuestion() {
        $('question').hidden = false;
        $('dailySummary').hidden = true;
        $('progress').textContent = current.label();
        renderPrompt();
        $('choices').innerHTML = current.choices.map(c =>
            `<button type="button" class="choice-button" data-code="${escapeHtml(c.countryCode)}">${escapeHtml(c.country)}</button>`).join('');
        $('reveal').hidden = true;
    }

    function renderPrompt() {
        const { result } = current;
        $('prompt').textContent = `Drawn at actual size between ${result.locations[0].address} (A) and ${result.locations[1].address} (B), ${formatDistance(result.distanceMiles)} apart.`;
    }

    function renderReveal() {
        const { answer: correct, isRight } = current;
        const orientation = correct.distanceOptionUsed === 'West-East' ? 'west–east' : 'north–south';
        $('revealText').textContent = `${isRight ? 'Correct!' : 'Not quite.'} It's ${correct.country}, ${formatDistance(correct.spanMiles)} ${orientation}.`;
    }

    // Marks the choices, reveals the answer and returns whether the guess was right
    function revealAnswer(button) {
        const { answer: correct } = current;
        current.isRight = button.dataset.code === correct.countryCode;
        [...$('choices').children].forEach(b => {
            b.disabled = true;
            if (b.dataset.code === correct.countryCode) b.classList.add('is-correct');
            else if (b === button) b.classList.add('is-wrong');
        });
        $('revealFlag').src = correct.flagUrl;
        $('revealFlag').alt = `Flag of ${correct.country}`;
        renderReveal();
        $('reveal').hidden = false;
        $('nextRound').focus();
        return current.isRight;
    }

    // Reports a result for the stats page; failures don't matter to the player
    function report(body) {
        fetch('/stats/quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            keepalive: true
        }).catch(() => {});
    }

    // ---------- Daily challenge ----------

    // Today's date in the player's time zone, as YYYY-MM-DD
    function today() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    function dailyNumber(date) {
        const days = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${DAILY_LAUNCH}T00:00:00Z`)) / 86400000;
        return Math.round(days) + 1;
    }

    const daily = {
        date: today(),
        get key() { return `closestgeo-daily-${this.date}`; },
        get answers() { return load(this.key, []); }
    };

    async function nextDailyRound() {
        const answers = daily.answers;
        if (answers.length >= DAILY_DIFFICULTIES.length) {
            showDailySummary();
            return;
        }
        const round = answers.length;
        const score = answers.filter(Boolean).length;
        await playRound({
            difficulty: DAILY_DIFFICULTIES[round],
            // Each round gets its own seed, so a reload resumes with the same round
            random: seededRandom(`closestgeo-${daily.date}-${round}`),
            label: () => `Daily #${dailyNumber(daily.date)} · Round ${round + 1} of ${DAILY_DIFFICULTIES.length} · Score ${score}`
        });
        $('nextRound').textContent = round === DAILY_DIFFICULTIES.length - 1 ? 'See results' : 'Next';
    }

    function answerDaily(button) {
        const isRight = revealAnswer(button);
        const answers = [...daily.answers, isRight];
        save(daily.key, answers);
        const score = answers.filter(Boolean).length;
        $('progress').textContent = `Daily #${dailyNumber(daily.date)} · Round ${answers.length} of ${DAILY_DIFFICULTIES.length} · Score ${score}`;
        if (answers.length === DAILY_DIFFICULTIES.length) report({ type: 'daily', score });
    }

    function shareText() {
        const answers = daily.answers;
        const squares = answers.map(right => (right ? '🟩' : '🟥')).join('');
        return `ClosestGeo Daily #${dailyNumber(daily.date)} ${answers.filter(Boolean).length}/${DAILY_DIFFICULTIES.length}\n${squares}\n${window.location.origin}/quiz.html?mode=daily`;
    }

    function showDailySummary() {
        const answers = daily.answers;
        const score = answers.filter(Boolean).length;
        $('question').hidden = true;
        $('dailySummary').hidden = false;
        $('summaryTitle').textContent = `Daily #${dailyNumber(daily.date)}`;
        $('summaryScore').textContent = `You got ${score} of ${DAILY_DIFFICULTIES.length} right.`;
        $('summarySquares').textContent = answers.map(right => (right ? '🟩' : '🟥')).join(' ');
        $('loading').hidden = true;
        $('quizCard').hidden = false;
        updateCountdown();
        setInterval(updateCountdown, 60 * 1000);
    }

    function updateCountdown() {
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0);
        const minutes = Math.ceil((midnight - Date.now()) / 60000);
        $('nextChallenge').textContent = `Next challenge in ${Math.floor(minutes / 60)}h ${minutes % 60}m.`;
    }

    async function shareResult() {
        const button = $('shareResult');
        const text = shareText();
        try {
            if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
                await navigator.share({ text });
                return;
            }
            await navigator.clipboard.writeText(text);
            button.textContent = 'Copied to clipboard';
            setTimeout(() => { button.textContent = 'Share result'; }, 2000);
        } catch (error) {
            if (error.name !== 'AbortError') window.prompt('Copy your result:', text);
        }
    }

    // ---------- Practice ----------

    const savedDifficulty = load('closestgeo-difficulty', 'medium');
    const practice = {
        difficulty: ['easy', 'medium', 'hard'].includes(savedDifficulty) ? savedDifficulty : 'medium',
        score: 0,
        answered: 0,
        streak: 0,
        get bestKey() { return `closestgeo-best-streak-${this.difficulty}`; }
    };

    function practiceLabel() {
        return `Score ${practice.score} of ${practice.answered} · Streak ${practice.streak} · Best ${load(practice.bestKey, 0)}`;
    }

    function nextPracticeRound() {
        return playRound({ difficulty: practice.difficulty, random: Math.random, label: practiceLabel });
    }

    function answerPractice(button) {
        const isRight = revealAnswer(button);
        practice.answered++;
        if (isRight) {
            practice.score++;
            practice.streak++;
            if (practice.streak > load(practice.bestKey, 0)) save(practice.bestKey, practice.streak);
        } else {
            practice.streak = 0;
        }
        $('progress').textContent = practiceLabel();
        report({ type: 'answer', difficulty: practice.difficulty, correct: isRight });
    }

    function setUpDifficulty() {
        const buttons = document.querySelectorAll('#difficulty button');
        const update = () => buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.difficulty === practice.difficulty)));
        buttons.forEach(button => button.addEventListener('click', () => {
            if (button.dataset.difficulty === practice.difficulty) return;
            practice.difficulty = button.dataset.difficulty;
            practice.streak = 0;
            save('closestgeo-difficulty', practice.difficulty);
            update();
            nextPracticeRound().catch(error => showError(error.message));
        }));
        update();
        $('difficulty').hidden = false;
    }

    // ---------- Page ----------

    function showError(message) {
        $('loading').hidden = true;
        $('errorMessage').textContent = message;
        $('error').hidden = false;
    }

    async function start() {
        $('loading').hidden = false;
        try {
            const [countryList] = await Promise.all([
                fetch('/countries').then(response => response.json()),
                ClosestGeo.loadGoogleMaps()
            ]);
            countries = countryList;
            if (!map) map = ClosestGeo.createMap($('map'));
            await (mode === 'daily' ? nextDailyRound() : nextPracticeRound());
        } catch (error) {
            showError(error.message);
        }
    }

    $(mode === 'daily' ? 'modeDaily' : 'modePractice').setAttribute('aria-current', 'page');
    if (mode === 'practice') setUpDifficulty();

    $('choices').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-code]');
        if (!button || !$('reveal').hidden) return;
        if (mode === 'daily') answerDaily(button);
        else answerPractice(button);
    });
    $('nextRound').addEventListener('click', () => {
        (mode === 'daily' ? nextDailyRound() : nextPracticeRound()).catch(error => showError(error.message));
    });
    $('shareResult').addEventListener('click', shareResult);
    $('retry').addEventListener('click', () => {
        $('error').hidden = true;
        start();
    });
    ClosestGeo.setUpUnitToggle(() => {
        if (!current || $('question').hidden) return;
        renderPrompt();
        if (!$('reveal').hidden) renderReveal();
    });

    document.addEventListener('DOMContentLoaded', start);
})();
