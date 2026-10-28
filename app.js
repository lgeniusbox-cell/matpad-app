/**
 * FitTV Arena - Core Application
 * Android TV 10-Foot UI, Remote D-Pad, Gamepad & Floor-Mat Step Tracker
 * 
 * 1. INPUT LAYER: Converts raw keyboard/gamepad/remote into SEMANTIC EVENTS on EventBus.
 * 2. APP / UI LAYER: Spatial focus navigation engine (TVNav), Shelves, Cards, Modals, 2D OSK.
 * 3. ENGINES: GameEngine (timeline rhythm overlay) and RunEngine (side-by-side table details & adaptive speed).
 * 
 * Bridges: window.TVBridge and window.TVNav exposed for Android Java WebView.
 * Native YouTube Bridge: window.AndroidBridge integration with fallback to YouTube IFrame API.
 */

/* ==========================================================================
   CONFIG & SOUND SYNTHESIS
   ========================================================================== */

export const Snd = (() => {
  let ctx = null;
  let muted = false;

  function beep(f, d, vol = 0.08) {
    if (muted) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!ctx && AudioCtx) ctx = new AudioCtx();
      if (ctx && ctx.state === "suspended") ctx.resume();
      if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + d);
    } catch (_) {}
  }

  return {
    get muted() { return muted; },
    set muted(val) { muted = val; },
    tick: () => beep(660, 0.04, 0.06),
    ok: () => beep(880, 0.08, 0.1),
    bump: () => beep(140, 0.08, 0.16),
    step: () => beep(440, 0.04, 0.05),
    success: (perfect = true) => {
      beep(perfect ? 880 : 587, 0.12, 0.15);
      if (perfect) setTimeout(() => beep(1320, 0.15, 0.15), 60);
    },
    fail: () => beep(180, 0.18, 0.18),
    countdown: (num) => beep(num === 0 ? 880 : 440, 0.12, 0.18),
    win: () => {
      beep(523, 0.1, 0.15);
      setTimeout(() => beep(659, 0.1, 0.15), 100);
      setTimeout(() => beep(784, 0.25, 0.18), 200);
    }
  };
})();

/* ==========================================================================
   LAYER 1: EVENT BUS & INPUT LAYER
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
        try { cb(payload); } catch (err) { console.error(`EventBus ${eventName}:`, err); }
      }
    }
    if (this.listeners.has("*")) {
      for (const cb of this.listeners.get("*")) {
        try { cb(payload); } catch (_) {}
      }
    }
  }
}

export const bus = new EventBus();

// Expose TVBridge for Android Java integration
window.TVBridge = {
  dispatch(eventName, payload = {}) {
    bus.emit(eventName, payload);
  },
  onEvent(callback) {
    return bus.on("*", callback);
  }
};

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
    this.navRepeatTimers = new Map();
    this.rafId = null;
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
      TVNav.toast("Manette connectée");
    }
  }

  handleGamepadDisconnected(e) {
    if (this.gamepadIndex === e.gamepad.index) {
      this.gamepadIndex = null;
      this.gamepadConnected = false;
      TVNav.toast("Manette déconnectée");
    }
  }

  handleKeyDown(e) {
    // If virtual keyboard is open, handle typing and arrow navigation
    if (osk.isOpen) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        bus.emit("NAV_UP", { source: "keyboard" });
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        bus.emit("NAV_DOWN", { source: "keyboard" });
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        bus.emit("NAV_LEFT", { source: "keyboard" });
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        bus.emit("NAV_RIGHT", { source: "keyboard" });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        bus.emit("OK", { source: "keyboard" });
        return;
      }
      if (e.key === "Escape" || e.key === "BrowserBack" || e.key === "GoBack") {
        e.preventDefault();
        bus.emit("BACK", { source: "keyboard" });
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        osk.deleteChar();
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        osk.insertChar(" ");
        return;
      }
      if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        e.preventDefault();
        osk.insertChar(e.key.toUpperCase());
        return;
      }
      return;
    }

    // 1. FLOOR-MAT TRACKER / STEP INPUTS (Alt+R, Alt+L, fallback R, L)
    const isKeyR = e.code === "KeyR" || e.key === "r" || e.key === "R";
    const isKeyL = e.code === "KeyL" || e.key === "l" || e.key === "L";

    if ((e.altKey && isKeyR) || (isKeyR && !e.ctrlKey && !e.metaKey && this.isNotTyping())) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) bus.emit("STEP_RIGHT", { source: "keyboard", alt: e.altKey });
      return;
    }

    if ((e.altKey && isKeyL) || (isKeyL && !e.ctrlKey && !e.metaKey && this.isNotTyping())) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) bus.emit("STEP_LEFT", { source: "keyboard", alt: e.altKey });
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
        if (appState.inRun) bus.emit("STEP_LEFT", { source: "keyboard" });
        break;
      case "ArrowRight":
        semanticEvent = "NAV_RIGHT";
        if (appState.inGame) bus.emit("RIGHT", { source: "keyboard" });
        if (appState.inRun) bus.emit("STEP_RIGHT", { source: "keyboard" });
        break;
      case "Enter":
      case " ":
        semanticEvent = "OK";
        if (appState.inGame) bus.emit("PUNCH", { source: "keyboard" });
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
    }

    if (semanticEvent) {
      e.preventDefault();
      bus.emit(semanticEvent, { source: "keyboard" });
    }
  }

  isNotTyping() {
    return !document.activeElement || document.activeElement.tagName !== "INPUT";
  }

  isBtnDown(btn) {
    if (!btn) return false;
    if (typeof btn === "object") {
      return Boolean(btn.pressed || (typeof btn.value === "number" && btn.value > 0.4));
    }
    return Boolean(btn > 0.4);
  }

  pollGamepadLoop() {
    this.pollGamepad();
    this.rafId = requestAnimationFrame(() => this.pollGamepadLoop());
  }

  pollGamepad() {
    const rawGamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gamepads = Array.from(rawGamepads).filter(Boolean);
    if (!gamepads.length) return;

    const isModalOpen = Boolean(
      (osk && osk.isOpen) ||
      document.querySelector(".modal-overlay.open") ||
      (document.getElementById("dialog") && !document.getElementById("dialog").hidden) ||
      (document.getElementById("bridge-status-overlay") && !document.getElementById("bridge-status-overlay").hidden)
    );

    for (const gp of gamepads) {
      const b = gp.buttons;
      const gpId = `gp_${gp.index}`;

      // 1. GLOBAL STEPS: L1 (button 4) and R1 (button 5) always trigger steps (for floor-mat tracker & gamepad)
      this.checkButtonEdge(`${gpId}_l1_global`, this.isBtnDown(b[4]), () => {
        bus.emit("STEP_LEFT", { source: "gamepad_l1" });
      });
      this.checkButtonEdge(`${gpId}_r1_global`, this.isBtnDown(b[5]), () => {
        bus.emit("STEP_RIGHT", { source: "gamepad_r1" });
      });

      // L2 (button 6) and R2 (button 7) triggers also emit steps when running
      if (appState.inRun) {
        this.checkButtonEdge(`${gpId}_l2_step`, this.isBtnDown(b[6]), () => {
          bus.emit("STEP_LEFT", { source: "gamepad_l2" });
        });
        this.checkButtonEdge(`${gpId}_r2_step`, this.isBtnDown(b[7]), () => {
          bus.emit("STEP_RIGHT", { source: "gamepad_r2" });
        });
      }

      // 2. STATE-SPECIFIC GAMEPAD ROUTING
      if (isModalOpen || (!appState.inGame && !appState.inRun)) {
        // --- MENU / MODAL / SHELL NAVIGATION ---
        this.checkButtonEdge(`${gpId}_btn_a`, this.isBtnDown(b[0]), () => bus.emit("OK", { source: "gamepad" }));
        this.checkButtonEdge(`${gpId}_btn_b`, this.isBtnDown(b[1]), () => bus.emit("BACK", { source: "gamepad" }));
        this.checkButtonEdge(`${gpId}_btn_back`, this.isBtnDown(b[8]), () => bus.emit("BACK", { source: "gamepad" }));
        this.checkButtonEdge(`${gpId}_btn_start`, this.isBtnDown(b[9]), () => bus.emit("MENU", { source: "gamepad" }));

        // D-Pad and Left Stick (Menu navigation repeat)
        const up = this.isBtnDown(b[12]) || (gp.axes[1] && gp.axes[1] < -0.5);
        const down = this.isBtnDown(b[13]) || (gp.axes[1] && gp.axes[1] > 0.5);
        const left = this.isBtnDown(b[14]) || (gp.axes[0] && gp.axes[0] < -0.5);
        const right = this.isBtnDown(b[15]) || (gp.axes[0] && gp.axes[0] > 0.5);

        this.checkNavRepeat(`${gpId}_NAV_UP`, up, () => bus.emit("NAV_UP", { source: "gamepad" }));
        this.checkNavRepeat(`${gpId}_NAV_DOWN`, down, () => bus.emit("NAV_DOWN", { source: "gamepad" }));
        this.checkNavRepeat(`${gpId}_NAV_LEFT`, left, () => bus.emit("NAV_LEFT", { source: "gamepad" }));
        this.checkNavRepeat(`${gpId}_NAV_RIGHT`, right, () => bus.emit("NAV_RIGHT", { source: "gamepad" }));
      }
      else if (appState.inRun) {
        // --- VIRTUAL RUN MODE ---
        const stickLeft = gp.axes[0] && gp.axes[0] < -0.5;
        const stickRight = gp.axes[0] && gp.axes[0] > 0.5;

        this.checkButtonEdge(`${gpId}_run_dpad_left`, this.isBtnDown(b[14]) || stickLeft, () => {
          bus.emit("STEP_LEFT", { source: "gamepad_dpad" });
        });
        this.checkButtonEdge(`${gpId}_run_dpad_right`, this.isBtnDown(b[15]) || stickRight, () => {
          bus.emit("STEP_RIGHT", { source: "gamepad_dpad" });
        });

        // Face buttons (X / Square for left step, B / Circle or A for right step)
        this.checkButtonEdge(`${gpId}_run_btn_x`, this.isBtnDown(b[2]), () => {
          bus.emit("STEP_LEFT", { source: "gamepad_btn_x" });
        });
        this.checkButtonEdge(`${gpId}_run_btn_b`, this.isBtnDown(b[1]) || this.isBtnDown(b[0]), () => {
          bus.emit("STEP_RIGHT", { source: "gamepad_btn_b" });
        });

        // Pause / Back
        this.checkButtonEdge(`${gpId}_run_start`, this.isBtnDown(b[9]), () => bus.emit("PAUSE", { source: "gamepad" }));
        this.checkButtonEdge(`${gpId}_run_back`, this.isBtnDown(b[8]), () => bus.emit("BACK", { source: "gamepad" }));
      }
      else if (appState.inGame) {
        // --- RHYTHM / FITNESS GAME MODE ---
        const stickUp = gp.axes[1] && gp.axes[1] < -0.5;
        const stickDown = gp.axes[1] && gp.axes[1] > 0.5;
        const stickLeft = gp.axes[0] && gp.axes[0] < -0.5;
        const stickRight = gp.axes[0] && gp.axes[0] > 0.5;

        this.checkButtonEdge(`${gpId}_game_up`, this.isBtnDown(b[12]) || stickUp, () => {
          bus.emit("JUMP", { source: "gamepad_dpad_up" });
        });
        this.checkButtonEdge(`${gpId}_game_down`, this.isBtnDown(b[13]) || stickDown, () => {
          bus.emit("SLIDE_DOWN", { source: "gamepad_dpad_down" });
        });
        this.checkButtonEdge(`${gpId}_game_left`, this.isBtnDown(b[14]) || stickLeft, () => {
          bus.emit("LEFT", { source: "gamepad_dpad_left" });
        });
        this.checkButtonEdge(`${gpId}_game_right`, this.isBtnDown(b[15]) || stickRight, () => {
          bus.emit("RIGHT", { source: "gamepad_dpad_right" });
        });

        // Face buttons
        this.checkButtonEdge(`${gpId}_game_btn_a`, this.isBtnDown(b[0]), () => {
          bus.emit("PUNCH", { source: "gamepad_a" });
        });
        this.checkButtonEdge(`${gpId}_game_btn_b`, this.isBtnDown(b[1]), () => {
          bus.emit("SLASH", { source: "gamepad_b" });
        });
        this.checkButtonEdge(`${gpId}_game_btn_x`, this.isBtnDown(b[2]), () => {
          bus.emit("PUNCH", { source: "gamepad_x" });
        });
        this.checkButtonEdge(`${gpId}_game_btn_y`, this.isBtnDown(b[3]), () => {
          bus.emit("JUMP", { source: "gamepad_y" });
        });

        // Shoulder & Trigger Buttons
        this.checkButtonEdge(`${gpId}_game_l1`, this.isBtnDown(b[4]), () => {
          bus.emit("LEFT", { source: "gamepad_l1" });
        });
        this.checkButtonEdge(`${gpId}_game_r1`, this.isBtnDown(b[5]), () => {
          bus.emit("RIGHT", { source: "gamepad_r1" });
        });
        this.checkButtonEdge(`${gpId}_game_l2`, this.isBtnDown(b[6]), () => {
          bus.emit("SLASH", { source: "gamepad_l2" });
        });
        this.checkButtonEdge(`${gpId}_game_r2`, this.isBtnDown(b[7]), () => {
          bus.emit("PUNCH", { source: "gamepad_r2" });
        });

        // System / Pause Buttons
        this.checkButtonEdge(`${gpId}_game_start`, this.isBtnDown(b[9]), () => bus.emit("PAUSE", { source: "gamepad" }));
        this.checkButtonEdge(`${gpId}_game_back`, this.isBtnDown(b[8]), () => bus.emit("BACK", { source: "gamepad" }));
      }
    }
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
        onAction();
        const initialTimer = setTimeout(() => {
          const repeatInterval = setInterval(() => {
            onAction();
          }, 120);
          this.navRepeatTimers.set(name, { repeatInterval });
        }, 400);
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
   LAYER 2: APP STATE & REFERENCE SPATIAL NAVIGATION (TVNav)
   ========================================================================== */

