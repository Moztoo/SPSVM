# Changelog

All notable changes to the SPSVM (Sony PS5 Monitor & Session Tracker) project will be documented in this file.

## [1.0.4] - 2026-11-24

### Fixed
- **Custom Lovelace Card Compatibility**: Added proper `<ha-card>` root wrapper, lifecycle checks in `setConfig` and `connectedCallback`, and hardened all attribute parsers against null/type mismatches so Lovelace renders without "Configuration error".

## [1.0.3] - 2026-11-24

### Added
- **Custom PS5 Monitor Lovelace Card**: Built-in standalone custom card (`custom:ps5-monitor-card`) featuring clean, next-gen PlayStation styling, glassmorphism, animated live gaming status, real-time power telemetry, cumulative KPI analytics, and interactive session history.
- Auto-deploys to `/config/www/community/ps5-monitor-card/` on add-on start.

## [1.0.2] - 2026-11-24

### Fixed
- **PS5 Active Discovery Port**: Probe both port `9302` (where active PS5 Remote Play DDP discovery responds with `HTTP/1.1 200 Ok`) and port `987` (used for standby/wake). Resolves issue where a running PS5 was not detected because port 987 times out while active.

## [1.0.1] - 2026-11-24

### Fixed
- Fixed `s6-overlay-suexec: fatal: can only run as pid 1` by setting `init: false` in `config.yaml` to prevent Supervisor from injecting Docker's init wrapper over S6-overlay.
- Migrated add-on service lifecycle to native S6-Overlay v3 architecture (`/etc/s6-overlay/s6-rc.d/ps5-monitor/`).

## [1.0.0] - 2026-11-24

### Added
- **Low-level UDP Discovery Protocol (DDP)**: Probes PS5 on UDP port 987, accurately distinguishing between:
  - `HTTP/1.1 200 OK` -> `awake` (active/in use)
  - `HTTP/1.1 620 Server Standby` -> `standby` (rest mode)
  - Timeout / no response after 3 retries -> `off` (powered down / unreachable)
- **Home Assistant Auto-Discovery**:
  - `sensor.ps5_status`: Real-time state (`awake`, `standby`, `off`) with session attributes.
  - `binary_sensor.ps5_in_use`: Presence sensor for instant automation triggers (`on` when active, `off` otherwise).
  - `sensor.ps5_session_history`: Session counter and composite historical analytics.
- **Smart Plug Energy Correlation**:
  - Optional power sensor input (`smart_plug_power_sensor` in Watts).
  - Optional energy sensor input (`smart_plug_energy_sensor` in kWh).
  - Real-time kWh calculation and average power consumption per session.
- **Session Lifecycle & Glitch Debounce**:
  - Automatic session start on transition to `awake`.
  - Configurable debounce timer (default 60s) preventing false session stops during game restarts or momentary Wi-Fi drops.
  - Persistent storage in `/data/sessions.json` surviving add-on updates and restarts.
  - Tracking of cumulative statistics (`total_play_time_hours`, `total_sessions`, `total_energy_kwh`, `last_session`, `recent_sessions`).
- **Communication Architecture**:
  - Primary: MQTT Auto-Discovery with auto-detection of Mosquitto credentials via Supervisor environment and services.
  - Fallback / Dual Mode: Home Assistant Core REST API (`http://supervisor/core/api`) via `SUPERVISOR_TOKEN`.
- **Multi-Architecture Support**:
  - `aarch64` (Raspberry Pi 4 / 5, Odroid, Home Assistant Green/Yellow)
  - `amd64` (x86_64 Generic NUC / Proxmox VM)
