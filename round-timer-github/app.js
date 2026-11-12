const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const STORAGE_KEY = "round-timer.preferences.v1";
const MAX_DURATION_SECONDS = 99 * 60 + 59;
const DEFAULTS = {
  config: { workSeconds: 60, restSeconds: 30, rounds: 10 },
  sound: { enabled: true, tenSeconds: true, countdown: true, transitions: true, complete: true, volume: 0.7 },
  keepScreenAwake: true
};

const state = {
  preferences: loadPreferences(),
  screen: "config",
  session: null,
  lastResult: null,
  audio: null,
  wakeLock: null,
  deferredInstallPrompt: null,
  pendingAction: null,
  toastTimer: null
};

class SoundEngine {
  constructor() {
    this.context = null;
  }

  ensure() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return Promise.reject(new Error("Web Audio indisponible"));
    if (!this.context) this.context = new AudioContextClass();
    return this.context.state === "suspended" ? this.context.resume() : Promise.resolve();
  }

  play(kind) {
    const sound = state.preferences.sound;
    if (!sound.enabled) return;
    if ((kind === "ten" && !sound.tenSeconds) ||
        (kind === "count" && !sound.countdown) ||
        (kind === "transition" && !sound.transitions) ||
        (kind === "complete" && !sound.complete)) return;
    this.ensure().then(() => this.schedule(kind)).catch(() => {});
  }

  preview(kind) {
    this.ensure().then(() => this.schedule(kind)).catch(() => showToast("Le son n’est pas disponible dans ce navigateur."));
  }

  schedule(kind) {
    if (!this.context || this.context.state !== "running") return;
    const now = this.context.currentTime + 0.015;
    const volume = Math.max(0.0001, state.preferences.sound.volume);
    if (kind === "ten") {
      this.tone(880, now, 0.38, volume * 0.82, "sine");
      this.tone(1175, now + 0.05, 0.25, volume * 0.36, "sine");
    } else if (kind === "count") {
      this.tone(720, now, 0.1, volume * 0.9, "square");
    } else if (kind === "transition") {
      this.tone(390, now, 0.43, volume * 0.72, "sine");
      this.tone(586, now + 0.025, 0.46, volume * 0.56, "sine");
      this.tone(780, now + 0.04, 0.32, volume * 0.3, "triangle");
    } else if (kind === "complete") {
      this.tone(392, now, 0.34, volume * 0.68, "sine");
      this.tone(587, now + 0.22, 0.34, volume * 0.68, "sine");
      this.tone(784, now + 0.45, 0.62, volume * 0.8, "sine");
    }
  }

  tone(frequency, startAt, duration, volume, type) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.03);
  }
}

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const preferences = {
      ...DEFAULTS,
      ...saved,
      config: { ...DEFAULTS.config, ...(saved.config || {}) },
      sound: { ...DEFAULTS.sound, ...(saved.sound || {}) }
    };
    preferences.config.workSeconds = clampInteger(preferences.config.workSeconds, 1, MAX_DURATION_SECONDS, 60);
    preferences.config.restSeconds = clampInteger(preferences.config.restSeconds, 0, MAX_DURATION_SECONDS, 30);
    preferences.config.rounds = clampInteger(preferences.config.rounds, 1, 100, 10);
    preferences.sound.volume = clampNumber(preferences.sound.volume, 0, 1, 0.7);
    for (const key of ["enabled", "tenSeconds", "countdown", "transitions", "complete"]) preferences.sound[key] = Boolean(preferences.sound[key]);
    preferences.keepScreenAwake = preferences.keepScreenAwake !== false;
    return preferences;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function savePreferences() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.preferences));
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function clampInteger(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function pad(value) {
  return String(Math.max(0, Math.trunc(value))).padStart(2, "0");
}

function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(remaining)}` : `${pad(minutes)}:${pad(remaining)}`;
}

function splitTime(totalSeconds) {
  return { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 };
}

function getTotals(config = state.preferences.config) {
  const work = config.workSeconds * config.rounds;
  const rest = config.restSeconds * Math.max(0, config.rounds - 1);
  return { work, rest, total: work + rest, pauses: Math.max(0, config.rounds - 1) };
}

function setRangeProgress(element, percent) {
  element.style.setProperty("--range-progress", `${Math.max(0, Math.min(100, percent))}%`);
}

function refreshConfiguration() {
  const config = state.preferences.config;
  for (const [kind, seconds] of [["work", config.workSeconds], ["rest", config.restSeconds]]) {
    const parts = splitTime(seconds);
    $(`#${kind}-minutes`).value = pad(parts.minutes);
    $(`#${kind}-seconds`).value = pad(parts.seconds);
  }
  $("#rounds-value").textContent = config.rounds;
  const roundsSlider = $("#rounds-slider");
  roundsSlider.value = config.rounds;
  setRangeProgress(roundsSlider, ((config.rounds - 1) / 99) * 100);
  const totals = getTotals();
  $("#total-duration").textContent = formatTime(totals.total);
  $("#total-work").textContent = formatTime(totals.work);
  $("#total-rest").textContent = formatTime(totals.rest);
  $("#total-pauses").textContent = totals.pauses;
  savePreferences();
}