class AppState {
  constructor() {
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
      theme: "adult",
      age: 28,
      weightKg: 70,
      strideLengthM: 0.75,
      bestScores: {},
      bestRuns: {}
    };
  }

  saveProfile() {
    localStorage.setItem("fittv_profile", JSON.stringify(this.profile));
    document.body.className = `theme-${this.profile.theme || "adult"}`;
  }
}

export const appState = new AppState();

function isVisible(el) {
  if (!el || el.hidden) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
}

export const TVNav = (() => {
  const S = {
    cur: null,
    last: null,
    col: 0,
    lastContent: null,
    screen: "home",
    prev: []
  };

  function dbg(text) {
    const el = document.getElementById("dbg");
    if (el) el.textContent = text;
  }

  function toast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("on"), 2200);
  }

  function setFocus(el, playSnd = true) {
    if (!el) return;
    if (S.cur) S.cur.classList.remove("is-focused");
    S.last = S.cur;
    S.cur = el;
    el.classList.add("is-focused");

    const onRail = !!el.closest("#rail");
    const rail = document.getElementById("rail");
    if (onRail) {
      rail?.classList.add("open");
    } else {
      rail?.classList.remove("open");
      S.lastContent = el;
    }

    reveal(el);
    if (playSnd) Snd.tick();

    const tag = el.dataset.action || el.dataset.target || el.dataset.screen || el.className;
    dbg(`Focus: [${tag}]\nScreen: ${S.screen} | Col: ${S.col}`);
  }

  function reveal(el) {
    // 1. Horizontal smooth track reveal
    const vp = el.closest(".viewport");
    if (vp) {
      const track = el.closest(".track");
      if (track) {
        const P = 24 * (window.innerWidth / 1920);
        const W = vp.clientWidth - 2 * P;
        const left = el.offsetLeft;
        const w = el.offsetWidth;
        let off = left - (W - w) / 2;
        const max = Math.max(0, track.scrollWidth - vp.clientWidth);
        off = Math.max(0, Math.min(off, max));
        track.style.transform = `translateX(-${off}px)`;
      }
    }

    // 2. Vertical shelves scroll
    const shelf = el.closest(".shelf");
    const wrap = el.closest(".wrap");
    if (shelf && wrap) {
      const shelves = wrap.querySelector(".shelves");
      if (shelves) {
        const shelfTop = shelf.offsetTop;
        const targetY = Math.max(0, shelfTop - 40 * (window.innerWidth / 1920));
        shelves.style.transform = `translateY(-${targetY}px)`;
      }
    }
  }

  function bump(el) {
    if (!el) return;
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
    Snd.bump();
  }

  function move(dirX, dirY) {
    // 1. If Virtual Keyboard (OSK) is open, delegate strictly to OSK 2D grid
    if (osk.isOpen) {
      osk.move(dirX, dirY);
      return;
    }

    // 2. Modal trap: Bridge Status / Error Overlay
    const bridgeOverlay = document.getElementById("bridge-status-overlay");
    if (bridgeOverlay && !bridgeOverlay.hidden) {
      const btns = Array.from(bridgeOverlay.querySelectorAll("[data-focusable]")).filter(isVisible);
      const i = btns.indexOf(S.cur);
      if (dirX !== 0) {
        const nextI = i + dirX;
        if (nextI >= 0 && nextI < btns.length) setFocus(btns[nextI]);
        else bump(S.cur);
      }
      return;
    }

    if (!S.cur) {
      const first = document.querySelector('.screen:not([hidden]) [data-focusable]') || document.querySelector('#rail [data-focusable]');
      if (first) setFocus(first);
      return;
    }

    // 3. Modal trap: Exit Dialog
    const exitDialog = document.getElementById("dialog");
    if (exitDialog && !exitDialog.hidden) {
      const btns = Array.from(exitDialog.querySelectorAll("[data-focusable]")).filter(isVisible);
      const i = btns.indexOf(S.cur);
      if (dirX !== 0) {
        const nextI = i + dirX;
        if (nextI >= 0 && nextI < btns.length) setFocus(btns[nextI]);
        else bump(S.cur);
      }
      return;
    }

    // 4. Modal overlays (Pause, Controls, Summary)
    const openModal = document.querySelector(".modal-overlay.open");
    if (openModal) {
      const modalZones = Array.from(openModal.querySelectorAll("[data-zone]")).filter(isVisible);
      const currentZone = S.cur.closest("[data-zone]");
      if (currentZone && modalZones.includes(currentZone)) {
        const items = Array.from(currentZone.querySelectorAll("[data-focusable]")).filter(isVisible);
        const i = items.indexOf(S.cur);
        if (dirX !== 0) {
          const nextI = i + dirX;
          if (nextI >= 0 && nextI < items.length) setFocus(items[nextI]);
          else bump(S.cur);
          return;
        }
        if (dirY !== 0 && modalZones.length > 1) {
          const zIdx = modalZones.indexOf(currentZone);
          const nextZ = modalZones[zIdx + dirY];
          if (nextZ) {
            const nextItems = Array.from(nextZ.querySelectorAll("[data-focusable]")).filter(isVisible);
            if (nextItems.length) setFocus(nextItems[Math.min(i, nextItems.length - 1)]);
          } else {
            bump(S.cur);
          }
          return;
        }
      }
      return;
    }

    // 5. Normal Screen / Shelf Navigation
    const currentZone = S.cur.closest("[data-zone]");
    if (!currentZone) return;
    const dir = currentZone.dataset.dir || "h";

    // HORIZONTAL MOVE
    if (dirX !== 0) {
      if (dir === "h") {
        const items = Array.from(currentZone.querySelectorAll("[data-focusable]")).filter(isVisible);
        const i = items.indexOf(S.cur);
        if (dirX < 0) {
          if (i === 0) {
            const onRail = !!S.cur.closest("#rail");
            if (!onRail) {
              const activeRail = document.querySelector("#rail .rail-item.active") || document.querySelector("#rail [data-focusable]");
              if (activeRail) setFocus(activeRail);
            } else {
              bump(S.cur);
            }
          } else if (i > 0) {
            S.col = i - 1;
            setFocus(items[i - 1]);
          }
        } else if (dirX > 0) {
          if (i === items.length - 1) {
            bump(S.cur);
          } else if (i < items.length - 1) {
            S.col = i + 1;
            setFocus(items[i + 1]);
          }
        }
      } else if (dir === "v") {
        if (dirX > 0) {
          const target = (S.lastContent && isVisible(S.lastContent))
            ? S.lastContent
            : document.querySelector(".screen:not([hidden]) [data-focusable]");
          if (target) setFocus(target);
          else bump(S.cur);
        } else {
          bump(S.cur);
        }
      }
      return;
    }

    // VERTICAL MOVE
    if (dirY !== 0) {
      if (dir === "v") {
        const items = Array.from(currentZone.querySelectorAll("[data-focusable]")).filter(isVisible);
        const i = items.indexOf(S.cur);
        const nextI = i + dirY;
        if (nextI < 0 || nextI >= items.length) {
          bump(S.cur);
        } else {
          setFocus(items[nextI]);
        }
      } else {
        const currentScreen = S.cur.closest(".screen");
        if (!currentScreen) return;
        const shelvesZones = Array.from(currentScreen.querySelectorAll("[data-zone]")).filter(isVisible);
        const zIdx = shelvesZones.indexOf(currentZone);
        const nextZIdx = zIdx + dirY;
        if (nextZIdx < 0 || nextZIdx >= shelvesZones.length) {
          bump(S.cur);
        } else {
          const nextZone = shelvesZones[nextZIdx];
          const nextItems = Array.from(nextZone.querySelectorAll("[data-focusable]")).filter(isVisible);
          if (nextItems.length > 0) {
            const targetCol = Math.min(S.col, nextItems.length - 1);
            setFocus(nextItems[targetCol]);
          }
        }
      }
    }
  }

  function activate(el = S.cur) {
    if (osk.isOpen) {
      osk.triggerCurrent();
      return;
    }

    if (!el) return;
    Snd.ok();

    if (el.classList.contains("rail-item")) {
      const scr = el.dataset.screen;
      if (scr) {
        show(scr);
        setTimeout(() => {
          const firstInScreen = document.querySelector(`.screen[data-screen="${scr}"]:not([hidden]) [data-focusable]`);
          if (firstInScreen) setFocus(firstInScreen);
        }, 50);
      }
      return;
    }

    const action = el.dataset.action;
    switch (action) {
      case "goto": {
        const target = el.dataset.target;
        if (target) show(target);
        break;
      }
      case "locked": {
        toast("Séance verrouillée - Bientôt disponible");
        break;
      }
      case "game": {
        const file = el.dataset.file;
        const g = appUI.gamesData.find(x => x._filename === file);
        if (g) gameEngine.start(g);
        break;
      }
      case "run": {
        const file = el.dataset.file;
        const r = appUI.runsData.find(x => x._filename === file);
        if (r) runEngine.start(r);
        break;
      }
      case "bridge-retry": {
        videoController.retryLastRequest();
        break;
      }
      case "bridge-cancel": {
        videoController.stop();
        gameEngine.stop();
        runEngine.stop();
        document.getElementById("video-stage")?.classList.remove("active");
        show(appState.inGame ? "games" : "runs");
        break;
      }
      case "stay": {
        const dlg = document.getElementById("dialog");
        if (dlg) dlg.hidden = true;
        setFocus(S.lastContent || document.querySelector('#rail .rail-item.active'));
        break;
      }
      case "exit": {
        toast("Au revoir !");
        videoController.stop();
        try {
          if (window.Android && typeof window.Android.closeApp === "function") {
            window.Android.closeApp();
          } else {
            window.close();
          }
        } catch (_) {}
        break;
      }
      case "resume": {
        appUI.closeModal("modal-pause");
        if (videoController.player) videoController.player.playVideo();
        break;
      }
      case "restart": {
        appUI.closeModal("modal-pause");
        if (appState.inGame && gameEngine.currentGame) gameEngine.start(gameEngine.currentGame);
        else if (appState.inRun && runEngine.currentRun) runEngine.start(runEngine.currentRun);
        break;
      }
      case "help":
      case "show-controls": {
        appUI.openModal("modal-controls-help");
        break;
      }
      case "close-controls": {
        appUI.closeModal("modal-controls-help");
        break;
      }
      case "quit": {
        appUI.closeModal("modal-pause");
        gameEngine.stop();
        runEngine.stop();
        videoController.stop();
        document.getElementById("video-stage")?.classList.remove("active");
        show("home");
        break;
      }
      case "edit-name": {
        osk.open(appState.profile.playerName, (newName) => {
          appState.profile.playerName = newName || "Joueur TV";
          const display = document.getElementById("profile-name-display");
          if (display) display.textContent = appState.profile.playerName;
          appState.saveProfile();
          toast(`Nom mis à jour: ${appState.profile.playerName}`);
        });
        break;
      }
      case "age-minus": {
        appState.profile.age = Math.max(10, (appState.profile.age || 28) - 1);
        const ageEl = document.getElementById("profile-age-val");
        if (ageEl) ageEl.textContent = `${appState.profile.age} ans`;
        appState.saveProfile();
        break;
      }
      case "age-plus": {
        appState.profile.age = Math.min(99, (appState.profile.age || 28) + 1);
        const ageEl = document.getElementById("profile-age-val");
        if (ageEl) ageEl.textContent = `${appState.profile.age} ans`;
        appState.saveProfile();
        break;
      }
      case "weight-minus": {
        appState.profile.weightKg = Math.max(30, (appState.profile.weightKg || 70) - 1);
        const weightEl = document.getElementById("profile-weight-val");
        if (weightEl) weightEl.textContent = `${appState.profile.weightKg} kg`;
        appState.saveProfile();
        break;
      }
      case "weight-plus": {
        appState.profile.weightKg = Math.min(180, (appState.profile.weightKg || 70) + 1);
        const weightEl = document.getElementById("profile-weight-val");
        if (weightEl) weightEl.textContent = `${appState.profile.weightKg} kg`;
        appState.saveProfile();
        break;
      }
      case "stride-minus": {
        appState.profile.strideLengthM = Math.max(0.4, Number((appState.profile.strideLengthM - 0.05).toFixed(2)));
        const strideEl = document.getElementById("profile-stride-val");
        if (strideEl) strideEl.textContent = `${appState.profile.strideLengthM.toFixed(2)} m`;
        appState.saveProfile();
        break;
      }
      case "stride-plus": {
        appState.profile.strideLengthM = Math.min(1.5, Number((appState.profile.strideLengthM + 0.05).toFixed(2)));
        const strideEl = document.getElementById("profile-stride-val");
        if (strideEl) strideEl.textContent = `${appState.profile.strideLengthM.toFixed(2)} m`;
        appState.saveProfile();
        break;
      }
      case "toggle-sound": {
        Snd.muted = !Snd.muted;
        el.textContent = Snd.muted ? "Désactivé (Muet)" : "Activé";
        toast(Snd.muted ? "Son coupé" : "Son activé");
        break;
      }
      case "cal-minus": {
        appState.calibrationMs = Math.max(-300, appState.calibrationMs - 20);
        const calEl = document.getElementById("cal-offset-val");
        if (calEl) calEl.textContent = `${appState.calibrationMs} ms`;
        break;
      }
      case "cal-plus": {
        appState.calibrationMs = Math.min(300, appState.calibrationMs + 20);
        const calEl = document.getElementById("cal-offset-val");
        if (calEl) calEl.textContent = `${appState.calibrationMs} ms`;
        break;
      }
      case "cal-test": {
        Snd.countdown(0);
        toast(`Test synchronisation (${appState.calibrationMs}ms)`);
        break;
      }
      case "toggle-sim": {
        appState.simMode = !appState.simMode;
        el.textContent = appState.simMode ? "Activé (Alt+L/R)" : "Désactivé";
        document.getElementById("sim-debug-canvas")?.classList.toggle("show", appState.simMode);
        toast(appState.simMode ? "Mode simulation activé" : "Mode simulation désactivé");
        break;
      }
      case "replay": {
        appUI.closeModal("modal-summary");
        if (appState.inGame && gameEngine.currentGame) gameEngine.start(gameEngine.currentGame);
        else if (appState.inRun && runEngine.currentRun) runEngine.start(runEngine.currentRun);
        break;
      }
      case "back-to-sessions": {
        appUI.closeModal("modal-summary");
        videoController.stop();
        document.getElementById("video-stage")?.classList.remove("active");
        show(appState.inGame ? "games" : "runs");
        break;
      }
      default: {
        if (el.classList.contains("theme-selector-btn")) {
          const theme = el.dataset.theme;
          appState.profile.theme = theme;
          appState.saveProfile();
          document.querySelectorAll(".theme-selector-btn").forEach(b => b.classList.toggle("active", b.dataset.theme === theme));
          toast(`Thème: ${theme.toUpperCase()}`);
        }
      }
    }
  }

  function back() {
    if (osk.isOpen) {
      osk.close();
      return;
    }

    // 1. If native bridge status overlay is open, cancel stream and return
    const bridgeOverlay = document.getElementById("bridge-status-overlay");
    if (bridgeOverlay && !bridgeOverlay.hidden) {
      videoController.stop();
      gameEngine.stop();
      runEngine.stop();
      document.getElementById("video-stage")?.classList.remove("active");
      show(appState.inGame ? "games" : "runs");
      return;
    }

    // 2. Exit dialog open
    const dlg = document.getElementById("dialog");
    if (dlg && !dlg.hidden) {
      dlg.hidden = true;
      setFocus(S.lastContent || document.querySelector("#rail .rail-item.active"));
      return;
    }

    // 3. Open modal overlay
    const openModal = document.querySelector(".modal-overlay.open");
    if (openModal) {
      appUI.closeModal(openModal.id);
      return;
    }

    // 4. Video stage active
    if (appState.inGame || appState.inRun) {
      appUI.openPauseMenu();
      return;
    }

    // 5. Focus in screen content -> move back to active rail button
    const onRail = !!S.cur?.closest("#rail");
    if (!onRail) {
      const activeRail = document.querySelector("#rail .rail-item.active") || document.querySelector("#rail [data-focusable]");
      if (activeRail) {
        setFocus(activeRail);
        return;
      }
    }

    // 6. Already on rail: if not home, go to home; if on home, open exit dialog
    if (S.screen !== "home") {
      show("home");
    } else {
      if (dlg) {
        dlg.hidden = false;
        const firstBtn = dlg.querySelector("[data-focusable]");
        if (firstBtn) setFocus(firstBtn);
      }
    }
  }

  function show(screenId) {
    document.querySelectorAll(".screen").forEach(s => s.hidden = true);
    const target = document.getElementById(`sh-${screenId}`);
    if (target) target.hidden = false;

    document.querySelectorAll("#rail .rail-item").forEach(b => {
      b.classList.toggle("active", b.dataset.screen === screenId);
    });

    S.screen = screenId;
    notifyAndroid("SCREEN_CHANGED", { screen: screenId });

    setTimeout(() => {
      const first = target?.querySelector("[data-focusable]");
      if (first && !S.cur?.closest("#rail")) setFocus(first);
    }, 50);
  }

  return {
    state: S,
    setFocus,
    reveal,
    bump,
    move,
    activate,
    back,
    show,
    toast
  };
})();

