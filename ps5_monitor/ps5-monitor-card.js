/**
 * SPSVM — PlayStation 5 Monitor & Session Tracker Card
 * v2.0 — Omarchy Shell Edition (Quickshell / Tiling WM / TUI Philosophy)
 *
 * Implements Omarchy's 4 Core UI Surfaces:
 *   1. Top Status Bar Widgets (Workspace pills, live session ticker, interactive system triggers)
 *   2. Dropdown Panels (Electrical telemetry, BE230 Network & DDP inspector, Theme switcher)
 *   3. Tiled Windows (Live Session TUI, Interactive SVG Power & State Graph, Analytics Matrix, Session Log)
 *   4. Full-Screen Overlays (Keyboard-driven Spotlight Command Launcher & Session/JSON Inspector)
 */

const OMARCHY_THEMES = {
  "tokyo-night": {
    id: "tokyo-night",
    label: "Tokyo Night",
    dot: "#7aa2f7",
    bg: "#1a1b26",
    surface: "#16161e",
    elevated: "#24283b",
    border: "#292e42",
    focus: "#7aa2f7",
    text: "#c0caf5",
    muted: "#565f89",
    subtle: "#787c99",
    accent: "#7aa2f7",
    cyan: "#7dcfff",
    green: "#9ece6a",
    amber: "#e0af68",
    red: "#f7768e",
    purple: "#bb9af7",
  },
  "catppuccin": {
    id: "catppuccin",
    label: "Catppuccin Mocha",
    dot: "#cba6f7",
    bg: "#1e1e2e",
    surface: "#181825",
    elevated: "#313244",
    border: "#45475a",
    focus: "#cba6f7",
    text: "#cdd6f4",
    muted: "#6c7086",
    subtle: "#9399b2",
    accent: "#89b4fa",
    cyan: "#89dceb",
    green: "#a6e3a1",
    amber: "#f9e2af",
    red: "#f38ba8",
    purple: "#cba6f7",
  },
  "gruvbox": {
    id: "gruvbox",
    label: "Gruvbox Dark",
    dot: "#fabd2f",
    bg: "#1d2021",
    surface: "#282828",
    elevated: "#3c3836",
    border: "#504945",
    focus: "#fabd2f",
    text: "#ebdbb2",
    muted: "#928374",
    subtle: "#a89984",
    accent: "#83a598",
    cyan: "#8ec07c",
    green: "#b8bb26",
    amber: "#fabd2f",
    red: "#fb4934",
    purple: "#d3869b",
  },
  "sony-ps5": {
    id: "sony-ps5",
    label: "PS5 Obsidian",
    dot: "#00f0ff",
    bg: "#090d16",
    surface: "#0d1322",
    elevated: "#162038",
    border: "#1e2f52",
    focus: "#00b4d8",
    text: "#f1f5f9",
    muted: "#64748b",
    subtle: "#94a3b8",
    accent: "#0070d1",
    cyan: "#00f0ff",
    green: "#10b981",
    amber: "#f59e0b",
    red: "#f43f5e",
    purple: "#818cf8",
  },
  "ha-sync": {
    id: "ha-sync",
    label: "HA Theme Sync",
    dot: "#0ea5e9",
    bg: "var(--primary-background-color, #111318)",
    surface: "var(--card-background-color, #1a1d24)",
    elevated: "var(--secondary-background-color, #252934)",
    border: "var(--divider-color, #2e3440)",
    focus: "var(--primary-color, #38bdf8)",
    text: "var(--primary-text-color, #e2e8f0)",
    muted: "var(--secondary-text-color, #64748b)",
    subtle: "var(--secondary-text-color, #94a3b8)",
    accent: "var(--primary-color, #38bdf8)",
    cyan: "#38bdf8",
    green: "#22c55e",
    amber: "#f59e0b",
    red: "#ef4444",
    purple: "#a855f7",
  },
};