function adjustTime(kind, part, delta) {
  const key = `${kind}Seconds`;
  const minimum = kind === "work" ? 1 : 0;
  const step = part === "minutes" ? 60 : 1;
  state.preferences.config[key] = clampInteger(state.preferences.config[key] + step * delta, minimum, MAX_DURATION_SECONDS, minimum);
  refreshConfiguration();
}

function setTypedTime(kind, part, rawValue) {
  if (rawValue === "") return;
  const key = `${kind}Seconds`;
  const minimum = kind === "work" ? 1 : 0;
  const current = splitTime(state.preferences.config[key]);
  const entered = Math.max(0, Math.floor(Number(rawValue) || 0));
  const next = part === "minutes" ? entered * 60 + current.seconds : current.minutes * 60 + Math.min(59, entered);
  state.preferences.config[key] = clampInteger(next, minimum, MAX_DURATION_SECONDS, minimum);
  refreshConfiguration();
}

function adjustRounds(delta) {
  state.preferences.config.rounds = clampInteger(state.preferences.config.rounds + delta, 1, 100, 1);
  refreshConfiguration();
}

function setScreen(name) {
  state.screen = name;
  $("#config-screen").classList.toggle("hidden", name !== "config");
  $("#timer-screen").classList.toggle("hidden", name !== "timer");
  $("#complete-screen").classList.toggle("hidden", name !== "complete");
}

function newSession() {
  const config = { ...state.preferences.config };
  const startedAt = Date.now();
  return {
    config,
    totals: getTotals(config),
    phase: "work",
    round: 1,
    phaseDurationMs: config.workSeconds * 1000,
    phaseStartedAt: startedAt,
    phaseEndsAt: startedAt + config.workSeconds * 1000,
    completedMs: 0,
    paused: false,
    pauseRemainingMs: 0,
    phaseId: 1,
    alerts: new Set()
  };
}

function beginPhase(session, phase, round, startedAt) {
  const durationSeconds = phase === "work" ? session.config.workSeconds : session.config.restSeconds;
  session.phase = phase;
  session.round = round;
  session.phaseDurationMs = durationSeconds * 1000;
  session.phaseStartedAt = startedAt;
  session.phaseEndsAt = startedAt + session.phaseDurationMs;
  session.pauseRemainingMs = 0;
  session.phaseId += 1;
  session.alerts = new Set();
}

function remainingMs(session, now = Date.now()) {
  return Math.max(0, session.paused ? session.pauseRemainingMs : session.phaseEndsAt - now);
}

function activeElapsedMs(session, now = Date.now()) {
  const withinPhase = session.phaseDurationMs - remainingMs(session, now);
  return Math.max(0, Math.min(session.totals.total * 1000, session.completedMs + withinPhase));
}

function startSession() {
  state.audio.ensure().catch(() => {});
  state.lastResult = null;
  state.session = newSession();
  setScreen("timer");
  updateTimer();
  requestWakeLock();
}

function advanceSession(session, now, silent) {
  let guard = 0;
  while (!session.paused && now >= session.phaseEndsAt && guard < 250) {
    guard += 1;
    const endedPhase = session.phase;
    const endedRound = session.round;
    const boundary = session.phaseEndsAt;
    session.completedMs += session.phaseDurationMs;

    if (endedPhase === "work" && endedRound >= session.config.rounds) {
      finishSession(session, silent);
      return false;
    }

    if (!silent) state.audio.play("transition");
    if (endedPhase === "work") {
      if (session.config.restSeconds > 0) {
        beginPhase(session, "rest", endedRound, boundary);
      } else {
        beginPhase(session, "work", endedRound + 1, boundary);
      }
    } else {
      beginPhase(session, "work", endedRound + 1, boundary);
    }
  }
  return true;
}