window.TVNav = TVNav;

/* ==========================================================================
   ON-SCREEN KEYBOARD (2D LOGICAL MATRIX NAVIGATION)
   ========================================================================== */

class OnScreenKeyboard {
  constructor() {
    this.currentText = "";
    this.callback = null;
    this.matrix = [
      ["A", "B", "C", "D", "E", "F"],
      ["G", "H", "I", "J", "K", "L"],
      ["M", "N", "O", "P", "Q", "R"],
      ["S", "T", "U", "V", "W", "X"],
      ["Y", "Z", "1", "2", "3", "4"],
      ["5", "6", "7", "8", "9", "0"]
    ];
    this.row = 0;
    this.col = 0;
    this.keyElements = [];
    this.actionElements = [];
    this.isOpen = false;
  }

  init() {
    const container = document.getElementById("osk-keys-matrix");
    if (!container) return;
    container.innerHTML = "";
    this.keyElements = [];

    this.matrix.forEach((r, rIdx) => {
      const rowEl = document.createElement("div");
      rowEl.className = "osk-row";
      const rowArr = [];

      r.forEach((char, cIdx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "osk-key";
        btn.setAttribute("data-focusable", "");
        btn.textContent = char;
        btn.dataset.char = char;

        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.insertChar(char);
          this.focusKey(rIdx, cIdx);
        });

        rowEl.appendChild(btn);
        rowArr.push(btn);
      });

      container.appendChild(rowEl);
      this.keyElements.push(rowArr);
    });

    const spaceBtn = document.getElementById("btn-osk-space");
    const backspaceBtn = document.getElementById("btn-osk-backspace");
    const doneBtn = document.getElementById("btn-osk-done");

    this.actionElements = [spaceBtn, backspaceBtn, doneBtn].filter(Boolean);

    spaceBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.insertChar(" ");
      this.row = 6;
      this.col = 0;
      this.focusCurrent();
    });

    backspaceBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.deleteChar();
      this.row = 6;
      this.col = 1;
      this.focusCurrent();
    });

    doneBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.confirm();
    });
  }

  open(initial, cb) {
    this.currentText = initial || "";
    this.callback = cb;
    this.isOpen = true;
    this.updateDisplay();
    appUI.openModal("modal-osk");
    this.row = 0;
    this.col = 0;
    setTimeout(() => this.focusCurrent(), 60);
  }

  close() {
    this.isOpen = false;
    appUI.closeModal("modal-osk");
  }

  insertChar(c) {
    if (this.currentText.length < 24) {
      this.currentText += c;
      this.updateDisplay();
      Snd.tick();
    }
  }

  deleteChar() {
    if (this.currentText.length > 0) {
      this.currentText = this.currentText.slice(0, -1);
      this.updateDisplay();
      Snd.tick();
    }
  }

  confirm() {
    this.close();
    Snd.ok();
    if (this.callback) this.callback(this.currentText.trim());
  }

  updateDisplay() {
    const el = document.getElementById("osk-input-text");
    if (el) el.textContent = this.currentText;
  }

  move(dirX, dirY) {
    if (!this.isOpen) return;

    if (dirX !== 0) {
      if (this.row < 6) {
        const nextCol = this.col + dirX;
        if (nextCol >= 0 && nextCol <= 5) {
          this.col = nextCol;
          this.focusCurrent();
        } else {
          Snd.bump();
        }
      } else {
        const nextCol = this.col + dirX;
        if (nextCol >= 0 && nextCol <= 2) {
          this.col = nextCol;
          this.focusCurrent();
        } else {
          Snd.bump();
        }
      }
      return;
    }

    if (dirY !== 0) {
      if (dirY < 0) {
        if (this.row === 0) {
          Snd.bump();
        } else if (this.row === 6) {
          this.row = 5;
          this.col = Math.min(5, this.col * 2 + 1);
          this.focusCurrent();
        } else {
          this.row--;
          this.focusCurrent();
        }
      } else if (dirY > 0) {
        if (this.row === 6) {
          Snd.bump();
        } else if (this.row === 5) {
          this.row = 6;
          this.col = Math.min(2, Math.floor(this.col / 2));
          this.focusCurrent();
        } else {
          this.row++;
          this.focusCurrent();
        }
      }
    }
  }

  focusCurrent() {
    let target = null;
    if (this.row < 6) {
      target = this.keyElements[this.row]?.[this.col];
    } else {
      target = this.actionElements[this.col];
    }
    if (target) {
      TVNav.setFocus(target, true);
    }
  }

  focusKey(r, c) {
    this.row = r;
    this.col = c;
    this.focusCurrent();
  }

  triggerCurrent() {
    if (!this.isOpen) return;
    if (this.row < 6) {
      const char = this.matrix[this.row]?.[this.col];
      if (char) this.insertChar(char);
    } else {
      if (this.col === 0) this.insertChar(" ");
      else if (this.col === 1) this.deleteChar();
      else if (this.col === 2) this.confirm();
    }
  }
}

