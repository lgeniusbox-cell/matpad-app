/**
 * FitTV Arena - Core Application
 * Designed for Android TV WebView (10-Foot UI, D-Pad, Gamepad & Floor-Mat Tracker)
 * 
 * ARCHITECTURE (3 Clear Layers):
 * 1. INPUT LAYER: Converts raw keyboard/gamepad/remote into SEMANTIC EVENTS on EventBus.
 *    Exposes window.TVBridge for Android Java integration.
 * 2. APP / UI LAYER: Spatial focus navigation, screens, shelves, banners, dialogs, themes.
 * 3. ENGINES: Video controller, GameEngine (timeline rhythm), RunEngine (cadence/speed).
 */

/* ==========================================================================
   EDITABLE CONFIGURATION CONSTANTS (TUNABLE AT TOP)
   ========================================================================== */

export const UI = {
  // Banner / Card fixed size (in px for 1920x1080 reference, applied to CSS)
  banner: { width: 400, height: 225 }, // 16:9
  bannerGap: 24,
  entryTile: { width: 560, height: 315 },
  rail: { collapsed: 96, expanded: 320 },
  safeMarginPercent: 5 // 5% TV safe overscan
};

export const INPUT_CONFIG = {
  // Gamepad auto-repeat for navigation ONLY (steps are never repeated)
  gamepad: {
    repeatInitialDelayMs: 400,
    repeatIntervalMs: 120,
    stickDeadzone: 0.5
  },
  // Default calibration offset in ms
  defaultCalibrationMs: 0
};

export const GAME_RULES_DEFAULT = {
  maxLives: 3,
  maxMisses: 5,
  timingWindowMs: {
    perfect: 120,
    good: 300
  },
  scoring: {
    perfect: 100,
    good: 50,
    comboMultiplierStep: 5,
    maxMultiplier: 4
  },
  winCondition: "survive_to_end"
};

export const RUN_CONFIG_DEFAULT = {
  referenceSpeedKmh: 8.0, // Speed for 1.0x video playback
  defaultStrideM: 0.75,   // Average stride length
  defaultWeightKg: 70,    // For MET calorie estimation
  cadenceWindow: 6,       // Steps window for median cadence
  idleTimeoutMs: 2500,    // Stop running after 2.5s without step
  minStepIntervalMs: 150, // Reject bounce under 150ms
  rateChangeMinDelayMs: 1200 // Minimum time between video playbackRate changes
};

// Simple i18n dictionary (French default, English supported)
export const I18N = {
  fr: {
    appTitle: "FitTV Arena",
    home: "Accueil",
    games: "Jeux Rythme",
    virtualRun: "Course Virtuelle",
    cardio: "Sessions Cardio",
    profile: "Profil",
    settings: "Paramètres",
    lockedCardio: "Bientôt disponible",
    ready: "Prêt ?",
    start: "Commencer",
    pause: "Pause",
    resume: "Reprendre",
    restart: "Recommencer",
    quit: "Quitter",
    controlsHelp: "Aide Contrôles",
    otherGenre: "Autres",
    level: "Niveau",
    bestScore: "Record",
    bestTime: "Meilleur",
    speed: "Vitesse",
    pace: "Allure",
    distance: "Distance",
    time: "Temps",
    steps: "Pas",
    cadence: "Cadence",
    rate: "Vidéo",
    calories: "Calories",
    perfect: "PARFAIT !",
    good: "BIEN !",
    miss: "RATÉ !",
    gameover: "GAME OVER",
    victory: "VICTOIRE !",
    runCompleted: "Bravo ! Course Terminée !",
    runSummary: "Récapitulatif de votre séance",
    replay: "Rejouer",
    backToList: "Retour à la liste",
    exitPrompt: "Voulez-vous quitter FitTV Arena ?",
    confirm: "Confirmer",
    cancel: "Annuler",
    themeLabel: "Thème d'affichage",
    soundLabel: "Effets sonores",
    calibrationLabel: "Calibrage latence (ms)",
    calibrationTest: "Test battement",
    strideLabel: "Longueur de foulée (m)",
    weightLabel: "Poids (kg)",
    simModeLabel: "Mode simulation pas (Alt+L/R)",
    controllerConnected: "Manette connectée",
    controllerDisconnected: "Manette déconnectée"
  },
  en: {
    appTitle: "FitTV Arena",
    home: "Home",
    games: "Rhythm Games",
    virtualRun: "Virtual Run",
    cardio: "Cardio Sessions",
    profile: "Profile",
    settings: "Settings",
    lockedCardio: "Coming soon",
    ready: "Ready?",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    restart: "Restart",
    quit: "Quit",
    controlsHelp: "Controls Help",
    otherGenre: "Other",
    level: "Level",
    bestScore: "Best",
    bestTime: "Best Time",
    speed: "Speed",
    pace: "Pace",
    distance: "Distance",
    time: "Time",
    steps: "Steps",
    cadence: "Cadence",
    rate: "Video Rate",
    calories: "Calories",
    perfect: "PERFECT!",
    good: "GOOD!",
    miss: "MISS!",
    gameover: "GAME OVER",
    victory: "VICTORY!",
    runCompleted: "Great job! Run Completed!",
    runSummary: "Workout Summary",
    replay: "Play Again",
    backToList: "Back to List",
    exitPrompt: "Do you want to exit FitTV Arena?",
    confirm: "Confirm",
    cancel: "Cancel",
    themeLabel: "Audience Theme",
    soundLabel: "Sound Effects",
    calibrationLabel: "Latency Calibration (ms)",
    calibrationTest: "Beat Test",
    strideLabel: "Stride Length (m)",
    weightLabel: "Weight (kg)",
    simModeLabel: "Step Simulation Mode (Alt+L/R)",
    controllerConnected: "Controller connected",
    controllerDisconnected: "Controller disconnected"
  }
};

/* ==========================================================================
   WEB AUDIO SYNTHESIZER (ZERO EXTERNAL ASSETS)
   ========================================================================== */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  playNav() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(600, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.05);
    } catch (_) {}
  }

  playSuccess(isPerfect = true) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = isPerfect ? "triangle" : "sine";
      osc.frequency.setValueAtTime(isPerfect ? 880 : 587.33, t);
      osc.frequency.exponentialRampToValueAtTime(isPerfect ? 1320 : 880, t + 0.12);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    } catch (_) {}
  }

  playFail() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.linearRampToValueAtTime(90, t + 0.2);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.22);
    } catch (_) {}
  }

  playCountdown(count) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      const freq = count === 0 ? 880 : 440;
      const dur = count === 0 ? 0.35 : 0.12;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
    } catch (_) {}
  }

  playWin() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, t + i * 0.1);
        gain.gain.setValueAtTime(0.2, t + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.1 + 0.35);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t + i * 0.1);
        osc.stop(t + i * 0.1 + 0.35);
      });
    } catch (_) {}
  }

  playGameOver() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const notes = [440, 415.3, 392, 349.2];
      notes.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, t + i * 0.18);
        gain.gain.setValueAtTime(0.18, t + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.18 + 0.3);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t + i * 0.18);
        osc.stop(t + i * 0.18 + 0.3);
      });
    } catch (_) {}
  }

  playStep() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.06);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.07);
    } catch (_) {}
  }
}

export const sounds = new SoundEngine();

/* ==========================================================================
   LAYER 1: INPUT LAYER & JAVA BRIDGE
   Converts keyboard, remote and gamepad inputs into SEMANTIC EVENTS.
   Exposes window.TVBridge and communicates with window.Android.
   ========================================================================== */

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(eventName, payload = {}) {
    payload.timestamp = payload.timestamp || performance.now();
    payload.name = eventName;
    if (this.listeners.has(eventName)) {
      for (const cb of this.listeners.get(eventName)) {
        try {
          cb(payload);
        } catch (err) {
          console.error(`Error in EventBus listener for ${eventName}:`, err);
        }
      }
    }
    // Also trigger wildcards
    if (this.listeners.has("*")) {
      for (const cb of this.listeners.get("*")) {
        try {
          cb(payload);
        } catch (_) {}
      }
    }
  }
}

export const bus = new EventBus();

// Expose TVBridge for Java WebView injection
window.TVBridge = {
  dispatch(eventName, payload = {}) {
    bus.emit(eventName, payload);
  },
  onEvent(callback) {
    return bus.on("*", callback);
  }
};

// Helper to notify Android Java container
export function notifyAndroid(name, payload = {}) {
  try {
    if (window.Android && typeof window.Android.onAppEvent === "function") {
      window.Android.onAppEvent(JSON.stringify({ name, payload, timestamp: performance.now() }));
    }
  } catch (err) {
    console.warn("Android bridge notify error:", err);
  }
}

class InputLayer {
  constructor() {
    this.gamepadConnected = false;
    this.gamepadIndex = null;
    this.buttonStates = new Map();
    this.navRepeatTimers = new Map(); // buttonKey -> { initialTimer, repeatInterval }
    this.rafId = null;
    this.activeScreen = "home";
  }

  init() {
    window.addEventListener("keydown", (e) => this.handleKeyDown(e), { passive: false });
    window.addEventListener("gamepadconnected", (e) => this.handleGamepadConnected(e));
    window.addEventListener("gamepaddisconnected", (e) => this.handleGamepadDisconnected(e));
    this.pollGamepadLoop();
  }

  handleGamepadConnected(e) {
    if (this.gamepadIndex === null) {
      this.gamepadIndex = e.gamepad.index;
      this.gamepadConnected = true;
      document.getElementById("gp-status-dot")?.classList.add("active");
      const label = document.getElementById("gp-status-label");
      if (label) label.textContent = I18N[appState.lang].controllerConnected;
      appUI.showToast(I18N[appState.lang].controllerConnected);
    }
  }

  handleGamepadDisconnected(e) {
    if (this.gamepadIndex === e.gamepad.index) {
      this.gamepadIndex = null;
      this.gamepadConnected = false;
      document.getElementById("gp-status-dot")?.classList.remove("active");
      const label = document.getElementById("gp-status-label");
      if (label) label.textContent = I18N[appState.lang].controllerDisconnected;
      appUI.showToast(I18N[appState.lang].controllerDisconnected);
    }
  }

