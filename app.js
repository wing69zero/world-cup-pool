const DEFAULT_POOL_CODE = "Fifa2026";
const POOL_CODE_KEY = "worldCup2026PoolCode";
const KNOCKOUT_CODES = new Set(["KO2026", "KOTEST2026"]);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  gateView: $("#gateView"),
  gateForm: $("#gateForm"),
  poolPasscode: $("#poolPasscode"),
  gateMessage: $("#gateMessage"),
  pageTitle: $("#pageTitle"),
  entryAmount: $("#entryAmount"),
  totalPot: $("#totalPot"),
  potSummary: $("#potSummary"),
  syncStatus: $("#syncStatus"),
  refreshData: $("#refreshData"),
  leavePool: $("#leavePool"),
  playerCount: $("#playerCount"),
  matchCount: $("#matchCount"),
  predictionCount: $("#predictionCount"),
  lockedCount: $("#lockedCount"),
  leaderboard: $("#leaderboard"),
  upcomingMatches: $("#upcomingMatches"),
  playerSelect: $("#playerSelect"),
  predictionBoard: $("#predictionBoard"),
  playerForm: $("#playerForm"),
  playerName: $("#playerName"),
  playerList: $("#playerList"),
  matchForm: $("#matchForm"),
  homeTeam: $("#homeTeam"),
  awayTeam: $("#awayTeam"),
  kickoff: $("#kickoff"),
  adminMatches: $("#adminMatches")
};

let db;
let currentPool = null;

let state = {
  entryAmount: 0,
  players: [],
  matches: [],
  predictions: [],
  knockoutSettings: null,
  knockoutMatches: [],
  knockoutPredictions: []
};

bootstrap();

async function bootstrap() {
  setStatus("Connecting");

  try {
    const config = await loadSupabaseConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error("Supabase URL or anon key is missing.");
    }

    if (!window.supabase?.createClient) {
      throw new Error("Supabase browser client could not load.");
    }

    db = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

    const savedCode = localStorage.getItem(POOL_CODE_KEY);
    if (savedCode) {
      try {
        await enterPool(savedCode, { silent: true });
      } catch (error) {
        localStorage.removeItem(POOL_CODE_KEY);
        showGate(`Could not reconnect to the pool. ${friendlyErrorMessage(error)}`);
        setStatus("Error");
        console.error(error);
      }
    } else {
      showGate("Enter your group passcode to begin.");
    }
  } catch (error) {
    showGate(`App setup issue. ${friendlySetupMessage(error)}`);
    setStatus("Setup needed");
    console.error(error);
  }
}

async function loadSupabaseConfig() {
  if (window.SUPABASE_CONFIG?.supabaseUrl && window.SUPABASE_CONFIG?.supabaseAnonKey) {
    return window.SUPABASE_CONFIG;
  }

  await loadLocalConfig();
  if (window.SUPABASE_CONFIG?.supabaseUrl && window.SUPABASE_CONFIG?.supabaseAnonKey) {
    return window.SUPABASE_CONFIG;
  }

  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error("Missing Supabase config endpoint.");
  }

  return response.json();
}

function loadLocalConfig() {
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "config.local.js";
    script.onload = resolve;
    script.onerror = resolve;
    document.head.append(script);
  });
}

function showGate(message = "") {
  document.body.classList.remove("pool-ready");
  elements.gateView.hidden = false;
  elements.gateMessage.textContent = message;
  elements.poolPasscode.value = "";
  elements.poolPasscode.focus();
}

function showApp() {
  document.body.classList.add("pool-ready");
  elements.gateView.hidden = true;
}

async function enterPool(passcode, options = {}) {
  const code = passcode.trim();
  if (!code) return;

  setStatus("Checking");
  elements.gateMessage.textContent = options.silent ? "" : "Checking passcode...";

  const { data, error } = await db
    .from("pools")
    .select("id, name, code, entry_amount")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    localStorage.removeItem(POOL_CODE_KEY);
    showGate("Passcode not found. Check your spelling and try again.");
    setStatus("Locked");
    return;
  }

  currentPool = data;
  localStorage.setItem(POOL_CODE_KEY, code);
  showApp();

  if (isKnockoutPool()) {
    try {
      await ensureKnockoutSetup();
    } catch (error) {
      console.warn("Knockout setup check skipped:", error);
    }
  } else {
    try {
      await ensureGroupStageMatches();
    } catch (error) {
      console.warn("Fixture seed check skipped:", error);
    }
  }

  await loadPoolData();
}

async function loadPoolData(options = {}) {
  if (!currentPool) return;
  if (!options.quiet) setStatus("Syncing");

  if (isKnockoutPool()) {
    await loadKnockoutPoolData();
    return;
  }

  const [poolResult, playersResult, matchesResult, predictionsResult] = await Promise.all([
    db.from("pools").select("id, name, code, entry_amount").eq("id", currentPool.id).single(),
    db.from("players").select("id, name").eq("pool_id", currentPool.id).order("name"),
    db.from("matches").select("*").eq("pool_id", currentPool.id).order("kickoff"),
    db.from("predictions").select("*").eq("pool_id", currentPool.id)
  ]);

  throwIfSupabaseError(poolResult.error);
  throwIfSupabaseError(playersResult.error);
  throwIfSupabaseError(matchesResult.error);
  throwIfSupabaseError(predictionsResult.error);

  currentPool = poolResult.data;
  state = {
    entryAmount: Number(currentPool.entry_amount || 0),
    players: playersResult.data.map((player) => ({
      id: player.id,
      name: player.name
    })),
    matches: matchesResult.data.map(fromMatchRow),
    predictions: predictionsResult.data.map((prediction) => ({
      id: prediction.id,
      playerId: prediction.player_id,
      matchId: prediction.match_id,
      homeScore: prediction.home_score,
      awayScore: prediction.away_score
    }))
  };

  render();
  setStatus("Synced - refresh manually");
}