export const osk = new OnScreenKeyboard();

/* ==========================================================================
   UI CONTROLLER & CONTENT LOADER
   ========================================================================== */

class AppUI {
  constructor() {
    this.gamesData = [];
    this.runsData = [];
  }

  async init() {
    this.bindBusEvents();
    this.setupRailEvents();
    this.setupFeetFlash();
    this.setupProfileUI();
    osk.init();

    await Promise.all([this.loadGames(), this.loadRuns()]);

    const firstTile = document.querySelector("#sh-home [data-focusable]");
    if (firstTile) TVNav.setFocus(firstTile, false);
  }

  bindBusEvents() {
    bus.on("NAV_UP", () => TVNav.move(0, -1));
    bus.on("NAV_DOWN", () => TVNav.move(0, 1));
    bus.on("NAV_LEFT", () => TVNav.move(-1, 0));
    bus.on("NAV_RIGHT", () => TVNav.move(1, 0));
    bus.on("OK", () => TVNav.activate());
    bus.on("BACK", () => TVNav.back());
    bus.on("MENU", () => this.openModal("modal-controls-help"));
    bus.on("PAUSE", () => {
      if (appState.inGame || appState.inRun) this.openPauseMenu();
    });
  }

  setupRailEvents() {
    document.querySelectorAll("#rail .rail-item").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        TVNav.activate(btn);
      });
    });

    document.addEventListener("click", (e) => {
      const target = e.target.closest("[data-focusable]");
      if (!target) return;
      if (target.closest("#modal-osk")) return;
      TVNav.activate(target);
    });
  }

  setupFeetFlash() {
    const fl = document.getElementById("fl");
    const fr = document.getElementById("fr");

    bus.on("STEP_LEFT", () => {
      if (fl) {
        fl.classList.add("on");
        setTimeout(() => fl.classList.remove("on"), 160);
      }
    });

    bus.on("STEP_RIGHT", () => {
      if (fr) {
        fr.classList.add("on");
        setTimeout(() => fr.classList.remove("on"), 160);
      }
    });
  }

  setupProfileUI() {
    const nameEl = document.getElementById("profile-name-display");
    if (nameEl) nameEl.textContent = appState.profile.playerName;

    const ageEl = document.getElementById("profile-age-val");
    if (ageEl) ageEl.textContent = `${appState.profile.age || 28} ans`;

    const weightEl = document.getElementById("profile-weight-val");
    if (weightEl) weightEl.textContent = `${appState.profile.weightKg || 70} kg`;

    const strideEl = document.getElementById("profile-stride-val");
    if (strideEl) strideEl.textContent = `${appState.profile.strideLengthM.toFixed(2)} m`;

    const editBtn = document.getElementById("btn-edit-name");
    editBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      TVNav.activate(editBtn);
    });
  }

  openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add("open");
    const firstBtn = el.querySelector("[data-focusable]");
    if (firstBtn && !osk.isOpen) TVNav.setFocus(firstBtn);
  }

  closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("open");
    const candidate = document.querySelector(".screen:not([hidden]) [data-focusable]");
    if (candidate) TVNav.setFocus(candidate);
  }

  openPauseMenu() {
    if (videoController.player) videoController.player.pauseVideo();
    this.openModal("modal-pause");
  }

  getBaseUrl() {
    const href = window.location.href.split("#")[0].split("?")[0];
    if (href.endsWith(".html")) {
      return href.substring(0, href.lastIndexOf("/") + 1);
    }
    return href.endsWith("/") ? href : href + "/";
  }

  async loadGames() {
    const container = document.getElementById("games-shelves");
    if (!container) return;

    try {
      const base = this.getBaseUrl();
      const manifestUrl = new URL("games/index.json", base).href;
      const resp = await fetch(manifestUrl);
      if (!resp.ok) throw new Error("games/index.json missing");
      const list = await resp.json();

      const items = [];
      for (const filename of list) {
        try {
          const itemUrl = new URL(`games/${filename}`, base).href;
          const itemResp = await fetch(itemUrl);
          if (itemResp.ok) {
            const data = await itemResp.json();
            if (data.type !== "game") continue;
            if (!data.video || !data.video.videoId) {
              console.warn(`Skipping game ${filename}: missing video.videoId`);
              continue;
            }
            this.sanitizeGameData(data, filename);
            items.push(data);
          }
        } catch (e) {
          console.warn(`Failed loading game ${filename}:`, e);
        }
      }

      this.gamesData = items;
      this.renderShelves(container, items, "game");
    } catch (err) {
      console.warn("Games load warning:", err);
      container.innerHTML = `<div class="shelf"><div class="shelf-title">Chargement des jeux...</div></div>`;
    }
  }

  async loadRuns() {
    const container = document.getElementById("runs-shelves");
    if (!container) return;

    try {
      const base = this.getBaseUrl();
      const manifestUrl = new URL("virtual-run/index.json", base).href;
      const resp = await fetch(manifestUrl);
      if (!resp.ok) throw new Error("virtual-run/index.json missing");
      const list = await resp.json();

      const items = [];
      for (const filename of list) {
        try {
          const itemUrl = new URL(`virtual-run/${filename}`, base).href;
          const itemResp = await fetch(itemUrl);
          if (itemResp.ok) {
            const data = await itemResp.json();
            if (data.type !== "virtual_run") continue;
            if (!data.video || !data.video.videoId) {
              console.warn(`Skipping run ${filename}: missing video.videoId`);
              continue;
            }
            this.sanitizeRunData(data, filename);
            items.push(data);
          }
        } catch (e) {
          console.warn(`Failed loading run ${filename}:`, e);
        }
      }

      this.runsData = items;
      this.renderShelves(container, items, "run");
    } catch (err) {
      console.warn("Runs load warning:", err);
      container.innerHTML = `<div class="shelf"><div class="shelf-title">Chargement des courses...</div></div>`;
    }
  }

  sanitizeGameData(data, filename) {
    data._filename = filename;
    data.meta = data.meta || {};
    data.video = data.video || {};
    data.game = data.game || {};

    data.meta.title = String(data.meta.title || "Jeu de Rythme");
    data.meta.genre = String(data.meta.genre || "Arcade").trim();
    data.meta.level = Number(data.meta.level) || 1;

    data.video.durationSeconds = Number(data.video.durationSeconds) || 90;
    data.video.effectiveDurationSeconds = Number(data.video.effectiveDurationSeconds) || data.video.durationSeconds;
    data.video.trimStart = Number(data.video.trimStart) || 0;
    data.video.trimEnd = Number(data.video.trimEnd) || data.video.durationSeconds;
    data.video.cuts = Array.isArray(data.video.cuts) ? data.video.cuts : [];

    const allowed = new Set(["STARTING COUNT", "GO", "JUMP", "RIGHT", "LEFT", "SLIDE DOWN", "SLASH", "PUNCH", "END", "WIN"]);
    const rawTL = Array.isArray(data.game.timeline) ? data.game.timeline : [];
    data.game.timeline = rawTL
      .filter(ev => ev && typeof ev.time === "number")
      .map((ev, i) => {
        let action = String(ev.action || "").replace(/_/g, " ").trim().toUpperCase();
        if (!allowed.has(action)) action = "JUMP";
        return {
          id: String(ev.id || `e${i}`),
          time: Number(ev.time),
          action: action,
          showOnScreen: ev.showOnScreen !== false,
          duration: Number(ev.duration) || 1.5,
          points: Number(ev.points) || 100,
          hint: String(ev.hint || ""),
          onFail: ev.onFail || { enabled: false, seekTo: null },
          onSuccess: ev.onSuccess || { enabled: false, seekTo: null }
        };
      })
      .sort((a, b) => a.time - b.time);
  }

  sanitizeRunData(data, filename) {
    data._filename = filename;
    data.meta = data.meta || {};
    data.video = data.video || {};
    data.virtualRun = data.virtualRun || {};

    data.meta.title = String(data.meta.title || "Course Virtuelle");
    data.meta.genre = String(data.meta.genre || "Nature").trim();
    data.meta.level = Number(data.meta.level) || 1;

    data.video.durationSeconds = Number(data.video.durationSeconds) || 600;
    data.video.effectiveDurationSeconds = Number(data.video.effectiveDurationSeconds) || data.video.durationSeconds;
    data.video.trimStart = Number(data.video.trimStart) || 0;
    data.video.trimEnd = Number(data.video.trimEnd) || data.video.durationSeconds;
    data.video.cuts = Array.isArray(data.video.cuts) ? data.video.cuts : [];
  }

  renderShelves(container, items, type) {
    container.innerHTML = "";
    if (!items.length) {
      container.innerHTML = `<div class="shelf"><div class="shelf-title">Aucune séance disponible</div></div>`;
      return;
    }

    const groups = new Map();
    items.forEach(item => {
      const genre = (item.meta?.genre || "Autres").trim();
      if (!groups.has(genre)) groups.set(genre, []);
      groups.get(genre).push(item);
    });

    groups.forEach((groupItems, genreName) => {
      const shelf = document.createElement("div");
      shelf.className = "shelf";

      const title = document.createElement("div");
      title.className = "shelf-title";
      title.innerHTML = `${genreName} <small>${groupItems.length} séance${groupItems.length > 1 ? "s" : ""}</small>`;
      shelf.appendChild(title);

      const viewport = document.createElement("div");
      viewport.className = "viewport";

      const track = document.createElement("div");
      track.className = "track";
      track.setAttribute("data-zone", "");
      track.setAttribute("data-dir", "h");

      groupItems.forEach(item => {
        const card = document.createElement("a");
        card.className = "card";
        card.setAttribute("data-action", type);
        card.setAttribute("data-file", item._filename);
        card.setAttribute("data-focusable", "");
        card.href = `#${type}/${item._filename}`;

        const videoId = (item.video?.videoId || "").trim();
        const thumbUrl = /^[\w-]{11}$/.test(videoId)
          ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
          : "";

        const duration = Math.round(item.video?.effectiveDurationSeconds || item.video?.durationSeconds || 90);
        const mins = Math.floor(duration / 60);
        const secs = String(duration % 60).padStart(2, "0");

        card.innerHTML = `
          ${thumbUrl ? `<img src="${thumbUrl}" alt="${item.meta?.title}" onerror="this.style.display='none'" />` : ""}
          <div class="shade"></div>
          <span class="tag">${item.meta?.difficulty || "Normal"}</span>
          <span class="dur">${mins}:${secs}</span>
          <div class="meta">
            <b>${item.meta?.title}</b>
            <small>Niveau ${item.meta?.level || 1} · ${type === "game" ? (item.game?.rules?.maxLives || 3) + " vies" : "Endurance"}</small>
          </div>
        `;

        track.appendChild(card);
      });

      viewport.appendChild(track);
      shelf.appendChild(viewport);
      container.appendChild(shelf);
    });
  }
}

