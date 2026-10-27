const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {build, compareRecords} = require('../../../assets/schedule-swap.js');
const root = path.resolve(__dirname, '../../..');
const json = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root, 'site-data/site-data.js'), 'utf8'), context);
const data = JSON.parse(JSON.stringify(context.window.SPARTY_ON_DATA));

function small(scores = [100,100,90,110]) {
  const ids = scores.map((_,i) => String.fromCharCode(65+i));
  const games = ids.map((id,i) => {
    const opponent = i ^ 1;
    return {year:2026,stage:'Regular Season',week:1,owner_id:id,opponent_owner_id:ids[opponent],
      points_for:scores[i],points_against:scores[opponent],result:scores[i] > scores[opponent] ? 'W' : scores[i] < scores[opponent] ? 'L' : 'T'};
  });
  return {validation_report:{status:'PASS',publication_cutoff:{current_season_through_week:1}},
    league:{current_season_through_week:1},seasons:[{year:2026,status:'Current',team_count:ids.length,regular_season_weeks:14,roster_owner_ids:ids}],
    games,current_standings:games.map((g,i) => ({year:2026,owner_id:g.owner_id,team:`Team ${g.owner_id}`,rank:i+1,games_played:1,wins:+(g.result==='W'),losses:+(g.result==='L'),ties:+(g.result==='T')}))};
}
const scenario = (analysis,a,b) => analysis.teams.find(t => t.owner_id===a).scenarios.find(s => s.schedule_id===b);

test('every real snapshot cell agrees with an independent full-fixture swap', () => {
  const result = build(data), mapping = json('site-data/sleeper/owner_map.json').rosters;
  const raw = Array.from({length:result.weeks}, (_,i) => json(`site-data/sleeper/raw/week-${String(i+1).padStart(2,'0')}.json`));
  let substitutions = 0;
  for (const team of result.teams) for (const borrowed of result.teams) {
    const expected = {wins:0,losses:0,ties:0};
    for (const week of raw) {
      const scores = new Map(), fixtures = new Map();
      const swap = id => id===team.owner_id ? borrowed.owner_id : id===borrowed.owner_id ? team.owner_id : id;
      for (const m of week.matchups) scores.set(mapping[m.roster_id], Math.round((m.custom_points ?? m.points)*100));
      for (const m of week.matchups) {
        const opponent = week.matchups.find(o => o.matchup_id===m.matchup_id && o.roster_id!==m.roster_id);
        fixtures.set(swap(mapping[m.roster_id]),swap(mapping[opponent.roster_id]));
        if (mapping[m.roster_id]===borrowed.owner_id && mapping[opponent.roster_id]===team.owner_id) substitutions++;
      }
      const ownScore = scores.get(team.owner_id), opponentScore = scores.get(fixtures.get(team.owner_id));
      expected[ownScore > opponentScore ? 'wins' : ownScore < opponentScore ? 'losses' : 'ties']++;
    }
    const actual = scenario(result,team.owner_id,borrowed.owner_id);
    for (const key of ['wins','losses','ties']) assert.equal(actual[key], expected[key]);
    assert.equal(actual.wins+actual.losses+actual.ties,result.weeks);
  }
  assert.equal(substitutions,result.weeks*result.teamCount);
  for (const team of result.teams) {
    const stored = data.current_standings.find(s => s.owner_id===team.owner_id);
    for (const key of ['wins','losses','ties']) assert.equal(team.actual[key],stored[key]);
  }
});

test('Week 7 reference outcomes are reproduced from scores', () => {
  const result = build(data);
  if (result.year !== 2026 || result.weeks !== 7) return; // Reference applies only to this snapshot.
  const tj=result.teams.find(t=>t.owner_id==='owner-tj'), alex=result.teams.find(t=>t.owner_id==='owner-alex');
  assert.equal(tj.best.wins,7); assert.equal(tj.averageWins,4.75);
  assert.equal(alex.best.wins,6); assert.equal(alex.averageWins,4.25);
});

test('self-matchups use the schedule owner score, with genuine ties retained', () => {
  const result=build(small());
  assert.equal(scenario(result,'A','B').ties,1);
  assert.equal(scenario(result,'C','D').losses,1);
  assert.equal(scenario(result,'A','C').losses,1);
  assert.equal(scenario(result,'A','D').wins,1);
  const a=result.teams.find(t=>t.owner_id==='A');
  assert.equal(a.averageWins,0.25); assert.equal(a.impact,-0.25);
  assert.equal(a.best.wins,1); assert.equal(a.worst.losses,1);
});

test('difficulty is the column mean including the actual diagonal', () => {
  const result=build(small());
  assert.equal(result.difficulty.find(d=>d.schedule_id==='A').averageWins,0.25);
  // D borrowing C's schedule faces C (90), rather than itself (110).
  assert.equal(result.difficulty.find(d=>d.schedule_id==='C').averageWins,0.25);
  assert.equal(result.difficulty.find(d=>d.schedule_id==='D').averageWins,0.75);
  for (const d of result.difficulty) assert.equal(d.averageWins,result.teams.reduce((n,t)=>n+t.scenarios.find(s=>s.schedule_id===d.schedule_id).wins,0)/result.teamCount);
});

test('league size comes from the roster, including a two-team league', () => {
  for (const count of [2,4,6,10,14]) {
    const result=build(small(Array.from({length:count},(_,i)=>100+i)));
    assert.equal(result.teams.length,count);
    assert.ok(result.teams.every(t=>t.scenarios.length===count));
    assert.ok(result.teams.every(t=>t.scenarios.every(s=>s.wins+s.losses+s.ties===1)));
  }
});

test('future and playoff rows never enter the analysis', () => {
  const sample=small(), expected=build(sample);
  sample.games.push({...sample.games[0],week:2,points_for:null});
  sample.games.push({...sample.games[0],stage:'Postseason',week:1,points_for:999});
  sample.games.push({...sample.games[0],year:2025,points_for:999});
  assert.deepEqual(build(sample),expected);
});

test('missing weeks, invalid scores, duplicate teams and broken opponents fail closed', () => {
  for (const mutate of [
    d=>d.games.pop(), d=>d.games.push({...d.games[0]}), d=>d.games[0].points_for=null,
    d=>d.games[0].points_for=Infinity, d=>d.games[0].points_for=100.001,
    d=>d.games[0].opponent_owner_id='A', d=>d.games[0].opponent_owner_id='unknown',
    d=>d.games[0].points_against=99, d=>d.games[0].result='W',
    d=>{d.league.current_season_through_week=2;d.validation_report.publication_cutoff.current_season_through_week=2;},
    d=>d.validation_report.publication_cutoff.current_season_through_week=2,
    d=>d.current_standings[0].wins=1, d=>d.validation_report.status='FAIL',
    d=>d.current_standings[0].owner_id='unknown', d=>d.seasons[0].team_count=12
  ]) {
    const sample=small();mutate(sample);assert.throws(()=>build(sample));
  }
});

test('boundary, zero-week state and best/worst tie ordering are explicit', () => {
  const sample=small();sample.league.current_season_through_week=15;sample.validation_report.publication_cutoff.current_season_through_week=15;
  assert.throws(()=>build(sample),/cutoff/);
  const zero=small();zero.games=[];zero.league.current_season_through_week=0;zero.validation_report.publication_cutoff.current_season_through_week=0;
  zero.current_standings.forEach(s=>{s.games_played=0;s.wins=0;s.losses=0;s.ties=0;});
  assert.equal(build(zero).weeks,0);
  assert.ok(compareRecords({wins:3,losses:2,ties:2},{wins:3,losses:3,ties:1})<0);
});