async function loadKnockoutPoolData() {
  const [poolResult, playersResult, settingsResult, matchesResult, predictionsResult] = await Promise.all([
    db.from("pools").select("id, name, code, entry_amount").eq("id", currentPool.id).single(),
    db.from("players").select("id, name").eq("pool_id", currentPool.id).order("name"),
    db.from("knockout_settings").select("*").eq("pool_id", currentPool.id).maybeSingle(),
    db.from("knockout_matches").select("*").eq("pool_id", currentPool.id).order("slot_no"),
    db.from("knockout_predictions").select("*").eq("pool_id", currentPool.id)
  ]);

  throwIfSupabaseError(poolResult.error);
  throwIfSupabaseError(playersResult.error);
  throwIfSupabaseError(settingsResult.error);
  throwIfSupabaseError(matchesResult.error);
  throwIfSupabaseError(predictionsResult.error);

  currentPool = poolResult.data;
  state = {
    entryAmount: Number(currentPool.entry_amount || 0),
    players: playersResult.data.map((player) => ({
      id: player.id,
      name: player.name
    })),
    matches: [],
    predictions: [],
    knockoutSettings: fromKnockoutSettingsRow(settingsResult.data),
    knockoutMatches: matchesResult.data.map(fromKnockoutMatchRow),
    knockoutPredictions: predictionsResult.data.map(fromKnockoutPredictionRow)
  };

  render();
  setStatus("Synced - refresh manually");
}

function throwIfSupabaseError(error) {
  if (error) throw error;
}

async function ensureGroupStageMatches() {
  const { count, error } = await db
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("pool_id", currentPool.id);

  throwIfSupabaseError(error);
  if (count && count >= 72) return;

  const seedRows = createGroupStageMatches().map((match) => toMatchRow(match, { scopeSeedId: true }));
  const { error: upsertError } = await db
    .from("matches")
    .upsert(seedRows, { onConflict: "id" });

  throwIfSupabaseError(upsertError);
}

async function ensureKnockoutSetup() {
  const defaultSettings = {
    pool_id: currentPool.id,
    lock_at: "2026-07-04T00:00:00Z",
    goals_pot: 125,
    bracket_pot: 125
  };

  const { error: settingsError } = await db
    .from("knockout_settings")
    .upsert(defaultSettings, { onConflict: "pool_id", ignoreDuplicates: true });

  throwIfSupabaseError(settingsError);

  const { count, error } = await db
    .from("knockout_matches")
    .select("id", { count: "exact", head: true })
    .eq("pool_id", currentPool.id);

  throwIfSupabaseError(error);
  if (count && count >= 16) return;

  const { error: matchError } = await db
    .from("knockout_matches")
    .upsert(createKnockoutMatches().map(toKnockoutMatchRow), { onConflict: "id" });

  throwIfSupabaseError(matchError);
}

function createKnockoutMatches() {
  const rows = [
    [1, "R16", "Round of 16 - Match 1", "R16 Team A1", "R16 Team B1"],
    [2, "R16", "Round of 16 - Match 2", "R16 Team A2", "R16 Team B2"],
    [3, "R16", "Round of 16 - Match 3", "R16 Team A3", "R16 Team B3"],
    [4, "R16", "Round of 16 - Match 4", "R16 Team A4", "R16 Team B4"],
    [5, "R16", "Round of 16 - Match 5", "R16 Team A5", "R16 Team B5"],
    [6, "R16", "Round of 16 - Match 6", "R16 Team A6", "R16 Team B6"],
    [7, "R16", "Round of 16 - Match 7", "R16 Team A7", "R16 Team B7"],
    [8, "R16", "Round of 16 - Match 8", "R16 Team A8", "R16 Team B8"],
    [9, "QF", "Quarter-final 1", "QF Team A1", "QF Team B1"],
    [10, "QF", "Quarter-final 2", "QF Team A2", "QF Team B2"],
    [11, "QF", "Quarter-final 3", "QF Team A3", "QF Team B3"],
    [12, "QF", "Quarter-final 4", "QF Team A4", "QF Team B4"],
    [13, "SF", "Semi-final 1", "SF Team A1", "SF Team B1"],
    [14, "SF", "Semi-final 2", "SF Team A2", "SF Team B2"],
    [15, "3P", "Third-place match", "Third-place Team A", "Third-place Team B"],
    [16, "Final", "Final", "Finalist A", "Finalist B"]
  ];

  return rows.map(([slotNo, stage, label, teamA, teamB]) => ({
    id: `${currentPool.code.toLowerCase()}-ko-${slotNo}`,
    slotNo,
    stage,
    label,
    kickoff: new Date(Date.UTC(2026, 6, 4, (slotNo - 1) * 4)).toISOString(),
    teamA,
    teamB,
    actualTotalGoals: null,
    winner: null
  }));
}

function render() {
  if (isKnockoutPool()) {
    renderKnockout();
    return;
  }

  elements.matchForm.style.display = "";
  state.matches.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  elements.entryAmount.value = state.entryAmount ?? 0;
  renderStats();
  renderPot();
  renderLeaderboard();
  renderUpcomingMatches();
  renderPlayerSelect();
  renderPlayerList();
  renderAdminMatches();
  renderPredictions();
}

function renderKnockout() {
  elements.matchForm.style.display = "none";
  elements.entryAmount.value = state.entryAmount ?? 25;
  elements.pageTitle.textContent = "Knockout Pools";
  renderKnockoutStats();
  renderKnockoutPot();
  renderKnockoutDashboard();
  renderPlayerSelect();
  renderPlayerList();
  renderKnockoutAdmin();
  renderKnockoutPredictions();
}

function renderKnockoutStats() {
  const filledGoals = state.knockoutPredictions.filter((prediction) => prediction.goalsPrediction !== null).length;
  const filledWinners = state.knockoutPredictions.filter((prediction) => prediction.winnerPrediction).length;
  elements.playerCount.textContent = state.players.length;
  elements.matchCount.textContent = state.knockoutMatches.length;
  elements.predictionCount.textContent = filledGoals + filledWinners;
  elements.lockedCount.textContent = isKnockoutLocked() ? state.knockoutMatches.length : 0;
}