export const appUI = new AppUI();

/* ==========================================================================
   LAYER 3: VIDEO CONTROLLER & GAME ENGINES
   ========================================================================== */

/**
 * Converts any YouTube embed URL, short URL, or video ID into a full standard watch URL:
 * https://www.youtube.com/watch?v=VIDEO_ID
 */
export function toYouTubeWatchUrl(input) {
  if (!input) return "";
  const str = String(input).trim();

  // Already standard watch URL
  if (/^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/i.test(str)) {
    return str;
  }
  // youtu.be/ID
  const shortMatch = str.match(/youtu\.be\/([\w-]+)/i);
  if (shortMatch && shortMatch[1]) {
    return `https://www.youtube.com/watch?v=${shortMatch[1]}`;
  }
  // youtube.com/embed/ID
  const embedMatch = str.match(/youtube\.com\/embed\/([\w-]+)/i);
  if (embedMatch && embedMatch[1]) {
    return `https://www.youtube.com/watch?v=${embedMatch[1]}`;
  }
  // youtube.com/v/ID
  const vMatch = str.match(/youtube\.com\/v\/([\w-]+)/i);
  if (vMatch && vMatch[1]) {
    return `https://www.youtube.com/watch?v=${vMatch[1]}`;
  }
  // Standard 11-char ID
  if (/^[\w-]{11}$/.test(str)) {
    return `https://www.youtube.com/watch?v=${str}`;
  }
  // Query parameter ?v=
  try {
    const urlObj = new URL(str);
    const vParam = urlObj.searchParams.get("v");
    if (vParam) return `https://www.youtube.com/watch?v=${vParam}`;
  } catch (_) {}

  // Fallback
  return `https://www.youtube.com/watch?v=${str}`;
}

class VideoController {
  constructor() {
    this.player = null;
    this.watcher = null;
    this.config = null;
    this.lastPolledTime = 0;
    this.lastPollTimestamp = 0;

    // Native Bridge state
    this.isBridgeMode = false;
    this.bridgeVideoElement = null;
    this.currentWatchUrl = "";
    this.loadResolveFn = null;
    this.loadTimeoutId = null;

    this.initNativeBridgeCallbacks();
  }

  /**
   * Detects if the Android TV native stream bridge is available.
   * Requirement 1: typeof window.AndroidBridge !== "undefined"
   */
  hasNativeBridge() {
    return typeof window.AndroidBridge !== "undefined" &&
      typeof window.AndroidBridge.requestVideo === "function";
  }

  /**
   * Initializes global callback functions called by Android native code:
   * - window.onStreamProgress(percent, bufferedSeconds)
   * - window.onStreamReady(localUrl)
   * - window.onStreamError(message)
   */
  initNativeBridgeCallbacks() {
    window.onStreamProgress = (percent, bufferedSeconds) => {
      this.handleStreamProgress(percent, bufferedSeconds);
    };

    window.onStreamReady = (localUrl) => {
      this.handleStreamReady(localUrl);
    };

    window.onStreamError = (message) => {
      this.handleStreamError(message);
    };
  }

