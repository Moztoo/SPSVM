/**
 * PlayStation 5 Monitor & Energy Tracker Card (custom:ps5-monitor-card)
 * Next-Gen PlayStation aesthetic Lovelace card for Home Assistant.
 */

class PS5MonitorCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
  }

  setConfig(config) {
    if (!config) {
      throw new Error("Invalid configuration");
    }
    this._config = {
      title: "PlayStation 5",
      status_entity: "sensor.ps5_status",
      in_use_entity: "binary_sensor.ps5_in_use",
      history_entity: "sensor.ps5_session_history",
      power_entity: "sensor.sala_tvsocket_tvsocket_power",
      energy_entity: "sensor.sala_tvsocket_energy",
      tracker_entity: "device_tracker.ps5_9df086",
      ...config,
    };
    if (this._hass) {
      this._render();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) {
      this._render();
    }
  }

  connectedCallback() {
    if (this._hass && this._config) {
      this._render();
    }
  }

  getCardSize() {
    return 6;
  }

  static getStubConfig() {
    return {
      title: "PlayStation 5",
      status_entity: "sensor.ps5_status",
      in_use_entity: "binary_sensor.ps5_in_use",
      history_entity: "sensor.ps5_session_history",
      power_entity: "sensor.sala_tvsocket_tvsocket_power",
      energy_entity: "sensor.sala_tvsocket_energy",
      tracker_entity: "device_tracker.ps5_9df086",
    };
  }

  _formatDuration(minutes) {
    if (!minutes || minutes <= 0) return "0 min";
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hrs = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hrs}h ${mins}m`;
  }

  _render() {
    if (!this._hass || !this._config) return;

    try {
      const states = this._hass.states || {};
      const statusObj = states[this._config.status_entity];
      const inUseObj = states[this._config.in_use_entity];
      const historyObj = states[this._config.history_entity];
      const powerObj = this._config.power_entity ? states[this._config.power_entity] : null;
      const energyObj = this._config.energy_entity ? states[this._config.energy_entity] : null;
      const trackerObj = this._config.tracker_entity ? states[this._config.tracker_entity] : null;

      const state = statusObj && statusObj.state ? statusObj.state.toLowerCase() : "off";
      const isInUse = inUseObj ? inUseObj.state === "on" : state === "awake";
      const statusAttrs = (statusObj && statusObj.attributes) || {};
      const historyAttrs = (historyObj && historyObj.attributes) || {};

      const hostName = String(statusAttrs.host_name || "PlayStation 5");
      const ipAddress = String(statusAttrs.ip_address || (trackerObj && trackerObj.attributes && trackerObj.attributes.ip) || "192.168.1.60");
      const sysVersionRaw = statusAttrs.system_version ? String(statusAttrs.system_version) : "PS5";
      const sysVersion = sysVersionRaw.length > 4 ? `v${sysVersionRaw.slice(0, 4)}` : sysVersionRaw;

      const currentPower = powerObj && !isNaN(parseFloat(powerObj.state)) ? parseFloat(powerObj.state) : (statusAttrs.current_power_watts || 0);
      const currentDuration = parseFloat(statusAttrs.current_session_duration_minutes) || 0;
      const currentKwh = parseFloat(statusAttrs.current_session_kwh) || 0;
      const currentStarted = statusAttrs.current_session_started;

      const totalSessions = historyObj && !isNaN(parseInt(historyObj.state, 10)) ? parseInt(historyObj.state, 10) : 0;
      const totalPlayHours = parseFloat(historyAttrs.total_play_time_hours) || 0;
      const totalEnergyKwh = parseFloat(historyAttrs.total_energy_kwh) || 0;
      const lastSession = historyAttrs.last_session || null;
      const recentSessions = Array.isArray(historyAttrs.recent_sessions) ? historyAttrs.recent_sessions : [];

      // State styling
      let stateLabel = "APAGADA";
      let stateClass = "off";
      let stateGlowColor = "#64748b";
      let stateDotColor = "#94a3b8";

      if (state === "awake") {
        stateLabel = "EN JUEGO (ACTIVA)";
        stateClass = "awake";
        stateGlowColor = "#0070d1";
        stateDotColor = "#00f0ff";
      } else if (state === "standby") {
        stateLabel = "MODO REPOSO (STANDBY)";
        stateClass = "standby";
        stateGlowColor = "#f59e0b";
        stateDotColor = "#fbbf24";
      }

      let sessionStartTimeFormatted = null;
      if (currentStarted) {
        try {
          const d = new Date(currentStarted);
          if (!isNaN(d.getTime())) {
            sessionStartTimeFormatted = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          }
        } catch (e) {
          sessionStartTimeFormatted = String(currentStarted);
        }
      }

      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Helvetica, Arial, sans-serif;
            --ps-blue: #0070d1;
            --ps-light-blue: #00b4d8;
            --ps-cyan: #00f0ff;
            --ps-dark: #0a0e17;
            --ps-card-bg: rgba(13, 19, 33, 0.75);
            --ps-glass: rgba(255, 255, 255, 0.05);
            --ps-border: rgba(255, 255, 255, 0.1);
          }

          ha-card.ps5-card-container {
            position: relative;
            background: linear-gradient(145deg, #090d16 0%, #0e1526 50%, #080c14 100%) !important;
            border-radius: 20px !important;
            border: 1px solid rgba(0, 112, 209, 0.3) !important;
            box-shadow: 0 12px 36px -6px rgba(0, 0, 0, 0.6), 0 0 24px -4px rgba(0, 112, 209, 0.15) !important;
            padding: 24px;
            color: #f8fafc;
            overflow: hidden;
            box-sizing: border-box;
            backdrop-filter: blur(20px);
          }

          /* Ambient Glow & Watermark */
          .ambient-glow {
            position: absolute;
            top: -80px;
            right: -80px;
            width: 240px;
            height: 240px;
            border-radius: 50%;
            background: radial-gradient(circle, ${stateGlowColor} 0%, transparent 70%);
            opacity: 0.35;
            pointer-events: none;
            filter: blur(40px);
            transition: all 0.5s ease;
          }

          .ps-symbols {
            position: absolute;
            bottom: 12px;
            right: 20px;
            display: flex;
            gap: 12px;
            opacity: 0.15;
            font-size: 16px;
            font-weight: 800;
            letter-spacing: 2px;
            pointer-events: none;
          }

          /* Top Bar */
          .top-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
          }

          .brand-section {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .console-icon-wrap {
            width: 44px;
            height: 44px;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
          }

          .console-icon {
            width: 26px;
            height: 26px;
            fill: #f8fafc;
          }

          .pulse-indicator {
            position: absolute;
            top: -2px;
            right: -2px;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background-color: ${stateDotColor};
            box-shadow: 0 0 10px ${stateDotColor};
          }

          .pulse-indicator.awake {
            animation: pulse 1.8s infinite;
          }

          @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(0, 240, 255, 0.7); }
            70% { box-shadow: 0 0 0 8px rgba(0, 240, 255, 0); }
            100% { box-shadow: 0 0 0 0 rgba(0, 240, 255, 0); }
          }

          .title-group h1 {
            font-size: 19px;
            font-weight: 700;
            margin: 0;
            letter-spacing: -0.3px;
            color: #ffffff;
          }

          .title-group .sub {
            font-size: 12px;
            color: #94a3b8;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .badges-group {
            display: flex;
            gap: 8px;
            align-items: center;
          }

          .pill-badge {
            font-size: 11px;
            font-weight: 600;
            padding: 4px 10px;
            border-radius: 100px;
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.08);
            color: #cbd5e1;
          }

          .pill-badge.status {
            border-color: ${stateDotColor};
            color: ${stateDotColor};
            background: rgba(0, 112, 209, 0.12);
          }

          /* Hero Session Card */
          .hero-banner {
            background: rgba(15, 23, 42, 0.6);
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            padding: 20px;
            margin-bottom: 20px;
            position: relative;
            overflow: hidden;
          }

          .hero-banner.awake {
            border-color: rgba(0, 180, 216, 0.4);
            background: linear-gradient(135deg, rgba(0, 112, 209, 0.15) 0%, rgba(15, 23, 42, 0.7) 100%);
            box-shadow: inset 0 0 20px rgba(0, 112, 209, 0.1);
          }

          .hero-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
          }

          .hero-title {
            font-size: 13px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: ${stateDotColor};
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .hero-stats-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
            gap: 16px;
            align-items: center;
          }

          .hero-stat {
            display: flex;
            flex-direction: column;
          }

          .hero-stat .stat-label {
            font-size: 11px;
            font-weight: 500;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
          }

          .hero-stat .stat-value {
            font-size: 26px;
            font-weight: 800;
            color: #ffffff;
            line-height: 1.1;
            display: flex;
            align-items: baseline;
            gap: 4px;
          }

          .hero-stat .stat-unit {
            font-size: 13px;
            font-weight: 600;
            color: #64748b;
          }

          .power-live {
            color: #38bdf8;
          }

          /* KPI 3-Column Grid */
          .kpi-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin-bottom: 20px;
          }

          .kpi-card {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 14px;
            padding: 14px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            transition: transform 0.2s ease, border-color 0.2s ease;
          }

          .kpi-card:hover {
            transform: translateY(-2px);
            border-color: rgba(0, 180, 216, 0.3);
            background: rgba(255, 255, 255, 0.05);
          }

          .kpi-icon-label {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            font-weight: 600;
            color: #94a3b8;
            text-transform: uppercase;
          }

          .kpi-val {
            font-size: 20px;
            font-weight: 800;
            color: #ffffff;
          }

          .kpi-val small {
            font-size: 12px;
            font-weight: 500;
            color: #64748b;
          }

          /* Last Session Strip */
          .last-session-card {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 14px;
            padding: 14px 18px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
          }

          .last-info-left {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }

          .last-title {
            font-size: 12px;
            font-weight: 600;
            color: #cbd5e1;
          }

          .last-date {
            font-size: 11px;
            color: #64748b;
          }

          .last-metrics-right {
            display: flex;
            gap: 16px;
            text-align: right;
          }

          .last-metric-item {
            display: flex;
            flex-direction: column;
          }

          .last-metric-item .val {
            font-size: 14px;
            font-weight: 700;
            color: #f1f5f9;
          }

          .last-metric-item .lbl {
            font-size: 10px;
            color: #64748b;
            text-transform: uppercase;
          }

          /* History Table Section */
          .history-section {
            margin-top: 16px;
          }

          .history-header-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            font-size: 12px;
            font-weight: 600;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .history-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
            max-height: 220px;
            overflow-y: auto;
            padding-right: 4px;
          }

          .history-list::-webkit-scrollbar {
            width: 4px;
          }
          .history-list::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
          }

          .history-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.04);
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 12px;
          }

          .history-item:hover {
            background: rgba(255, 255, 255, 0.04);
          }

          .hist-date {
            font-weight: 600;
            color: #cbd5e1;
          }

          .hist-time {
            font-size: 10px;
            color: #64748b;
          }

          .hist-tags {
            display: flex;
            gap: 8px;
            align-items: center;
          }

          .hist-tag {
            font-size: 11px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 4px;
            background: rgba(255, 255, 255, 0.04);
            color: #94a3b8;
          }

          .hist-tag.energy {
            color: #38bdf8;
            background: rgba(56, 189, 248, 0.08);
          }

          .hist-tag.duration {
            color: #818cf8;
            background: rgba(129, 140, 248, 0.08);
          }

          .empty-history {
            font-size: 12px;
            color: #64748b;
            text-align: center;
            padding: 16px 0;
            font-style: italic;
          }
        </style>

        <ha-card class="ps5-card-container">
          <div class="ambient-glow"></div>

          <!-- PlayStation Decorative Symbols -->
          <div class="ps-symbols">
            <span style="color:#0070d1">✕</span>
            <span style="color:#e11d48">○</span>
            <span style="color:#10b981">△</span>
            <span style="color:#ec4899">□</span>
          </div>

          <!-- Top Header Bar -->
          <div class="top-bar">
            <div class="brand-section">
              <div class="console-icon-wrap">
                <svg class="console-icon" viewBox="0 0 24 24">
                  <path d="M7.74 3C6.39 3 5.34 4.09 5.34 5.44V18.56C5.34 19.91 6.39 21 7.74 21H9.86C10.74 21 11.5 20.44 11.78 19.61L12.5 17.5H11.5C10.67 17.5 10 16.83 10 16V8C10 7.17 10.67 6.5 11.5 6.5H12.5L11.78 4.39C11.5 3.56 10.74 3 9.86 3H7.74M14.14 3C13.26 3 12.5 3.56 12.22 4.39L11.5 6.5H12.5C13.33 6.5 14 7.17 14 8V16C14 16.83 13.33 17.5 12.5 17.5H11.5L12.22 19.61C12.5 20.44 13.26 21 14.14 21H16.26C17.61 21 18.66 19.91 18.66 18.56V5.44C18.66 4.09 17.61 3 16.26 3H14.14Z"/>
                </svg>
                <div class="pulse-indicator ${stateClass}"></div>
              </div>
              <div class="title-group">
                <h1>${this._config.title}</h1>
                <div class="sub">
                  <span>${hostName}</span>
                  <span>•</span>
                  <span>${ipAddress}</span>
                </div>
              </div>
            </div>
            <div class="badges-group">
              <div class="pill-badge">${sysVersion}</div>
              <div class="pill-badge status">${stateLabel}</div>
            </div>
          </div>

          <!-- Hero Active / Status Banner -->
          <div class="hero-banner ${stateClass}">
            <div class="hero-header">
              <div class="hero-title">
                <span>${isInUse ? "⚡ SESIÓN EN VIVO" : "TELEMETRÍA EN DIRECTO"}</span>
              </div>
              ${
                sessionStartTimeFormatted
                  ? `<div class="pill-badge" style="background:rgba(0,180,216,0.15); border-color:rgba(0,180,216,0.3); color:#38bdf8;">Iniciada ${sessionStartTimeFormatted}</div>`
                  : ""
              }
            </div>

            <div class="hero-stats-row">
              <div class="hero-stat">
                <span class="stat-label">Tiempo de Juego</span>
                <span class="stat-value">
                  ${isInUse ? this._formatDuration(currentDuration) : "--"}
                </span>
              </div>

              <div class="hero-stat">
                <span class="stat-label">Potencia Actual</span>
                <span class="stat-value power-live">
                  ${Math.round(currentPower)} <span class="stat-unit">W</span>
                </span>
              </div>

              <div class="hero-stat">
                <span class="stat-label">Consumo Sesión</span>
                <span class="stat-value" style="color:#a5f3fc;">
                  ${currentKwh.toFixed(3)} <span class="stat-unit">kWh</span>
                </span>
              </div>
            </div>
          </div>

          <!-- KPI 3-Column Cumulative Grid -->
          <div class="kpi-grid">
            <div class="kpi-card">
              <div class="kpi-icon-label">
                <span>🎮</span>
                <span>Partidas</span>
              </div>
              <div class="kpi-val">${totalSessions}</div>
            </div>

            <div class="kpi-card">
              <div class="kpi-icon-label">
                <span>⌛</span>
                <span>Horas Totales</span>
              </div>
              <div class="kpi-val">${totalPlayHours.toFixed(1)} <small>hrs</small></div>
            </div>

            <div class="kpi-card">
              <div class="kpi-icon-label">
                <span>⚡</span>
                <span>Energía Total</span>
              </div>
              <div class="kpi-val">${totalEnergyKwh.toFixed(2)} <small>kWh</small></div>
            </div>
          </div>

          <!-- Last Completed Session Summary Strip -->
          ${
            lastSession && lastSession.started_at
              ? `
            <div class="last-session-card">
              <div class="last-info-left">
                <div class="last-title">⏮️ Última Sesión Terminada</div>
                <div class="last-date">
                  ${new Date(lastSession.started_at).toLocaleDateString([], { month: "short", day: "numeric" })} • ${new Date(lastSession.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              <div class="last-metrics-right">
                <div class="last-metric-item">
                  <span class="val">${this._formatDuration(lastSession.duration_minutes)}</span>
                  <span class="lbl">Duración</span>
                </div>
                <div class="last-metric-item">
                  <span class="val">${parseFloat(lastSession.energy_kwh || 0).toFixed(3)} kWh</span>
                  <span class="lbl">Consumo</span>
                </div>
                <div class="last-metric-item">
                  <span class="val">${Math.round(lastSession.avg_power_watts || 0)} W</span>
                  <span class="lbl">Media</span>
                </div>
              </div>
            </div>
          `
              : ""
          }

          <!-- Recent Sessions History -->
          <div class="history-section">
            <div class="history-header-row">
              <span>Partidas Recientes</span>
              <span>${recentSessions.length} registros</span>
            </div>

            <div class="history-list">
              ${
                recentSessions.length > 0
                  ? recentSessions
                      .map((s) => {
                        try {
                          const startDate = new Date(s.started_at);
                          const dateStr = startDate.toLocaleDateString([], { month: "short", day: "numeric" });
                          const timeStr = startDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                          const dur = Math.round(s.duration_minutes || 0);
                          const kwh = parseFloat(s.energy_kwh || 0).toFixed(3);
                          const w = Math.round(s.avg_power_watts || 0);
                          return `
                            <div class="history-item">
                              <div>
                                <span class="hist-date">${dateStr}</span>
                                <span class="hist-time">(${timeStr})</span>
                              </div>
                              <div class="hist-tags">
                                <span class="hist-tag duration">${dur}m</span>
                                <span class="hist-tag energy">${kwh} kWh</span>
                                <span class="hist-tag">${w} W</span>
                              </div>
                            </div>
                          `;
                        } catch (err) {
                          return "";
                        }
                      })
                      .join("")
                  : `<div class="empty-history">El historial se actualizará cuando concluya tu partida actual.</div>`
              }
            </div>
          </div>
        </ha-card>
      `;
    } catch (err) {
      console.error("PS5MonitorCard render error:", err);
      this.shadowRoot.innerHTML = `
        <ha-card style="padding: 16px; color: #ef4444; background: #1e1e24; border: 1px solid #dc2626; border-radius: 12px;">
          <strong>Error en PS5 Monitor Card:</strong> ${err.message}
        </ha-card>
      `;
    }
  }
}

customElements.define("ps5-monitor-card", PS5MonitorCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ps5-monitor-card",
  name: "PS5 Monitor Card",
  description: "Display elegante de PlayStation 5 con telemetría en tiempo real y consumo de energía.",
  preview: true,
});
console.info(
  "%c PS5-MONITOR-CARD %c v1.0.1 Loaded ",
  "color: white; background: #0070d1; font-weight: bold; padding: 2px 6px; border-radius: 4px;",
  "color: #0070d1; background: #0a0e17; font-weight: bold; padding: 2px 6px;"
);