  handleKeyDown(e) {
    // 1. FLOOR-MAT TRACKER / STEP INPUTS (Alt+R, Alt+L, or fallback R, L)
    // IMPORTANT: Ignore key auto-repeat for steps, never affect focus system
    const isKeyR = e.code === "KeyR" || e.key === "r" || e.key === "R";
    const isKeyL = e.code === "KeyL" || e.key === "l" || e.key === "L";

    if ((e.altKey && isKeyR) || (isKeyR && !e.ctrlKey && !e.metaKey && this.isNotTyping(e))) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) {
        bus.emit("STEP_RIGHT", { source: "keyboard", alt: e.altKey });
      }
      return;
    }

    if ((e.altKey && isKeyL) || (isKeyL && !e.ctrlKey && !e.metaKey && this.isNotTyping(e))) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) {
        bus.emit("STEP_LEFT", { source: "keyboard", alt: e.altKey });
      }
      return;
    }

    // If an on-screen keyboard or text input is active, allow normal keys
    if (document.activeElement && document.activeElement.tagName === "INPUT") {
      if (e.key === "Enter") {
        e.preventDefault();
        bus.emit("OK", { source: "keyboard" });
      }
      return;
    }

    // 2. STANDARD TV REMOTE & KEYBOARD MAPPING
    let semanticEvent = null;

    switch (e.key) {
      case "ArrowUp":
        semanticEvent = "NAV_UP";
        if (appState.inGame) bus.emit("JUMP", { source: "keyboard" });
        break;
      case "ArrowDown":
        semanticEvent = "NAV_DOWN";
        if (appState.inGame) bus.emit("SLIDE_DOWN", { source: "keyboard" });
        break;
      case "ArrowLeft":
        semanticEvent = "NAV_LEFT";
        if (appState.inGame) bus.emit("LEFT", { source: "keyboard" });
        break;
      case "ArrowRight":
        semanticEvent = "NAV_RIGHT";
        if (appState.inGame) bus.emit("RIGHT", { source: "keyboard" });
        break;
      case "Enter":
      case " ":
        semanticEvent = "OK";
        break;
      case "Escape":
      case "Backspace":
      case "BrowserBack":
      case "GoBack":
        semanticEvent = "BACK";
        break;
      case "ContextMenu":
      case "m":
      case "M":
        semanticEvent = "MENU";
        break;
      case "p":
      case "P":
        semanticEvent = "PAUSE";
        break;
      case "f":
      case "F":
        bus.emit("PUNCH", { source: "keyboard" });
        break;
      case "d":
      case "D":
        bus.emit("SLASH", { source: "keyboard" });
        break;
      default:
        break;
    }

    if (semanticEvent) {
      e.preventDefault();
      bus.emit(semanticEvent, { source: "keyboard" });
    }
  }

  isNotTyping(e) {
    return !document.activeElement || document.activeElement.tagName !== "INPUT";
  }

  pollGamepadLoop() {
    this.pollGamepad();
    this.rafId = requestAnimationFrame(() => this.pollGamepadLoop());
  }

  pollGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    if (this.gamepadIndex !== null && gamepads[this.gamepadIndex]) {
      gp = gamepads[this.gamepadIndex];
    } else {
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
          gp = gamepads[i];
          this.gamepadIndex = i;
          break;
        }
      }
    }

    if (!gp) return;

    // Check Button Presses with Edge Detection
    const b = gp.buttons;

    // STEPS (L1 = button 4, R1 = button 5) - NEVER auto-repeated!
    this.checkButtonEdge(4, b[4]?.pressed, () => bus.emit("STEP_LEFT", { source: "gamepad" }));
    this.checkButtonEdge(5, b[5]?.pressed, () => bus.emit("STEP_RIGHT", { source: "gamepad" }));

    // Game Actions
    this.checkButtonEdge(2, b[2]?.pressed, () => bus.emit("PUNCH", { source: "gamepad" })); // X = Punch
    this.checkButtonEdge(3, b[3]?.pressed, () => bus.emit("SLASH", { source: "gamepad" })); // Y = Slash
    this.checkButtonEdge(9, b[9]?.pressed, () => bus.emit("PAUSE", { source: "gamepad" })); // Start = Pause/Menu

    // OK / Back
    this.checkButtonEdge(0, b[0]?.pressed, () => {
      bus.emit("OK", { source: "gamepad" });
      if (appState.inGame) bus.emit("JUMP", { source: "gamepad" }); // A is also Jump in game
    });
    this.checkButtonEdge(1, b[1]?.pressed, () => bus.emit("BACK", { source: "gamepad" }));

    // D-Pad and Stick Navigation with 400ms initial delay then 120ms repeat
    const up = b[12]?.pressed || gp.axes[1] < -INPUT_CONFIG.gamepad.stickDeadzone;
    const down = b[13]?.pressed || gp.axes[1] > INPUT_CONFIG.gamepad.stickDeadzone;
    const left = b[14]?.pressed || gp.axes[0] < -INPUT_CONFIG.gamepad.stickDeadzone;
    const right = b[15]?.pressed || gp.axes[0] > INPUT_CONFIG.gamepad.stickDeadzone;

    this.checkNavRepeat("NAV_UP", up, () => {
      bus.emit("NAV_UP", { source: "gamepad" });
      if (appState.inGame) bus.emit("JUMP", { source: "gamepad" });
    });
    this.checkNavRepeat("NAV_DOWN", down, () => {
      bus.emit("NAV_DOWN", { source: "gamepad" });
      if (appState.inGame) bus.emit("SLIDE_DOWN", { source: "gamepad" });
    });
    this.checkNavRepeat("NAV_LEFT", left, () => {
      bus.emit("NAV_LEFT", { source: "gamepad" });
      if (appState.inGame) bus.emit("LEFT", { source: "gamepad" });
    });
    this.checkNavRepeat("NAV_RIGHT", right, () => {
      bus.emit("NAV_RIGHT", { source: "gamepad" });
      if (appState.inGame) bus.emit("RIGHT", { source: "gamepad" });
    });
  }

  checkButtonEdge(index, pressed, onDown) {
    const wasPressed = this.buttonStates.get(index) || false;
    if (pressed && !wasPressed) {
      onDown();
    }
    this.buttonStates.set(index, !!pressed);
  }

  checkNavRepeat(name, pressed, onAction) {
    const isCurrentlyActive = this.navRepeatTimers.has(name);
    if (pressed) {
      if (!isCurrentlyActive) {
        // Initial press
        onAction();
        const initialTimer = setTimeout(() => {
          const repeatInterval = setInterval(() => {
            onAction();
          }, INPUT_CONFIG.gamepad.repeatIntervalMs);
          this.navRepeatTimers.set(name, { repeatInterval });
        }, INPUT_CONFIG.gamepad.repeatInitialDelayMs);
        this.navRepeatTimers.set(name, { initialTimer });
      }
    } else {
      if (isCurrentlyActive) {
        const state = this.navRepeatTimers.get(name);
        if (state.initialTimer) clearTimeout(state.initialTimer);
        if (state.repeatInterval) clearInterval(state.repeatInterval);
        this.navRepeatTimers.delete(name);
      }
    }
  }
}

export const inputLayer = new InputLayer();

/* ==========================================================================
   LAYER 2: APP / UI LAYER
   Spatial Focus Navigation, Shelves, Fixed Banners, Themes, On-Screen Keyboard.
   ========================================================================== */

class AppState {
  constructor() {
    this.lang = "fr";
    this.inGame = false;
    this.inRun = false;
    this.simMode = false;
    this.calibrationMs = 0;
    this.profile = this.loadProfile();
  }

  loadProfile() {
    const saved = localStorage.getItem("fittv_profile");
    if (saved) {
      try { return JSON.parse(saved); } catch (_) {}
    }
    return {
      playerName: "Champion TV",
      theme: "adult", // "kids" | "adult" | "pro"
      strideLengthM: 0.75,
      weightKg: 70,
      bestScores: {},
      bestRuns: {}
    };
  }

  saveProfile() {
    localStorage.setItem("fittv_profile", JSON.stringify(this.profile));
    this.applyTheme(this.profile.theme);
  }

  applyTheme(themeName) {
    document.body.className = `theme-${themeName || "adult"}`;
  }
}

export const appState = new AppState();

/**
 * 2D Spatial Focus Navigation Engine
 * YouTube TV style with 1.08 scale, 4px white ring, and memory per shelf.
 */
class SpatialFocusManager {
  constructor() {
    this.currentFocused = null;
    this.historyPerScreen = new Map(); // screenId -> element
    this.shelfColumnHistory = new Map(); // shelfElement -> columnIndex
    this.isRailFocused = false;
  }

  init() {
    bus.on("NAV_UP", () => this.move("UP"));
    bus.on("NAV_DOWN", () => this.move("DOWN"));
    bus.on("NAV_LEFT", () => this.move("LEFT"));
    bus.on("NAV_RIGHT", () => this.move("RIGHT"));
    bus.on("OK", () => this.triggerOk());
    bus.on("BACK", () => this.triggerBack());
    bus.on("MENU", () => appUI.openControlsHelp());
  }