  initApi() {
    return new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve();
        return;
      }
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prevCallback === "function") prevCallback();
        resolve();
      };
      if (!document.getElementById("yt-api-script")) {
        const tag = document.createElement("script");
        tag.id = "yt-api-script";
        tag.src = "https://www.youtube.com/iframe_api";
        tag.onerror = () => {
          console.warn("Failed to load YouTube iframe API script");
          resolve();
        };
        document.head.appendChild(tag);
      }
      setTimeout(() => resolve(), 2500);
    });
  }

  /**
   * Main entrypoint to load and play a video.
   * Uses AndroidBridge if available, or falls back to YouTube IFrame API.
   */
  async loadVideo(videoConfig) {
    this.config = videoConfig;

    // 1. Cancel any active native video stream before starting another one (Requirement 5)
    this.cancelNativeVideo();

    // 2. Check if running inside Android TV WebView shell with native bridge
    if (this.hasNativeBridge()) {
      return this.loadVideoViaBridge(videoConfig);
    } else {
      return this.loadVideoViaIframe(videoConfig);
    }
  }

  /**
   * Requirement 1 & 2: Native Bridge Pipeline with HTML5 <video> element
   */
  loadVideoViaBridge(videoConfig) {
    this.isBridgeMode = true;
    this.ensureBridgeUi();

    // Requirement 3: Convert embed URL or video ID to full watch URL
    const rawIdOrUrl = videoConfig.url || videoConfig.videoId || "";
    this.currentWatchUrl = toYouTubeWatchUrl(rawIdOrUrl);

    console.info(`[VideoController] Native bridge active. Requesting: ${this.currentWatchUrl}`);

    // Show loading overlay
    this.showBridgeOverlay("loading", {
      title: "Téléchargement du flux local…",
      subtitle: "Résolution NewPipe & Streaming HTTP 206",
      percent: 0,
      bufferedSecs: 0
    });

    // Hide iframe container if previously present
    const iframePlaceholder = document.getElementById("yt-iframe-placeholder");
    if (iframePlaceholder) iframePlaceholder.style.display = "none";

    // Setup HTML5 video element
    const video = this.bridgeVideoElement;
    if (video) {
      video.style.display = "block";
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (videoConfig.audioMuted) video.muted = true;
      else video.muted = false;
    }

    // Build unified player adapter for GameEngine and RunEngine
    this.buildVideoAdapter();

    return new Promise((resolve) => {
      this.loadResolveFn = resolve;

      // Request native download & streaming
      try {
        window.AndroidBridge.requestVideo(this.currentWatchUrl);
      } catch (err) {
        console.error("AndroidBridge.requestVideo call failed:", err);
        this.handleStreamError("Impossible de démarrer le streaming natif : " + err.message);
      }

      // Safety fallback timeout
      if (this.loadTimeoutId) clearTimeout(this.loadTimeoutId);
      this.loadTimeoutId = setTimeout(() => {
        if (this.loadResolveFn) {
          console.warn("[VideoController] Bridge ready timeout reached, proceeding with engine loop");
          const r = this.loadResolveFn;
          this.loadResolveFn = null;
          r(this.player);
        }
      }, 45000);
    });
  }

  /**
   * Normal browser fallback: YouTube IFrame API
   */
  async loadVideoViaIframe(videoConfig) {
    this.isBridgeMode = false;
    this.hideBridgeOverlay();

    if (this.bridgeVideoElement) {
      this.bridgeVideoElement.style.display = "none";
      this.bridgeVideoElement.pause();
    }

    const iframePlaceholder = document.getElementById("yt-iframe-placeholder");
    if (iframePlaceholder) iframePlaceholder.style.display = "block";

    await this.initApi();

    return new Promise((resolve) => {
      let resolved = false;
      const done = (val) => {
        if (!resolved) {
          resolved = true;
          resolve(val);
        }
      };

      setTimeout(() => {
        if (!resolved) {
          console.warn("YouTube player ready timeout - starting engine loop");
          done(this.player);
        }
      }, 3000);

      if (this.player && typeof this.player.loadVideoById === "function") {
        try {
          this.player.loadVideoById({
            videoId: videoConfig.videoId,
            startSeconds: videoConfig.trimStart || 0
          });
          if (videoConfig.audioMuted) this.player.mute();
          else this.player.unMute();
          try { this.player.playVideo(); } catch (_) {}
        } catch (err) {
          console.warn("loadVideoById error:", err);
        }
        this.startWatcher();
        done(this.player);
        return;
      }

      if (!window.YT || !window.YT.Player) {
        console.warn("window.YT not available - skipping player creation");
        done(null);
        return;
      }

      try {
        this.player = new window.YT.Player("yt-iframe-placeholder", {
          videoId: videoConfig.videoId,
          playerVars: {
            autoplay: 1,
            controls: 0,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            disablekb: 1,
            origin: window.location.origin
          },
          events: {
            onReady: (e) => {
              if (videoConfig.audioMuted) e.target.mute();
              try { e.target.playVideo(); } catch (_) {}
              this.startWatcher();
              done(e.target);
            },
            onError: (e) => {
              console.warn("YouTube player error:", e.data);
              TVNav.toast(`Erreur vidéo (${e.data})`);
              done(this.player);
            }
          }
        });
      } catch (err) {
        console.warn("new YT.Player error:", err);
        done(null);
      }
    });
  }

  /**
   * Ensures the <video> element and loading/error overlay DOM elements exist.
   * Requirement 2 & 4: Replace iframe with <video> and show loading/error states.
   */
  ensureBridgeUi() {
    let container = document.getElementById("yt-player-container");
    if (!container) {
      container = document.getElementById("video-stage") || document.body;
    }

    // 1. Create or bind <video> element
    if (!this.bridgeVideoElement) {
      let video = document.getElementById("native-bridge-video");
      if (!video) {
        video = document.createElement("video");
        video.id = "native-bridge-video";
        video.className = "native-bridge-player";
        video.setAttribute("playsinline", "");
        video.setAttribute("controls", "");
        video.autoplay = true;
        video.style.cssText = `
          width: 100%;
          height: 100%;
          object-fit: contain;
          background: #000;
          position: absolute;
          inset: 0;
          z-index: 2;
        `;
        container.appendChild(video);
      }
      this.bridgeVideoElement = video;

      video.addEventListener("ended", () => {
        bus.emit("VIDEO_REACHED_END");
      });
    }

    // 2. Create or bind overlay HUD (Loading & Error state)
    let overlay = document.getElementById("bridge-status-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "bridge-status-overlay";
      overlay.className = "bridge-status-overlay";
      overlay.style.cssText = `
        position: absolute;
        inset: 0;
        z-index: 15;
        background: rgba(10, 14, 23, 0.94);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: #f8fafc;
        font-family: system-ui, -apple-system, sans-serif;
        padding: 32px;
        text-align: center;
      `;
      overlay.innerHTML = `
        <div id="bridge-status-card" style="max-width: 560px; width: 100%; background: #131c2e; border: 1px solid #334155; border-radius: 20px; padding: 36px 32px; box-shadow: 0 20px 40px rgba(0,0,0,0.7);">
          <!-- Loading View -->
          <div id="bridge-loading-view">
            <div style="width: 64px; height: 64px; border: 4px solid rgba(16, 185, 129, 0.2); border-top-color: #10b981; border-radius: 50%; margin: 0 auto 24px; animation: bridge-spin 1s linear infinite;"></div>
            <h3 id="bridge-loading-title" style="font-size: 24px; font-weight: 700; color: #f1f5f9; margin: 0 0 10px;">Préparation du flux…</h3>
            <p id="bridge-loading-sub" style="font-size: 14px; color: #94a3b8; margin: 0 0 24px; font-family: monospace;">Mise en mémoire tampon progressive (120s)</p>
            
            <div style="background: #0f172a; border-radius: 999px; height: 12px; width: 100%; overflow: hidden; margin-bottom: 14px; border: 1px solid #1e293b;">
              <div id="bridge-progress-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #10b981, #38bdf8); transition: width 0.3s ease;"></div>
            </div>

            <div style="display: flex; justify-content: space-between; font-family: monospace; font-size: 13px; color: #cbd5e1;">
              <span id="bridge-progress-pct">0.0%</span>
              <span id="bridge-buffered-secs">0.0s / ~120s</span>
            </div>
          </div>

          <!-- Error View -->
          <div id="bridge-error-view" style="display: none;">
            <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(239, 68, 68, 0.2); color: #ef4444; display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 20px; font-weight: bold;">✕</div>
            <h3 style="font-size: 24px; font-weight: 700; color: #f87171; margin: 0 0 12px;">Erreur de lecture vidéo</h3>
            <p id="bridge-error-msg" style="font-size: 15px; color: #cbd5e1; margin: 0 0 28px; line-height: 1.5;"></p>
            
            <div style="display: flex; gap: 16px; justify-content: center;" data-zone data-dir="h">
              <button type="button" id="btn-bridge-retry" class="bridge-btn bridge-btn-primary" data-action="bridge-retry" data-focusable tabindex="0" style="padding: 14px 28px; font-size: 16px; font-weight: 700; background: #10b981; color: #022c22; border: none; border-radius: 12px; cursor: pointer;">
                Réessayer
              </button>
              <button type="button" id="btn-bridge-cancel" class="bridge-btn bridge-btn-cancel" data-action="bridge-cancel" data-focusable tabindex="0" style="padding: 14px 24px; font-size: 16px; font-weight: 600; background: #334155; color: #f1f5f9; border: none; border-radius: 12px; cursor: pointer;">
                Quitter
              </button>
            </div>
          </div>
        </div>

        <style>
          @keyframes bridge-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          .bridge-btn:focus, .bridge-btn.is-focused {
            outline: 3px solid #38bdf8 !important;
            box-shadow: 0 0 20px rgba(56, 189, 248, 0.6) !important;
            transform: scale(1.06);
          }
        </style>
      `;
      container.appendChild(overlay);

      document.getElementById("btn-bridge-retry")?.addEventListener("click", () => {
        this.retryLastRequest();
      });
      document.getElementById("btn-bridge-cancel")?.addEventListener("click", () => {
        TVNav.activate(document.getElementById("btn-bridge-cancel"));
      });
    }
  }

  showBridgeOverlay(type, data = {}) {
    const overlay = document.getElementById("bridge-status-overlay");
    if (!overlay) return;
    overlay.hidden = false;
    overlay.style.display = "flex";

    const loadingView = document.getElementById("bridge-loading-view");
    const errorView = document.getElementById("bridge-error-view");

    if (type === "loading") {
      if (loadingView) loadingView.style.display = "block";
      if (errorView) errorView.style.display = "none";
      if (data.title) document.getElementById("bridge-loading-title").textContent = data.title;
      if (data.subtitle) document.getElementById("bridge-loading-sub").textContent = data.subtitle;
    } else if (type === "error") {
      if (loadingView) loadingView.style.display = "none";
      if (errorView) errorView.style.display = "block";
      const errEl = document.getElementById("bridge-error-msg");
      if (errEl) errEl.textContent = data.message || "Une erreur est survenue lors du streaming.";

      setTimeout(() => {
        const retryBtn = document.getElementById("btn-bridge-retry");
        if (retryBtn) TVNav.setFocus(retryBtn);
      }, 60);
    }
  }

  hideBridgeOverlay() {
    const overlay = document.getElementById("bridge-status-overlay");
    if (overlay) {
      overlay.hidden = true;
      overlay.style.display = "none";
    }
  }

  /**
   * Adapts the native HTML5 <video> element to match the YouTube Player API
   * expected by GameEngine and RunEngine (playVideo, pauseVideo, seekTo, etc.).
   */
  buildVideoAdapter() {
    const video = this.bridgeVideoElement;
    if (!video) return;

    this.player = {
      playVideo: () => {
        if (this.bridgeVideoElement) {
          return this.bridgeVideoElement.play().catch(e => {
            console.warn("Auto-play prevented or stream error:", e);
          });
        }
      },
      pauseVideo: () => {
        if (this.bridgeVideoElement) {
          this.bridgeVideoElement.pause();
        }
      },
      seekTo: (seconds, allowSeekAhead) => {
        if (this.bridgeVideoElement) {
          this.bridgeVideoElement.currentTime = seconds;
        }
      },
      getCurrentTime: () => {
        return this.bridgeVideoElement ? this.bridgeVideoElement.currentTime : 0;
      },
      getPlayerState: () => {
        if (!this.bridgeVideoElement) return -1;
        if (this.bridgeVideoElement.ended) return 0; // ended
        if (this.bridgeVideoElement.seeking || this.bridgeVideoElement.readyState < 3) return 3; // buffering
        if (!this.bridgeVideoElement.paused) return 1; // playing
        return 2; // paused
      },
      setPlaybackRate: (rate) => {
        if (this.bridgeVideoElement) {
          this.bridgeVideoElement.playbackRate = rate;
        }
      },
      getPlaybackRate: () => {
        return this.bridgeVideoElement ? this.bridgeVideoElement.playbackRate : 1.0;
      },
      getAvailablePlaybackRates: () => [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
      mute: () => {
        if (this.bridgeVideoElement) this.bridgeVideoElement.muted = true;
      },
      unMute: () => {
        if (this.bridgeVideoElement) this.bridgeVideoElement.muted = false;
      },
      stopVideo: () => {
        if (this.bridgeVideoElement) {
          this.bridgeVideoElement.pause();
          this.bridgeVideoElement.removeAttribute("src");
          this.bridgeVideoElement.load();
        }
      }
    };
  }

  /**
   * Callback received from Android Native code:
   * window.onStreamProgress(percent, bufferedSeconds)
   */
  handleStreamProgress(percent, bufferedSeconds) {
    const bar = document.getElementById("bridge-progress-bar");
    const pctEl = document.getElementById("bridge-progress-pct");
    const bufEl = document.getElementById("bridge-buffered-secs");

    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    const s = Math.max(0, Number(bufferedSeconds) || 0);

    if (bar) bar.style.width = `${p}%`;
    if (pctEl) pctEl.textContent = `${p.toFixed(1)}%`;
    if (bufEl) bufEl.textContent = `${s.toFixed(1)}s / ~120s buffer`;
  }

  /**
   * Callback received from Android Native code:
   * window.onStreamReady(localUrl)
   */
  handleStreamReady(localUrl) {
    console.info(`[VideoController] onStreamReady: ${localUrl}`);
    if (this.loadTimeoutId) {
      clearTimeout(this.loadTimeoutId);
      this.loadTimeoutId = null;
    }

    this.hideBridgeOverlay();

    const video = this.bridgeVideoElement;
    if (video) {
      video.src = localUrl;

      const startSecs = this.config?.trimStart || 0;
      if (startSecs > 0) {
        const onLoadedMeta = () => {
          video.removeEventListener("loadedmetadata", onLoadedMeta);
          video.currentTime = startSecs;
        };
        video.addEventListener("loadedmetadata", onLoadedMeta);
      }

      video.play().catch(err => {
        console.warn("Video playback auto-start error:", err);
      });

      this.startWatcher();
    }

    if (this.loadResolveFn) {
      const fn = this.loadResolveFn;
      this.loadResolveFn = null;
      fn(this.player);
    }
  }

  /**
   * Callback received from Android Native code:
   * window.onStreamError(message)
   */
  handleStreamError(message) {
    console.error(`[VideoController] onStreamError: ${message}`);
    if (this.loadTimeoutId) {
      clearTimeout(this.loadTimeoutId);
      this.loadTimeoutId = null;
    }

    this.showBridgeOverlay("error", {
      message: message || "Erreur lors du téléchargement du flux YouTube."
    });
    TVNav.toast("Erreur de streaming");
  }

  /**
   * Retries requesting the current video URL after an error.
   */
  retryLastRequest() {
    if (this.config) {
      this.loadVideo(this.config);
    }
  }

  /**
   * Requirement 5: Call cancelVideo() when the user leaves the video,
   * closes the player, or picks another video.
   */
  cancelNativeVideo() {
    if (this.hasNativeBridge()) {
      try {
        console.info("[VideoController] Calling window.AndroidBridge.cancelVideo()");
        window.AndroidBridge.cancelVideo();
      } catch (err) {
        console.warn("Error calling AndroidBridge.cancelVideo():", err);
      }
    }
  }

  startWatcher() {
    if (this.watcher) clearInterval(this.watcher);
    this.lastPolledTime = 0;
    this.lastPollTimestamp = performance.now();

    this.watcher = setInterval(() => {
      if (!this.player || typeof this.player.getCurrentTime !== "function") return;
      try {
        const raw = this.player.getCurrentTime();
        this.lastPolledTime = raw;
        this.lastPollTimestamp = performance.now();

        if (!this.config) return;

        // Trim start clamp
        const trimStart = this.config.trimStart || 0;
        if (raw < trimStart - 0.5) {
          this.player.seekTo(trimStart, true);
          return;
        }

        // Trim end check
        const trimEnd = this.config.trimEnd;
        if (trimEnd && raw >= trimEnd) {
          bus.emit("VIDEO_REACHED_END");
          return;
        }

        // Non-destructive cuts
        const cuts = this.config.cuts || [];
        for (const cut of cuts) {
          if (raw >= cut.start && raw < cut.end) {
            this.player.seekTo(cut.end + 0.05, true);
            break;
          }
        }
      } catch (_) {}
    }, 50);
  }

  getInterpolatedOriginalTime() {
    if (this.isBridgeMode && this.bridgeVideoElement) {
      return this.bridgeVideoElement.currentTime;
    }
    if (!this.player) return 0;
    const elapsedSec = (performance.now() - this.lastPollTimestamp) / 1000;
    return this.lastPolledTime + elapsedSec;
  }

  /**
   * Stops video playback and releases resources.
   * Requirement 5: cancels native download stream.
   */
  stop() {
    if (this.watcher) clearInterval(this.watcher);
    if (this.loadTimeoutId) clearTimeout(this.loadTimeoutId);
    this.hideBridgeOverlay();

    // Stop native download
    this.cancelNativeVideo();

    try {
      if (this.player && typeof this.player.stopVideo === "function") {
        this.player.stopVideo();
      }
    } catch (_) {}
  }
}

export const videoController = new VideoController();