function renderKnockoutPot() {
  const total = Number(state.knockoutSettings?.goalsPot || 0) + Number(state.knockoutSettings?.bracketPot || 0);
  elements.totalPot.textContent = `$${total.toLocaleString()}`;
  elements.potSummary.textContent = `Goals $${Number(state.knockoutSettings?.goalsPot || 0).toLocaleString()} + Bracket $${Number(state.knockoutSettings?.bracketPot || 0).toLocaleString()}`;
}

function renderKnockoutDashboard() {
  const goalsRows = getKnockoutLeaderboard("goals");
  const bracketRows = getKnockoutLeaderboard("bracket");
  const lockText = state.knockoutSettings?.lockAt ? formatDate(state.knockoutSettings.lockAt) : "Not set";

  elements.leaderboard.innerHTML = `
    <div class="leaderboard-section">
      <h4>Goals Pool</h4>
      ${leaderboardRowsMarkup(goalsRows)}
    </div>
    <div class="leaderboard-section">
      <h4>Bracket Pool</h4>
      ${leaderboardRowsMarkup(bracketRows)}
    </div>
  `;

  elements.upcomingMatches.innerHTML = `
    <article class="match-row">
      <div class="match-meta">
        <div>
          <div class="teams">Global prediction lock</div>
          <div class="time">${escapeHtml(lockText)}</div>
        </div>
        <span class="lock ${isKnockoutLocked() ? "closed" : ""}">${isKnockoutLocked() ? "Locked" : "Open"}</span>
      </div>
    </article>
    <article class="match-row">
      <div class="time">Goals Pool: exact total goals = 3 pts, off by 1 = 1 pt. Penalty shootout goals do not count.</div>
      <div class="time">Bracket Pool: R16 2 pts, QF 3 pts, SF 5 pts, third-place 3 pts, final 8 pts. Penalty winners count.</div>
    </article>
  `;
}

function leaderboardRowsMarkup(rows) {
  if (!rows.length) {
    return `<div class="empty-state"><strong>No players yet</strong><p>Add players in Setup.</p></div>`;
  }

  return rows
    .map((player, index) => `
      <div class="leader-row">
        <span class="rank">${index + 1}</span>
        <strong>${escapeHtml(player.name)}</strong>
        <span class="score">${player.points} pt${player.points === 1 ? "" : "s"}</span>
      </div>
    `)
    .join("");
}

