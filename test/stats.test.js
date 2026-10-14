const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStats } = require('../lib/stats');

const newStats = () => createStats({
    file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'closestgeo-stats-')), 'stats.json'),
    countryNames: { EG: 'Egypt', NZ: 'New Zealand' }
});

test('counts searches by country, distance range and option', () => {
    const stats = newStats();
    stats.recordSearch({ countryCode: 'EG', distanceMiles: 942, distanceOption: 'both' });
    stats.recordSearch({ countryCode: 'EG', distanceMiles: 950, distanceOption: 'westEast' });
    stats.recordSearch({ countryCode: 'NZ', distanceMiles: 50, distanceOption: undefined });

    const { searches } = stats.summary();
    assert.equal(searches.total, 3);
    assert.deepEqual(searches.topCountries[0], { code: 'EG', name: 'Egypt', count: 2 });
    assert.equal(searches.byDistance.find(d => d.range === '500–1,000 mi').count, 2);
    assert.equal(searches.byDistance.find(d => d.range === '0–100 mi').count, 1);
    assert.equal(searches.byOption.find(o => o.option === 'both').count, 2, 'a missing option counts as both');
    assert.equal(searches.last30Days.length, 30);
    assert.equal(searches.last30Days.at(-1).count, 3, 'today has all three');
});

test('records valid quiz results and rejects invalid ones', () => {
    const stats = newStats();
    assert.equal(stats.recordQuizAnswer({ difficulty: 'hard', correct: true }), true);
    assert.equal(stats.recordQuizAnswer({ difficulty: 'hard', correct: false }), true);
    assert.equal(stats.recordQuizAnswer({ difficulty: 'impossible', correct: true }), false);
    assert.equal(stats.recordQuizAnswer({ difficulty: 'easy', correct: 'yes' }), false);
    assert.equal(stats.recordDailyResult({ score: 4 }), true);
    assert.equal(stats.recordDailyResult({ score: 6 }), false);
    assert.equal(stats.recordDailyResult({ score: 2.5 }), false);

    const { quiz } = stats.summary();
    assert.deepEqual(quiz.practice.find(d => d.difficulty === 'hard'), { difficulty: 'hard', answered: 2, correct: 1 });
    assert.equal(quiz.daily.played, 1);
    assert.equal(quiz.daily.scores.find(s => s.score === 4).count, 1);
});