  getFocusables(container = document) {
    // If a modal dialog is open, trap focus strictly inside that dialog!
    const openModal = document.querySelector(".modal-overlay.open");
    const scope = openModal || container;
    return Array.from(scope.querySelectorAll('[data-focusable="true"]'))
      .filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
      });
  }

  setFocus(el, shouldScroll = true) {
    if (!el) return;
    if (this.currentFocused) {
      this.currentFocused.removeAttribute("data-focused");
    }
    this.currentFocused = el;
    el.setAttribute("data-focused", "true");
    sounds.playNav();

    // Check if rail is focused
    const rail = document.getElementById("nav-rail");
    this.isRailFocused = el.classList.contains("rail-btn");
    if (this.isRailFocused) {
      rail?.classList.add("expanded");
    } else {
      rail?.classList.remove("expanded");
    }

    if (shouldScroll) {
      this.ensureVisible(el);
    }
  }

  ensureVisible(el) {
    // 1. Horizontal Shelf Scrolling (Smooth Programmatic Scroll)
    const shelfTrack = el.closest(".shelf-track");
    if (shelfTrack) {
      const cards = Array.from(shelfTrack.children);
      const index = cards.indexOf(el);
      const shelfRow = el.closest(".shelf-row");
      if (shelfRow) this.shelfColumnHistory.set(shelfRow, index);

      // Card width + gap
      const step = UI.banner.width + UI.bannerGap;
      const targetScroll = Math.max(0, (index - 1) * step);
      shelfTrack.style.transform = `translateX(-${targetScroll}px)`;
    }

    // 2. Vertical Shelves Scroller: Put active shelf in upper third of the screen
    const shelfRow = el.closest(".shelf-row");
    const container = el.closest(".shelves-container");
    if (shelfRow && container) {
      const shelves = Array.from(container.querySelectorAll(".shelf-row"));
      const rowIndex = shelves.indexOf(shelfRow);
      const rowHeight = UI.banner.height + 90; // row height approx
      const targetY = Math.max(0, rowIndex * rowHeight);
      container.style.transform = `translateY(-${targetY}px)`;
    }
  }

  move(direction) {
    if (appState.inGame || appState.inRun) {
      // In video mode, only pause menu dialog takes spatial focus
      const openModal = document.querySelector(".modal-overlay.open");
      if (!openModal) return;
    }

    const openModal = document.querySelector(".modal-overlay.open");
    const current = this.currentFocused || this.getFocusables()[0];
    if (!current) return;

    // SPECIAL RULE: Nav Rail Interaction
    if (this.isRailFocused) {
      if (direction === "UP" || direction === "DOWN") {
        const railItems = Array.from(document.querySelectorAll("#nav-rail .rail-btn"));
        const idx = railItems.indexOf(current);
        const nextIdx = direction === "UP" ? Math.max(0, idx - 1) : Math.min(railItems.length - 1, idx + 1);
        this.setFocus(railItems[nextIdx]);
        return;
      } else if (direction === "RIGHT") {
        // Return from rail into current screen's content
        const screen = document.querySelector(".screen.active");
        if (screen) {
          const focusables = this.getFocusables(screen);
          if (focusables.length > 0) {
            this.setFocus(focusables[0]);
            return;
          }
        }
      }
      return;
    }

    // SPECIAL RULE: Left edge of shelf row goes to left rail!
    if (direction === "LEFT" && !openModal) {
      const shelfTrack = current.closest(".shelf-track");
      if (shelfTrack) {
        const cards = Array.from(shelfTrack.children);
        if (cards.indexOf(current) === 0) {
          // Move focus to currently active rail button
          const activeRailBtn = document.querySelector("#nav-rail .rail-btn.active") || document.querySelector("#nav-rail .rail-btn");
          if (activeRailBtn) {
            this.setFocus(activeRailBtn);
            return;
          }
        }
      }
      // If home tiles, first tile goes to rail
      if (current.classList.contains("entry-tile")) {
        const tiles = Array.from(document.querySelectorAll(".home-tiles-row .entry-tile"));
        if (tiles.indexOf(current) === 0) {
          const activeRailBtn = document.querySelector("#nav-rail .rail-btn.active") || document.querySelector("#nav-rail .rail-btn");
          if (activeRailBtn) {
            this.setFocus(activeRailBtn);
            return;
          }
        }
      }
    }

    // SPECIAL RULE: UP/DOWN across shelves lands on same column index when possible
    if ((direction === "UP" || direction === "DOWN") && !openModal) {
      const currentShelfRow = current.closest(".shelf-row");
      const container = current.closest(".shelves-container");
      if (currentShelfRow && container) {
        const shelves = Array.from(container.querySelectorAll(".shelf-row"));
        const currentShelfIndex = shelves.indexOf(currentShelfRow);
        const nextShelfIndex = direction === "UP" ? currentShelfIndex - 1 : currentShelfIndex + 1;
        if (nextShelfIndex >= 0 && nextShelfIndex < shelves.length) {
          const nextShelf = shelves[nextShelfIndex];
          const nextCards = Array.from(nextShelf.querySelectorAll('[data-focusable="true"]'));
          const currentTrack = current.closest(".shelf-track");
          const currentCol = currentTrack ? Array.from(currentTrack.children).indexOf(current) : 0;
          const targetCol = Math.min(currentCol, nextCards.length - 1);
          if (nextCards[targetCol]) {
            this.setFocus(nextCards[targetCol]);
            return;
          }
        }
      }
    }

    // Default 2D Spatial Search
    const candidates = this.getFocusables(openModal || undefined).filter(el => el !== current);
    const best = this.findNearest(current, candidates, direction);
    if (best) {
      this.setFocus(best);
    }
  }

  findNearest(current, candidates, direction) {
    const cRect = current.getBoundingClientRect();
    const cCenter = { x: cRect.left + cRect.width / 2, y: cRect.top + cRect.height / 2 };

    let closest = null;
    let minScore = Infinity;

    for (const cand of candidates) {
      const r = cand.getBoundingClientRect();
      const candCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };

      const dx = candCenter.x - cCenter.x;
      const dy = candCenter.y - cCenter.y;

      // Filter by direction quadrant
      let isEligible = false;
      let primaryDist = 0;
      let secondaryDist = 0;

      switch (direction) {
        case "UP":
          isEligible = dy < -5;
          primaryDist = -dy;
          secondaryDist = Math.abs(dx);
          break;
        case "DOWN":
          isEligible = dy > 5;
          primaryDist = dy;
          secondaryDist = Math.abs(dx);
          break;
        case "LEFT":
          isEligible = dx < -5;
          primaryDist = -dx;
          secondaryDist = Math.abs(dy);
          break;
        case "RIGHT":
          isEligible = dx > 5;
          primaryDist = dx;
          secondaryDist = Math.abs(dy);
          break;
      }

      if (!isEligible) continue;

      // Distance score: penalize perpendicular alignment
      const score = primaryDist + secondaryDist * 2.2;
      if (score < minScore) {
        minScore = score;
        closest = cand;
      }
    }

    return closest;
  }

  triggerOk() {
    if (this.currentFocused) {
      this.currentFocused.click();
    }
  }

  triggerBack() {
    // 1. If modal open, close modal
    const openModal = document.querySelector(".modal-overlay.open");
    if (openModal) {
      appUI.closeModal(openModal.id);
      return;
    }

    // 2. If in video mode, open Pause dialog
    if (appState.inGame || appState.inRun) {
      appUI.openPauseMenu();
      return;
    }

    // 3. If in screen content, move focus to rail
    if (!this.isRailFocused) {
      const activeRailBtn = document.querySelector("#nav-rail .rail-btn.active") || document.querySelector("#nav-rail .rail-btn");
      if (activeRailBtn) {
        this.setFocus(activeRailBtn);
        return;
      }
    }

    // 4. On Home screen, BACK prompts to exit
    if (appUI.currentScreenId === "screen-home") {
      appUI.openExitDialog();
    } else {
      appUI.navigateScreen("home");
    }
  }
}

export const focusManager = new SpatialFocusManager();

/**
 * Main UI Controller: Screens, Shelves, On-Screen Keyboard, Dialogs
 */
class AppUI {
  constructor() {
    this.currentScreenId = "screen-home";
    this.gamesData = [];
    this.runsData = [];
  }

  async init() {
    this.setupRailNavigation();
    this.setupHomeTiles();
    this.setupDialogs();
    this.setupSettingsScreen();
    this.setupProfileScreen();

    // Load content manifests
    await Promise.all([this.loadGames(), this.loadRuns()]);

    // Apply stored theme
    appState.applyTheme(appState.profile.theme);

    // Initial focus on first Home entry tile
    const firstTile = document.querySelector(".home-tiles-row .entry-tile");
    if (firstTile) focusManager.setFocus(firstTile);
  }