function evaluateAlerts(session, secondsLeft, silent) {
  const phaseSeconds = session.phaseDurationMs / 1000;
  const mark = (name, sound) => {
    if (session.alerts.has(name)) return;
    session.alerts.add(name);
    if (!silent) state.audio.play(sound);
  };
  if (session.phase === "work" && phaseSeconds >= 10 && secondsLeft <= 10) mark("ten", "ten");
  if (secondsLeft >= 1 && secondsLeft <= 3 && phaseSeconds >= secondsLeft) mark(`count-${secondsLeft}`, "count");
}

function updateTimer({ silent = false } = {}) {
  const session = state.session;
  if (!session || state.screen !== "timer") return;
  const now = Date.now();
  if (!session.paused && now >= session.phaseEndsAt && !advanceSession(session, now, silent)) return;

  const currentRemainingMs = remainingMs(session, now);
  const secondsLeft = Math.max(0, Math.ceil(currentRemainingMs / 1000));
  evaluateAlerts(session, secondsLeft, silent);
  renderTimer(session, secondsLeft, currentRemainingMs, now);
}

function renderTimer(session, secondsLeft, currentRemainingMs, now) {
  const isRest = session.phase === "rest";
  const fraction = session.phaseDurationMs > 0 ? currentRemainingMs / session.phaseDurationMs : 0;
  $("#timer-stage").classList.toggle("rest-phase", isRest);
  $("#phase-ring").style.strokeDashoffset = String((1 - Math.max(0, Math.min(1, fraction))) * 100);
  $("#phase-icon use").setAttribute("href", isRest ? "#i-coffee" : "#i-flame");
  $("#timer-title").textContent = isRest ? "REPOS" : "EFFORT";
  $("#timer-mode-label").textContent = session.paused ? "Séance en pause" : isRest ? "Repos en cours" : "Effort en cours";
  $("#round-count").textContent = `Round ${session.round} / ${session.config.rounds}`;
  $("#countdown").textContent = formatTime(secondsLeft);
  $("#countdown-hint").textContent = session.paused ? "En pause" : isRest ? "Récupère, le prochain round arrive" : "Reste concentré";
  $("#pause-label").textContent = session.paused ? "Reprendre" : "Pause";
  $("#pause-button").setAttribute("aria-label", session.paused ? "Reprendre la séance" : "Mettre la séance en pause");
  $("#pause-icon use").setAttribute("href", session.paused ? "#i-play" : "#i-pause");

  const elapsed = activeElapsedMs(session, now);
  $("#global-time").textContent = `${formatTime(Math.floor(elapsed / 1000))} / ${formatTime(session.totals.total)}`;
  $("#global-progress").style.width = `${Math.min(100, (elapsed / (session.totals.total * 1000)) * 100)}%`;
  updateWakeStatus();
}

function togglePause() {
  const session = state.session;
  if (!session) return;
  const now = Date.now();
  if (session.paused) {
    const passedInPhase = session.phaseDurationMs - session.pauseRemainingMs;
    session.phaseStartedAt = now - passedInPhase;
    session.phaseEndsAt = now + session.pauseRemainingMs;
    session.paused = false;
    requestWakeLock();
  } else {
    session.pauseRemainingMs = remainingMs(session, now);
    session.paused = true;
    releaseWakeLock();
  }
  updateTimer({ silent: true });
}

function finishSession(session, silent) {
  if (state.session !== session) return;
  state.lastResult = { config: { ...session.config }, totals: { ...session.totals } };
  state.session = null;
  releaseWakeLock();
  if (!silent) state.audio.play("complete");
  renderResults();
  setScreen("complete");
}

function stopSession() {
  state.session = null;
  releaseWakeLock();
  setScreen("config");
  refreshConfiguration();
}

