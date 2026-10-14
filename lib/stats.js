// Anonymous usage counts for the stats page: which countries searches match, how far apart the
// places are, which distance option is used, and quiz results. No addresses, coordinates or IP
// addresses are stored, since people may search from their home address.

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'stats.json');
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const DAILY_ROUNDS = 5;
const DAYS_SHOWN = 30;
// Upper limits of the distance ranges, in miles
const DISTANCE_RANGES = [100, 250, 500, 1000, 2000, 4000, Infinity];

const rangeLabel = (index) => {
    const upper = DISTANCE_RANGES[index];
    const lower = index === 0 ? 0 : DISTANCE_RANGES[index - 1];
    return upper === Infinity ? `${lower.toLocaleString('en-US')}+ mi` : `${lower.toLocaleString('en-US')}–${upper.toLocaleString('en-US')} mi`;
};

function emptyStats() {
    return {
        since: new Date().toISOString().slice(0, 10),
        searches: { total: 0, byDay: {}, byCountry: {}, byOption: {}, byDistance: {} },
        quiz: {
            practice: Object.fromEntries(DIFFICULTIES.map(d => [d, { answered: 0, correct: 0 }])),
            daily: { played: 0, scores: {} }
        }
    };
}

function load(file) {
    try {
        return { ...emptyStats(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
        return emptyStats();
    }
}

const increment = (counts, key) => {
    counts[key] = (counts[key] || 0) + 1;
};

// `countryNames` maps country codes to names for the summary
function createStats({ file = DEFAULT_FILE, countryNames = {} } = {}) {
    const data = load(file);
    let saveTimer;

    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFile(file, JSON.stringify(data), (error) => {
                if (error) console.error('Could not save stats:', error.message);
            });
        }, 1000);
        saveTimer.unref();
    }

    function recordSearch({ countryCode, distanceMiles, distanceOption }) {
        const s = data.searches;
        s.total++;
        increment(s.byDay, new Date().toISOString().slice(0, 10));
        increment(s.byCountry, countryCode);
        increment(s.byOption, ['westEast', 'northSouth'].includes(distanceOption) ? distanceOption : 'both');
        increment(s.byDistance, String(DISTANCE_RANGES.findIndex(limit => distanceMiles < limit)));
        scheduleSave();
    }

    // Returns false for input that isn't a valid quiz result
    function recordQuizAnswer({ difficulty, correct }) {
        if (!DIFFICULTIES.includes(difficulty) || typeof correct !== 'boolean') return false;
        data.quiz.practice[difficulty].answered++;
        if (correct) data.quiz.practice[difficulty].correct++;
        scheduleSave();
        return true;
    }

    function recordDailyResult({ score }) {
        if (!Number.isInteger(score) || score < 0 || score > DAILY_ROUNDS) return false;
        data.quiz.daily.played++;
        increment(data.quiz.daily.scores, String(score));
        scheduleSave();
        return true;
    }

    // Everything the stats page shows
    function summary() {
        const s = data.searches;
        const days = [];
        for (let i = DAYS_SHOWN - 1; i >= 0; i--) {
            const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
            days.push({ day, count: s.byDay[day] || 0 });
        }
        return {
            since: data.since,
            searches: {
                total: s.total,
                last30Days: days,
                topCountries: Object.entries(s.byCountry)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                    .map(([code, count]) => ({ code, name: countryNames[code] || code, count })),
                byOption: ['both', 'westEast', 'northSouth'].map(option => ({ option, count: s.byOption[option] || 0 })),
                byDistance: DISTANCE_RANGES.map((_, i) => ({ range: rangeLabel(i), count: s.byDistance[i] || 0 }))
            },
            quiz: {
                practice: DIFFICULTIES.map(difficulty => ({ difficulty, ...data.quiz.practice[difficulty] })),
                daily: {
                    played: data.quiz.daily.played,
                    scores: Array.from({ length: DAILY_ROUNDS + 1 }, (_, score) => ({ score, count: data.quiz.daily.scores[score] || 0 }))
                }
            }
        };
    }

    return { recordSearch, recordQuizAnswer, recordDailyResult, summary };
}

module.exports = { createStats, DAILY_ROUNDS };