  setupRailNavigation() {
    const railBtns = document.querySelectorAll("#nav-rail .rail-btn");
    railBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.target;
        if (target === "cardio") {
          this.showToast(I18N[appState.lang].lockedCardio);
          return;
        }
        this.navigateScreen(target);
      });
    });
  }

  setupHomeTiles() {
    document.getElementById("tile-games")?.addEventListener("click", () => this.navigateScreen("games"));
    document.getElementById("tile-runs")?.addEventListener("click", () => this.navigateScreen("runs"));
    document.getElementById("tile-cardio")?.addEventListener("click", () => {
      this.showToast(I18N[appState.lang].lockedCardio);
    });
  }

  navigateScreen(screenKey) {
    const screenMap = {
      home: "screen-home",
      games: "screen-games",
      runs: "screen-runs",
      profile: "screen-profile",
      settings: "screen-settings"
    };

    const targetId = screenMap[screenKey] || "screen-home";
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    const targetScreen = document.getElementById(targetId);
    if (targetScreen) {
      targetScreen.classList.add("active");
      this.currentScreenId = targetId;
      notifyAndroid("SCREEN_CHANGED", { screen: screenKey });

      // Update active state in rail
      document.querySelectorAll("#nav-rail .rail-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.target === screenKey);
      });

      // Set focus to first interactive card/control in screen
      setTimeout(() => {
        const firstFocus = targetScreen.querySelector('[data-focusable="true"]');
        if (firstFocus) focusManager.setFocus(firstFocus);
      }, 50);
    }
  }

  showToast(message, durationMs = 3000) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 250);
    }, durationMs);
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add("open");
    const firstBtn = modal.querySelector('[data-focusable="true"]');
    if (firstBtn) focusManager.setFocus(firstBtn);
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove("open");
    // Return focus to active screen content
    const screen = document.getElementById(this.currentScreenId);
    if (screen) {
      const candidate = screen.querySelector('[data-focusable="true"]');
      if (candidate) focusManager.setFocus(candidate);
    }
  }

  openControlsHelp() {
    this.openModal("modal-controls-help");
  }

  openExitDialog() {
    this.openModal("modal-exit");
  }

  openPauseMenu() {
    if (videoController.player) videoController.player.pauseVideo();
    this.openModal("modal-pause");
  }

  setupDialogs() {
    // Controls Help modal close button
    document.getElementById("btn-close-controls")?.addEventListener("click", () => {
      this.closeModal("modal-controls-help");
    });

    // Exit confirm modal buttons
    document.getElementById("btn-exit-cancel")?.addEventListener("click", () => {
      this.closeModal("modal-exit");
    });
    document.getElementById("btn-exit-confirm")?.addEventListener("click", () => {
      this.showToast("Au revoir !");
      try {
        if (window.Android && typeof window.Android.closeApp === "function") {
          window.Android.closeApp();
        } else {
          window.close();
        }
      } catch (_) {}
    });

    // Pause menu buttons
    document.getElementById("btn-pause-resume")?.addEventListener("click", () => {
      this.closeModal("modal-pause");
      if (videoController.player) videoController.player.playVideo();
    });
    document.getElementById("btn-pause-restart")?.addEventListener("click", () => {
      this.closeModal("modal-pause");
      if (appState.inGame && gameEngine.currentGame) {
        gameEngine.start(gameEngine.currentGame);
      } else if (appState.inRun && runEngine.currentRun) {
        runEngine.start(runEngine.currentRun);
      }
    });
    document.getElementById("btn-pause-controls")?.addEventListener("click", () => {
      this.closeModal("modal-pause");
      this.openControlsHelp();
    });
    document.getElementById("btn-pause-quit")?.addEventListener("click", () => {
      this.closeModal("modal-pause");
      gameEngine.stop();
      runEngine.stop();
      videoController.stop();
      document.getElementById("video-stage")?.classList.remove("active");
      this.navigateScreen("home");
    });
  }

  setupSettingsScreen() {
    // Mute toggle
    const muteBtn = document.getElementById("btn-setting-sound");
    if (muteBtn) {
      muteBtn.addEventListener("click", () => {
        sounds.muted = !sounds.muted;
        muteBtn.textContent = sounds.muted ? "Désactivé (Muet)" : "Activé";
        this.showToast(sounds.muted ? "Son coupé" : "Son activé");
      });
    }

    // Calibration Offset
    const calVal = document.getElementById("cal-offset-val");
    document.getElementById("btn-cal-minus")?.addEventListener("click", () => {
      appState.calibrationMs = Math.max(-300, appState.calibrationMs - 20);
      if (calVal) calVal.textContent = `${appState.calibrationMs} ms`;
    });
    document.getElementById("btn-cal-plus")?.addEventListener("click", () => {
      appState.calibrationMs = Math.min(300, appState.calibrationMs + 20);
      if (calVal) calVal.textContent = `${appState.calibrationMs} ms`;
    });
    document.getElementById("btn-cal-test")?.addEventListener("click", () => {
      sounds.playCountdown(0);
      this.showToast(`Test de synchro (${appState.calibrationMs}ms)`);
    });

    // Language toggle
    const langBtn = document.getElementById("btn-setting-lang");
    if (langBtn) {
      langBtn.addEventListener("click", () => {
        appState.lang = appState.lang === "fr" ? "en" : "fr";
        langBtn.textContent = appState.lang.toUpperCase();
        this.showToast(`Langue: ${appState.lang.toUpperCase()}`);
        this.refreshTextLabels();
      });
    }

    // Step Simulation mode toggle
    const simBtn = document.getElementById("btn-setting-sim");
    if (simBtn) {
      simBtn.addEventListener("click", () => {
        appState.simMode = !appState.simMode;
        simBtn.textContent = appState.simMode ? "Activé (Alt+L/R)" : "Désactivé";
        document.getElementById("sim-debug-canvas")?.classList.toggle("show", appState.simMode);
        this.showToast(appState.simMode ? "Mode simulation activé" : "Mode simulation désactivé");
      });
    }
  }

  setupProfileScreen() {
    const nameDisplay = document.getElementById("profile-name-display");
    if (nameDisplay) nameDisplay.textContent = appState.profile.playerName;

    document.getElementById("btn-edit-name")?.addEventListener("click", () => {
      osk.open(appState.profile.playerName, (newName) => {
        appState.profile.playerName = newName || "Joueur TV";
        if (nameDisplay) nameDisplay.textContent = appState.profile.playerName;
        appState.saveProfile();
        this.showToast(`Nom mis à jour: ${appState.profile.playerName}`);
      });
    });

    // Theme selector buttons
    const themeButtons = document.querySelectorAll(".theme-selector-btn");
    themeButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const theme = btn.dataset.theme;
        appState.profile.theme = theme;
        appState.saveProfile();
        themeButtons.forEach(b => b.classList.toggle("active", b.dataset.theme === theme));
        this.showToast(`Thème: ${theme.toUpperCase()}`);
      });
    });

    // Stride length adjust
    const strideVal = document.getElementById("profile-stride-val");
    if (strideVal) strideVal.textContent = `${appState.profile.strideLengthM.toFixed(2)} m`;
    document.getElementById("btn-stride-minus")?.addEventListener("click", () => {
      appState.profile.strideLengthM = Math.max(0.4, Number((appState.profile.strideLengthM - 0.05).toFixed(2)));
      if (strideVal) strideVal.textContent = `${appState.profile.strideLengthM.toFixed(2)} m`;
      appState.saveProfile();
    });
    document.getElementById("btn-stride-plus")?.addEventListener("click", () => {
      appState.profile.strideLengthM = Math.min(1.5, Number((appState.profile.strideLengthM + 0.05).toFixed(2)));
      if (strideVal) strideVal.textContent = `${appState.profile.strideLengthM.toFixed(2)} m`;
      appState.saveProfile();
    });
  }

  refreshTextLabels() {
    const t = I18N[appState.lang];
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.dataset.i18n;
      if (t[key]) el.textContent = t[key];
    });
  }

  /* ==========================================================================
     SECTION 5: LOADING CONTENT FROM FOLDERS + GROUPING BY GENRE
     Strict validation against 5.1 JSON CONTRACT. Tolerant defaults.
     ========================================================================== */

  sanitizeGameData(data, filename) {
    data._filename = filename;
    data.meta = data.meta || {};
    data.video = data.video || {};
    data.game = data.game || {};

    // 1. Meta fields
    data.meta.title = String(data.meta.title || data.video.title || "Sans titre");
    data.meta.genre = String(data.meta.genre || "").trim();
    const diff = (data.meta.difficulty || "normal").toLowerCase();
    data.meta.difficulty = ["easy", "normal", "hard"].includes(diff) ? diff : "normal";

    const defaultLevel = data.meta.difficulty === "easy" ? 1 : data.meta.difficulty === "hard" ? 3 : 2;
    const rawLevel = parseInt(data.meta.level, 10);
    data.meta.level = Number.isInteger(rawLevel) && rawLevel >= 1 ? rawLevel : defaultLevel;

    // 2. Video fields
    data.video.durationSeconds = Number(data.video.durationSeconds) || 180;
    const trimStart = Math.max(0, Number(data.video.trimStart) || 0);
    const trimEnd = Math.max(trimStart + 1, Number(data.video.trimEnd) || data.video.durationSeconds);
    data.video.trimStart = trimStart;
    data.video.trimEnd = trimEnd;
    data.video.cuts = Array.isArray(data.video.cuts) ? data.video.cuts.map(c => ({
      start: Number(c.start) || 0,
      end: Number(c.end) || 0
    })).filter(c => c.end > c.start) : [];
    data.video.audioMuted = Boolean(data.video.audioMuted);

    // Compute effectiveDurationSeconds fallback: trimEnd - trimStart - sum(cuts)
    if (!data.video.effectiveDurationSeconds || Number(data.video.effectiveDurationSeconds) <= 0) {
      let cutTotal = 0;
      for (const cut of data.video.cuts) {
        const cStart = Math.max(trimStart, Math.min(trimEnd, cut.start));
        const cEnd = Math.max(trimStart, Math.min(trimEnd, cut.end));
        if (cEnd > cStart) cutTotal += (cEnd - cStart);
      }
      data.video.effectiveDurationSeconds = Math.max(1, (trimEnd - trimStart) - cutTotal);
    } else {
      data.video.effectiveDurationSeconds = Number(data.video.effectiveDurationSeconds);
    }

    // 3. Game Timeline validation
    const allowedActions = new Set([
      "STARTING COUNT", "GO", "JUMP", "RIGHT", "LEFT", "SLIDE DOWN", "SLASH", "PUNCH", "END", "WIN"
    ]);

    const rawTimeline = Array.isArray(data.game.timeline) ? data.game.timeline : [];
    const validTimeline = [];

    for (const ev of rawTimeline) {
      if (!ev || typeof ev.time !== "number" || isNaN(ev.time)) continue;

      // Normalize action name (accept SLIDE_DOWN or SLIDE DOWN)
      let action = String(ev.action || "").replace(/_/g, " ").trim().toUpperCase();
      if (!allowedActions.has(action)) {
        console.warn(`[${filename}] Ignored unknown action:`, ev.action);
        continue;
      }

      // Ignore events outside trimStart..trimEnd
      if (ev.time < trimStart || ev.time > trimEnd) {
        console.warn(`[${filename}] Ignored event out of trim bounds (${ev.time}s)`);
        continue;
      }

      // Ignore events inside cuts
      const inCut = data.video.cuts.some(c => ev.time >= c.start && ev.time < c.end);
      if (inCut) {
        console.warn(`[${filename}] Ignored event inside cut (${ev.time}s)`);
        continue;
      }

      // Validate onFail / onSuccess
      const parseOutcome = (outcome) => {
        if (!outcome || typeof outcome !== "object") {
          return { enabled: false, seekTo: null };
        }
        let enabled = Boolean(outcome.enabled);
        let seekTo = outcome.seekTo != null && isFinite(outcome.seekTo) ? Number(outcome.seekTo) : null;
        if (outcome.enabled === undefined && seekTo !== null && seekTo >= 0) {
          enabled = true; // legacy support
        }
        return { enabled: enabled && seekTo !== null && seekTo >= 0, seekTo: seekTo };
      };

      validTimeline.push({
        id: String(ev.id || `ev_${validTimeline.length}`),
        time: Number(ev.time),
        action: action,
        showOnScreen: ev.showOnScreen !== false,
        duration: Math.max(0.2, Number(ev.duration) || 1.5),
        points: Number.isFinite(ev.points) ? Number(ev.points) : 100,
        hint: String(ev.hint || ""),
        onFail: parseOutcome(ev.onFail),
        onSuccess: parseOutcome(ev.onSuccess)
      });
    }

    // Sort timeline strictly by time
    validTimeline.sort((a, b) => a.time - b.time);
    data.game.timeline = validTimeline;
  }

  sanitizeRunData(data, filename) {
    data._filename = filename;
    data.meta = data.meta || {};
    data.video = data.video || {};
    data.virtualRun = data.virtualRun || {};

    data.meta.title = String(data.meta.title || data.video.title || "Course Virtuelle");
    data.meta.genre = String(data.meta.genre || "").trim();
    const diff = (data.meta.difficulty || "normal").toLowerCase();
    data.meta.difficulty = ["easy", "normal", "hard"].includes(diff) ? diff : "normal";

    const defaultLevel = data.meta.difficulty === "easy" ? 1 : data.meta.difficulty === "hard" ? 3 : 2;
    const rawLevel = parseInt(data.meta.level, 10);
    data.meta.level = Number.isInteger(rawLevel) && rawLevel >= 1 ? rawLevel : defaultLevel;

    data.video.durationSeconds = Number(data.video.durationSeconds) || 1800;
    const trimStart = Math.max(0, Number(data.video.trimStart) || 0);
    const trimEnd = Math.max(trimStart + 1, Number(data.video.trimEnd) || data.video.durationSeconds);
    data.video.trimStart = trimStart;
    data.video.trimEnd = trimEnd;
    data.video.cuts = Array.isArray(data.video.cuts) ? data.video.cuts.map(c => ({
      start: Number(c.start) || 0,
      end: Number(c.end) || 0
    })).filter(c => c.end > c.start) : [];
    data.video.audioMuted = Boolean(data.video.audioMuted);

    if (!data.video.effectiveDurationSeconds || Number(data.video.effectiveDurationSeconds) <= 0) {
      let cutTotal = 0;
      for (const cut of data.video.cuts) {
        const cStart = Math.max(trimStart, Math.min(trimEnd, cut.start));
        const cEnd = Math.max(trimStart, Math.min(trimEnd, cut.end));
        if (cEnd > cStart) cutTotal += (cEnd - cStart);
      }
      data.video.effectiveDurationSeconds = Math.max(1, (trimEnd - trimStart) - cutTotal);
    } else {
      data.video.effectiveDurationSeconds = Number(data.video.effectiveDurationSeconds);
    }

    // Route fields
    data.virtualRun.route = data.virtualRun.route || {};
    data.virtualRun.route.name = String(data.virtualRun.route.name || data.meta.title);
    if (data.virtualRun.route.totalDistanceKm != null) {
      data.virtualRun.route.totalDistanceKm = Number(data.virtualRun.route.totalDistanceKm);
    }
    if (data.virtualRun.route.elevationGainM != null) {
      data.virtualRun.route.elevationGainM = Number(data.virtualRun.route.elevationGainM);
    }
  }

  getBaseUrl() {
    const href = window.location.href.split('#')[0].split('?')[0];
    if (href.endsWith('.html')) {
      return href.substring(0, href.lastIndexOf('/') + 1);
    }
    return href.endsWith('/') ? href : href + '/';
  }

  async loadGames() {
    const container = document.getElementById("games-shelves-container");
    if (!container) return;

    try {
      const base = this.getBaseUrl();
      const manifestUrl = new URL("games/index.json", base).href;
      const resp = await fetch(manifestUrl);
      if (!resp.ok) throw new Error("Manifest games not found");
      const list = await resp.json();

      const items = [];
      for (const filename of list) {
        try {
          const itemUrl = new URL(`games/${filename}`, base).href;
          const itemResp = await fetch(itemUrl);
          if (itemResp.ok) {
            const data = await itemResp.json();
            // Contract 5.1: type must match folder
            if (data.type !== "game") {
              console.warn(`[${filename}] Skipped: type is not 'game' (${data.type})`);
              continue;
            }
            // videoId must match 11 chars
            if (!data.video?.videoId || !/^[\w-]{11}$/.test(data.video.videoId)) {
              console.warn(`[${filename}] Skipped: invalid videoId (${data.video?.videoId})`);
              continue;
            }
            this.sanitizeGameData(data, filename);
            items.push(data);
          }
        } catch (e) {
          console.warn(`Failed to fetch game ${filename}:`, e);
        }
      }

      this.gamesData = items;
      this.renderShelves(container, items, "game");
    } catch (err) {
      console.error("Error loading games manifest:", err);
      container.innerHTML = `<div class="empty-state">Impossible de charger le manifest ./games/index.json</div>`;
    }
  }

  async loadRuns() {
    const container = document.getElementById("runs-shelves-container");
    if (!container) return;

    try {
      const base = this.getBaseUrl();
      const manifestUrl = new URL("virtual-run/index.json", base).href;
      const resp = await fetch(manifestUrl);
      if (!resp.ok) throw new Error("Manifest virtual-run not found");
      const list = await resp.json();

      const items = [];
      for (const filename of list) {
        try {
          const itemUrl = new URL(`virtual-run/${filename}`, base).href;
          const itemResp = await fetch(itemUrl);
          if (itemResp.ok) {
            const data = await itemResp.json();
            // Contract 5.1: type must match folder
            if (data.type !== "virtual_run") {
              console.warn(`[${filename}] Skipped: type is not 'virtual_run' (${data.type})`);
              continue;
            }
            if (!data.video?.videoId || !/^[\w-]{11}$/.test(data.video.videoId)) {
              console.warn(`[${filename}] Skipped: invalid videoId (${data.video?.videoId})`);
              continue;
            }
            this.sanitizeRunData(data, filename);
            items.push(data);
          }
        } catch (e) {
          console.warn(`Failed to fetch virtual run ${filename}:`, e);
        }
      }

      this.runsData = items;
      this.renderShelves(container, items, "run");
    } catch (err) {
      console.error("Error loading virtual runs manifest:", err);
      container.innerHTML = `<div class="empty-state">Impossible de charger le manifest ./virtual-run/index.json</div>`;
    }
  }

  /**
   * Group items by meta.genre (case-insensitive, preserve first spelling, "Autres" last)
   * Sort inside shelf by meta.level then title.
   * Render horizontal row of fixed banners (UI.banner = 400x225px)
   */
  renderShelves(container, items, type) {
    container.innerHTML = "";
    if (!items || items.length === 0) {
      container.innerHTML = `<div class="empty-state">Aucun contenu trouvé.</div>`;
      return;
    }

    const genreGroups = new Map();
    const otherLabel = I18N[appState.lang].otherGenre;

    items.forEach(item => {
      const rawGenre = (item.meta?.genre || "").trim();
      const genreKey = rawGenre.toLowerCase();
      const displayName = rawGenre || otherLabel;

      if (!genreGroups.has(genreKey)) {
        genreGroups.set(genreKey, { displayName: displayName, items: [] });
      }
      genreGroups.get(genreKey).items.push(item);
    });

    // Sort genres alphabetically, "Autres" / empty last
    const sortedGenres = Array.from(genreGroups.entries()).sort((a, b) => {
      const isAOther = a[0] === "" || a[1].displayName.toLowerCase() === otherLabel.toLowerCase();
      const isBOther = b[0] === "" || b[1].displayName.toLowerCase() === otherLabel.toLowerCase();
      if (isAOther) return 1;
      if (isBOther) return -1;
      return a[1].displayName.localeCompare(b[1].displayName);
    });

    // Build Shelves
    sortedGenres.forEach(([_, group]) => {
      // Sort inside shelf by level then title
      group.items.sort((a, b) => {
        const lvlA = a.meta?.level || 1;
        const lvlB = b.meta?.level || 1;
        if (lvlA !== lvlB) return lvlA - lvlB;
        return (a.meta?.title || "").localeCompare(b.meta?.title || "");
      });

      const shelfRow = document.createElement("div");
      shelfRow.className = "shelf-row";

      const header = document.createElement("div");
      header.className = "shelf-title";
      header.textContent = group.displayName;

      const countBadge = document.createElement("span");
      countBadge.className = "shelf-count";
      countBadge.textContent = `(${group.items.length})`;
      header.appendChild(countBadge);
      shelfRow.appendChild(header);

      const trackWrapper = document.createElement("div");
      trackWrapper.className = "shelf-track-wrapper";

      const track = document.createElement("div");
      track.className = "shelf-track";

      group.items.forEach(item => {
        const card = this.createCardElement(item, type);
        track.appendChild(card);
      });

      trackWrapper.appendChild(track);
      shelfRow.appendChild(trackWrapper);
      container.appendChild(shelfRow);
    });
  }

  createCardElement(item, type) {
    const card = document.createElement("div");
    card.className = "tv-card";
    card.setAttribute("data-focusable", "true");

    const videoId = (item.video?.videoId || "").trim();
    const isValidId = /^[\w-]{11}$/.test(videoId);
    const thumbUrl = isValidId
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : "";

    const title = item.meta?.title || "Sans titre";
    const difficulty = (item.meta?.difficulty || "normal").toLowerCase();
    const level = item.meta?.level || 1;
    const duration = Math.round(item.video?.effectiveDurationSeconds || item.video?.durationSeconds || 180);
    const minutes = Math.floor(duration / 60);
    const seconds = String(duration % 60).padStart(2, "0");

    // Thumb wrap with fallback
    const thumbWrap = document.createElement("div");
    thumbWrap.className = "tv-card-thumb-wrap";

    if (thumbUrl) {
      const img = document.createElement("img");
      img.className = "tv-card-thumb";
      img.src = thumbUrl;
      img.alt = title;
      img.referrerPolicy = "no-referrer";
      img.onerror = () => {
        img.style.display = "none";
      };
      thumbWrap.appendChild(img);
    }

    // Gradient Overlay with text & metadata (no innerHTML for safety)
    const gradient = document.createElement("div");
    gradient.className = "tv-card-gradient";

    const titleEl = document.createElement("div");
    titleEl.className = "tv-card-title";
    titleEl.textContent = title;
    gradient.appendChild(titleEl);

    const metaRow = document.createElement("div");
    metaRow.className = "tv-card-meta";

    const diffBadge = document.createElement("span");
    diffBadge.className = `tv-badge badge-${difficulty}`;
    diffBadge.textContent = difficulty.toUpperCase();
    metaRow.appendChild(diffBadge);

    const durSpan = document.createElement("span");
    durSpan.textContent = `${minutes}:${seconds}`;
    metaRow.appendChild(durSpan);

    const lvlSpan = document.createElement("span");
    lvlSpan.textContent = `Nv.${level}`;
    metaRow.appendChild(lvlSpan);

    // Route badges for Virtual Run (totalDistanceKm, elevationGainM)
    if (type === "run" && item.virtualRun?.route) {
      const route = item.virtualRun.route;
      if (route.totalDistanceKm && route.totalDistanceKm > 0) {
        const distBadge = document.createElement("span");
        distBadge.textContent = `${route.totalDistanceKm} km`;
        metaRow.appendChild(distBadge);
      }
      if (route.elevationGainM && route.elevationGainM > 0) {
        const elevBadge = document.createElement("span");
        elevBadge.textContent = `+${route.elevationGainM}m D+`;
        metaRow.appendChild(elevBadge);
      }
    }

    // Profile record
    if (type === "game") {
      const best = appState.profile.bestScores[item._filename] || 0;
      if (best > 0) {
        const scoreSpan = document.createElement("span");
        scoreSpan.className = "best-score-tag";
        scoreSpan.textContent = `★ ${best}`;
        metaRow.appendChild(scoreSpan);
      }
    } else {
      const bestRun = appState.profile.bestRuns[item._filename];
      if (bestRun) {
        const distSpan = document.createElement("span");
        distSpan.className = "best-score-tag";
        distSpan.textContent = `★ ${bestRun.distanceKm.toFixed(1)} km`;
        metaRow.appendChild(distSpan);
      }
    }

    gradient.appendChild(metaRow);
    thumbWrap.appendChild(gradient);
    card.appendChild(thumbWrap);

    // Click handler triggers game or run mode
    card.addEventListener("click", () => {
      if (type === "game") {
        gameEngine.start(item);
      } else {
        runEngine.start(item);
      }
    });

    return card;
  }
}

