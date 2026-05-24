const DEFAULT_POOL_CODE = "Fifa2026";
const POOL_CODE_KEY = "worldCup2026PoolCode";

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
let refreshTimer = null;

let state = {
  entryAmount: 0,
  players: [],
  matches: [],
  predictions: []
};

bootstrap();

async function bootstrap() {
  setStatus("Connecting");

  try {
    const config = await loadSupabaseConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error("Supabase URL or anon key is missing.");
    }
    db = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

    const savedCode = localStorage.getItem(POOL_CODE_KEY);
    if (savedCode) {
      await enterPool(savedCode, { silent: true });
    } else {
      showGate("Enter your group passcode to begin.");
    }
  } catch (error) {
    showGate("Supabase is not configured yet. Add Vercel env vars or a local config file.");
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
  await ensureGroupStageMatches();
  await loadPoolData();
  startAutoRefresh();
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    loadPoolData({ quiet: true }).catch((error) => {
      setStatus("Refresh failed");
      console.error(error);
    });
  }, 30000);
}

async function loadPoolData(options = {}) {
  if (!currentPool) return;
  if (!options.quiet) setStatus("Syncing");

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
  setStatus("Synced");
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

  const seedRows = createGroupStageMatches().map(toMatchRow);
  const { error: upsertError } = await db
    .from("matches")
    .upsert(seedRows, { onConflict: "id" });

  throwIfSupabaseError(upsertError);
}

function render() {
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

function isLocked(match) {
  return new Date(match.kickoff) <= new Date();
}

function hasResult(match) {
  return match.homeScore !== null && match.awayScore !== null && match.homeScore !== "" && match.awayScore !== "";
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

function toMatchRow(match) {
  return {
    id: match.id,
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
    id: `wc26-${matchNo}`,
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
    showGate("Could not connect to the pool. Check Supabase setup and try again.");
    setStatus("Error");
    console.error(error);
  }
});

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
  clearInterval(refreshTimer);
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
  const scoreMatchId = event.target.dataset.scoreMatch;
  const predictionMatchId = event.target.dataset.predictionMatch;

  try {
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