/**
 * GameEngine: Rhythm Timeline Engine with Outcome Seeks (Score & Hearts Overlay)
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
    this.seekGracePeriodUntil = 0;
    this.rafLoopId = null;
    this.activeCues = [];
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
    this.lives = gameData.game?.rules?.maxLives || 3;

    this.timeline = (gameData.game?.timeline || []).map(e => Object.assign({}, e));
    this.judgedEvents.clear();

    const stage = document.getElementById("video-stage");
    if (stage) {
      stage.classList.add("active", "mode-game");
      stage.classList.remove("mode-run");
    }

    // Display HUD overlay for game, hide virtual run panel
    document.getElementById("game-hud")?.classList.remove("hidden");
    document.getElementById("run-panel")?.classList.add("hidden");
    this.updateHUD();

    this.canvas = document.getElementById("game-feedback-canvas");
    if (this.canvas) {
      this.canvas.width = 1920;
      this.canvas.height = 1080;
      this.ctx = this.canvas.getContext("2d");
    }

    this.unsubEvents = [
      bus.on("JUMP", () => this.handleAction("JUMP")),
      bus.on("UP", () => this.handleAction("JUMP")),
      bus.on("RIGHT", () => this.handleAction("RIGHT")),
      bus.on("LEFT", () => this.handleAction("LEFT")),
      bus.on("SLIDE_DOWN", () => this.handleAction("SLIDE DOWN")),
      bus.on("SLIDE DOWN", () => this.handleAction("SLIDE DOWN")),
      bus.on("DOWN", () => this.handleAction("SLIDE DOWN")),
      bus.on("SLASH", () => this.handleAction("SLASH")),
      bus.on("PUNCH", () => this.handleAction("PUNCH")),
      bus.on("STEP_LEFT", () => this.handleAction("LEFT")),
      bus.on("STEP_RIGHT", () => this.handleAction("RIGHT")),
      bus.on("GAME_ACTION", (p) => { if (p?.action) this.handleAction(p.action); }),
      bus.on("VIDEO_REACHED_END", () => this.handleVictory())
    ];

    notifyAndroid("GAME_STARTED", { title: gameData.meta?.title });

    videoController.loadVideo(gameData.video).then(() => {
      this.runGameLoop();
    });
  }

  stop() {
    this.active = false;
    appState.inGame = false;
    if (this.rafLoopId) cancelAnimationFrame(this.rafLoopId);
    this.unsubEvents.forEach(un => un());
    this.unsubEvents = [];
    document.getElementById("video-stage")?.classList.remove("mode-game");
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  runGameLoop() {
    if (!this.active) return;
    const currentTime = videoController.getInterpolatedOriginalTime() + (appState.calibrationMs / 1000);
    this.processTimeline(currentTime);
    this.renderCanvasFeedback();
    this.updateTimelineBar(currentTime);
    this.rafLoopId = requestAnimationFrame(() => this.runGameLoop());
  }

  processTimeline(currentTime) {
    const rules = this.currentGame.game?.rules || {};
    const windowGoodSec = (rules.timingWindowMs?.good || 350) / 1000;

    for (const ev of this.timeline) {
      if (this.judgedEvents.has(ev.id)) continue;

      if (ev.action === "STARTING COUNT") {
        if (currentTime >= ev.time && currentTime < ev.time + 3.0) {
          const count = 3 - Math.floor(currentTime - ev.time);
          if (ev._lastCount !== count && count > 0) {
            ev._lastCount = count;
            Snd.countdown(count);
            this.addCue("COUNT", count.toString());
          }
        } else if (currentTime >= ev.time + 3.0) {
          this.judgedEvents.add(ev.id);
        }
        continue;
      }

      if (ev.action === "GO") {
        if (currentTime >= ev.time && !ev._triggered) {
          ev._triggered = true;
          Snd.countdown(0);
          this.addCue("GO", "GO !");
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

      // Miss check
      if (performance.now() > this.seekGracePeriodUntil) {
        if (currentTime > ev.time + windowGoodSec) {
          this.judgedEvents.add(ev.id);
          this.handleFail(ev, "MISS");
        }
      }
    }
  }

  matchAction(targetAction, inputAction) {
    const norm = (a) => String(a || "").replace(/_/g, " ").trim().toUpperCase();
    const t = norm(targetAction);
    const i = norm(inputAction);
    if (t === i) return true;
    if ((t === "SLIDE DOWN" || t === "SLIDE") && (i === "SLIDE DOWN" || i === "SLIDE" || i === "DOWN")) return true;
    if (t === "JUMP" && (i === "JUMP" || i === "UP")) return true;
    if (t === "LEFT" && (i === "LEFT" || i === "STEP LEFT")) return true;
    if (t === "RIGHT" && (i === "RIGHT" || i === "STEP RIGHT")) return true;
    if (t === "PUNCH" && (i === "PUNCH" || i === "HIT" || i === "STRIKE")) return true;
    if (t === "SLASH" && (i === "SLASH" || i === "SWORD")) return true;
    return false;
  }

  handleAction(action) {
    if (!this.active) return;
    const currentTime = videoController.getInterpolatedOriginalTime() + (appState.calibrationMs / 1000);
    const rules = this.currentGame.game?.rules || {};
    const winPerfectSec = (rules.timingWindowMs?.perfect || 150) / 1000;
    const winGoodSec = (rules.timingWindowMs?.good || 350) / 1000;

    let target = null;
    let minDelta = Infinity;

    for (const ev of this.timeline) {
      if (this.judgedEvents.has(ev.id)) continue;
      if (["STARTING COUNT", "GO", "END", "WIN"].includes(ev.action)) continue;
      const delta = Math.abs(currentTime - ev.time);
      if (delta <= winGoodSec && delta < minDelta) {
        minDelta = delta;
        target = ev;
      }
    }

    if (!target) return;

    this.judgedEvents.add(target.id);
    if (this.matchAction(target.action, action)) {
      this.handleSuccess(target, minDelta <= winPerfectSec);
    } else {
      this.handleFail(target, "WRONG");
    }
  }

  handleSuccess(ev, isPerfect) {
    const rules = this.currentGame.game?.rules || {};
    const basePts = isPerfect ? (rules.scoring?.perfect || 100) : (rules.scoring?.good || 50);

    this.combo++;
    const step = rules.scoring?.comboMultiplierStep || 5;
    const maxMult = rules.scoring?.maxMultiplier || 3;
    this.multiplier = Math.min(maxMult, 1 + Math.floor(this.combo / step));

    this.score += basePts * this.multiplier;
    Snd.success(isPerfect);
    this.addCue(isPerfect ? "PERFECT" : "GOOD", isPerfect ? "PARFAIT !" : "BIEN !");
    this.updateHUD();

    if (ev.onSuccess?.enabled && typeof ev.onSuccess.seekTo === "number" && ev.onSuccess.seekTo >= 0) {
      this.applyOutcomeSeek(ev.onSuccess.seekTo, "SUCCÈS !");
    }
  }

  handleFail(ev, reason) {
    this.combo = 0;
    this.multiplier = 1;
    this.lives = Math.max(0, this.lives - 1);
    this.misses++;

    Snd.fail();
    this.addCue("FAIL", reason === "WRONG" ? "MAUVAIS MOUVEMENT" : "RATÉ !");
    this.updateHUD();

    const rules = this.currentGame.game?.rules || {};
    if (this.lives <= 0 || this.misses >= (rules.maxMisses || 6)) {
      this.handleGameOver();
      return;
    }

    if (ev.onFail?.enabled && typeof ev.onFail.seekTo === "number" && ev.onFail.seekTo >= 0) {
      this.applyOutcomeSeek(ev.onFail.seekTo, "RATÉ !");
    }
  }

  applyOutcomeSeek(seekToTime, bannerLabel) {
    if (!videoController.player) return;
    const target = Math.max(this.currentGame.video.trimStart || 0, seekToTime);
    videoController.player.seekTo(target, true);

    this.judgedEvents.clear();
    for (const ev of this.timeline) {
      if (ev.time < target) this.judgedEvents.add(ev.id);
    }

    this.seekGracePeriodUntil = performance.now() + 900;

    const mins = Math.floor(target / 60);
    const secs = String(Math.floor(target % 60)).padStart(2, "0");
    const banner = document.getElementById("seek-toast-banner");
    if (banner) {
      banner.textContent = `${bannerLabel} ↪ ${mins}:${secs}`;
      banner.classList.add("show");
      setTimeout(() => banner.classList.remove("show"), 2000);
    }
  }

  handleGameOver() {
    this.stop();
    Snd.fail();
    notifyAndroid("GAME_FINISHED", { result: "GAMEOVER", score: this.score });
    TVNav.toast("GAME OVER ! Réessayez !");
    this.showSummaryScreen("GAME OVER");
  }

  handleVictory() {
    this.stop();
    Snd.win();
    const best = appState.profile.bestScores[this.currentGame._filename] || 0;
    if (this.score > best) {
      appState.profile.bestScores[this.currentGame._filename] = this.score;
      appState.saveProfile();
    }
    notifyAndroid("GAME_FINISHED", { result: "WIN", score: this.score, bestScore: Math.max(best, this.score) });
    this.showSummaryScreen("VICTOIRE !");
  }

  showSummaryScreen(title) {
    document.getElementById("summary-hero-title").textContent = title;
    document.getElementById("summary-stat-1-val").textContent = this.score;
    document.getElementById("summary-stat-1-lbl").textContent = "Score Final";

    const best = appState.profile.bestScores[this.currentGame._filename] || this.score;
    document.getElementById("summary-stat-2-val").textContent = best;
    document.getElementById("summary-stat-2-lbl").textContent = "Meilleur Score";

    document.getElementById("summary-stat-3-val").textContent = `${this.misses}`;
    document.getElementById("summary-stat-3-lbl").textContent = "Fautes";

    appUI.openModal("modal-summary");
  }

  updateHUD() {
    const scoreVal = document.getElementById("hud-game-score");
    if (scoreVal) scoreVal.textContent = this.score;

    const comboVal = document.getElementById("hud-game-combo");
    if (comboVal) comboVal.textContent = `x${this.multiplier} (${this.combo})`;

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
    const end = this.currentGame.video.trimEnd || 90;
    const progress = Math.max(0, Math.min(100, ((currentTime - start) / (end - start)) * 100));

    const fill = document.getElementById("game-timeline-progress");
    if (fill) fill.style.width = `${progress}%`;

    const nextEv = this.timeline.find(ev => !this.judgedEvents.has(ev.id) && ev.time >= currentTime && ev.showOnScreen !== false);
    const spotlight = document.getElementById("game-next-cue-spotlight");
    if (spotlight && nextEv) {
      spotlight.style.display = "flex";
      const icon = document.getElementById("next-cue-icon");
      const text = document.getElementById("next-cue-text");
      const hint = document.getElementById("next-cue-hint");
      if (icon) icon.textContent = this.getActionIcon(nextEv.action);
      if (text) text.textContent = nextEv.action;
      if (hint) hint.textContent = nextEv.hint || "";
    } else if (spotlight) {
      spotlight.style.display = "none";
    }
  }

  getActionIcon(action) {
    switch (action) {
      case "JUMP": return "↑";
      case "SLIDE DOWN": return "↓";
      case "LEFT": return "←";
      case "RIGHT": return "→";
      case "PUNCH": return "👊";
      case "SLASH": return "⚔️";
      default: return "★";
    }
  }

  addCue(type, text) {
    this.activeCues.push({
      type,
      text,
      startTime: performance.now(),
      endTime: performance.now() + 800
    });
  }

  renderCanvasFeedback() {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const now = performance.now();
    this.activeCues = this.activeCues.filter(c => now < c.endTime);

    for (const cue of this.activeCues) {
      const p = (now - cue.startTime) / (cue.endTime - cue.startTime);
      const scale = 1.0 + Math.sin(p * Math.PI) * 0.25;
      const opacity = 1.0 - Math.pow(p, 2);

      this.ctx.save();
      this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2 - 30);
      this.ctx.scale(scale, scale);
      this.ctx.globalAlpha = opacity;

      if (cue.type === "PERFECT") {
        this.ctx.fillStyle = "#34d399";
        this.ctx.font = "900 84px system-ui";
      } else if (cue.type === "GOOD") {
        this.ctx.fillStyle = "#60a5fa";
        this.ctx.font = "800 72px system-ui";
      } else if (cue.type === "FAIL") {
        this.ctx.fillStyle = "#ef4444";
        this.ctx.font = "900 76px system-ui";
      } else {
        this.ctx.fillStyle = "#fbbf24";
        this.ctx.font = "900 110px system-ui";
      }
      this.ctx.textAlign = "center";
      this.ctx.fillText(cue.text, 0, 0);
      this.ctx.restore();
    }
  }
}

export const gameEngine = new GameEngine();

/**
 * RunEngine: Virtual Run Mode
 * Dedicated Details Table at Left (Time, Steps, Speed, Distance, Calories based on age/weight/speed/steps).
 * NO HEARTS, NO SCORE. Video is fully visible at right with ZERO OVERLAY!
 */