export const appUI = new AppUI();

/**
 * TV-Friendly On-Screen Keyboard (D-Pad Navigable)
 */
class OnScreenKeyboard {
  constructor() {
    this.modal = document.getElementById("modal-osk");
    this.display = document.getElementById("osk-input-text");
    this.currentText = "";
    this.onDoneCallback = null;
    this.setupGrid();
  }

  setupGrid() {
    const keys = [
      ["A", "B", "C", "D", "E", "F", "1", "2", "3"],
      ["G", "H", "I", "J", "K", "L", "4", "5", "6"],
      ["M", "N", "O", "P", "Q", "R", "7", "8", "9"],
      ["S", "T", "U", "V", "W", "X", "Y", "Z", "0"],
      ["ESPACE", "EFFACER", "VALIDER"]
    ];

    const grid = document.getElementById("osk-keys-container");
    if (!grid) return;
    grid.innerHTML = "";

    keys.forEach(row => {
      const rowEl = document.createElement("div");
      rowEl.className = "osk-row";
      row.forEach(k => {
        const btn = document.createElement("button");
        btn.className = "osk-key";
        btn.setAttribute("data-focusable", "true");
        btn.textContent = k;

        if (k === "ESPACE") btn.classList.add("space");
        if (k === "EFFACER" || k === "VALIDER") btn.classList.add("wide");

        btn.addEventListener("click", () => this.handleKeyPress(k));
        rowEl.appendChild(btn);
      });
      grid.appendChild(rowEl);
    });
  }

  open(initialText, callback) {
    this.currentText = initialText || "";
    this.onDoneCallback = callback;
    if (this.display) this.display.textContent = this.currentText;
    appUI.openModal("modal-osk");
  }

  handleKeyPress(key) {
    if (key === "ESPACE") {
      this.currentText += " ";
    } else if (key === "EFFACER") {
      this.currentText = this.currentText.slice(0, -1);
    } else if (key === "VALIDER") {
      appUI.closeModal("modal-osk");
      if (this.onDoneCallback) this.onDoneCallback(this.currentText.trim());
      return;
    } else {
      if (this.currentText.length < 24) {
        this.currentText += key;
      }
    }
    if (this.display) this.display.textContent = this.currentText;
  }
}

export const osk = new OnScreenKeyboard();

/* ==========================================================================
   LAYER 3: ENGINES (VIDEO CONTROLLER, GAME ENGINE, RUN ENGINE)
   ========================================================================== */

/**
 * YouTube Player Controller with Non-Destructive Live Cut/Trim Support
 */