class PS5MonitorCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;

    // Omarchy UI State
    const savedTheme = localStorage.getItem("omarchy_ps5_theme");
    this._themeId = savedTheme && OMARCHY_THEMES[savedTheme] ? savedTheme : "tokyo-night";
    this._focusedTile = 1; // 1: Live, 2: Graph, 3: Analytics, 4: Session Log
    this._activeDropdown = null; // null | "power" | "network" | "theme"
    this._overlayMode = null; // null | "Launcher" | "session" | "raw"
    this._commandQuery = "";
    this._commandIdx = 0;
    this._logFilter = "";
    this._selectedSessionIdx = 0;
    this._inspectedSession = null;

    // Telemetry Graph State
    this._rangeHours = 12;
    this._powerHistory = [];
    this._statusHistory = [];
    this._historyLoading = false;
    this._lastHistoryFetch = 0;
    this._lastHistoryRange = 0;
    this._hoverPoint = null;

    // Timers & Event Handlers
    this._tickInterval = null;
    this._lastStateHash = "";

    this._onKeyDown = this._handleKeyDown.bind(this);
  }

  setConfig(config) {
    if (!config) {
      throw new Error("Invalid configuration");
    }
    this._config = {
      title: "SPSVM // PS5",
      status_entity: "sensor.ps5_status",
      in_use_entity: "binary_sensor.ps5_in_use",
      history_entity: "sensor.ps5_session_history",
      power_entity: "sensor.sala_tvsocket_tvsocket_power",
      energy_entity: "sensor.sala_tvsocket_energy",
      daily_energy_entity: "sensor.sala_tvsocket_daily_energy_tv",
      voltage_entity: "sensor.sala_tvsocket_tvsocket_voltage",
      current_entity: "sensor.sala_tvsocket_tvsocket_current",
      frequency_entity: "sensor.sala_tvsocket_tvsocket_frequency",
      tracker_entity: "device_tracker.ps5_9df086",
      kwh_rate_mxn: 3.25,
      ...config,
    };
    if (this._hass) {
      this._fetchHistoryIfNeeded();
      this._render();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;

    this._fetchHistoryIfNeeded();

    const newHash = this._computeStateHash(hass);
    if (newHash !== this._lastStateHash) {
      this._lastStateHash = newHash;
      this._render();
    }
  }

  connectedCallback() {
    window.addEventListener("keydown", this._onKeyDown);
    this._tickInterval = setInterval(() => {
      this._updateLiveClockDom();
    }, 1000);
    if (this._hass && this._config) {
      this._fetchHistoryIfNeeded();
      this._render();
    }
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this._onKeyDown);
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
  }

  getCardSize() {
    return 10;
  }

  static getStubConfig() {
    return {
      title: "SPSVM // PS5",
      status_entity: "sensor.ps5_status",
      in_use_entity: "binary_sensor.ps5_in_use",
      history_entity: "sensor.ps5_session_history",
      power_entity: "sensor.sala_tvsocket_tvsocket_power",
      energy_entity: "sensor.sala_tvsocket_energy",
      tracker_entity: "device_tracker.ps5_9df086",
    };
  }

  _computeStateHash(hass) {
    if (!hass || !this._config) return "";
    const keys = [
      this._config.status_entity,
      this._config.in_use_entity,
      this._config.history_entity,
      this._config.power_entity,
      this._config.energy_entity,
      this._config.daily_energy_entity,
      this._config.voltage_entity,
      this._config.current_entity,
      this._config.tracker_entity,
    ];
    return keys
      .map((k) => {
        const s = k ? hass.states[k] : null;
        return s ? `${s.state}:${s.last_updated}` : "-";
      })
      .join("|");
  }

  async _fetchHistoryIfNeeded(force = false) {
    if (!this._hass || !this._config) return;
    const now = Date.now();
    if (
      !force &&
      this._lastHistoryRange === this._rangeHours &&
      now - this._lastHistoryFetch < 45000 &&
      this._powerHistory.length > 0
    ) {
      return;
    }
    if (this._historyLoading) return;

    this._historyLoading = true;
    this._lastHistoryFetch = now;
    this._lastHistoryRange = this._rangeHours;

    try {
      const startIso = new Date(now - this._rangeHours * 3600 * 1000).toISOString();
      const entities = [this._config.power_entity, this._config.status_entity]
        .filter(Boolean)
        .join(",");
      const url = `history/period/${startIso}?filter_entity_id=${entities}&minimal_response=true&no_attributes=true`;
      const res = await this._hass.callApi("GET", url);

      let pSeries = [];
      let sSeries = [];
      if (Array.isArray(res)) {
        for (const arr of res) {
          if (!Array.isArray(arr) || arr.length === 0) continue;
          const eid = arr[0].entity_id;
          if (eid === this._config.power_entity) {
            pSeries = arr
              .map((pt) => ({
                t: new Date(pt.last_changed || pt.last_updated || pt.lu * 1000).getTime(),
                v: parseFloat(pt.state),
              }))
              .filter((pt) => !isNaN(pt.t) && !isNaN(pt.v));
          } else if (eid === this._config.status_entity) {
            sSeries = arr
              .map((pt) => ({
                t: new Date(pt.last_changed || pt.last_updated || pt.lu * 1000).getTime(),
                s: String(pt.state || "off").toLowerCase(),
              }))
              .filter((pt) => !isNaN(pt.t));
          }
        }
      }
      this._powerHistory = this._downsampleSeries(pSeries, 120);
      this._statusHistory = sSeries;
    } catch (err) {
      console.warn("SPSVM history fetch warning:", err);
    } finally {
      this._historyLoading = false;
      this._render();
    }
  }

  _downsampleSeries(points, maxBuckets) {
    if (!points || points.length <= maxBuckets) return points || [];
    const start = points[0].t;
    const end = points[points.length - 1].t;
    if (end <= start) return points.slice(-maxBuckets);

    const step = (end - start) / maxBuckets;
    const buckets = [];
    let idx = 0;

    for (let i = 0; i < maxBuckets; i++) {
      const bStart = start + i * step;
      const bEnd = bStart + step;
      let sum = 0;
      let maxVal = -Infinity;
      let count = 0;
      while (idx < points.length && points[idx].t <= bEnd) {
        const v = points[idx].v;
        sum += v;
        if (v > maxVal) maxVal = v;
        count++;
        idx++;
      }
      if (count > 0) {
        buckets.push({
          t: Math.round(bStart + step / 2),
          v: Math.round((sum / count) * 10) / 10,
          max: maxVal,
        });
      } else if (buckets.length > 0) {
        buckets.push({
          t: Math.round(bStart + step / 2),
          v: buckets[buckets.length - 1].v,
          max: buckets[buckets.length - 1].v,
        });
      }
    }
    return buckets;
  }

  _handleKeyDown(e) {
    // Do not intercept if user is typing in another input outside our shadowRoot
    const path = e.composedPath ? e.composedPath() : [];
    const inOurCard = path.includes(this) || document.activeElement === this;
    const activeEl = this.shadowRoot ? this.shadowRoot.activeElement : null;
    const isTyping = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");

    if (e.key === "Escape") {
      if (this._overlayMode || this._activeDropdown) {
        e.preventDefault();
        this._overlayMode = null;
        this._activeDropdown = null;
        this._render();
        return;
      }
      if (isTyping) {
        activeEl.blur();
        return;
      }
    }

    // Command launcher shortcuts
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      this._toggleOverlay("launcher");
      return;
    }

    if (this._overlayMode === "launcher") {
      const cmds = this._getFilteredCommands();
      if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
        e.preventDefault();
        this._commandIdx = cmds.length ? (this._commandIdx + 1) % cmds.length : 0;
        this._render();
      } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
        e.preventDefault();
        this._commandIdx = cmds.length ? (this._commandIdx - 1 + cmds.length) % cmds.length : 0;
        this._render();
      } else if (e.key === "Enter" && cmds[this._commandIdx]) {
        e.preventDefault();
        cmds[this._commandIdx].action();
      }
      return;
    }

    if (isTyping) return;
    if (!inOurCard && document.activeElement && document.activeElement.tagName === "INPUT") return;

    if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") {
      this._focusedTile = parseInt(e.key, 10);
      this._render();
    } else if (e.key === "t") {
      this._cycleTheme();
    } else if (e.key === "?" || e.key === "/") {
      e.preventDefault();
      this._toggleOverlay("launcher");
    } else if (e.key === "j" || e.key === "ArrowDown") {
      const sessions = this._getDisplaySessions();
      if (sessions.length > 0) {
        this._focusedTile = 4;
        this._selectedSessionIdx = Math.min(sessions.length - 1, this._selectedSessionIdx + 1);
        this._render();
      }
    } else if (e.key === "k" || e.key === "ArrowUp") {
      const sessions = this._getDisplaySessions();
      if (sessions.length > 0) {
        this._focusedTile = 4;
        this._selectedSessionIdx = Math.max(0, this._selectedSessionIdx - 1);
        this._render();
      }
    } else if (e.key === "Enter" && this._focusedTile === 4) {
      const sessions = this._getDisplaySessions();
      if (sessions[this._selectedSessionIdx]) {
        this._inspectedSession = sessions[this._selectedSessionIdx];
        this._overlayMode = "session";
        this._render();
      }
    }
  }

  _cycleTheme() {
    const keys = Object.keys(OMARCHY_THEMES);
    const nextIdx = (keys.indexOf(this._themeId) + 1) % keys.length;
    this._setTheme(keys[nextIdx]);
  }

  _setTheme(themeId) {
    if (!OMARCHY_THEMES[themeId]) return;
    this._themeId = themeId;
    localStorage.setItem("omarchy_ps5_theme", themeId);
    this._activeDropdown = null;
    this._overlayMode = null;
    this._render();
  }

  _toggleDropdown(name) {
    this._activeDropdown = this._activeDropdown === name ? null : name;
    this._render();
  }

  _toggleOverlay(mode) {
    if (this._overlayMode === mode) {
      this._overlayMode = null;
    } else {
      this._overlayMode = mode;
      this._commandQuery = "";
      this._commandIdx = 0;
    }
    this._activeDropdown = null;
    this._render();
    if (this._overlayMode === "launcher") {
      setTimeout(() => {
        const inp = this.shadowRoot.querySelector("#om-cmd-input");
        if (inp) inp.focus();
      }, 20);
    }
  }

  _getCommands() {
    return [
      {
        id: "theme-tokyo",
        category: "THEME",
        label: "Switch Theme → Tokyo Night",
        hint: "omarchy://theme/tokyo-night",
        action: () => this._setTheme("tokyo-night"),
      },
      {
        id: "theme-catppuccin",
        category: "THEME",
        label: "Switch Theme → Catppuccin Mocha",
        hint: "omarchy://theme/catppuccin",
        action: () => this._setTheme("catppuccin"),
      },
      {
        id: "theme-gruvbox",
        category: "THEME",
        label: "Switch Theme → Gruvbox Dark",
        hint: "omarchy://theme/gruvbox",
        action: () => this._setTheme("gruvbox"),
      },
      {
        id: "theme-sony",
        category: "THEME",
        label: "Switch Theme → PS5 Obsidian Blue",
        hint: "omarchy://theme/sony-ps5",
        action: () => this._setTheme("sony-ps5"),
      },
      {
        id: "theme-ha",
        category: "THEME",
        label: "Switch Theme → Home Assistant Native Sync",
        hint: "omarchy://theme/ha-sync",
        action: () => this._setTheme("ha-sync"),
      },
      {
        id: "range-1h",
        category: "GRAPH",
        label: "Telemetry Range → Last 1 Hour",
        hint: "1H",
        action: () => this._setRange(1),
      },
      {
        id: "range-6h",
        category: "GRAPH",
        label: "Telemetry Range → Last 6 Hours",
        hint: "6H",
        action: () => this._setRange(6),
      },
      {
        id: "range-12h",
        category: "GRAPH",
        label: "Telemetry Range → Last 12 Hours",
        hint: "12H",
        action: () => this._setRange(12),
      },
      {
        id: "range-24h",
        category: "GRAPH",
        label: "Telemetry Range → Last 24 Hours",
        hint: "24H",
        action: () => this._setRange(24),
      },
      {
        id: "range-48h",
        category: "GRAPH",
        label: "Telemetry Range → Last 48 Hours",
        hint: "48H",
        action: () => this._setRange(48),
      },
      {
        id: "panel-power",
        category: "PANEL",
        label: "Open Electrical Smart Plug Dropdown",
        hint: "TVSocket W/V/A/Hz",
        action: () => {
          this._overlayMode = null;
          this._activeDropdown = "power";
          this._render();
        },
      },
      {
        id: "panel-net",
        category: "PANEL",
        label: "Open Network & DDP Protocol Dropdown",
        hint: "BE230 + UDP 9302/987",
        action: () => {
          this._overlayMode = null;
          this._activeDropdown = "network";
          this._render();
        },
      },
      {
        id: "overlay-raw",
        category: "DEBUG",
        label: "Inspect Raw Home Assistant Entity Payloads",
        hint: "JSON Dump",
        action: () => {
          this._overlayMode = "raw";
          this._render();
        },
      },
      {
        id: "refresh-history",
        category: "ACTION",
        label: "Force Refresh Historical Telemetry Curves",
        hint: "API Fetch",
        action: () => {
          this._overlayMode = null;
          this._fetchHistoryIfNeeded(true);
        },
      },
    ];
  }

  _getFilteredCommands() {
    const q = (this._commandQuery || "").trim().toLowerCase();
    const all = this._getCommands();
    if (!q) return all;
    return all.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.hint.toLowerCase().includes(q)
    );
  }

  _setRange(hrs) {
    this._rangeHours = hrs;
    this._overlayMode = null;
    this._fetchHistoryIfNeeded(true);
    this._render();
  }

  _formatClockHMS(startIso) {
    if (!startIso) return "00:00:00";
    const startMs = new Date(startIso).getTime();
    if (isNaN(startMs)) return "00:00:00";
    const diffSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    const h = String(Math.floor(diffSec / 3600)).padStart(2, "0");
    const m = String(Math.floor((diffSec % 3600) / 60)).padStart(2, "0");
    const s = String(diffSec % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  _formatDurationShort(minutes) {
    const m = parseFloat(minutes) || 0;
    if (m <= 0) return "0m";
    if (m < 60) return `${Math.round(m)}m`;
    const h = Math.floor(m / 60);
    const rem = Math.round(m % 60);
    return `${h}h ${rem}m`;
  }

  _updateLiveClockDom() {
    if (!this.shadowRoot || !this._hass || !this._config) return;
    const states = this._hass.states || {};
    const statusObj = states[this._config.status_entity];
    const inUseObj = states[this._config.in_use_entity];
    const state = statusObj && statusObj.state ? statusObj.state.toLowerCase() : "off";
    const isInUse = inUseObj ? inUseObj.state === "on" : state === "awake";
    const started = statusObj && statusObj.attributes ? statusObj.attributes.current_session_started : null;

    const clockEl = this.shadowRoot.querySelector("#om-live-clock");
    const tickerClockEl = this.shadowRoot.querySelector("#om-ticker-clock");
    if (isInUse && started) {
      const hms = this._formatClockHMS(started);
      if (clockEl) clockEl.textContent = hms;
      if (tickerClockEl) tickerClockEl.textContent = hms;
    }
  }

  _extractData() {
    const states = (this._hass && this._hass.states) || {};
    const statusObj = states[this._config.status_entity];
    const inUseObj = states[this._config.in_use_entity];
    const historyObj = states[this._config.history_entity];
    const powerObj = states[this._config.power_entity];
    const energyObj = states[this._config.energy_entity];
    const dailyEnergyObj = states[this._config.daily_energy_entity];
    const voltageObj = states[this._config.voltage_entity];
    const currentObj = states[this._config.current_entity];
    const freqObj = states[this._config.frequency_entity];
    const trackerObj = states[this._config.tracker_entity];

    const state = statusObj && statusObj.state ? String(statusObj.state).toLowerCase() : "off";
    const isInUse = inUseObj ? inUseObj.state === "on" : state === "awake";
    const sAttrs = (statusObj && statusObj.attributes) || {};
    const hAttrs = (historyObj && historyObj.attributes) || {};
    const tAttrs = (trackerObj && trackerObj.attributes) || {};

    const num = (obj, fallback = 0) => {
      if (!obj || obj.state === undefined || obj.state === null) return fallback;
      const v = parseFloat(obj.state);
      return isNaN(v) ? fallback : v;
    };

    const currentPower = num(powerObj, parseFloat(sAttrs.current_power_watts) || 0);
    const totalSocketEnergy = num(energyObj, 0);
    const dailySocketEnergy = num(dailyEnergyObj, 0);
    const voltage = num(voltageObj, 123.0);
    const currentAmp = num(currentObj, currentPower / Math.max(voltage, 1));
    const frequency = num(freqObj, 60.0);
    const apparentVA = voltage * currentAmp;
    const powerFactor = apparentVA > 0 ? Math.min(1.0, currentPower / apparentVA) : 0;

    const sessionStarted = sAttrs.current_session_started || null;
    const sessionDurationMin = parseFloat(sAttrs.current_session_duration_minutes) || 0;
    const sessionKwh = parseFloat(sAttrs.current_session_kwh) || 0;

    const totalSessions = historyObj && !isNaN(parseInt(historyObj.state, 10)) ? parseInt(historyObj.state, 10) : 0;
    const totalPlayHours = parseFloat(hAttrs.total_play_time_hours) || 0;
    const totalGamingKwh = parseFloat(hAttrs.total_energy_kwh) || 0;
    const lastSession = hAttrs.last_session || null;
    const recentSessions = Array.isArray(hAttrs.recent_sessions) ? hAttrs.recent_sessions : [];

    const hostName = String(sAttrs.host_name || tAttrs.host_name || "PS5-294");
    const hostId = String(sAttrs.host_id || "00E4219DF086");
    const ipAddress = String(sAttrs.ip_address || tAttrs.ip || "192.168.1.60");
    const macAddress = String(tAttrs.mac || "CC:6B:1E:A7:0A:5D");
    const sysRaw = String(sAttrs.system_version || "14230000");
    const sysFormatted =
      sysRaw.length >= 4 ? `${sysRaw.slice(0, 2)}.${sysRaw.slice(2, 4)}` : sysRaw;
    const wifiBand = String(tAttrs.network || tAttrs.band || "Wi-Fi 5GHz");
    const wifiSignal = tAttrs.signal !== undefined ? `${tAttrs.signal} dBm` : "-54 dBm";
    const wifiSignalNum = parseFloat(tAttrs.signal) || -54;
    const txMbps = tAttrs.tx_rate ? (parseFloat(tAttrs.tx_rate) / 1000000).toFixed(2) : "1.13";
    const rxMbps = tAttrs.rx_rate ? (parseFloat(tAttrs.rx_rate) / 1000000).toFixed(2) : "1.20";
    const trafficMb = tAttrs.traffic_usage ? Math.round(parseFloat(tAttrs.traffic_usage) / (1024 * 1024)) : 863;

    // Classify load state
    let loadProfile = "POWERED OFF";
    if (state === "awake") {
      if (currentPower >= 220) loadProfile = "AAA GAMING LOAD";
      else if (currentPower >= 120) loadProfile = "ACTIVE MEDIA / OS";
      else loadProfile = "HOME MENU / IDLE";
    } else if (state === "standby") {
      loadProfile = "REST MODE (620)";
    }

    return {
      state,
      isInUse,
      currentPower,
      totalSocketEnergy,
      dailySocketEnergy,
      voltage,
      currentAmp,
      frequency,
      apparentVA,
      powerFactor,
      sessionStarted,
      sessionDurationMin,
      sessionKwh,
      totalSessions,
      totalPlayHours,
      totalGamingKwh,
      lastSession,
      recentSessions,
      hostName,
      hostId,
      ipAddress,
      macAddress,
      sysFormatted,
      wifiBand,
      wifiSignal,
      wifiSignalNum,
      txMbps,
      rxMbps,
      trafficMb,
      loadProfile,
      rawEntities: {
        status: statusObj,
        in_use: inUseObj,
        history: historyObj,
        tracker: trackerObj,
      },
    };
  }

  _getDisplaySessions() {
    const d = this._extractData();
    const list = [];
    if (d.isInUse && d.sessionStarted) {
      list.push({
        isLive: true,
        id: "LIVE",
        started_at: d.sessionStarted,
        ended_at: null,
        duration_minutes: d.sessionDurationMin,
        energy_kwh: d.sessionKwh,
        avg_power_watts: d.currentPower,
      });
    }
    d.recentSessions.forEach((s, idx) => {
      list.push({
        isLive: false,
        id: String(d.totalSessions - idx).padStart(2, "0"),
        started_at: s.started_at,
        ended_at: s.ended_at,
        duration_minutes: parseFloat(s.duration_minutes) || 0,
        energy_kwh: parseFloat(s.energy_kwh) || 0,
        avg_power_watts: parseFloat(s.avg_power_watts) || 0,
      });
    });

    const q = (this._logFilter || "").trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => {
      const dateStr = item.started_at ? new Date(item.started_at).toLocaleString().toLowerCase() : "";
      return (
        item.id.toLowerCase().includes(q) ||
        dateStr.includes(q) ||
        `${item.duration_minutes}m`.includes(q) ||
        `${item.energy_kwh}kwh`.includes(q)
      );
    });
  }

  _buildPowerSvgChart(d, theme) {
    const pts = this._powerHistory && this._powerHistory.length > 1
      ? this._powerHistory
      : [
          { t: Date.now() - 3600000, v: d.currentPower * 0.8 },
          { t: Date.now() - 1800000, v: d.currentPower * 0.95 },
          { t: Date.now(), v: d.currentPower },
        ];

    const W = 760;
    const H = 205;
    const padL = 44;
    const padR = 14;
    const padT = 18;
    const padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const minT = pts[0].t;
    const maxT = Math.max(minT + 1, pts[pts.length - 1].t);
    const values = pts.map((p) => p.v);
    const maxV = Math.max(360, Math.ceil(Math.max(...values, d.currentPower, 100) / 50) * 50);
    const minV = 0;

    const avgV = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const peakV = values.length ? Math.max(...values) : d.currentPower;

    const toX = (t) => padL + ((t - minT) / (maxT - minT)) * plotW;
    const toY = (v) => padT + plotH - ((Math.min(maxV, Math.max(minV, v)) - minV) / (maxV - minV)) * plotH;

    const coords = pts.map((p) => ({
      x: toX(p.t),
      y: toY(p.v),
      t: p.t,
      v: p.v,
    }));

    const linePath = coords
      .map((c, idx) => `${idx === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(" ");
    const areaPath = `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} L${coords[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

    // Y-axis grid ticks
    const yTicks = [0, Math.round(maxV * 0.33), Math.round(maxV * 0.66), maxV];
    const gridLines = yTicks
      .map((val) => {
        const y = toY(val).toFixed(1);
        return `
          <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${theme.border}" stroke-dasharray="3,3" stroke-width="1" />
          <text x="${padL - 6}" y="${parseFloat(y) + 3}" text-anchor="end" fill="${theme.muted}" font-size="10" font-family="JetBrains Mono, monospace">${val}W</text>
        `;
      })
      .join("");

    // X-axis time ticks (5 ticks)
    const xTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
      const t = minT + frac * (maxT - minT);
      const x = (padL + frac * plotW).toFixed(1);
      const label = new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `<text x="${x}" y="${H - 8}" text-anchor="middle" fill="${theme.muted}" font-size="10" font-family="JetBrains Mono, monospace">${label}</text>`;
    }).join("");

    // Average line
    const avgY = toY(avgV).toFixed(1);

    // State Timeline Ribbon segments at bottom of plot
    const ribbonY = padT + plotH + 4;
    const ribbonSegments = coords.map((c, idx) => {
      if (idx === coords.length - 1) return "";
      const next = coords[idx + 1];
      const segW = Math.max(1.5, next.x - c.x + 0.5);
      // Infer state from power or status history
      let segColor = theme.border;
      if (c.v >= 100) segColor = theme.green;
      else if (c.v >= 15) segColor = theme.amber;
      return `<rect x="${c.x.toFixed(1)}" y="${ribbonY}" width="${segW.toFixed(1)}" height="5" fill="${segColor}" opacity="0.85" />`;
    }).join("");

    // Hover crosshair if active
    let hoverOverlay = "";
    if (this._hoverPoint) {
      const hp = this._hoverPoint;
      const hx = toX(hp.t);
      const hy = toY(hp.v);
      const timeLbl = new Date(hp.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const tooltipX = hx > W - 150 ? hx - 128 : hx + 10;
      hoverOverlay = `
        <line x1="${hx.toFixed(1)}" y1="${padT}" x2="${hx.toFixed(1)}" y2="${padT + plotH}" stroke="${theme.cyan}" stroke-width="1" stroke-dasharray="2,2" />
        <circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="4.5" fill="${theme.cyan}" stroke="${theme.bg}" stroke-width="2" />
        <g transform="translate(${tooltipX.toFixed(1)}, ${padT + 6})">
          <rect x="0" y="0" width="118" height="38" rx="4" fill="${theme.surface}" stroke="${theme.focus}" stroke-width="1" opacity="0.95" />
          <text x="8" y="15" fill="${theme.cyan}" font-size="11" font-weight="700" font-family="JetBrains Mono, monospace">${hp.v.toFixed(1)} W</text>
          <text x="8" y="30" fill="${theme.subtle}" font-size="10" font-family="JetBrains Mono, monospace">@ ${timeLbl}</text>
        </g>
      `;
    }

    return {
      peakV,
      avgV,
      svg: `
        <svg id="om-power-svg" viewBox="0 0 ${W} ${H}" class="om-svg-chart" preserveAspectRatio="none">
          <defs>
            <linearGradient id="omPowerGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${theme.accent}" stop-opacity="0.42" />
              <stop offset="85%" stop-color="${theme.cyan}" stop-opacity="0.04" />
              <stop offset="100%" stop-color="${theme.bg}" stop-opacity="0.0" />
            </linearGradient>
          </defs>
          ${gridLines}
          <line x1="${padL}" y1="${avgY}" x2="${W - padR}" y2="${avgY}" stroke="${theme.purple}" stroke-dasharray="4,4" stroke-width="1" opacity="0.7" />
          <path d="${areaPath}" fill="url(#omPowerGrad)" />
          <path d="${linePath}" fill="none" stroke="${theme.accent}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
          ${ribbonSegments}
          ${xTicks}
          ${hoverOverlay}
        </svg>
      `,
      coords,
      W,
      padL,
      padR,
    };
  }

  _buildSessionMiniBars(sessions, theme) {
    const slice = sessions.slice(0, 8).reverse();
    if (slice.length === 0) {
      return `<div class="om-empty-mini">Sin sesiones completadas aún — sesión actual en monitoreo activo</div>`;
    }
    const maxDur = Math.max(30, ...slice.map((s) => s.duration_minutes || 1));
    return `
      <div class="om-mini-bars">
        ${slice
          .map((s) => {
            const pct = Math.min(100, Math.max(10, Math.round(((s.duration_minutes || 1) / maxDur) * 100)));
            const color = s.isLive ? theme.green : theme.accent;
            const lbl = s.isLive ? "LIVE" : `#${s.id}`;
            return `
              <div class="om-mini-bar-col" title="${lbl}: ${Math.round(s.duration_minutes)} min (${s.energy_kwh.toFixed(3)} kWh)">
                <div class="om-mini-bar-val">${Math.round(s.duration_minutes)}m</div>
                <div class="om-mini-bar-track">
                  <div class="om-mini-bar-fill" style="height:${pct}%; background:${color};"></div>
                </div>
                <div class="om-mini-bar-lbl">${lbl}</div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  _render() {
    if (!this._hass || !this._config || !this.shadowRoot) return;

    try {
      const theme = OMARCHY_THEMES[this._themeId] || OMARCHY_THEMES["tokyo-night"];
      const d = this._extractData();
      const sessions = this._getDisplaySessions();
      const chartObj = this._buildPowerSvgChart(d, theme);

      let statusColor = theme.muted;
      let statusBadgeText = "OFF // UNREACHABLE";
      let httpCodeBadge = "UDP:TIMEOUT";
      if (d.state === "awake") {
        statusColor = theme.green;
        statusBadgeText = "AWAKE // IN USE";
        httpCodeBadge = "UDP:9302 • 200 OK";
      } else if (d.state === "standby") {
        statusColor = theme.amber;
        statusBadgeText = "STANDBY // REST MODE";
        httpCodeBadge = "UDP:987 • 620 STANDBY";
      }

      const liveClockStr = d.isInUse && d.sessionStarted ? this._formatClockHMS(d.sessionStarted) : "00:00:00";
      const loadPct = Math.min(100, Math.round((d.currentPower / 360) * 100));
      const estSessionCost = (d.sessionKwh * (this._config.kwh_rate_mxn || 3.25)).toFixed(2);
      const estTotalCost = (d.totalGamingKwh * (this._config.kwh_rate_mxn || 3.25)).toFixed(2);
      const avgSessionMin = d.totalSessions > 0 ? Math.round((d.totalPlayHours * 60) / d.totalSessions) : Math.round(d.sessionDurationMin);

      // Signal bars quality
      const sigQuality = Math.min(100, Math.max(15, Math.round((100 + d.wifiSignalNum) * 1.6)));

      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            --om-bg: ${theme.bg};
            --om-surface: ${theme.surface};
            --om-elevated: ${theme.elevated};
            --om-border: ${theme.border};
            --om-focus: ${theme.focus};
            --om-text: ${theme.text};
            --om-muted: ${theme.muted};
            --om-subtle: ${theme.subtle};
            --om-accent: ${theme.accent};
            --om-cyan: ${theme.cyan};
            --om-green: ${theme.green};
            --om-amber: ${theme.amber};
            --om-red: ${theme.red};
            --om-purple: ${theme.purple};
            --om-mono: "JetBrains Mono", "Fira Code", "SF Mono", Consolas, monospace;
            --om-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-family: var(--om-sans);
            color: var(--om-text);
          }

          * {
            box-sizing: border-box;
          }

          ha-card.omarchy-shell {
            background: var(--om-bg) !important;
            border: 1px solid var(--om-border) !important;
            border-radius: 10px !important;
            padding: 12px !important;
            color: var(--om-text) !important;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45) !important;
            position: relative;
            overflow: visible;
          }

          /* ============================================================
           * SURFACE 1: OMARCHY QUICKSHELL TOP BAR
           * ============================================================ */
          .om-topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px;
            background: var(--om-surface);
            border: 1px solid var(--om-border);
            border-radius: 8px;
            padding: 6px 10px;
            margin-bottom: 12px;
            font-family: var(--om-mono);
            font-size: 12px;
            position: relative;
          }

          .om-bar-left, .om-bar-center, .om-bar-right {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
          }

          .om-launcher-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--om-elevated);
            color: var(--om-focus);
            border: 1px solid var(--om-focus);
            border-radius: 5px;
            padding: 4px 9px;
            font-family: var(--om-mono);
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.15s ease;
          }

          .om-launcher-btn:hover {
            background: var(--om-focus);
            color: var(--om-bg);
          }

          .om-ws-pills {
            display: inline-flex;
            gap: 4px;
          }

          .om-ws-pill {
            background: transparent;
            border: 1px solid var(--om-border);
            color: var(--om-subtle);
            border-radius: 5px;
            padding: 3px 8px;
            font-family: var(--om-mono);
            font-size: 11px;
            cursor: pointer;
            transition: all 0.12s ease;
          }

          .om-ws-pill:hover {
            border-color: var(--om-subtle);
            color: var(--om-text);
          }

          .om-ws-pill.active {
            background: var(--om-elevated);
            border-color: var(--om-focus);
            color: var(--om-text);
            font-weight: 700;
          }

          .om-status-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--om-elevated);
            border: 1px solid var(--om-border);
            border-radius: 5px;
            padding: 3px 10px;
            font-size: 11px;
            font-weight: 700;
          }

          .om-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
          }

          .om-dot.pulse {
            animation: omPulse 1.8s infinite;
          }

          @keyframes omPulse {
            0% { box-shadow: 0 0 0 0 rgba(158, 206, 106, 0.7); }
            70% { box-shadow: 0 0 0 7px rgba(158, 206, 106, 0); }
            100% { box-shadow: 0 0 0 0 rgba(158, 206, 106, 0); }
          }

          .om-widget-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            background: var(--om-bg);
            border: 1px solid var(--om-border);
            color: var(--om-text);
            border-radius: 5px;
            padding: 4px 9px;
            font-family: var(--om-mono);
            font-size: 11px;
            cursor: pointer;
            transition: all 0.15s ease;
            font-variant-numeric: tabular-nums;
          }

          .om-widget-btn:hover, .om-widget-btn.open {
            border-color: var(--om-focus);
            background: var(--om-elevated);
          }

          /* ============================================================
           * SURFACE 2: DROPDOWN PANELS (QUICKSHELL POPOVERS)
           * ============================================================ */
          .om-dropdown-panel {
            background: var(--om-surface);
            border: 1px solid var(--om-focus);
            border-radius: 8px;
            padding: 14px;
            margin-bottom: 12px;
            box-shadow: 0 14px 36px rgba(0, 0, 0, 0.55);
            font-family: var(--om-mono);
            animation: omSlideDown 0.14s ease-out;
          }

          @keyframes omSlideDown {
            from { opacity: 0; transform: translateY(-6px); }
            to { opacity: 1; transform: translateY(0); }
          }

          .om-dd-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--om-border);
            padding-bottom: 8px;
            margin-bottom: 12px;
            font-size: 11px;
            font-weight: 700;
            color: var(--om-focus);
            text-transform: uppercase;
            letter-spacing: 0.6px;
          }

          .om-dd-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 10px;
          }

          .om-dd-cell {
            background: var(--om-bg);
            border: 1px solid var(--om-border);
            border-radius: 6px;
            padding: 8px 10px;
          }

          .om-dd-lbl {
            font-size: 10px;
            color: var(--om-muted);
            text-transform: uppercase;
            margin-bottom: 4px;
          }

          .om-dd-val {
            font-size: 14px;
            font-weight: 700;
            color: var(--om-text);
            font-variant-numeric: tabular-nums;
          }

          .om-theme-row {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
          }

          .om-theme-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: var(--om-bg);
            border: 1px solid var(--om-border);
            color: var(--om-text);
            padding: 8px 12px;
            border-radius: 6px;
            font-family: var(--om-mono);
            font-size: 12px;
            cursor: pointer;
          }

          .om-theme-btn.active {
            border-color: var(--om-focus);
            background: var(--om-elevated);
            font-weight: 700;
          }

          /* ============================================================
           * SURFACE 3: TILED WINDOWS (HYPRLAND / TUI WORKSPACE)
           * ============================================================ */
          .om-tiling-grid {
            display: grid;
            grid-template-columns: repeat(12, 1fr);
            gap: 12px;
          }

          .om-tile {
            background: var(--om-surface);
            border: 1px solid var(--om-border);
            border-radius: 8px;
            padding: 14px;
            display: flex;
            flex-direction: column;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
            position: relative;
          }

          .om-tile.focused {
            border-color: var(--om-focus);
            box-shadow: inset 0 0 0 1px rgba(122, 162, 247, 0.15);
          }

          .om-tile-live {
            grid-column: span 5;
          }

          .om-tile-graph {
            grid-column: span 7;
          }

          .om-tile-analytics {
            grid-column: span 5;
          }

          .om-tile-log {
            grid-column: span 7;
          }

          @media (max-width: 1024px) {
            .om-tile-live, .om-tile-graph, .om-tile-analytics, .om-tile-log {
              grid-column: span 12;
            }
          }

          .om-tile-titlebar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--om-border);
            padding-bottom: 8px;
            margin-bottom: 12px;
            font-family: var(--om-mono);
            font-size: 11px;
          }

          .om-win-path {
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 700;
            color: var(--om-subtle);
          }

          .om-tile.focused .om-win-path {
            color: var(--om-focus);
          }

          .om-win-idx {
            background: var(--om-elevated);
            color: var(--om-text);
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 10px;
          }

          .om-win-tag {
            font-size: 10px;
            padding: 2px 7px;
            border-radius: 4px;
            background: var(--om-bg);
            border: 1px solid var(--om-border);
            color: var(--om-subtle);
          }

          /* Tile 1: Live Session TUI */
          .om-live-hero {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            background: var(--om-bg);
            border: 1px solid var(--om-border);
            border-radius: 6px;
            padding: 14px 16px;
            margin-bottom: 12px;
          }

          .om-clock-block .lbl {
            font-family: var(--om-mono);
            font-size: 10px;
            color: var(--om-muted);
            text-transform: uppercase;
            margin-bottom: 4px;
          }

          .om-clock-block .clock-val {
            font-family: var(--om-mono);
            font-size: 30px;
            font-weight: 800;
            color: var(--om-text);
            font-variant-numeric: tabular-nums;
            letter-spacing: -0.5px;
          }

          .om-power-block {
            text-align: right;
          }

          .om-power-block .p-val {
            font-family: var(--om-mono);
            font-size: 26px;
            font-weight: 800;
            color: var(--om-cyan);
            font-variant-numeric: tabular-nums;
          }

          .om-power-block .p-sub {
            font-family: var(--om-mono);
            font-size: 10px;
            color: var(--om-subtle);
          }

          .om-load-meter {
            margin-bottom: 12px;
          }

          .om-load-header {
            display: flex;
            justify-content: space-between;
            font-family: var(--om-mono);
            font-size: 10px;
            color: var(--om-subtle);
            margin-bottom: 5px;
          }

          .om-load-track {
            width: 100%;
            height: 8px;
            background: var(--om-bg);
            border: 1px solid var(--om-border);
            border-radius: 4px;
            overflow: hidden;
          }

          .om-load-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--om-accent), var(--om-cyan));
            transition: width 0.3s ease;
          }

          .om-kv-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            font-family: var(--om-mono);
          }

          .om-kv-box {
            background: var(--om-bg);
            border: 1px solid var(--om-border);
            border-radius: 6px;
            padding: 8px 10px;
          }

          .om-kv-box .k {
            font-size: 10px;
            color: var(--om-muted);
            text-transform: uppercase;
            margin-bottom: 2px;
          }

          .om-kv-box .v {
            font-size: 13px;
            font-weight: 700;
            color: var(--om-text);
            font-variant-numeric: tabular-nums;
          }

          /* Tile 2: SVG Power Graph */
          .om-range-group {
            display: inline-flex;
            gap: 4px;
          }

          .om-range-btn {
            background: var(--om-bg);
            border: 1px solid var(--om-border);
            color: var(--om-subtle);
            border-radius: 4px;
            padding: 2px 7px;
            font-family: var(--om-mono);
            font-size: 10px;
            cursor: pointer;
          }

          .om-range-btn.active {
            border-color: var(--om-focus);
            color: var(--om-focus);
            background: var(--om-elevated);
            font-weight: 700;
          }

          .om-chart-stats-bar {
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px;
            font-family: var(--om-mono);
            font-size: 11px;
            margin-bottom: 8px;
            color: var(--om-subtle);
          }

          .om-svg-wrap {
            width: 100%;
            height: 205px;
            background: var(--om-bg);
            border: 1px solid var(--om-border);
            border-radius: 6px;
            padding: 4px;
            position: relative;
          }

          .om-svg-chart {
            width: 100%;
            height: 100%;
            display: block;
            cursor: crosshair;
          }

          /* Tile 3: Cumulative Analytics */
          .om-kpi-matrix {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            margin-bottom: 12px;
            font-family: var(--om-mono);
          }

          .om-kpi-cell {
            background: var(--om-bg);
            border: 1px solid var(--om-border);
            border-radius: 6px;
            padding: 10px 12px;
          }

          .om-kpi-cell .lbl {
            font-size: 10px;
            color: var(--om-muted);
            text-transform: uppercase;
            margin-bottom: 4px;
          }

          .om-kpi-cell .val {
            font-size: 20px;
            font-weight: 800;
            color: var(--om-text);
            font-variant-numeric: tabular-nums;
          }

          .om-kpi-cell .sub {
            font-size: 10px;
            color: var(--om-subtle);
            margin-top: 2px;
          }

          .om-mini-bars {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 8px;
            height: 92px;
            background: var(--om-bg);
            border: 1px solid var(--om-border);
            border-radius: 6px;
            padding: 10px 12px 8px 12px;
            font-family: var(--om-mono);
          }

          .om-mini-bar-col {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            height: 100%;
          }

          .om-mini-bar-val {
            font-size: 9px;
            color: var(--om-subtle);
            margin-bottom: 3px;
          }

          .om-mini-bar-track {
            flex: 1;
            width: 100%;
            max-width: 24px;
            background: var(--om-surface);
            border-radius: 3px;
            display: flex;
            align-items: flex-end;
            overflow: hidden;
          }

          .om-mini-bar-fill {
            width: 100%;
            border-radius: 3px 3px 0 0;
          }

          .om-mini-bar-lbl {
            font-size: 9px;
            color: var(--om-muted);
            margin-top: 4px;
          }

          .om-empty-mini {
            background: var(--om-bg);
            border: 1px dashed var(--om-border);
            border-radius: 6px;
            padding: 18px;
            text-align: center;
            font-family: var(--om-mono);
            font-size: 11px;
            color: var(--om-muted);
          }

          /* Tile 4: TUI Session Log */
          .om-log-toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
          }

          .om-filter-input {
            flex: 1;
            background: var(--om-bg);
            border: 1px solid var(--om-border);
            border-radius: 5px;
            padding: 5px 10px;
            color: var(--om-text);
            font-family: var(--om-mono);
            font-size: 11px;
            outline: none;
          }

          .om-filter-input:focus {
            border-color: var(--om-focus);
          }

          .om-table-wrap {
            background: var(--om-bg);
            border: 1px solid var(--om-border);
            border-radius: 6px;
            max-height: 215px;
            overflow-y: auto;
            font-family: var(--om-mono);
          }

          table.om-tui-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
            font-variant-numeric: tabular-nums;
          }

          table.om-tui-table th {
            text-align: left;
            padding: 7px 10px;
            background: var(--om-elevated);
            color: var(--om-subtle);
            font-size: 10px;
            text-transform: uppercase;
            position: sticky;
            top: 0;
            border-bottom: 1px solid var(--om-border);
          }

          table.om-tui-table td {
            padding: 7px 10px;
            border-bottom: 1px solid var(--om-border);
            color: var(--om-text);
          }

          table.om-tui-table tr.om-row {
            cursor: pointer;
          }

          table.om-tui-table tr.om-row:hover,
          table.om-tui-table tr.om-row.selected {
            background: var(--om-elevated);
          }

          .om-badge-live {
            background: rgba(158, 206, 106, 0.16);
            color: var(--om-green);
            border: 1px solid var(--om-green);
            padding: 1px 6px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 700;
          }

          /* ============================================================
           * SURFACE 4: FULL-SCREEN OVERLAYS (SPOTLIGHT & INSPECTOR)
           * ============================================================ */
          .om-overlay-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(5, 8, 15, 0.78);
            backdrop-filter: blur(8px);
            z-index: 9999;
            display: flex;
            align-items: flex-start;
            justify-content: center;
            padding: 64px 16px 24px 16px;
          }

          .om-modal {
            width: 100%;
            max-width: 620px;
            background: var(--om-surface);
            border: 1px solid var(--om-focus);
            border-radius: 10px;
            box-shadow: 0 24px 64px rgba(0, 0, 0, 0.75);
            overflow: hidden;
            font-family: var(--om-mono);
          }

          .om-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 14px;
            background: var(--om-elevated);
            border-bottom: 1px solid var(--om-border);
            font-size: 12px;
            font-weight: 700;
            color: var(--om-focus);
          }

          .om-cmd-search {
            width: 100%;
            background: var(--om-bg);
            border: none;
            border-bottom: 1px solid var(--om-border);
            padding: 12px 14px;
            color: var(--om-text);
            font-family: var(--om-mono);
            font-size: 13px;
            outline: none;
          }

          .om-cmd-list {
            max-height: 320px;
            overflow-y: auto;
            padding: 6px;
          }

          .om-cmd-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 10px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
          }

          .om-cmd-item:hover, .om-cmd-item.active {
            background: var(--om-elevated);
            color: var(--om-focus);
          }

          .om-cmd-cat {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 4px;
            background: var(--om-bg);
            border: 1px solid var(--om-border);
            color: var(--om-subtle);
            margin-right: 8px;
          }

          .om-json-pre {
            margin: 0;
            padding: 14px;
            background: var(--om-bg);
            color: var(--om-cyan);
            font-size: 11px;
            max-height: 400px;
            overflow: auto;
          }

          /* Footer Status Strip */
          .om-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 12px;
            padding: 6px 10px;
            background: var(--om-surface);
            border: 1px solid var(--om-border);
            border-radius: 6px;
            font-family: var(--om-mono);
            font-size: 10px;
            color: var(--om-muted);
          }

          .om-key {
            background: var(--om-elevated);
            border: 1px solid var(--om-border);
            color: var(--om-text);
            padding: 1px 5px;
            border-radius: 3px;
          }
        </style>

        <ha-card class="omarchy-shell" tabindex="0">
          <!-- ========================================================
               1. TOP QUICKSHELL BAR
               ======================================================== -->
          <div class="om-topbar">
            <div class="om-bar-left">
              <button class="om-launcher-btn" id="btn-launcher" title="Open Omarchy Spotlight Command Palette (⌘K or /)">
                <span>󰐔</span>
                <span>${this._config.title}</span>
              </button>
              <div class="om-ws-pills">
                <button class="om-ws-pill ${this._focusedTile === 1 ? "active" : ""}" data-tile="1">[1:LIVE]</button>
                <button class="om-ws-pill ${this._focusedTile === 2 ? "active" : ""}" data-tile="2">[2:GRAPH]</button>
                <button class="om-ws-pill ${this._focusedTile === 3 ? "active" : ""}" data-tile="3">[3:STATS]</button>
                <button class="om-ws-pill ${this._focusedTile === 4 ? "active" : ""}" data-tile="4">[4:LOG]</button>
              </div>
            </div>

            <div class="om-bar-center">
              <div class="om-status-chip" style="border-color:${statusColor}; color:${statusColor};">
                <span class="om-dot ${d.isInUse ? "pulse" : ""}" style="background:${statusColor};"></span>
                <span>${statusBadgeText}</span>
                <span style="color:var(--om-subtle);">// ${d.hostName}</span>
              </div>
              ${
                d.isInUse
                  ? `<div class="om-status-chip" style="color:var(--om-cyan);">
                      <span>⏱</span>
                      <span id="om-ticker-clock">${liveClockStr}</span>
                      <span style="color:var(--om-muted);">|</span>
                      <span>${d.sessionKwh.toFixed(3)} kWh</span>
                    </div>`
                  : ""
              }
            </div>

            <div class="om-bar-right">
              <button class="om-widget-btn ${this._activeDropdown === "power" ? "open" : ""}" id="btn-dd-power" title="Toggle Electrical Smart Plug Telemetry">
                <span style="color:var(--om-amber);">⚡</span>
                <span>${d.currentPower.toFixed(1)}W</span>
                <span style="color:var(--om-muted);">·</span>
                <span>${d.voltage.toFixed(0)}V</span>
                <span>▾</span>
              </button>

              <button class="om-widget-btn ${this._activeDropdown === "network" ? "open" : ""}" id="btn-dd-net" title="Toggle BE230 Network & DDP Telemetry">
                <span style="color:var(--om-cyan);">📶</span>
                <span>${d.wifiSignal}</span>
                <span style="color:var(--om-muted);">·</span>
                <span>${d.ipAddress}</span>
                <span>▾</span>
              </button>

              <button class="om-widget-btn ${this._activeDropdown === "theme" ? "open" : ""}" id="btn-dd-theme" title="Switch Omarchy Theme (Shortcut: t)">
                <span class="om-dot" style="background:${theme.dot};"></span>
                <span>${theme.label}</span>
                <span>▾</span>
              </button>

              <button class="om-widget-btn" id="btn-cmd-help" title="Spotlight Launcher (Shortcut: / or ?)">
                <span>⌘K</span>
              </button>
            </div>
          </div>

          <!-- ========================================================
               2. DROPDOWN PANELS (QUICKSHELL POPOVERS)
               ======================================================== -->
          ${this._renderDropdownPanel(d, theme, sigQuality, httpCodeBadge)}

          <!-- ========================================================
               3. TILED WINDOWS WORKSPACE
               ======================================================== -->
          <div class="om-tiling-grid">
            <!-- TILE [1]: LIVE SESSION & CONSOLE MONITOR -->
            <div class="om-tile om-tile-live ${this._focusedTile === 1 ? "focused" : ""}" data-focus-tile="1">
              <div class="om-tile-titlebar">
                <div class="om-win-path">
                  <span class="om-win-idx">01</span>
                  <span>ps5://telemetry/live-session</span>
                </div>
                <span class="om-win-tag" style="color:${statusColor}; border-color:${statusColor};">${httpCodeBadge}</span>
              </div>

              <div class="om-live-hero">
                <div class="om-clock-block">
                  <div class="lbl">${d.isInUse ? "ACTIVE SESSION TIMER" : "CONSOLE IDLE / STANDBY"}</div>
                  <div class="clock-val" id="om-live-clock" style="color:${d.isInUse ? "var(--om-green)" : "var(--om-muted)"};">
                    ${liveClockStr}
                  </div>
                </div>
                <div class="om-power-block">
                  <div class="p-val">${d.currentPower.toFixed(1)} <span style="font-size:13px;">W</span></div>
                  <div class="p-sub">${d.voltage.toFixed(1)}V · ${d.currentAmp.toFixed(2)}A</div>
                </div>
              </div>

              <div class="om-load-meter">
                <div class="om-load-header">
                  <span>LOAD PROFILE: <strong style="color:var(--om-cyan);">${d.loadProfile}</strong></span>
                  <span>${loadPct}% OF 360W MAX</span>
                </div>
                <div class="om-load-track">
                  <div class="om-load-fill" style="width:${loadPct}%;"></div>
                </div>
              </div>

              <div class="om-kv-grid">
                <div class="om-kv-box">
                  <div class="k">Session Energy</div>
                  <div class="v" style="color:var(--om-cyan);">${d.sessionKwh.toFixed(3)} kWh</div>
                </div>
                <div class="om-kv-box">
                  <div class="k">Est. Session Cost</div>
                  <div class="v" style="color:var(--om-green);">$${estSessionCost} MXN</div>
                </div>
                <div class="om-kv-box">
                  <div class="k">Host / Firmware</div>
                  <div class="v">${d.hostName} (FW ${d.sysFormatted})</div>
                </div>
                <div class="om-kv-box">
                  <div class="k">Network / RSSI</div>
                  <div class="v">${d.wifiBand} (${d.wifiSignal})</div>
                </div>
              </div>
            </div>

            <!-- TILE [2]: INTERACTIVE 24H SVG POWER & STATE GRAPH -->
            <div class="om-tile om-tile-graph ${this._focusedTile === 2 ? "focused" : ""}" data-focus-tile="2">
              <div class="om-tile-titlebar">
                <div class="om-win-path">
                  <span class="om-win-idx">02</span>
                  <span>ps5://graphs/power-timeline (${this._rangeHours}H)</span>
                </div>
                <div class="om-range-group">
                  ${[1, 6, 12, 24, 48]
                    .map(
                      (hrs) =>
                        `<button class="om-range-btn ${this._rangeHours === hrs ? "active" : ""}" data-range="${hrs}">${hrs}H</button>`
                    )
                    .join("")}
                  <button class="om-range-btn" id="btn-refresh-graph" title="Refresh history">↻</button>
                </div>
              </div>

              <div class="om-chart-stats-bar">
                <span>NOW: <strong style="color:var(--om-cyan);">${d.currentPower.toFixed(1)} W</strong></span>
                <span>AVG (${this._rangeHours}H): <strong style="color:var(--om-purple);">${chartObj.avgV.toFixed(1)} W</strong></span>
                <span>PEAK (${this._rangeHours}H): <strong style="color:var(--om-amber);">${chartObj.peakV.toFixed(1)} W</strong></span>
                <span>SOCKET TODAY: <strong style="color:var(--om-green);">${d.dailySocketEnergy.toFixed(3)} kWh</strong></span>
              </div>

              <div class="om-svg-wrap" id="om-chart-box">
                ${chartObj.svg}
              </div>
            </div>

            <!-- TILE [3]: CUMULATIVE ANALYTICS & SESSION BARS -->
            <div class="om-tile om-tile-analytics ${this._focusedTile === 3 ? "focused" : ""}" data-focus-tile="3">
              <div class="om-tile-titlebar">
                <div class="om-win-path">
                  <span class="om-win-idx">03</span>
                  <span>ps5://analytics/cumulative-matrix</span>
                </div>
                <span class="om-win-tag">/data/sessions.json</span>
              </div>

              <div class="om-kpi-matrix">
                <div class="om-kpi-cell">
                  <div class="lbl">Total Sessions</div>
                  <div class="val">${d.totalSessions} <span style="font-size:12px; color:var(--om-green);">${d.isInUse ? "+1 LIVE" : ""}</span></div>
                  <div class="sub">Avg: ${avgSessionMin} min / session</div>
                </div>

                <div class="om-kpi-cell">
                  <div class="lbl">Total Play Time</div>
                  <div class="val">${d.totalPlayHours.toFixed(1)} <span style="font-size:12px; color:var(--om-subtle);">hrs</span></div>
                  <div class="sub">Active session: ${this._formatDurationShort(d.sessionDurationMin)}</div>
                </div>

                <div class="om-kpi-cell">
                  <div class="lbl">Gaming Energy</div>
                  <div class="val" style="color:var(--om-cyan);">${d.totalGamingKwh.toFixed(2)} <span style="font-size:12px;">kWh</span></div>
                  <div class="sub">Est. Cost: $${estTotalCost} MXN</div>
                </div>

                <div class="om-kpi-cell">
                  <div class="lbl">TVSocket Total</div>
                  <div class="val" style="color:var(--om-amber);">${d.totalSocketEnergy.toFixed(2)} <span style="font-size:12px;">kWh</span></div>
                  <div class="sub">PF: ${d.powerFactor.toFixed(2)} · ${d.frequency.toFixed(0)} Hz</div>
                </div>
              </div>

              ${this._buildSessionMiniBars(sessions, theme)}
            </div>

            <!-- TILE [4]: KEYBOARD-DRIVEN TUI SESSION LOG -->
            <div class="om-tile om-tile-log ${this._focusedTile === 4 ? "focused" : ""}" data-focus-tile="4">
              <div class="om-tile-titlebar">
                <div class="om-win-path">
                  <span class="om-win-idx">04</span>
                  <span>ps5://history/session-log (${sessions.length})</span>
                </div>
                <span class="om-win-tag">[j/k] Select · [Enter] Inspect</span>
              </div>

              <div class="om-log-toolbar">
                <input
                  type="text"
                  id="om-log-filter"
                  class="om-filter-input"
                  placeholder="Filter sessions by date, duration, or kWh..."
                  value="${this._escapeHtml(this._logFilter)}"
                />
              </div>

              <div class="om-table-wrap">
                <table class="om-tui-table">
                  <thead>
                    <tr>
                      <th>#ID</th>
                      <th>START</th>
                      <th>DURATION</th>
                      <th>ENERGY</th>
                      <th>AVG LOAD</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${
                      sessions.length > 0
                        ? sessions
                            .map((s, idx) => {
                              const isSel = idx === this._selectedSessionIdx;
                              const startDt = s.started_at ? new Date(s.started_at) : null;
                              const dateLbl =
                                startDt && !isNaN(startDt.getTime())
                                  ? `${startDt.toLocaleDateString([], { month: "short", day: "numeric" })} ${startDt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                                  : "--";
                              return `
                                <tr class="om-row ${isSel ? "selected" : ""}" data-session-idx="${idx}">
                                  <td style="color:var(--om-focus); font-weight:700;">#${s.id}</td>
                                  <td>${dateLbl}</td>
                                  <td>${this._formatDurationShort(s.duration_minutes)}</td>
                                  <td style="color:var(--om-cyan);">${s.energy_kwh.toFixed(3)} kWh</td>
                                  <td>${Math.round(s.avg_power_watts)} W</td>
                                  <td>
                                    ${
                                      s.isLive
                                        ? `<span class="om-badge-live">● ACTIVE</span>`
                                        : `<span style="color:var(--om-subtle);">SAVED</span>`
                                    }
                                  </td>
                                </tr>
                              `;
                            })
                            .join("")
                        : `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--om-muted);">No matching sessions found.</td></tr>`
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- ========================================================
               4. FOOTER KEYBOARD SHORTCUT BAR
               ======================================================== -->
          <div class="om-footer">
            <div>
              <span>OMARCHY SHELL v2.0</span>
              <span>·</span>
              <span>DDP v00030010 (UDP 9302/987)</span>
              <span>·</span>
              <span>HOST_ID: ${d.hostId}</span>
            </div>
            <div>
              <span class="om-key">1-4</span> Focus Window
              <span class="om-key">t</span> Cycle Theme
              <span class="om-key">j/k</span> Navigate Log
              <span class="om-key">/</span> Spotlight
              <span class="om-key">Esc</span> Close
            </div>
          </div>

          <!-- ========================================================
               5. FULL-SCREEN OVERLAYS (SPOTLIGHT / SESSION / RAW)
               ======================================================== -->
          ${this._renderOverlayModal(d)}
        </ha-card>
      `;

      this._bindEvents(chartObj, sessions);
    } catch (err) {
      console.error("PS5MonitorCard Omarchy render error:", err);
      this.shadowRoot.innerHTML = `
        <ha-card style="padding:16px; color:#f7768e; background:#1a1b26; border:1px solid #f7768e; border-radius:8px; font-family:monospace;">
          <strong>SPSVM Render Error:</strong> ${err.message}
        </ha-card>
      `;
    }
  }

  _renderDropdownPanel(d, theme, sigQuality, httpCodeBadge) {
    if (!this._activeDropdown) return "";

    if (this._activeDropdown === "power") {
      return `
        <div class="om-dropdown-panel">
          <div class="om-dd-header">
            <span>⚡ ELECTRICAL TELEMETRY // SALA TVSOCKET (SHELLY)</span>
            <span>[ESC TO CLOSE]</span>
          </div>
          <div class="om-dd-grid">
            <div class="om-dd-cell">
              <div class="om-dd-lbl">Active Power</div>
              <div class="om-dd-val" style="color:var(--om-cyan);">${d.currentPower.toFixed(1)} W</div>
            </div>
            <div class="om-dd-cell">
              <div class="om-dd-lbl">Line Voltage</div>
              <div class="om-dd-val">${d.voltage.toFixed(1)} V</div>
            </div>
            <div class="om-dd-cell">
              <div class="om-dd-lbl">Current Draw</div>
              <div class="om-dd-val">${d.currentAmp.toFixed(3)} A</div>
            </div>
            <div class="om-dd-cell">
              <div class="om-dd-lbl">Apparent Power</div>
              <div class="om-dd-val">${d.apparentVA.toFixed(1)} VA</div>
            </div>
            <div class="om-dd-cell">
              <div class="om-dd-lbl">Power Factor / Freq</div>
              <div class="om-dd-val">${d.powerFactor.toFixed(2)} PF · ${d.frequency.toFixed(1)} Hz</div>
            </div>
            <div class="om-dd-cell">
              <div class="om-dd-lbl">Today / Total Energy</div>
              <div class="om-dd-val" style="color:var(--om-green);">${d.dailySocketEnergy.toFixed(3)} / ${d.totalSocketEnergy.toFixed(2)} kWh</div>
            </div>
          </div>
        </div>
      `;
    }

    if (this._activeDropdown === "network") {
      return `
        <div class="om-dropdown-panel">
          <div class="om-dd-header">
            <span>📶 NETWORK & DDP DISCOVERY // TP-LINK BE230 ROUTER</span>
            <span>[ESC TO CLOSE]</span>
          </div>
          <div class="om-dd-grid">
            <div class="om-dd-cell">
              <div class="om-dd-lbl">IPv4 (Static DHCP)</div>
              <div class="om-dd-val" style="color:var(--om-cyan);">${d.ipAddress}</div>
            </div>
            <div class="om-dd-cell">
              <div class="om-dd-lbl">MAC Address</div>
              <div class="om-dd-val">${d.macAddress}</div>
            </div>
            <div class="om-dd-cell">
              <div class="om-dd-lbl">Wi-Fi Band & RSSI</div>
              <div class="om-dd-val">${d.wifiBand} (${d.wifiSignal} · ${sigQuality}%)</div>
            </div>
            <div class="om-dd-cell">
              <div class="om-dd-lbl">PHY TX / RX Rate</div>
              <div class="om-dd-val">${d.txMbps} / ${d.rxMbps} Mbps</div>
            </div>
            <div class="om-dd-cell">
              <div class="om-dd-lbl">Router Traffic Usage</div>
              <div class="om-dd-val">${d.trafficMb} MB</div>
            </div>
            <div class="om-dd-cell">
              <div class="om-dd-lbl">DDP Status / Host ID</div>
              <div class="om-dd-val" style="color:var(--om-green);">${httpCodeBadge} (${d.hostId})</div>
            </div>
          </div>
        </div>
      `;
    }

    if (this._activeDropdown === "theme") {
      return `
        <div class="om-dropdown-panel">
          <div class="om-dd-header">
            <span>🎨 OMARCHY SYSTEM THEME ENGINE</span>
            <span>[SHORTCUT: t]</span>
          </div>
          <div class="om-theme-row">
            ${Object.values(OMARCHY_THEMES)
              .map(
                (t) => `
                  <button class="om-theme-btn ${this._themeId === t.id ? "active" : ""}" data-theme-id="${t.id}">
                    <span class="om-dot" style="background:${t.dot};"></span>
                    <span>${t.label}</span>
                  </button>
                `
              )
              .join("")}
          </div>
        </div>
      `;
    }

    return "";
  }

  _renderOverlayModal(d) {
    if (!this._overlayMode) return "";

    if (this._overlayMode === "launcher") {
      const cmds = this._getFilteredCommands();
      return `
        <div class="om-overlay-backdrop" id="om-backdrop">
          <div class="om-modal" onclick="event.stopPropagation()">
            <div class="om-modal-header">
              <span>󰐔 OMARCHY SPOTLIGHT // COMMAND PALETTE</span>
              <span>[ESC]</span>
            </div>
            <input
              type="text"
              id="om-cmd-input"
              class="om-cmd-search"
              placeholder="Type a command, theme, or time range..."
              value="${this._escapeHtml(this._commandQuery)}"
            />
            <div class="om-cmd-list">
              ${
                cmds.length > 0
                  ? cmds
                      .map(
                        (c, i) => `
                          <div class="om-cmd-item ${i === this._commandIdx ? "active" : ""}" data-cmd-idx="${i}">
                            <div>
                              <span class="om-cmd-cat">${c.category}</span>
                              <span>${c.label}</span>
                            </div>
                            <span style="color:var(--om-muted); font-size:11px;">${c.hint}</span>
                          </div>
                        `
                      )
                      .join("")
                  : `<div style="padding:18px; text-align:center; color:var(--om-muted);">No matching commands</div>`
              }
            </div>
          </div>
        </div>
      `;
    }

    if (this._overlayMode === "session" && this._inspectedSession) {
      const s = this._inspectedSession;
      const cost = (s.energy_kwh * (this._config.kwh_rate_mxn || 3.25)).toFixed(2);
      return `
        <div class="om-overlay-backdrop" id="om-backdrop">
          <div class="om-modal" onclick="event.stopPropagation()">
            <div class="om-modal-header">
              <span>🎮 SESSION INSPECTOR // #${s.id}</span>
              <button class="om-range-btn" id="btn-close-modal">ESC</button>
            </div>
            <div style="padding:16px;">
              <div class="om-dd-grid">
                <div class="om-dd-cell">
                  <div class="om-dd-lbl">Session Status</div>
                  <div class="om-dd-val" style="color:${s.isLive ? "var(--om-green)" : "var(--om-cyan)"};">
                    ${s.isLive ? "● ACTIVE IN-GAME" : "COMPLETED"}
                  </div>
                </div>
                <div class="om-dd-cell">
                  <div class="om-dd-lbl">Duration</div>
                  <div class="om-dd-val">${this._formatDurationShort(s.duration_minutes)} (${s.duration_minutes.toFixed(1)} min)</div>
                </div>
                <div class="om-dd-cell">
                  <div class="om-dd-lbl">Energy Consumed</div>
                  <div class="om-dd-val" style="color:var(--om-cyan);">${s.energy_kwh.toFixed(3)} kWh</div>
                </div>
                <div class="om-dd-cell">
                  <div class="om-dd-lbl">Average Power</div>
                  <div class="om-dd-val">${Math.round(s.avg_power_watts)} W</div>
                </div>
                <div class="om-dd-cell">
                  <div class="om-dd-lbl">Started At</div>
                  <div class="om-dd-val" style="font-size:11px;">${s.started_at ? new Date(s.started_at).toLocaleString() : "--"}</div>
                </div>
                <div class="om-dd-cell">
                  <div class="om-dd-lbl">Estimated CFE Cost</div>
                  <div class="om-dd-val" style="color:var(--om-green);">$${cost} MXN</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    if (this._overlayMode === "raw") {
      const jsonDump = JSON.stringify(d.rawEntities, null, 2);
      return `
        <div class="om-overlay-backdrop" id="om-backdrop">
          <div class="om-modal" onclick="event.stopPropagation()">
            <div class="om-modal-header">
              <span>{ } RAW ENTITY PAYLOAD INSPECTOR</span>
              <button class="om-range-btn" id="btn-close-modal">ESC</button>
            </div>
            <pre class="om-json-pre">${this._escapeHtml(jsonDump)}</pre>
          </div>
        </div>
      `;
    }

    return "";
  }

  _bindEvents(chartObj, sessions) {
    const root = this.shadowRoot;
    if (!root) return;

    // Top bar dropdown triggers
    const bindClick = (sel, fn) => {
      const el = root.querySelector(sel);
      if (el) el.addEventListener("click", fn);
    };

    bindClick("#btn-launcher", () => this._toggleOverlay("launcher"));
    bindClick("#btn-cmd-help", () => this._toggleOverlay("launcher"));
    bindClick("#btn-dd-power", () => this._toggleDropdown("power"));
    bindClick("#btn-dd-net", () => this._toggleDropdown("network"));
    bindClick("#btn-dd-theme", () => this._toggleDropdown("theme"));
    bindClick("#btn-refresh-graph", () => this._fetchHistoryIfNeeded(true));
    bindClick("#om-backdrop", () => {
      this._overlayMode = null;
      this._render();
    });
    bindClick("#btn-close-modal", () => {
      this._overlayMode = null;
      this._render();
    });

    // Workspace pills & tile click focus
    root.querySelectorAll("[data-tile]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._focusedTile = parseInt(btn.getAttribute("data-tile"), 10) || 1;
        this._render();
      });
    });

    root.querySelectorAll("[data-focus-tile]").forEach((tile) => {
      tile.addEventListener("click", (e) => {
        const idx = parseInt(tile.getAttribute("data-focus-tile"), 10) || 1;
        if (this._focusedTile !== idx) {
          this._focusedTile = idx;
          root.querySelectorAll("[data-focus-tile]").forEach((t) => t.classList.remove("focused"));
          tile.classList.add("focused");
        }
      });
    });

    // Theme selector buttons
    root.querySelectorAll("[data-theme-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._setTheme(btn.getAttribute("data-theme-id"));
      });
    });

    // Graph range buttons
    root.querySelectorAll("[data-range]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const hrs = parseInt(btn.getAttribute("data-range"), 10) || 12;
        this._setRange(hrs);
      });
    });

    // Interactive SVG Chart hover crosshair
    const svgEl = root.querySelector("#om-power-svg");
    if (svgEl && chartObj.coords && chartObj.coords.length > 0) {
      svgEl.addEventListener("mousemove", (e) => {
        const rect = svgEl.getBoundingClientRect();
        if (rect.width <= 0) return;
        const relX = ((e.clientX - rect.left) / rect.width) * chartObj.W;
        let closest = chartObj.coords[0];
        let minDist = Math.abs(relX - closest.x);
        for (const c of chartObj.coords) {
          const dist = Math.abs(relX - c.x);
          if (dist < minDist) {
            minDist = dist;
            closest = c;
          }
        }
        if (!this._hoverPoint || this._hoverPoint.t !== closest.t) {
          this._hoverPoint = { t: closest.t, v: closest.v };
          this._render();
        }
      });
      svgEl.addEventListener("mouseleave", () => {
        if (this._hoverPoint) {
          this._hoverPoint = null;
          this._render();
        }
      });
    }

    // Session log filter input
    const filterInp = root.querySelector("#om-log-filter");
    if (filterInp) {
      filterInp.addEventListener("input", (e) => {
        this._logFilter = e.target.value;
        this._selectedSessionIdx = 0;
        const caret = e.target.selectionStart;
        this._render();
        const newInp = this.shadowRoot.querySelector("#om-log-filter");
        if (newInp) {
          newInp.focus();
          try {
            newInp.setSelectionRange(caret, caret);
          } catch (_) {}
        }
      });
    }

    // Session log row click -> inspect session
    root.querySelectorAll("[data-session-idx]").forEach((row) => {
      row.addEventListener("click", () => {
        const idx = parseInt(row.getAttribute("data-session-idx"), 10) || 0;
        this._selectedSessionIdx = idx;
        if (sessions[idx]) {
          this._inspectedSession = sessions[idx];
          this._overlayMode = "session";
          this._render();
        }
      });
    });

    // Command launcher search & items
    const cmdInp = root.querySelector("#om-cmd-input");
    if (cmdInp) {
      cmdInp.addEventListener("input", (e) => {
        this._commandQuery = e.target.value;
        this._commandIdx = 0;
        const caret = e.target.selectionStart;
        this._render();
        const newCmd = this.shadowRoot.querySelector("#om-cmd-input");
        if (newCmd) {
          newCmd.focus();
          try {
            newCmd.setSelectionRange(caret, caret);
          } catch (_) {}
        }
      });
    }

    const cmds = this._getFilteredCommands();
    root.querySelectorAll("[data-cmd-idx]").forEach((item) => {
      item.addEventListener("click", () => {
        const i = parseInt(item.getAttribute("data-cmd-idx"), 10) || 0;
        if (cmds[i]) cmds[i].action();
      });
    });
  }

  _escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

if (!customElements.get("ps5-monitor-card")) {
  customElements.define("ps5-monitor-card", PS5MonitorCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "ps5-monitor-card")) {
  window.customCards.push({
    type: "ps5-monitor-card",
    name: "SPSVM — PS5 Monitor Card (Omarchy Edition)",
    description: "Omarchy-inspired Quickshell/Tiling UI with real-time PS5 UDP telemetry, SVG power curves, and keyboard-first session logs.",
    preview: true,
  });
}

console.info(
  "%c SPSVM // OMARCHY %c v2.0.0 Loaded ",
  "color: #1a1b26; background: #7aa2f7; font-weight: bold; padding: 2px 6px; border-radius: 4px 0 0 4px;",
  "color: #c0caf5; background: #16161e; font-weight: bold; padding: 2px 6px; border-radius: 0 4px 4px 0;"
);