class RunEngine {
  constructor() {
    this.active = false;
    this.currentRun = null;
    this.stepTimestamps = [];
    this.totalSteps = 0;
    this.leftSteps = 0;
    this.rightSteps = 0;
    this.distanceKm = 0;
    this.movingTimeSec = 0;
    this.smoothedSpeedKmh = 0;
    this.currentCadenceSpm = 0;
    this.calories = 0;
    this.lastStepTime = 0;
    this.lastRateChangeTime = 0;
    this.timerInterval = null;
    this.rafLoopId = null;
    this.unsubEvents = [];
    this.stepIntervalHistory = [];
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
    this.calories = 0;
    this.lastStepTime = performance.now();

    const stage = document.getElementById("video-stage");
    if (stage) {
      stage.classList.add("active", "mode-run");
      stage.classList.remove("mode-game");
    }

    // Show Left Table Panel, HIDE GAME HUD COMPLETELY
    const runPanel = document.getElementById("run-panel");
    if (runPanel) {
      runPanel.classList.remove("hidden");
      const titleEl = document.getElementById("run-panel-route-title");
      if (titleEl) titleEl.textContent = runData.meta?.title || "Sentier Alpin";
      const calMetaEl = document.getElementById("run-tbl-cal-meta");
      if (calMetaEl) calMetaEl.textContent = `${appState.profile.age || 28} ans · ${appState.profile.weightKg || 70} kg`;
    }
    document.getElementById("game-hud")?.classList.add("hidden");

    this.unsubEvents = [
      bus.on("STEP_LEFT", () => this.handleStep("LEFT")),
      bus.on("STEP_RIGHT", () => this.handleStep("RIGHT")),
      bus.on("VIDEO_REACHED_END", () => this.handleEnd())
    ];

    notifyAndroid("RUN_STARTED", { title: runData.meta?.title });

    this.updateTable();

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
    this.unsubEvents.forEach(un => un());
    this.unsubEvents = [];
    document.getElementById("video-stage")?.classList.remove("mode-run");
  }

  handleStep(foot) {
    if (!this.active) return;
    const now = performance.now();

    // Reject bounce < 150ms
    if (now - this.lastStepTime < 150) return;
    const interval = now - this.lastStepTime;
    this.lastStepTime = now;
    Snd.step();

    this.totalSteps++;
    if (foot === "LEFT") this.leftSteps++;
    else this.rightSteps++;

    const footEl = document.getElementById(foot === "LEFT" ? "foot-left-ind" : "foot-right-ind");
    if (footEl) {
      footEl.classList.add("flash");
      setTimeout(() => footEl.classList.remove("flash"), 120);
    }

    this.stepTimestamps.push(now);
    if (this.stepTimestamps.length > 6) this.stepTimestamps.shift();

    if (interval < 5000) {
      this.stepIntervalHistory.push(interval);
      if (this.stepIntervalHistory.length > 50) this.stepIntervalHistory.shift();
    }

    this.updateMetrics();
    this.distanceKm = (this.totalSteps * appState.profile.strideLengthM) / 1000;

    // Mechanical step energy expenditure
    const weight = appState.profile.weightKg || 70;
    const stepWorkKcal = 0.038 * (weight / 70) * (Math.max(4, this.smoothedSpeedKmh) / 8.0);
    this.calories += stepWorkKcal;

    this.updateTable();

    // Resume video if paused
    if (videoController.player && typeof videoController.player.playVideo === "function") {
      try {
        if (videoController.player.getPlayerState() === 2) videoController.player.playVideo();
      } catch (_) {}
    }
  }

  updateMetrics() {
    if (this.stepTimestamps.length < 2) return;
    const intervals = [];
    for (let i = 1; i < this.stepTimestamps.length; i++) {
      intervals.push(this.stepTimestamps[i] - this.stepTimestamps[i - 1]);
    }
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];

    if (median > 0) {
      this.currentCadenceSpm = Math.round(60000 / median);
      const stepSec = median / 1000;
      const rawSpeed = (appState.profile.strideLengthM / stepSec) * 3.6;
      this.smoothedSpeedKmh = this.smoothedSpeedKmh === 0 ? rawSpeed : (this.smoothedSpeedKmh * 0.65 + rawSpeed * 0.35);
    }
  }

  startMovingClock() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (!this.active) return;
      const now = performance.now();

      // Idle timeout > 2.5s
      if (now - this.lastStepTime > 2500) {
        this.smoothedSpeedKmh = Math.max(0, this.smoothedSpeedKmh * 0.7);
        if (this.smoothedSpeedKmh < 0.5) this.smoothedSpeedKmh = 0;
        this.currentCadenceSpm = 0;

        if (videoController.player && typeof videoController.player.pauseVideo === "function") {
          try {
            if (videoController.player.getPlayerState() === 1) videoController.player.pauseVideo();
          } catch (_) {}
        }
      } else {
        this.movingTimeSec++;

        const age = appState.profile.age || 28;
        const weight = appState.profile.weightKg || 70;
        let met = 2.0;
        if (this.smoothedSpeedKmh >= 12) met = 12.8;
        else if (this.smoothedSpeedKmh >= 10) met = 11.5;
        else if (this.smoothedSpeedKmh >= 8) met = 9.8;
        else if (this.smoothedSpeedKmh >= 6) met = 7.5;
        else if (this.smoothedSpeedKmh >= 4) met = 4.0;
        else if (this.smoothedSpeedKmh > 0) met = 2.8;

        const ageFactor = Math.max(0.75, 1 - (age - 20) * 0.003);
        const kcalPerSec = ((met * 3.5 * weight / 200) / 60) * ageFactor;
        this.calories += kcalPerSec;
      }

      this.adjustVideoPlaybackSpeed();
      this.updateTable();
    }, 1000);
  }

  runEngineLoop() {
    if (!this.active) return;
    this.updateProgressBar();
    if (appState.simMode) this.renderSimDebug();
    this.rafLoopId = requestAnimationFrame(() => this.runEngineLoop());
  }

  adjustVideoPlaybackSpeed() {
    if (!videoController.player || typeof videoController.player.setPlaybackRate !== "function") return;
    const now = performance.now();
    if (now - this.lastRateChangeTime < 1200) return;

    let targetRate = this.smoothedSpeedKmh / 8.0;
    if (this.smoothedSpeedKmh === 0) targetRate = 1.0;
    targetRate = Math.max(0.25, Math.min(2.0, targetRate));

    const avail = videoController.player.getAvailablePlaybackRates?.() || [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    let closest = avail[0];
    let minD = Infinity;
    for (const r of avail) {
      const d = Math.abs(r - targetRate);
      if (d < minD) { minD = d; closest = r; }
    }

    try {
      const cur = videoController.player.getPlaybackRate();
      if (cur !== closest) {
        videoController.player.setPlaybackRate(closest);
        this.lastRateChangeTime = now;
        const lbl = document.getElementById("run-tbl-rate");
        if (lbl) lbl.textContent = `${closest}x`;
      }
    } catch (_) {}
  }

  updateTable() {
    // 1. Current Running Time (MM:SS)
    const timeEl = document.getElementById("run-tbl-time");
    if (timeEl) {
      const m = Math.floor(this.movingTimeSec / 60);
      const s = String(this.movingTimeSec % 60).padStart(2, "0");
      timeEl.textContent = `${m}:${s}`;
    }

    // 2. Count of Steps (Total + Left/Right Split)
    const stepsEl = document.getElementById("run-tbl-steps");
    if (stepsEl) stepsEl.textContent = this.totalSteps.toLocaleString("fr-FR");

    const splitEl = document.getElementById("run-tbl-split");
    if (splitEl) splitEl.textContent = `G: ${this.leftSteps} · D: ${this.rightSteps}`;

    // 3. Speed (km/h)
    const spdEl = document.getElementById("run-tbl-speed");
    if (spdEl) spdEl.textContent = this.smoothedSpeedKmh.toFixed(1);

    // 4. Distance (m / km)
    const distEl = document.getElementById("run-tbl-distance");
    const distUnit = document.getElementById("run-tbl-distance-unit");
    if (distEl) {
      if (this.distanceKm < 1.0) {
        distEl.textContent = Math.round(this.distanceKm * 1000);
        if (distUnit) distUnit.textContent = "m";
      } else {
        distEl.textContent = this.distanceKm.toFixed(2);
        if (distUnit) distUnit.textContent = "km";
      }
    }

    // 5. Calories (based on age, weight, speed, and steps)
    const calEl = document.getElementById("run-tbl-calories");
    if (calEl) calEl.textContent = Math.round(this.calories);

    // 6. Pace (/km)
    const paceEl = document.getElementById("run-tbl-pace");
    if (paceEl) {
      if (this.smoothedSpeedKmh > 1.0) {
        const pMin = 60 / this.smoothedSpeedKmh;
        const pM = Math.floor(pMin);
        const pS = String(Math.floor((pMin % 1) * 60)).padStart(2, "0");
        paceEl.textContent = `${pM}'${pS}"`;
      } else {
        paceEl.textContent = "--'--\"";
      }
    }

    // 7. Cadence (SPM)
    const cadEl = document.getElementById("run-tbl-cadence");
    if (cadEl) cadEl.textContent = this.currentCadenceSpm;
  }

  updateProgressBar() {
    const rawTime = videoController.getInterpolatedOriginalTime();
    const start = this.currentRun.video.trimStart || 0;
    const end = this.currentRun.video.trimEnd || 600;
    const p = Math.max(0, Math.min(100, ((rawTime - start) / (end - start)) * 100));

    const fill = document.getElementById("run-bottom-progress-fill");
    if (fill) fill.style.width = `${p}%`;

    const pct = document.getElementById("run-progress-pct");
    if (pct) pct.textContent = `${Math.round(p)}%`;
  }

  handleEnd() {
    this.stop();
    Snd.win();

    const summary = {
      distanceKm: this.distanceKm,
      totalSteps: this.totalSteps,
      movingTimeSec: this.movingTimeSec,
      calories: Math.round(this.calories),
      avgSpeedKmh: this.movingTimeSec > 0 ? (this.distanceKm / (this.movingTimeSec / 3600)) : 0
    };

    notifyAndroid("RUN_FINISHED", summary);

    document.getElementById("summary-hero-title").textContent = "Course Terminée !";
    document.getElementById("summary-stat-1-val").textContent = `${summary.distanceKm.toFixed(2)} km`;
    document.getElementById("summary-stat-1-lbl").textContent = "Distance Totale";

    document.getElementById("summary-stat-2-val").textContent = `${summary.totalSteps} pas`;
    document.getElementById("summary-stat-2-lbl").textContent = "Nombre de Pas";

    document.getElementById("summary-stat-3-val").textContent = `${summary.calories} kcal`;
    document.getElementById("summary-stat-3-lbl").textContent = "Calories Brûlées";

    appUI.openModal("modal-summary");
  }

  renderSimDebug() {
    const canvas = document.getElementById("sim-debug-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 2;
    ctx.beginPath();

    const w = canvas.width;
    const h = canvas.height;
    const len = this.stepIntervalHistory.length;

    for (let i = 0; i < len; i++) {
      const x = (i / Math.max(1, len - 1)) * w;
      const y = h - Math.min(h, (this.stepIntervalHistory[i] / 2000) * h);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "12px monospace";
    ctx.fillText(`Intervalle: ${this.stepIntervalHistory[len - 1] || 0}ms`, 8, 16);
  }
}

export const runEngine = new RunEngine();

/* ==========================================================================
   INITIALIZATION
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  inputLayer.init();
  appUI.init();
});
