/* Pure schedule swaps over the site's verified regular-season snapshot.
   CommonJS export lets CI test the same calculation used by the page. */
(() => {
  'use strict';
  const compareRecords = (a, b) => b.wins - a.wins || a.losses - b.losses;
  const cents = value => {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) {
      throw new Error('A weekly score is missing or has unsupported precision.');
    }
    return Math.round(value * 100);
  };
  function build(data) {
    if (data?.validation_report?.status !== 'PASS') throw new Error('The scoring snapshot is not verified.');
    const seasons = data.seasons.filter(s => s.status === 'Current');
    if (seasons.length !== 1) throw new Error('The current season is unavailable.');
    const season = seasons[0], weeks = data.league.current_season_through_week;
    const ids = season.roster_owner_ids, count = season.team_count;
    if (!Array.isArray(ids) || ids.length !== count || new Set(ids).size !== count || count < 2 || count % 2) {
      throw new Error('Every team needs a paired schedule for this analysis.');
    }
    if (!Number.isInteger(weeks) || weeks < 0 || weeks > season.regular_season_weeks ||
        weeks !== data.validation_report.publication_cutoff.current_season_through_week) {
      throw new Error('The regular-season publication cutoff is inconsistent.');
    }
    const standings = data.current_standings;
    if (standings.length !== count || new Set(standings.map(s => s.owner_id)).size !== count ||
        standings.some(s => !ids.includes(s.owner_id) || s.year !== season.year)) {
      throw new Error('The current-season team mapping is inconsistent.');
    }
    const byWeek = new Map();
    for (const g of data.games) {
      if (g.year !== season.year || g.stage !== 'Regular Season' || g.week > weeks) continue;
      if (!Number.isInteger(g.week) || g.week < 1 || !ids.includes(g.owner_id)) throw new Error('Invalid weekly team mapping.');
      if (!byWeek.has(g.week)) byWeek.set(g.week, new Map());
      const week = byWeek.get(g.week);
      if (week.has(g.owner_id)) throw new Error('A team has duplicate weekly results.');
      week.set(g.owner_id, {opponent: g.opponent_owner_id, score: cents(g.points_for), against: cents(g.points_against), result: g.result});
    }
    for (let w = 1; w <= weeks; w++) {
      const week = byWeek.get(w);
      if (!week || week.size !== count) throw new Error(`Week ${w} is incomplete. No partial analysis is shown.`);
      for (const [id, game] of week) {
        const other = week.get(game.opponent);
        const result = game.score > game.against ? 'W' : game.score < game.against ? 'L' : 'T';
        if (id === game.opponent || !other || other.opponent !== id || other.score !== game.against ||
            other.against !== game.score || game.result !== result) throw new Error(`Week ${w} has inconsistent matchup data.`);
      }
    }
    const teams = [...standings].sort((a, b) => a.rank - b.rank).map(team => {
      const scenarios = ids.map(schedule_id => {
        const record = {schedule_id, wins: 0, losses: 0, ties: 0};
        for (let w = 1; w <= weeks; w++) {
          const week = byWeek.get(w), score = week.get(team.owner_id).score;
          let opponent = week.get(schedule_id).opponent;
          // Swap A and B's positions in the fixture, including their head-to-head week.
          if (opponent === team.owner_id) opponent = schedule_id;
          const other = week.get(opponent).score;
          record[score > other ? 'wins' : score < other ? 'losses' : 'ties']++;
        }
        record.difference = record.wins - team.wins;
        return record;
      });
      const actual = scenarios.find(s => s.schedule_id === team.owner_id);
      if (team.games_played !== weeks || ['wins', 'losses', 'ties'].some(k => actual[k] !== team[k])) {
        throw new Error('Own-schedule results do not reproduce the published standings.');
      }
      const ordered = [...scenarios].sort(compareRecords);
      const averageWins = scenarios.reduce((sum, s) => sum + s.wins, 0) / count;
      return {owner_id: team.owner_id, team: team.team, rank: team.rank, actual,
        averageWins, impact: team.wins - averageWins, best: ordered[0], worst: ordered.at(-1), scenarios};
    });
    const difficulty = ids.map(schedule_id => ({schedule_id,
      averageWins: teams.reduce((sum, t) => sum + t.scenarios.find(s => s.schedule_id === schedule_id).wins, 0) / count
    }));
    return {year: season.year, weeks, teamCount: count, teams, difficulty};
  }
  const api = {build, compareRecords};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.SpartyScheduleSwap = api;
})();