class VideoController {
  constructor() {
    this.player = null;
    this.isReady = false;
    this.watcherInterval = null;
    this.config = null; // current video edit config
    this.lastPolledTime = 0;
    this.lastPollTimestamp = 0;
  }

  initApi() {
    return new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve();
        return;
      }
      window.onYouTubeIframeAPIReady = () => {
        resolve();
      };
      if (!document.getElementById("yt-api-script")) {
        const tag = document.createElement("script");
        tag.id = "yt-api-script";
        tag.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(tag);
      }
    });
  }

  async loadVideo(videoConfig) {
    await this.initApi();
    this.config = videoConfig;

    return new Promise((resolve, reject) => {
      const container = document.getElementById("yt-iframe-placeholder");
      if (!container) return reject(new Error("Container not found"));

      // If player already exists, load videoById
      if (this.player && typeof this.player.loadVideoById === "function") {
        this.player.loadVideoById({
          videoId: videoConfig.videoId,
          startSeconds: videoConfig.trimStart || 0
        });
        if (videoConfig.audioMuted) this.player.mute();
        else this.player.unMute();
        this.startWatcher();
        resolve(this.player);
        return;
      }

      // Create player
      this.player = new window.YT.Player("yt-iframe-placeholder", {
        videoId: videoConfig.videoId,
        playerVars: {
          controls: 0,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          disablekb: 1,
          origin: window.location.origin
        },
        events: {
          onReady: (e) => {
            this.isReady = true;
            if (videoConfig.audioMuted) e.target.mute();
            this.startWatcher();
            resolve(e.target);
          },
          onError: (e) => {
            console.error("YouTube Player error:", e.data);
            appUI.showToast(`Erreur vidéo (${e.data}). Vérifiez la connexion.`);
          }
        }
      });
    });
  }

  startWatcher() {
    if (this.watcherInterval) clearInterval(this.watcherInterval);
    this.lastPolledTime = 0;
    this.lastPollTimestamp = performance.now();

    // 50ms polling + performance.now() interpolation
    this.watcherInterval = setInterval(() => {
      if (!this.player || typeof this.player.getCurrentTime !== "function") return;
      try {
        const rawTime = this.player.getCurrentTime();
        this.lastPolledTime = rawTime;
        this.lastPollTimestamp = performance.now();

        if (!this.config) return;

        // 1. Clamp trimStart
        const trimStart = this.config.trimStart || 0;
        if (rawTime < trimStart - 0.5) {
          this.player.seekTo(trimStart, true);
          return;
        }

        // 2. Stop at trimEnd
        const trimEnd = this.config.trimEnd;
        if (trimEnd && rawTime >= trimEnd) {
          bus.emit("VIDEO_REACHED_END");
          return;
        }

        // 3. Skip cuts non-destructively
        const cuts = this.config.cuts || [];
        for (const cut of cuts) {
          if (rawTime >= cut.start && rawTime < cut.end) {
            // Seek past cut end
            this.player.seekTo(cut.end + 0.05, true);
            break;
          }
        }
      } catch (_) {}
    }, 50);
  }

  getInterpolatedOriginalTime() {
    if (!this.player) return 0;
    const elapsedSec = (performance.now() - this.lastPollTimestamp) / 1000;
    return this.lastPolledTime + elapsedSec;
  }

  stop() {
    if (this.watcherInterval) clearInterval(this.watcherInterval);
    try {
      if (this.player && typeof this.player.stopVideo === "function") {
        this.player.stopVideo();
      }
    } catch (_) {}
  }
}

export const videoController = new VideoController();

/**
 * GameEngine: Rhythm Game Mode with Outcome Seeks, Scoring, and Canvas Feedback
 */
class GameEngine {
  constructor() {
    this.active = false;
    this.currentGame = null;
    this.timeline = [];
    this.judgedEvents = new Set();
    this.score = 0;
    this.combo = 0;
    this.multiplier = 1;
    this.lives = 3;
    this.misses = 0;
    this.seekGracePeriodUntil = 0; // ms
    this.canvas = null;
    this.ctx = null;
    this.rafLoopId = null;
    this.activeCues = []; // visual cues drawn on canvas
    this.unsubEvents = [];
  }

  start(gameData) {
    this.stop();
    this.active = true;
    appState.inGame = true;
    this.currentGame = gameData;
    this.score = 0;
    this.combo = 0;
    this.multiplier = 1;
    this.misses = 0;

    const rules = Object.assign({}, GAME_RULES_DEFAULT, gameData.game?.rules);
    this.lives = rules.maxLives;

    // Clone and prepare timeline
    this.timeline = (gameData.game?.timeline || []).map(ev => Object.assign({}, ev));
    this.judgedEvents.clear();

    // Show Video Stage & Game HUD
    document.getElementById("video-stage")?.classList.add("active");
    document.getElementById("game-hud")?.classList.remove("hidden");
    document.getElementById("run-hud")?.classList.add("hidden");
    this.updateHUD();

    // Canvas setup
    this.canvas = document.getElementById("game-feedback-canvas");
    if (this.canvas) {
      this.canvas.width = 1920;
      this.canvas.height = 1080;
      this.ctx = this.canvas.getContext("2d");
    }

    // Subscribe to semantic game actions
    this.unsubEvents = [
      bus.on("JUMP", () => this.handlePlayerAction("JUMP")),
      bus.on("RIGHT", () => this.handlePlayerAction("RIGHT")),
      bus.on("LEFT", () => this.handlePlayerAction("LEFT")),
      bus.on("SLIDE_DOWN", () => this.handlePlayerAction("SLIDE_DOWN")),
      bus.on("SLASH", () => this.handlePlayerAction("SLASH")),
      bus.on("PUNCH", () => this.handlePlayerAction("PUNCH")),
      bus.on("VIDEO_REACHED_END", () => this.handleVictory())
    ];

    notifyAndroid("GAME_STARTED", { gameTitle: gameData.meta?.title });

    // Load and play video
    videoController.loadVideo(gameData.video).then(() => {
      this.runGameLoop();
    });
  }