function renderResults() {
  const result = state.lastResult;
  if (!result) return;
  $("#result-total").textContent = formatTime(result.totals.total);
  $("#result-rounds").textContent = result.config.rounds;
  $("#result-work").textContent = formatTime(result.totals.work);
  $("#result-rest").textContent = formatTime(result.totals.rest);
}

async function requestWakeLock() {
  const session = state.session;
  if (!state.preferences.keepScreenAwake || !session || session.paused || !("wakeLock" in navigator)) {
    updateWakeStatus();
    return;
  }
  if (state.wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request("screen");
    state.wakeLock = lock;
    lock.addEventListener("release", () => {
      if (state.wakeLock === lock) state.wakeLock = null;
      updateWakeStatus();
    });
  } catch {
    state.wakeLock = null;
  }
  updateWakeStatus();
}

async function releaseWakeLock() {
  if (!state.wakeLock) {
    updateWakeStatus();
    return;
  }
  const lock = state.wakeLock;
  state.wakeLock = null;
  try { await lock.release(); } catch { /* Already released by the browser. */ }
  updateWakeStatus();
}

function updateWakeStatus() {
  const element = $("#wake-state");
  if (!element) return;
  if (!state.preferences.keepScreenAwake) element.innerHTML = '<svg class="icon"><use href="#i-sun"/></svg> Maintien de l’écran désactivé';
  else if (!("wakeLock" in navigator)) element.innerHTML = '<svg class="icon"><use href="#i-info"/></svg> Maintien de l’écran indisponible ici';
  else if (state.wakeLock) element.innerHTML = '<svg class="icon"><use href="#i-sun"/></svg> Écran maintenu allumé';
  else element.innerHTML = '<svg class="icon"><use href="#i-sun"/></svg> Écran maintenu allumé si disponible';
}

function syncSettingsUI() {
  const sound = state.preferences.sound;
  $$('[data-sound-setting]').forEach((input) => { input.checked = Boolean(sound[input.dataset.soundSetting]); });
  const volume = Math.round(sound.volume * 100);
  $("#volume-range").value = volume;
  setRangeProgress($("#volume-range"), volume);
  $("#volume-value").textContent = `${volume} %`;
  $("#wake-lock-toggle").checked = state.preferences.keepScreenAwake;
  updateInstallUI();
}

function openSettings() {
  syncSettingsUI();
  $("#settings-overlay").classList.remove("hidden");
  $("#settings-overlay").setAttribute("aria-hidden", "false");
  $("#close-settings-button").focus();
}

function closeSettings() {
  $("#settings-overlay").classList.add("hidden");
  $("#settings-overlay").setAttribute("aria-hidden", "true");
  $("#settings-button").focus();
}

function showConfirmation(action) {
  state.pendingAction = action;
  const isRestart = action === "restart";
  $("#confirm-icon use").setAttribute("href", isRestart ? "#i-restart" : "#i-stop");
  $("#confirm-title").textContent = isRestart ? "Recommencer la séance ?" : "Arrêter la séance ?";
  $("#confirm-text").textContent = isRestart ? "Le round en cours sera remis au départ." : "La progression en cours sera perdue.";
  $("#confirm-accept").textContent = isRestart ? "Recommencer" : "Arrêter";
  $("#confirm-overlay").classList.remove("hidden");
  $("#confirm-overlay").setAttribute("aria-hidden", "false");
  $("#confirm-cancel").focus();
}

function closeConfirmation() {
  state.pendingAction = null;
  $("#confirm-overlay").classList.add("hidden");
  $("#confirm-overlay").setAttribute("aria-hidden", "true");
}