function getKnockoutLeaderboard(type) {
  return state.players
    .map((player) => ({
      ...player,
      points: state.knockoutPredictions
        .filter((prediction) => prediction.playerId === player.id)
        .reduce((sum, prediction) => sum + knockoutPointsForPrediction(prediction, type), 0)
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

function renderStats() {
  elements.playerCount.textContent = state.players.length;
  elements.matchCount.textContent = state.matches.length;
  elements.predictionCount.textContent = state.predictions.length;
  elements.lockedCount.textContent = state.matches.filter(isLocked).length;
}

function renderPot() {
  const amount = Number(state.entryAmount || 0);
  const total = amount * state.players.length;
  elements.totalPot.textContent = `$${total.toLocaleString()}`;
  elements.potSummary.textContent = `${state.players.length} players x $${amount.toLocaleString()} entry amount`;
}

function renderLeaderboard() {
  if (!state.players.length) {
    renderEmpty(elements.leaderboard, "No players yet", "Add friends in Setup to start the pool.");
    return;
  }

  const rows = state.players
    .map((player) => ({
      ...player,
      points: state.predictions
        .filter((prediction) => prediction.playerId === player.id)
        .reduce((sum, prediction) => sum + pointsForPrediction(prediction), 0)
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  elements.leaderboard.innerHTML = rows
    .map((player, index) => `
      <div class="leader-row">
        <span class="rank">${index + 1}</span>
        <strong>${escapeHtml(player.name)}</strong>
        <span class="score">${player.points} pt${player.points === 1 ? "" : "s"}</span>
      </div>
    `)
    .join("");
}

function renderUpcomingMatches() {
  const matches = state.matches.filter((match) => !isLocked(match)).slice(0, 5);
  if (!matches.length) {
    renderEmpty(elements.upcomingMatches, "No open matches", "All visible matches are locked or completed.");
    return;
  }

  elements.upcomingMatches.innerHTML = matches.map(matchSummaryMarkup).join("");
}

function renderPlayerSelect() {
  if (!state.players.length) {
    elements.playerSelect.innerHTML = "<option>Add players first</option>";
    elements.playerSelect.disabled = true;
    return;
  }

  const previous = elements.playerSelect.value;
  elements.playerSelect.disabled = false;
  elements.playerSelect.innerHTML = state.players
    .map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`)
    .join("");

  if (state.players.some((player) => player.id === previous)) {
    elements.playerSelect.value = previous;
  }
}

function renderPlayerList() {
  if (!state.players.length) {
    renderEmpty(elements.playerList, "No players yet", "Add each friend once.");
    return;
  }

  elements.playerList.innerHTML = state.players
    .map((player) => `
      <div class="player-pill">
        <strong>${escapeHtml(player.name)}</strong>
        <button class="icon-button" data-remove-player="${player.id}" title="Remove ${escapeHtml(player.name)}" type="button">x</button>
      </div>
    `)
    .join("");
}

function renderAdminMatches() {
  if (!state.matches.length) {
    renderEmpty(elements.adminMatches);
    return;
  }

  elements.adminMatches.innerHTML = state.matches
    .map((match) => `
      <article class="match-row">
        ${matchSummaryMarkup(match)}
        <form class="score-form" data-score-match="${match.id}">
          <input aria-label="${escapeHtml(match.homeTeam)} final score" min="0" type="number" value="${match.homeScore ?? ""}" placeholder="H">
          <input aria-label="${escapeHtml(match.awayTeam)} final score" min="0" type="number" value="${match.awayScore ?? ""}" placeholder="A">
          <button type="submit">Save Result</button>
        </form>
        <button class="secondary-button" data-remove-match="${match.id}" type="button">Remove Match</button>
      </article>
    `)
    .join("");
}

function renderKnockoutPredictions() {
  const selectedPlayerId = elements.playerSelect.value || state.players[0]?.id;

  if (!state.players.length || !state.knockoutMatches.length) {
    renderEmpty(elements.predictionBoard, "Knockout predictions need players and matches", "Add players in Setup first.");
    return;
  }

  const locked = isKnockoutLocked();
  elements.predictionBoard.innerHTML = state.knockoutMatches
    .map((match) => {
      const prediction = getKnockoutPrediction(selectedPlayerId, match.id);
      const winnerOptions = [match.teamA, match.teamB]
        .filter(Boolean)
        .map((team) => `<option value="${escapeHtml(team)}" ${prediction?.winnerPrediction === team ? "selected" : ""}>${escapeHtml(team)}</option>`)
        .join("");

      return `
        <article class="prediction-row">
          <div class="prediction-meta">
            <div>
              <div class="teams">${escapeHtml(match.label)}: ${escapeHtml(match.teamA)} vs ${escapeHtml(match.teamB)}</div>
              <div class="time">${escapeHtml(match.stage)} - ${formatDate(match.kickoff)}</div>
            </div>
            <div>
              <span class="lock ${locked ? "closed" : ""}">${locked ? "Locked" : "Open"}</span>
              <span class="points"> - Goals ${knockoutPointsForPrediction(prediction, "goals")} pts / Bracket ${knockoutPointsForPrediction(prediction, "bracket")} pts</span>
            </div>
          </div>
          <form class="knockout-prediction-form" data-ko-prediction-match="${match.id}">
            <label>
              Total goals
              <input min="0" type="number" value="${prediction?.goalsPrediction ?? ""}" placeholder="0" ${locked ? "disabled" : ""}>
            </label>
            <label>
              Winner
              <select ${locked ? "disabled" : ""}>
                <option value="">Pick winner</option>
                ${winnerOptions}
              </select>
            </label>
            <button type="submit" ${locked ? "disabled" : ""}>Save Picks</button>
          </form>
        </article>
      `;
    })
    .join("");
}

function renderKnockoutAdmin() {
  const lockLocal = state.knockoutSettings?.lockAt ? toDateTimeLocal(state.knockoutSettings.lockAt) : "";

  elements.adminMatches.innerHTML = `
    <article class="match-row">
      <form class="knockout-settings-form" data-ko-settings>
        <label>
          Global lock time
          <input type="datetime-local" value="${lockLocal}" required>
        </label>
        <label>
          Goals pot
          <input min="0" type="number" value="${state.knockoutSettings?.goalsPot ?? 125}" required>
        </label>
        <label>
          Bracket pot
          <input min="0" type="number" value="${state.knockoutSettings?.bracketPot ?? 125}" required>
        </label>
        <button type="submit">Save Knockout Settings</button>
      </form>
    </article>
    ${state.knockoutMatches.map(knockoutAdminMatchMarkup).join("")}
  `;
}

function knockoutAdminMatchMarkup(match) {
  return `
    <article class="match-row">
      <form class="knockout-match-form" data-ko-match="${match.id}">
        <div class="prediction-meta">
          <div>
            <div class="teams">${escapeHtml(match.label)}</div>
            <div class="time">${escapeHtml(match.stage)} - slot ${match.slotNo}</div>
          </div>
        </div>
        <input aria-label="Match label" value="${escapeHtml(match.label)}" required>
        <input aria-label="Team A" value="${escapeHtml(match.teamA)}" required>
        <input aria-label="Team B" value="${escapeHtml(match.teamB)}" required>
        <input aria-label="Kickoff" type="datetime-local" value="${toDateTimeLocal(match.kickoff)}" required>
        <input aria-label="Actual total goals" min="0" type="number" value="${match.actualTotalGoals ?? ""}" placeholder="Actual total goals">
        <select aria-label="Actual winner">
          <option value="">Winner not set</option>
          <option value="${escapeHtml(match.teamA)}" ${match.winner === match.teamA ? "selected" : ""}>${escapeHtml(match.teamA)}</option>
          <option value="${escapeHtml(match.teamB)}" ${match.winner === match.teamB ? "selected" : ""}>${escapeHtml(match.teamB)}</option>
        </select>
        <button type="submit">Save Match</button>
      </form>
    </article>
  `;
}

function renderPredictions() {
  const selectedPlayerId = elements.playerSelect.value || state.players[0]?.id;

  if (!state.players.length || !state.matches.length) {
    renderEmpty(elements.predictionBoard, "Predictions need players and matches", "Add players in Setup first.");
    return;
  }

  elements.predictionBoard.innerHTML = state.matches
    .map((match) => {
      const prediction = getPrediction(selectedPlayerId, match.id);
      const locked = isLocked(match);
      const points = prediction ? pointsForPrediction(prediction) : 0;
      const isResultDone = hasResult(match);

      return `
        <article class="prediction-row">
          <div class="prediction-meta">
            <div>
              <div class="teams">${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}</div>
              <div class="time">${formatDate(match.kickoff)}</div>
            </div>
            <div>
              <span class="lock ${locked ? "closed" : ""}">${locked ? "Locked" : "Open"}</span>
              <span class="points ${points ? "hit" : ""}"> - ${isResultDone ? `${points} pt${points === 1 ? "" : "s"}` : "awaiting result"}</span>
            </div>
          </div>
          <form class="prediction-form" data-prediction-match="${match.id}">
            <input aria-label="${escapeHtml(match.homeTeam)} predicted score" min="0" type="number" value="${prediction?.homeScore ?? ""}" placeholder="H" ${locked ? "disabled" : ""}>
            <input aria-label="${escapeHtml(match.awayTeam)} predicted score" min="0" type="number" value="${prediction?.awayScore ?? ""}" placeholder="A" ${locked ? "disabled" : ""}>
            <button type="submit" ${locked ? "disabled" : ""}>Save Pick</button>
          </form>
        </article>
      `;
    })
    .join("");
}

function matchSummaryMarkup(match) {
  const resultText = hasResult(match) ? `${match.homeScore}-${match.awayScore}` : "No result";
  const context = [match.matchNo ? `#${match.matchNo}` : null, match.groupName, match.venue].filter(Boolean).join(" - ");
  return `
    <div class="match-meta">
      <div>
        <div class="teams">${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}</div>
        <div class="time">${escapeHtml(context)}</div>
        <div class="time">${formatDate(match.kickoff)}</div>
      </div>
      <div>
        <span class="lock ${isLocked(match) ? "closed" : ""}">${isLocked(match) ? "Locked" : "Open"}</span>
        <span class="result ${hasResult(match) ? "done" : ""}"> - ${resultText}</span>
      </div>
    </div>
  `;
}

function pointsForPrediction(prediction) {
  const match = state.matches.find((item) => item.id === prediction.matchId);
  if (!match || !hasResult(match)) return 0;
  return Number(prediction.homeScore) === Number(match.homeScore) &&
    Number(prediction.awayScore) === Number(match.awayScore)
    ? 1
    : 0;
}

function getPrediction(playerId, matchId) {
  return state.predictions.find((prediction) => prediction.playerId === playerId && prediction.matchId === matchId);
}

function getKnockoutPrediction(playerId, matchId) {
  return state.knockoutPredictions.find((prediction) => prediction.playerId === playerId && prediction.matchId === matchId);
}

function isLocked(match) {
  return new Date(match.kickoff) <= new Date();
}

function hasResult(match) {
  return match.homeScore !== null && match.awayScore !== null && match.homeScore !== "" && match.awayScore !== "";
}

function isKnockoutPool() {
  return KNOCKOUT_CODES.has(currentPool?.code);
}

function isKnockoutLocked() {
  return Boolean(state.knockoutSettings?.lockAt) && new Date(state.knockoutSettings.lockAt) <= new Date();
}

function knockoutPointsForPrediction(prediction, type) {
  if (!prediction) return 0;
  const match = state.knockoutMatches.find((item) => item.id === prediction.matchId);
  if (!match) return 0;

  if (type === "goals") {
    if (prediction.goalsPrediction === null || match.actualTotalGoals === null) return 0;
    const gap = Math.abs(Number(prediction.goalsPrediction) - Number(match.actualTotalGoals));
    if (gap === 0) return 3;
    if (gap === 1) return 1;
    return 0;
  }

  if (!prediction.winnerPrediction || !match.winner) return 0;
  return prediction.winnerPrediction === match.winner ? knockoutStagePoints(match.stage) : 0;
}

function knockoutStagePoints(stage) {
  return {
    R16: 2,
    QF: 3,
    SF: 5,
    "3P": 3,
    Final: 8
  }[stage] || 0;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

function renderEmpty(target, title = "Nothing here yet", body = "Add players and matches in Setup to get the pool moving.") {
  target.innerHTML = `
    <div class="empty-state">
      <strong>${title}</strong>
      <p>${body}</p>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setActiveTab(tabName) {
  $$(".nav-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#${tabName}View`).classList.add("active");
  elements.pageTitle.textContent = tabName === "admin" ? "Setup" : tabName.charAt(0).toUpperCase() + tabName.slice(1);
}

function setStatus(text) {
  elements.syncStatus.textContent = text;
}

function toMatchRow(match, options = {}) {
  return {
    id: options.scopeSeedId ? poolScopedMatchId(match.matchNo) : match.id,
    pool_id: currentPool.id,
    match_no: match.matchNo,
    group_name: match.groupName,
    home_team: match.homeTeam,
    away_team: match.awayTeam,
    kickoff: match.kickoff,
    venue: match.venue,
    source: match.source,
    home_score: match.homeScore,
    away_score: match.awayScore
  };
}

function poolScopedMatchId(matchNo) {
  const code = currentPool?.code || DEFAULT_POOL_CODE;
  return `${code.toLowerCase()}-wc26-${matchNo}`;
}

function fromMatchRow(row) {
  return {
    id: row.id,
    matchNo: row.match_no,
    groupName: row.group_name,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    kickoff: row.kickoff,
    venue: row.venue,
    source: row.source,
    homeScore: row.home_score,
    awayScore: row.away_score
  };
}

function fromKnockoutSettingsRow(row) {
  if (!row) return null;
  return {
    lockAt: row.lock_at,
    goalsPot: Number(row.goals_pot || 0),
    bracketPot: Number(row.bracket_pot || 0)
  };
}

function toKnockoutMatchRow(match) {
  return {
    id: match.id,
    pool_id: currentPool.id,
    slot_no: match.slotNo,
    stage: match.stage,
    label: match.label,
    kickoff: match.kickoff,
    team_a: match.teamA,
    team_b: match.teamB,
    actual_total_goals: match.actualTotalGoals,
    winner: match.winner
  };
}

function fromKnockoutMatchRow(row) {
  return {
    id: row.id,
    slotNo: row.slot_no,
    stage: row.stage,
    label: row.label,
    kickoff: row.kickoff,
    teamA: row.team_a,
    teamB: row.team_b,
    actualTotalGoals: row.actual_total_goals,
    winner: row.winner
  };
}

function fromKnockoutPredictionRow(row) {
  return {
    id: row.id,
    playerId: row.player_id,
    matchId: row.match_id,
    goalsPrediction: row.goals_prediction,
    winnerPrediction: row.winner_prediction
  };
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createGroupStageMatches() {
  const rows = [
    [1, "Group A", "Mexico", "South Africa", "2026-06-11T19:00:00Z", "Estadio Azteca, Mexico City"],
    [2, "Group A", "Korea Republic", "Czechia", "2026-06-12T02:00:00Z", "Estadio Akron, Guadalajara"],
    [3, "Group B", "Canada", "Bosnia and Herzegovina", "2026-06-12T19:00:00Z", "BMO Field, Toronto"],
    [4, "Group D", "United States", "Paraguay", "2026-06-13T01:00:00Z", "SoFi Stadium, Los Angeles"],
    [5, "Group C", "Haiti", "Scotland", "2026-06-14T01:00:00Z", "Gillette Stadium, Boston"],
    [6, "Group D", "Australia", "Turkey", "2026-06-14T04:00:00Z", "BC Place, Vancouver"],
    [7, "Group C", "Brazil", "Morocco", "2026-06-13T22:00:00Z", "MetLife Stadium, New York/New Jersey"],
    [8, "Group B", "Qatar", "Switzerland", "2026-06-13T19:00:00Z", "Levi's Stadium, San Francisco Bay Area"],
    [9, "Group E", "Cote d'Ivoire", "Ecuador", "2026-06-14T23:00:00Z", "Lincoln Financial Field, Philadelphia"],
    [10, "Group E", "Germany", "Curacao", "2026-06-14T17:00:00Z", "NRG Stadium, Houston"],
    [11, "Group F", "Netherlands", "Japan", "2026-06-14T20:00:00Z", "AT&T Stadium, Dallas"],
    [12, "Group F", "Sweden", "Tunisia", "2026-06-15T02:00:00Z", "Estadio BBVA, Monterrey"],
    [13, "Group H", "Saudi Arabia", "Uruguay", "2026-06-15T22:00:00Z", "Hard Rock Stadium, Miami"],
    [14, "Group H", "Spain", "Cabo Verde", "2026-06-15T16:00:00Z", "Mercedes-Benz Stadium, Atlanta"],
    [15, "Group G", "Iran", "New Zealand", "2026-06-16T01:00:00Z", "SoFi Stadium, Los Angeles"],
    [16, "Group G", "Belgium", "Egypt", "2026-06-15T19:00:00Z", "Lumen Field, Seattle"],
    [17, "Group I", "France", "Senegal", "2026-06-16T19:00:00Z", "MetLife Stadium, New York/New Jersey"],
    [18, "Group I", "Iraq", "Norway", "2026-06-16T22:00:00Z", "Gillette Stadium, Boston"],
    [19, "Group J", "Argentina", "Algeria", "2026-06-17T01:00:00Z", "Arrowhead Stadium, Kansas City"],
    [20, "Group J", "Austria", "Jordan", "2026-06-17T04:00:00Z", "Levi's Stadium, San Francisco Bay Area"],
    [21, "Group L", "Ghana", "Panama", "2026-06-17T23:00:00Z", "BMO Field, Toronto"],
    [22, "Group L", "England", "Croatia", "2026-06-17T20:00:00Z", "AT&T Stadium, Dallas"],
    [23, "Group K", "Portugal", "Congo DR", "2026-06-17T17:00:00Z", "NRG Stadium, Houston"],
    [24, "Group K", "Uzbekistan", "Colombia", "2026-06-18T02:00:00Z", "Estadio Azteca, Mexico City"],
    [25, "Group A", "Czechia", "South Africa", "2026-06-18T16:00:00Z", "Mercedes-Benz Stadium, Atlanta"],
    [26, "Group B", "Switzerland", "Bosnia and Herzegovina", "2026-06-18T19:00:00Z", "SoFi Stadium, Los Angeles"],
    [27, "Group B", "Canada", "Qatar", "2026-06-18T22:00:00Z", "BC Place, Vancouver"],
    [28, "Group A", "Mexico", "Korea Republic", "2026-06-19T01:00:00Z", "Estadio Akron, Guadalajara"],
    [29, "Group C", "Brazil", "Haiti", "2026-06-20T00:30:00Z", "Lincoln Financial Field, Philadelphia"],
    [30, "Group C", "Scotland", "Morocco", "2026-06-19T22:00:00Z", "Gillette Stadium, Boston"],
    [31, "Group D", "Turkey", "Paraguay", "2026-06-20T03:00:00Z", "Levi's Stadium, San Francisco Bay Area"],
    [32, "Group D", "United States", "Australia", "2026-06-19T19:00:00Z", "Lumen Field, Seattle"],
    [33, "Group E", "Germany", "Cote d'Ivoire", "2026-06-20T20:00:00Z", "BMO Field, Toronto"],
    [34, "Group E", "Ecuador", "Curacao", "2026-06-21T00:00:00Z", "Arrowhead Stadium, Kansas City"],
    [35, "Group F", "Netherlands", "Sweden", "2026-06-20T17:00:00Z", "NRG Stadium, Houston"],
    [36, "Group F", "Tunisia", "Japan", "2026-06-21T04:00:00Z", "Estadio BBVA, Monterrey"],
    [37, "Group H", "Uruguay", "Cabo Verde", "2026-06-21T22:00:00Z", "Hard Rock Stadium, Miami"],
    [38, "Group H", "Spain", "Saudi Arabia", "2026-06-21T16:00:00Z", "Mercedes-Benz Stadium, Atlanta"],
    [39, "Group G", "Belgium", "Iran", "2026-06-21T19:00:00Z", "SoFi Stadium, Los Angeles"],
    [40, "Group G", "New Zealand", "Egypt", "2026-06-22T01:00:00Z", "BC Place, Vancouver"],
    [41, "Group I", "Norway", "Senegal", "2026-06-23T00:00:00Z", "MetLife Stadium, New York/New Jersey"],
    [42, "Group I", "France", "Iraq", "2026-06-22T21:00:00Z", "Lincoln Financial Field, Philadelphia"],
    [43, "Group J", "Argentina", "Austria", "2026-06-22T17:00:00Z", "AT&T Stadium, Dallas"],
    [44, "Group J", "Jordan", "Algeria", "2026-06-23T03:00:00Z", "Levi's Stadium, San Francisco Bay Area"],
    [45, "Group L", "England", "Ghana", "2026-06-23T20:00:00Z", "Gillette Stadium, Boston"],
    [46, "Group L", "Panama", "Croatia", "2026-06-23T23:00:00Z", "BMO Field, Toronto"],
    [47, "Group K", "Portugal", "Uzbekistan", "2026-06-23T17:00:00Z", "NRG Stadium, Houston"],
    [48, "Group K", "Colombia", "Congo DR", "2026-06-24T02:00:00Z", "Estadio Akron, Guadalajara"],
    [49, "Group C", "Scotland", "Brazil", "2026-06-24T22:00:00Z", "Hard Rock Stadium, Miami"],
    [50, "Group C", "Morocco", "Haiti", "2026-06-24T22:00:00Z", "Mercedes-Benz Stadium, Atlanta"],
    [51, "Group B", "Switzerland", "Canada", "2026-06-24T19:00:00Z", "BC Place, Vancouver"],
    [52, "Group B", "Bosnia and Herzegovina", "Qatar", "2026-06-24T19:00:00Z", "Lumen Field, Seattle"],
    [53, "Group A", "Czechia", "Mexico", "2026-06-25T01:00:00Z", "Estadio Azteca, Mexico City"],
    [54, "Group A", "South Africa", "Korea Republic", "2026-06-25T01:00:00Z", "Estadio BBVA, Monterrey"],
    [55, "Group E", "Curacao", "Cote d'Ivoire", "2026-06-25T20:00:00Z", "Lincoln Financial Field, Philadelphia"],
    [56, "Group E", "Ecuador", "Germany", "2026-06-25T20:00:00Z", "MetLife Stadium, New York/New Jersey"],
    [57, "Group F", "Japan", "Sweden", "2026-06-25T23:00:00Z", "AT&T Stadium, Dallas"],
    [58, "Group F", "Tunisia", "Netherlands", "2026-06-25T23:00:00Z", "Arrowhead Stadium, Kansas City"],
    [59, "Group D", "Turkey", "United States", "2026-06-26T02:00:00Z", "SoFi Stadium, Los Angeles"],
    [60, "Group D", "Paraguay", "Australia", "2026-06-26T02:00:00Z", "Levi's Stadium, San Francisco Bay Area"],
    [61, "Group I", "Norway", "France", "2026-06-26T19:00:00Z", "Gillette Stadium, Boston"],
    [62, "Group I", "Senegal", "Iraq", "2026-06-26T19:00:00Z", "BMO Field, Toronto"],
    [63, "Group G", "Egypt", "Iran", "2026-06-27T03:00:00Z", "Lumen Field, Seattle"],
    [64, "Group G", "New Zealand", "Belgium", "2026-06-27T03:00:00Z", "BC Place, Vancouver"],
    [65, "Group H", "Cabo Verde", "Saudi Arabia", "2026-06-27T00:00:00Z", "NRG Stadium, Houston"],
    [66, "Group H", "Uruguay", "Spain", "2026-06-27T00:00:00Z", "Estadio Akron, Guadalajara"],
    [67, "Group L", "Panama", "England", "2026-06-27T21:00:00Z", "MetLife Stadium, New York/New Jersey"],
    [68, "Group L", "Croatia", "Ghana", "2026-06-27T21:00:00Z", "Lincoln Financial Field, Philadelphia"],
    [69, "Group J", "Algeria", "Austria", "2026-06-28T02:00:00Z", "Arrowhead Stadium, Kansas City"],
    [70, "Group J", "Jordan", "Argentina", "2026-06-28T02:00:00Z", "AT&T Stadium, Dallas"],
    [71, "Group K", "Colombia", "Portugal", "2026-06-27T23:30:00Z", "Hard Rock Stadium, Miami"],
    [72, "Group K", "Congo DR", "Uzbekistan", "2026-06-27T23:30:00Z", "Mercedes-Benz Stadium, Atlanta"]
  ];

  return rows.map(([matchNo, groupName, homeTeam, awayTeam, kickoff, venue]) => ({
    id: poolScopedMatchId(matchNo),
    matchNo,
    groupName,
    homeTeam,
    awayTeam,
    kickoff,
    venue,
    source: "FIFA World Cup 2026 official schedule",
    homeScore: null,
    awayScore: null
  }));
}

$$(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
});

elements.gateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await enterPool(elements.poolPasscode.value);
  } catch (error) {
    showGate(`Could not connect to the pool. ${friendlyErrorMessage(error)}`);
    setStatus("Error");
    console.error(error);
  }
});

function friendlyErrorMessage(error) {
  if (!navigator.onLine) {
    return "Your device appears to be offline.";
  }

  const message = String(error?.message || "");
  if (message.includes("Failed to fetch") || message.includes("fetch")) {
    return "Please check your internet connection and try again.";
  }

  if (error?.code) {
    return `Supabase returned ${error.code}. Please try again shortly.`;
  }

  return "Please try again shortly.";
}

function friendlySetupMessage(error) {
  const message = String(error?.message || "");

  if (message.includes("URL") || message.includes("anon key")) {
    return "Supabase settings are missing in Vercel.";
  }

  if (message.includes("browser client")) {
    return "The Supabase browser library did not load. Please refresh, or try another browser/network.";
  }

  return friendlyErrorMessage(error);
}

elements.entryAmount.addEventListener("change", async (event) => {
  if (!currentPool) return;
  const nextAmount = Number(event.target.value || 0);
  setStatus("Saving");

  const { error } = await db
    .from("pools")
    .update({ entry_amount: nextAmount })
    .eq("id", currentPool.id);

  throwIfSupabaseError(error);
  await loadPoolData();
});

elements.refreshData.addEventListener("click", () => {
  loadPoolData().catch((error) => {
    setStatus("Refresh failed");
    console.error(error);
  });
});

elements.leavePool.addEventListener("click", () => {
  currentPool = null;
  localStorage.removeItem(POOL_CODE_KEY);
  showGate("You have left the pool on this device.");
  setStatus("Locked");
});

elements.playerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = elements.playerName.value.trim();
  if (!name || !currentPool) return;

  setStatus("Saving");
  const { error } = await db
    .from("players")
    .insert({ pool_id: currentPool.id, name });

  throwIfSupabaseError(error);
  elements.playerName.value = "";
  await loadPoolData();
});

elements.matchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentPool) return;

  const match = {
    id: `custom-${crypto.randomUUID()}`,
    pool_id: currentPool.id,
    match_no: null,
    group_name: "Custom",
    home_team: elements.homeTeam.value.trim(),
    away_team: elements.awayTeam.value.trim(),
    kickoff: new Date(elements.kickoff.value).toISOString(),
    venue: "Custom fixture",
    source: "Manual",
    home_score: null,
    away_score: null
  };

  setStatus("Saving");
  const { error } = await db.from("matches").insert(match);
  throwIfSupabaseError(error);
  elements.matchForm.reset();
  await loadPoolData();
});