  stop() {
    this.active = false;
    appState.inGame = false;
    if (this.rafLoopId) cancelAnimationFrame(this.rafLoopId);
    this.unsubEvents.forEach(unsub => unsub());
    this.unsubEvents = [];
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  runGameLoop() {
    if (!this.active) return;

    const currentTime = videoController.getInterpolatedOriginalTime() + (appState.calibrationMs / 1000);
    this.processTimeline(currentTime);
    this.renderCanvasFeedback(currentTime);
    this.updateTimelineBar(currentTime);

    this.rafLoopId = requestAnimationFrame(() => this.runGameLoop());
  }

  processTimeline(currentTime) {
    const rules = this.currentGame.game?.rules || GAME_RULES_DEFAULT;
    const windowGoodSec = (rules.timingWindowMs?.good || 300) / 1000;

    for (const ev of this.timeline) {
      if (this.judgedEvents.has(ev.id)) continue;

      // System events: STARTING COUNT, GO, END, WIN
      if (ev.action === "STARTING COUNT") {
        if (currentTime >= ev.time && currentTime < ev.time + 3.0) {
          const count = 3 - Math.floor(currentTime - ev.time);
          if (ev._lastCount !== count && count > 0) {
            ev._lastCount = count;
            sounds.playCountdown(count);
            this.addVisualCue(`COUNT_${count}`, count.toString(), 900);
          }
        } else if (currentTime >= ev.time + 3.0) {
          this.judgedEvents.add(ev.id);
        }
        continue;
      }

      if (ev.action === "GO") {
        if (currentTime >= ev.time && !ev._triggered) {
          ev._triggered = true;
          sounds.playCountdown(0);
          this.addVisualCue("GO", "GO !", 1000);
          this.judgedEvents.add(ev.id);
        }
        continue;
      }

      if (ev.action === "END" || ev.action === "WIN") {
        if (currentTime >= ev.time) {
          this.judgedEvents.add(ev.id);
          this.handleVictory();
          return;
        }
        continue;
      }

      // Check MISS for PLAYER actions (passed time + window without input)
      if (performance.now() > this.seekGracePeriodUntil) {
        if (currentTime > ev.time + windowGoodSec) {
          this.judgedEvents.add(ev.id);
          this.handleFail(ev, "MISS");
        }
      }
    }
  }

  handlePlayerAction(action) {
    if (!this.active) return;
    const currentTime = videoController.getInterpolatedOriginalTime() + (appState.calibrationMs / 1000);
    const rules = this.currentGame.game?.rules || GAME_RULES_DEFAULT;
    const windowPerfectSec = (rules.timingWindowMs?.perfect || 120) / 1000;
    const windowGoodSec = (rules.timingWindowMs?.good || 300) / 1000;

    const normAction = (a) => String(a || "").replace(/_/g, " ").trim().toUpperCase();
    const inputActionNorm = normAction(action);

    // Find nearest pending player event
    let targetEv = null;
    let minDelta = Infinity;

    for (const ev of this.timeline) {
      if (this.judgedEvents.has(ev.id)) continue;
      // Skip system events
      if (["STARTING COUNT", "GO", "END", "WIN"].includes(ev.action)) continue;

      const delta = Math.abs(currentTime - ev.time);
      if (delta <= windowGoodSec && delta < minDelta) {
        minDelta = delta;
        targetEv = ev;
      }
    }

    if (!targetEv) {
      // Pressed wrong timing or spurious action
      return;
    }

    // Check if matching action
    if (normAction(targetEv.action) === inputActionNorm) {
      this.judgedEvents.add(targetEv.id);
      const isPerfect = minDelta <= windowPerfectSec;
      this.handleSuccess(targetEv, isPerfect);
    } else {
      // Wrong action triggered
      this.judgedEvents.add(targetEv.id);
      this.handleFail(targetEv, "WRONG");
    }
  }

  handleSuccess(ev, isPerfect) {
    const rules = this.currentGame.game?.rules || GAME_RULES_DEFAULT;
    const basePts = isPerfect ? (rules.scoring?.perfect || 100) : (rules.scoring?.good || 50);

    this.combo++;
    const step = rules.scoring?.comboMultiplierStep || 5;
    const maxMult = rules.scoring?.maxMultiplier || 4;
    this.multiplier = Math.min(maxMult, 1 + Math.floor(this.combo / step));

    const earned = basePts * this.multiplier;
    this.score += earned;

    sounds.playSuccess(isPerfect);
    if (ev.showOnScreen !== false) {
      this.addVisualCue(isPerfect ? "PERFECT" : "GOOD", isPerfect ? "PARFAIT !" : "BIEN !", 700);
    }
    this.updateHUD();

    // OUTCOME SEEK: onSuccess check
    if (ev.onSuccess && ev.onSuccess.enabled === true && typeof ev.onSuccess.seekTo === "number" && isFinite(ev.onSuccess.seekTo) && ev.onSuccess.seekTo >= 0) {
      this.applyOutcomeSeek(ev.onSuccess.seekTo, "SUCCÈS !");
    }
  }

  handleFail(ev, reason) {
    this.combo = 0;
    this.multiplier = 1;
    this.lives = Math.max(0, this.lives - 1);
    this.misses++;

    sounds.playFail();
    if (ev.showOnScreen !== false) {
      this.addVisualCue("FAIL", reason === "WRONG" ? "MAUVAIS MOUVEMENT" : "RATÉ !", 800);
    }
    this.updateHUD();

    // Check GAME OVER condition first (priority over seek!)
    const rules = this.currentGame.game?.rules || GAME_RULES_DEFAULT;
    if (this.lives <= 0 || this.misses >= (rules.maxMisses || 5)) {
      this.handleGameOver();
      return;
    }

    // OUTCOME SEEK: onFail check
    if (ev.onFail && ev.onFail.enabled === true && typeof ev.onFail.seekTo === "number" && isFinite(ev.onFail.seekTo) && ev.onFail.seekTo >= 0) {
      this.applyOutcomeSeek(ev.onFail.seekTo, "RATÉ !");
    }
  }

  applyOutcomeSeek(seekToTime, bannerLabel) {
    if (!videoController.player) return;

    // Clamp seekTo within video trim bounds and skip cuts
    let target = Math.max(this.currentGame.video.trimStart || 0, seekToTime);
    if (this.currentGame.video.trimEnd && target > this.currentGame.video.trimEnd) {
      target = this.currentGame.video.trimEnd - 1;
    }

    const cuts = this.currentGame.video.cuts || [];
    for (const cut of cuts) {
      if (target >= cut.start && target < cut.end) {
        target = cut.end + 0.1;
      }
    }

    videoController.player.seekTo(target, true);

    // Re-arm timeline events: >= seekTo is pending, < seekTo is judged
    this.judgedEvents.clear();
    for (const ev of this.timeline) {
      if (ev.time < target) {
        this.judgedEvents.add(ev.id);
      }
    }

    // 900ms miss-detection grace period
    this.seekGracePeriodUntil = performance.now() + 900;

    // Show on-screen seek banner (e.g. "RATÉ ! ↪ 3:03")
    const minutes = Math.floor(target / 60);
    const seconds = String(Math.floor(target % 60)).padStart(2, "0");
    const banner = document.getElementById("seek-toast-banner");
    if (banner) {
      banner.textContent = `${bannerLabel} ↪ ${minutes}:${seconds}`;
      banner.classList.add("show");
      setTimeout(() => banner.classList.remove("show"), 2000);
    }
  }

  handleGameOver() {
    this.stop();
    sounds.playGameOver();
    notifyAndroid("GAME_FINISHED", { result: "GAMEOVER", score: this.score });
    appUI.showToast("GAME OVER ! Réessayez !");
    this.showSummaryScreen("GAME OVER", false);
  }

  handleVictory() {
    this.stop();
    sounds.playWin();

    // Save best score to profile
    const best = appState.profile.bestScores[this.currentGame._filename] || 0;
    if (this.score > best) {
      appState.profile.bestScores[this.currentGame._filename] = this.score;
      appState.saveProfile();
    }

    notifyAndroid("GAME_FINISHED", { result: "WIN", score: this.score, bestScore: Math.max(best, this.score) });
    this.showSummaryScreen("VICTOIRE !", true);
  }

  showSummaryScreen(heroTitle, isWin) {
    const overlay = document.getElementById("modal-summary");
    if (!overlay) return;

    document.getElementById("summary-hero-title").textContent = heroTitle;
    document.getElementById("summary-stat-1-val").textContent = this.score;
    document.getElementById("summary-stat-1-lbl").textContent = "Score Final";

    const best = appState.profile.bestScores[this.currentGame._filename] || this.score;
    document.getElementById("summary-stat-2-val").textContent = best;
    document.getElementById("summary-stat-2-lbl").textContent = "Meilleur Score";

    document.getElementById("summary-stat-3-val").textContent = `${this.misses}`;
    document.getElementById("summary-stat-3-lbl").textContent = "Fautes";

    document.getElementById("btn-summary-replay").onclick = () => {
      appUI.closeModal("modal-summary");
      this.start(this.currentGame);
    };

    document.getElementById("btn-summary-back").onclick = () => {
      appUI.closeModal("modal-summary");
      document.getElementById("video-stage")?.classList.remove("active");
      appUI.navigateScreen("games");
    };

    appUI.openModal("modal-summary");
  }

  updateHUD() {
    const scoreVal = document.getElementById("hud-game-score");
    if (scoreVal) scoreVal.textContent = this.score;

    const comboVal = document.getElementById("hud-game-combo");
    if (comboVal) comboVal.textContent = `x${this.multiplier} (${this.combo})`;

    // Hearts representation
    const heartsWrap = document.getElementById("hud-lives-container");
    if (heartsWrap) {
      heartsWrap.innerHTML = "";
      for (let i = 0; i < 4; i++) {
        const heart = document.createElement("div");
        heart.innerHTML = `<svg class="heart-icon ${i >= this.lives ? 'lost' : ''}" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
        heartsWrap.appendChild(heart.firstChild);
      }
    }
  }

  updateTimelineBar(currentTime) {
    const start = this.currentGame.video.trimStart || 0;
    const end = this.currentGame.video.trimEnd || 200;
    const progress = Math.max(0, Math.min(100, ((currentTime - start) / (end - start)) * 100));

    const fill = document.getElementById("game-timeline-progress");
    if (fill) fill.style.width = `${progress}%`;

    // Next upcoming event preview (skip showOnScreen: false and system events like WIN/END)
    const nextEv = this.timeline.find(ev => !this.judgedEvents.has(ev.id) && ev.time >= currentTime && ev.showOnScreen !== false);
    const spotlight = document.getElementById("game-next-cue-spotlight");
    if (spotlight && nextEv) {
      spotlight.style.display = "flex";
      const icon = document.getElementById("next-cue-icon");
      const text = document.getElementById("next-cue-text");
      const hint = document.getElementById("next-cue-hint");

      if (icon) icon.textContent = this.getActionInitial(nextEv.action);
      if (text) text.textContent = nextEv.action;
      if (hint) hint.textContent = nextEv.hint || "";
    } else if (spotlight) {
      spotlight.style.display = "none";
    }
  }

  getActionInitial(action) {
    const norm = String(action || "").replace(/_/g, " ").trim().toUpperCase();
    switch (norm) {
      case "JUMP": return "↑";
      case "SLIDE DOWN": return "↓";
      case "LEFT": return "←";
      case "RIGHT": return "→";
      case "PUNCH": return "👊";
      case "SLASH": return "⚔️";
      default: return "★";
    }
  }

  addVisualCue(type, text, durationMs = 800) {
    this.activeCues.push({
      type,
      text,
      startTime: performance.now(),
      endTime: performance.now() + durationMs
    });
  }

  renderCanvasFeedback(currentTime) {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const now = performance.now();
    this.activeCues = this.activeCues.filter(cue => now < cue.endTime);

    // Draw active cues
    for (const cue of this.activeCues) {
      const p = (now - cue.startTime) / (cue.endTime - cue.startTime);
      const scale = 1.0 + Math.sin(p * Math.PI) * 0.3;
      const opacity = 1.0 - Math.pow(p, 3);

      this.ctx.save();
      this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2 - 40);
      this.ctx.scale(scale, scale);
      this.ctx.globalAlpha = opacity;

      if (cue.type === "PERFECT") {
        this.ctx.fillStyle = "#34d399";
        this.ctx.font = "900 84px system-ui";
        this.ctx.textAlign = "center";
        this.ctx.shadowColor = "#34d399";
        this.ctx.shadowBlur = 30;
        this.ctx.fillText(cue.text, 0, 0);
      } else if (cue.type === "GOOD") {
        this.ctx.fillStyle = "#60a5fa";
        this.ctx.font = "800 72px system-ui";
        this.ctx.textAlign = "center";
        this.ctx.shadowColor = "#60a5fa";
        this.ctx.shadowBlur = 20;
        this.ctx.fillText(cue.text, 0, 0);
      } else if (cue.type === "FAIL") {
        this.ctx.fillStyle = "#ef4444";
        this.ctx.font = "900 76px system-ui";
        this.ctx.textAlign = "center";
        this.ctx.shadowColor = "#ef4444";
        this.ctx.shadowBlur = 24;
        this.ctx.fillText(cue.text, 0, 0);
      } else if (cue.type.startsWith("COUNT_") || cue.type === "GO") {
        this.ctx.fillStyle = "#fbbf24";
        this.ctx.font = "900 120px system-ui";
        this.ctx.textAlign = "center";
        this.ctx.shadowColor = "#fbbf24";
        this.ctx.shadowBlur = 40;
        this.ctx.fillText(cue.text, 0, 0);
      }
      this.ctx.restore();
    }
  }
}

export const gameEngine = new GameEngine();

/**
 * RunEngine: Virtual Run Mode with Real-Time Step Processing and Video Playback Speed
 */
class RunEngine {
  constructor() {
    this.active = false;
    this.currentRun = null;
    this.stepTimestamps = []; // sliding window of performance.now()
    this.totalSteps = 0;
    this.leftSteps = 0;
    this.rightSteps = 0;
    this.distanceKm = 0;
    this.movingTimeSec = 0;
    this.smoothedSpeedKmh = 0;
    this.currentCadenceSpm = 0;
    this.maxSpeedKmh = 0;
    this.lastStepTime = 0;
    this.lastRateChangeTime = 0;
    this.timerInterval = null;
    this.rafLoopId = null;
    this.unsubEvents = [];
    this.stepIntervalHistory = []; // for simulation debug canvas
  }

  start(runData) {
    this.stop();
    this.active = true;
    appState.inRun = true;
    this.currentRun = runData;

    this.stepTimestamps = [];
    this.totalSteps = 0;
    this.leftSteps = 0;
    this.rightSteps = 0;
    this.distanceKm = 0;
    this.movingTimeSec = 0;
    this.smoothedSpeedKmh = 0;
    this.currentCadenceSpm = 0;
    this.maxSpeedKmh = 0;
    this.lastStepTime = performance.now();
    this.lastRateChangeTime = 0;

    // Show Video Stage & Run HUD
    document.getElementById("video-stage")?.classList.add("active");
    document.getElementById("run-hud")?.classList.remove("hidden");
    document.getElementById("game-hud")?.classList.add("hidden");

    this.unsubEvents = [
      bus.on("STEP_LEFT", () => this.handleStep("LEFT")),
      bus.on("STEP_RIGHT", () => this.handleStep("RIGHT")),
      bus.on("VIDEO_REACHED_END", () => this.handleEnd())
    ];

    notifyAndroid("RUN_STARTED", { routeName: runData.virtualRun?.route?.name });

    // Load video
    videoController.loadVideo(runData.video).then(() => {
      this.startMovingClock();
      this.runEngineLoop();
    });
  }

  stop() {
    this.active = false;
    appState.inRun = false;
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.rafLoopId) cancelAnimationFrame(this.rafLoopId);
    this.unsubEvents.forEach(unsub => unsub());
    this.unsubEvents = [];
  }

  handleStep(foot) {
    if (!this.active) return;
    const now = performance.now();

    // Reject bounce < 150ms
    if (now - this.lastStepTime < RUN_CONFIG_DEFAULT.minStepIntervalMs) {
      return;
    }

    const interval = now - this.lastStepTime;
    this.lastStepTime = now;
    sounds.playStep();

    // Increment step counts
    this.totalSteps++;
    if (foot === "LEFT") this.leftSteps++;
    else this.rightSteps++;

    // Step flash indicator on HUD
    const footEl = document.getElementById(foot === "LEFT" ? "foot-left-ind" : "foot-right-ind");
    if (footEl) {
      footEl.classList.add("flash");
      setTimeout(() => footEl.classList.remove("flash"), 120);
    }

    // Slide window of last 6 steps
    this.stepTimestamps.push(now);
    if (this.stepTimestamps.length > RUN_CONFIG_DEFAULT.cadenceWindow) {
      this.stepTimestamps.shift();
    }

    // Interval history for debug graph
    if (interval < 5000) {
      this.stepIntervalHistory.push(interval);
      if (this.stepIntervalHistory.length > 50) this.stepIntervalHistory.shift();
    }

    // Calculate cadence and speed
    this.updateMetricsFromSteps();

    // Distance in km
    this.distanceKm = (this.totalSteps * appState.profile.strideLengthM) / 1000;

    // If video was paused by idle, resume it!
    if (videoController.player && typeof videoController.player.playVideo === "function") {
      try {
        if (videoController.player.getPlayerState() === 2) {
          videoController.player.playVideo();
        }
      } catch (_) {}
    }
  }

  updateMetricsFromSteps() {
    if (this.stepTimestamps.length < 2) return;

    // Calculate intervals between consecutive steps
    const intervals = [];
    for (let i = 1; i < this.stepTimestamps.length; i++) {
      intervals.push(this.stepTimestamps[i] - this.stepTimestamps[i - 1]);
    }

    // Median filter to reject outliers
    intervals.sort((a, b) => a - b);
    const medianIntervalMs = intervals[Math.floor(intervals.length / 2)];

    if (medianIntervalMs > 0) {
      // Cadence (SPM)
      this.currentCadenceSpm = Math.round(60000 / medianIntervalMs);

      // Raw speed (km/h) = (strideLengthM / stepSec) * 3.6
      const stepSec = medianIntervalMs / 1000;
      const rawSpeedKmh = (appState.profile.strideLengthM / stepSec) * 3.6;

      // Exponential Moving Average (alpha 0.35)
      this.smoothedSpeedKmh = this.smoothedSpeedKmh === 0
        ? rawSpeedKmh
        : (this.smoothedSpeedKmh * 0.65 + rawSpeedKmh * 0.35);

      if (this.smoothedSpeedKmh > this.maxSpeedKmh) {
        this.maxSpeedKmh = this.smoothedSpeedKmh;
      }
    }
  }

  startMovingClock() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (!this.active) return;
      const now = performance.now();

      // Check idle timeout (>2.5s without step)
      if (now - this.lastStepTime > RUN_CONFIG_DEFAULT.idleTimeoutMs) {
        // Player has stopped
        this.smoothedSpeedKmh = Math.max(0, this.smoothedSpeedKmh * 0.7);
        if (this.smoothedSpeedKmh < 0.5) this.smoothedSpeedKmh = 0;
        this.currentCadenceSpm = 0;

        // Auto-pause video when stopped
        if (videoController.player && typeof videoController.player.pauseVideo === "function") {
          try {
            if (videoController.player.getPlayerState() === 1) {
              videoController.player.pauseVideo();
            }
          } catch (_) {}
        }
      } else {
        // Active moving time
        this.movingTimeSec++;
      }

      this.adjustVideoPlaybackSpeed();
      this.updateHUD();
    }, 1000);
  }

  runEngineLoop() {
    if (!this.active) return;
    this.updateProgressBar();
    if (appState.simMode) this.renderSimDebugGraph();
    this.rafLoopId = requestAnimationFrame(() => this.runEngineLoop());
  }

  adjustVideoPlaybackSpeed() {
    if (!videoController.player || typeof videoController.player.setPlaybackRate !== "function") return;
    const now = performance.now();
    if (now - this.lastRateChangeTime < RUN_CONFIG_DEFAULT.rateChangeMinDelayMs) return;

    const refSpeed = this.currentRun.virtualRun?.speedMapping?.referenceSpeedKmh || RUN_CONFIG_DEFAULT.referenceSpeedKmh;
    let targetRate = this.smoothedSpeedKmh / refSpeed;
    if (this.smoothedSpeedKmh === 0) targetRate = 1.0; // keep neutral if idle

    // Clamp [0.25, 2.0]
    targetRate = Math.max(0.25, Math.min(2.0, targetRate));

    // Snap to available YouTube playback rates
    const avail = videoController.player.getAvailablePlaybackRates?.() || [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    let closestRate = avail[0];
    let minDiff = Infinity;
    for (const r of avail) {
      const diff = Math.abs(r - targetRate);
      if (diff < minDiff) {
        minDiff = diff;
        closestRate = r;
      }
    }

    try {
      const currentRate = videoController.player.getPlaybackRate();
      if (currentRate !== closestRate) {
        videoController.player.setPlaybackRate(closestRate);
        this.lastRateChangeTime = now;
        const rateLabel = document.getElementById("hud-metric-rate");
        if (rateLabel) rateLabel.textContent = `${closestRate}x`;
      }
    } catch (_) {}
  }

  updateHUD() {
    // 1. Speed (km/h)
    const speedEl = document.getElementById("hud-metric-speed");
    if (speedEl) speedEl.textContent = this.smoothedSpeedKmh.toFixed(1);

    // 2. Pace (min/km)
    const paceEl = document.getElementById("hud-metric-pace");
    if (paceEl) {
      if (this.smoothedSpeedKmh > 1.0) {
        const paceMin = 60 / this.smoothedSpeedKmh;
        const pM = Math.floor(paceMin);
        const pS = String(Math.floor((paceMin % 1) * 60)).padStart(2, "0");
        paceEl.textContent = `${pM}'${pS}"`;
      } else {
        paceEl.textContent = "--'--\"";
      }
    }

    // 3. Distance (m if < 1000, km if >= 1000)
    const distEl = document.getElementById("hud-metric-dist");
    const distUnit = document.getElementById("hud-metric-dist-unit");
    if (distEl) {
      if (this.distanceKm < 1.0) {
        distEl.textContent = Math.round(this.distanceKm * 1000);
        if (distUnit) distUnit.textContent = "m";
      } else {
        distEl.textContent = this.distanceKm.toFixed(2);
        if (distUnit) distUnit.textContent = "km";
      }
    }

    // 4. Time (MM:SS)
    const timeEl = document.getElementById("hud-metric-time");
    if (timeEl) {
      const m = Math.floor(this.movingTimeSec / 60);
      const s = String(this.movingTimeSec % 60).padStart(2, "0");
      timeEl.textContent = `${m}:${s}`;
    }

    // 5. Steps (total with L/R split)
    const stepsEl = document.getElementById("hud-metric-steps");
    if (stepsEl) stepsEl.textContent = `${this.totalSteps} (G:${this.leftSteps} D:${this.rightSteps})`;

    // 6. Cadence (SPM)
    const cadEl = document.getElementById("hud-metric-cadence");
    if (cadEl) cadEl.textContent = this.currentCadenceSpm;
  }

  updateProgressBar() {
    const rawTime = videoController.getInterpolatedOriginalTime();
    const start = this.currentRun.video.trimStart || 0;
    const end = this.currentRun.video.trimEnd || 200;
    const p = Math.max(0, Math.min(100, ((rawTime - start) / (end - start)) * 100));

    const fill = document.getElementById("run-bottom-progress-fill");
    if (fill) fill.style.width = `${p}%`;
  }

  handleEnd() {
    this.stop();
    sounds.playWin();

    // Calories calculation (MET formula): Running MET ~ 8.0
    const hours = this.movingTimeSec / 3600;
    const calories = Math.round(8.0 * (appState.profile.weightKg || 70) * hours);
    const avgSpeed = hours > 0 ? (this.distanceKm / hours) : 0;

    // Save best run to profile
    const best = appState.profile.bestRuns[this.currentRun._filename];
    if (!best || this.distanceKm > best.distanceKm) {
      appState.profile.bestRuns[this.currentRun._filename] = {
        distanceKm: this.distanceKm,
        steps: this.totalSteps,
        avgSpeed: avgSpeed,
        movingTimeSec: this.movingTimeSec
      };
      appState.saveProfile();
    }

    const summaryPayload = {
      routeName: this.currentRun.virtualRun?.route?.name || "Parcours Virtuel",
      totalSteps: this.totalSteps,
      leftSteps: this.leftSteps,
      rightSteps: this.rightSteps,
      distanceKm: this.distanceKm,
      movingTimeSec: this.movingTimeSec,
      avgSpeedKmh: avgSpeed,
      maxSpeedKmh: this.maxSpeedKmh,
      calories: calories
    };

    notifyAndroid("RUN_FINISHED", summaryPayload);
    this.showRunSummaryModal(summaryPayload);
  }

  showRunSummaryModal(summary) {
    const overlay = document.getElementById("modal-summary");
    if (!overlay) return;

    document.getElementById("summary-hero-title").textContent = I18N[appState.lang].runCompleted;
    document.getElementById("summary-stat-1-val").textContent = `${summary.distanceKm.toFixed(2)} km`;
    document.getElementById("summary-stat-1-lbl").textContent = "Distance Totale";

    document.getElementById("summary-stat-2-val").textContent = `${summary.totalSteps}`;
    document.getElementById("summary-stat-2-lbl").textContent = "Nombre de Pas";

    document.getElementById("summary-stat-3-val").textContent = `${summary.avgSpeedKmh.toFixed(1)} km/h`;
    document.getElementById("summary-stat-3-lbl").textContent = "Vitesse Moyenne";

    document.getElementById("btn-summary-replay").onclick = () => {
      appUI.closeModal("modal-summary");
      this.start(this.currentRun);
    };

    document.getElementById("btn-summary-back").onclick = () => {
      appUI.closeModal("modal-summary");
      document.getElementById("video-stage")?.classList.remove("active");
      appUI.navigateScreen("runs");
    };

    appUI.openModal("modal-summary");
  }

  renderSimDebugGraph() {
    const canvas = document.getElementById("sim-debug-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 2;
    ctx.beginPath();

    const w = canvas.width;
    const h = canvas.height;
    const len = this.stepIntervalHistory.length;

    for (let i = 0; i < len; i++) {
      const x = (i / Math.max(1, len - 1)) * w;
      // map 0..2000ms to bottom..top
      const y = h - Math.min(h, (this.stepIntervalHistory[i] / 2000) * h);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "12px monospace";
    ctx.fillText(`Interval: ${this.stepIntervalHistory[len - 1] || 0}ms`, 8, 16);
  }
}

export const runEngine = new RunEngine();

/* ==========================================================================
   APP INITIALIZATION
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  inputLayer.init();
  focusManager.init();
  appUI.init();
});