function acceptConfirmation() {
  const action = state.pendingAction;
  closeConfirmation();
  if (action === "stop") stopSession();
  if (action === "restart") startSession();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function updateInstallUI() {
  const button = $("#install-button");
  const copy = $("#install-copy");
  if (isStandalone()) {
    button.disabled = true;
    button.textContent = "Installée";
    copy.textContent = "L’application est déjà installée sur cet appareil.";
  } else if (state.deferredInstallPrompt) {
    button.disabled = false;
    button.textContent = "Installer";
    copy.textContent = "Accès rapide et utilisation hors connexion.";
  } else if (isIos()) {
    button.disabled = false;
    button.textContent = "Voir comment";
    copy.textContent = "Dans Safari : Partager, puis « Sur l’écran d’accueil ».";
  } else {
    button.disabled = false;
    button.textContent = "Installer";
    copy.textContent = "Disponible via le menu de ton navigateur après le premier chargement.";
  }
}

async function handleInstall() {
  if (isStandalone()) return;
  if (state.deferredInstallPrompt) {
    const prompt = state.deferredInstallPrompt;
    prompt.prompt();
    try { await prompt.userChoice; } catch { /* The browser may not provide a result. */ }
    state.deferredInstallPrompt = null;
    updateInstallUI();
  } else if (isIos()) {
    showToast("Dans Safari, touche Partager puis « Sur l’écran d’accueil ».");
  } else {
    showToast("Utilise « Installer l’application » dans le menu du navigateur.");
  }
}

function bindEvents() {
  $$('[data-time]').forEach((button) => button.addEventListener("click", () => adjustTime(button.dataset.time, button.dataset.part, Number(button.dataset.delta))));
  $$('[data-input-time]').forEach((input) => {
    input.addEventListener("change", () => setTypedTime(input.dataset.inputTime, input.dataset.part, input.value));
    input.addEventListener("blur", () => refreshConfiguration());
  });
  $("#rounds-minus").addEventListener("click", () => adjustRounds(-1));
  $("#rounds-plus").addEventListener("click", () => adjustRounds(1));
  $("#rounds-slider").addEventListener("input", (event) => {
    state.preferences.config.rounds = clampInteger(event.target.value, 1, 100, 10);
    refreshConfiguration();
  });
  $("#start-button").addEventListener("click", startSession);
  $("#pause-button").addEventListener("click", togglePause);
  $("#stop-button").addEventListener("click", () => showConfirmation("stop"));
  $("#exit-session-button").addEventListener("click", () => showConfirmation("stop"));
  $("#restart-button").addEventListener("click", () => showConfirmation("restart"));
  $("#again-button").addEventListener("click", startSession);
  $("#new-session-button").addEventListener("click", () => { setScreen("config"); refreshConfiguration(); });

  $("#settings-button").addEventListener("click", openSettings);
  $("#close-settings-button").addEventListener("click", closeSettings);
  $("#settings-overlay").addEventListener("click", (event) => { if (event.target === $("#settings-overlay")) closeSettings(); });
  $$('[data-sound-setting]').forEach((input) => input.addEventListener("change", () => {
    state.preferences.sound[input.dataset.soundSetting] = input.checked;
    savePreferences();
    syncSettingsUI();
  }));
  $("#volume-range").addEventListener("input", (event) => {
    state.preferences.sound.volume = clampNumber(Number(event.target.value) / 100, 0, 1, 0.7);
    savePreferences();
    syncSettingsUI();
  });
  $$('[data-preview]').forEach((button) => button.addEventListener("click", () => state.audio.preview(button.dataset.preview)));
  $("#wake-lock-toggle").addEventListener("change", (event) => {
    state.preferences.keepScreenAwake = event.target.checked;
    savePreferences();
    if (state.preferences.keepScreenAwake && state.session && !state.session.paused) requestWakeLock();
    else if (!state.preferences.keepScreenAwake) releaseWakeLock();
    syncSettingsUI();
  });
  $("#install-button").addEventListener("click", handleInstall);

  $("#confirm-cancel").addEventListener("click", closeConfirmation);
  $("#confirm-accept").addEventListener("click", acceptConfirmation);
  $("#confirm-overlay").addEventListener("click", (event) => { if (event.target === $("#confirm-overlay")) closeConfirmation(); });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    updateInstallUI();
  });
  window.addEventListener("appinstalled", () => { state.deferredInstallPrompt = null; updateInstallUI(); showToast("Round Timer est installée."); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (state.session && !state.session.paused) {
        updateTimer({ silent: true });
        requestWakeLock();
      }
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("#confirm-overlay").classList.contains("hidden")) closeConfirmation();
    else if (!$("#settings-overlay").classList.contains("hidden")) closeSettings();
  });
}

function tick() {
  if (state.session && state.screen === "timer" && document.visibilityState === "visible") updateTimer();
  requestAnimationFrame(tick);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

function init() {
  state.audio = new SoundEngine();
  refreshConfiguration();
  syncSettingsUI();
  bindEvents();
  registerServiceWorker();
  requestAnimationFrame(tick);
}

init();