elements.playerSelect.addEventListener("change", renderPredictions);

document.addEventListener("click", async (event) => {
  const playerId = event.target.dataset.removePlayer;
  const matchId = event.target.dataset.removeMatch;

  try {
    if (playerId) {
      setStatus("Saving");
      const { error } = await db.from("players").delete().eq("id", playerId).eq("pool_id", currentPool.id);
      throwIfSupabaseError(error);
      await loadPoolData();
    }

    if (matchId) {
      setStatus("Saving");
      const { error } = await db.from("matches").delete().eq("id", matchId).eq("pool_id", currentPool.id);
      throwIfSupabaseError(error);
      await loadPoolData();
    }
  } catch (error) {
    setStatus("Save failed");
    console.error(error);
  }
});

document.addEventListener("submit", async (event) => {
  const knockoutSettings = event.target.dataset.koSettings !== undefined;
  const knockoutMatchId = event.target.dataset.koMatch;
  const knockoutPredictionMatchId = event.target.dataset.koPredictionMatch;
  const scoreMatchId = event.target.dataset.scoreMatch;
  const predictionMatchId = event.target.dataset.predictionMatch;

  try {
    if (knockoutSettings) {
      event.preventDefault();
      const [lockInput, goalsPotInput, bracketPotInput] = event.target.querySelectorAll("input");
      setStatus("Saving");

      const { error } = await db
        .from("knockout_settings")
        .upsert({
          pool_id: currentPool.id,
          lock_at: new Date(lockInput.value).toISOString(),
          goals_pot: Number(goalsPotInput.value || 0),
          bracket_pot: Number(bracketPotInput.value || 0)
        }, { onConflict: "pool_id" });

      throwIfSupabaseError(error);
      await loadPoolData();
    }

    if (knockoutMatchId) {
      event.preventDefault();
      const inputs = event.target.querySelectorAll("input");
      const winnerSelect = event.target.querySelector("select");
      const match = state.knockoutMatches.find((item) => item.id === knockoutMatchId);
      setStatus("Saving");

      const { error } = await db
        .from("knockout_matches")
        .update({
          label: inputs[0].value.trim(),
          team_a: inputs[1].value.trim(),
          team_b: inputs[2].value.trim(),
          kickoff: new Date(inputs[3].value).toISOString(),
          actual_total_goals: inputs[4].value === "" ? null : Number(inputs[4].value),
          winner: winnerSelect.value || null
        })
        .eq("id", knockoutMatchId)
        .eq("pool_id", currentPool.id);

      throwIfSupabaseError(error);

      if (match && winnerSelect.value && ![inputs[1].value.trim(), inputs[2].value.trim()].includes(winnerSelect.value)) {
        console.warn("Saved winner did not match the edited team names.");
      }

      await loadPoolData();
    }

    if (knockoutPredictionMatchId) {
      event.preventDefault();
      if (isKnockoutLocked()) return;

      const [goalsInput] = event.target.querySelectorAll("input");
      const winnerSelect = event.target.querySelector("select");
      const playerId = elements.playerSelect.value;
      setStatus("Saving");

      const { error } = await db.from("knockout_predictions").upsert({
        pool_id: currentPool.id,
        player_id: playerId,
        match_id: knockoutPredictionMatchId,
        goals_prediction: goalsInput.value === "" ? null : Number(goalsInput.value),
        winner_prediction: winnerSelect.value || null
      }, { onConflict: "pool_id,player_id,match_id" });

      throwIfSupabaseError(error);
      await loadPoolData();
    }

    if (scoreMatchId) {
      event.preventDefault();
      const [homeInput, awayInput] = event.target.querySelectorAll("input");
      setStatus("Saving");

      const { error } = await db
        .from("matches")
        .update({
          home_score: homeInput.value === "" ? null : Number(homeInput.value),
          away_score: awayInput.value === "" ? null : Number(awayInput.value)
        })
        .eq("id", scoreMatchId)
        .eq("pool_id", currentPool.id);

      throwIfSupabaseError(error);
      await loadPoolData();
    }

    if (predictionMatchId) {
      event.preventDefault();
      const match = state.matches.find((item) => item.id === predictionMatchId);
      if (isLocked(match)) return;

      const [homeInput, awayInput] = event.target.querySelectorAll("input");
      const playerId = elements.playerSelect.value;
      setStatus("Saving");

      const { error } = await db.from("predictions").upsert({
        pool_id: currentPool.id,
        player_id: playerId,
        match_id: predictionMatchId,
        home_score: Number(homeInput.value),
        away_score: Number(awayInput.value)
      }, { onConflict: "pool_id,player_id,match_id" });

      throwIfSupabaseError(error);
      await loadPoolData();
    }
  } catch (error) {
    setStatus("Save failed");
    console.error(error);
  }
});
