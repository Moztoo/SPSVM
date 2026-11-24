# SPSVM: Sony PlayStation 5 Monitor & Session Tracker

[![Home Assistant Add-on](https://img.shields.io/badge/Home%20Assistant-Add--on-blue.svg)](https://www.home-assistant.io/)
[![Architecture](https://img.shields.io/badge/arch-aarch64%20%7C%20amd64-orange.svg)](#architecture-compatibility)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**SPSVM (Sony PS5 Monitor)** is a Home Assistant Installable Add-on designed to monitor PlayStation 5 consoles over the local network using Sony's low-level Device Discovery Protocol (UDP DDP). It operates entirely offline without needing PlayStation Network (PSN) accounts, tokens, or cloud polling.

---

## Architecture Diagram

```
 +-----------------------------------------------------------+
 |                    Home Assistant OS                      |
 |                                                           |
 |  +-----------------------------------------------------+  |
 |  |            SPSVM Add-on (ps5_monitor)               |  |
 |  |                                                     |  |
 |  |  +------------------+    +-----------------------+  |  |
 |  |  |   DDP Engine     |    |   Session Tracker     |  |  |
 |  |  |  (UDP Port 987)  |--->|   & Debounce Logic    |  |  |
 |  |  +------------------+    +-----------------------+  |  |
 |  |            |                         |              |  |
 |  |            v                         v              |  |
 |  |     [200 / 620 / OFF]       [/data/sessions.json]   |  |
 |  |            |                         |              |  |
 |  |  +---------+-------------------------+-----------+  |  |
 |  |  |          Dual HA Publishing Bridge            |  |  |
 |  |  |    • MQTT Auto-Discovery (Mosquitto)          |  |  |
 |  |  |    • Core REST API (SUPERVISOR_TOKEN)         |  |  |
 |  |  +-----------------------------------------------+  |  |
 |  +-----------------------------------------------------+  |
 |                           |                               |
 |                           v                               |
 |  +-----------------------------------------------------+  |
 |  |             Home Assistant Entities                 |  |
 |  |                                                     |  |
 |  |  • sensor.ps5_status          (awake / standby / off)  |
 |  |  • binary_sensor.ps5_in_use   (on / off presence)   |  |
 |  |  • sensor.ps5_session_history (analytics & metrics) |  |
 |  +-----------------------------------------------------+  |
 +-----------------------------------------------------------+
               |                                 ^
        UDP Port 987 (Probe)              Optional Smart Plug
               |                          (Power / Energy W/kWh)
               v                                 |
      [ PlayStation 5 ]             [ Shelly / Zigbee / Tuya ]
```

---

## Key Capabilities

1. **Low-Level Protocol Detection**:
   - Sends UDP discovery datagrams to port `987`.
   - Distinguishes **`awake`** (HTTP 200 OK), **`standby`** (HTTP 620 Server Standby), and **`off`** (Timeout).
2. **Smart Plug Energy Correlation**:
   - Accepts an optional power sensor (in Watts) and energy sensor (in kWh).
   - Samples power during active sessions and computes total energy (kWh) and average Watts per gaming session.
3. **Robust Debouncing**:
   - Short network drops, Wi-Fi handoffs, or game restarts (up to `debounce_seconds`, default 60s) will **not** trigger premature session conclusion.
4. **Persistent History**:
   - Saves session logs to `/data/sessions.json` so data survives add-on restarts.
   - Retains cumulative play time (hours), total sessions, and recent session details.
5. **Dual Auto-Discovery**:
   - Integrates with Home Assistant via MQTT Discovery (auto-detecting Mosquitto) AND direct Home Assistant Core REST API (`http://supervisor/core/api`).

---

## Installation via Home Assistant Add-on Store

1. In Home Assistant, navigate to **Settings** -> **Add-ons** -> **Add-on Store**.
2. Click the three dots in the top right corner and select **Repositories**.
3. Add the repository URL:
   ```text
   https://github.com/Moztoo/SPSVM
   ```
4. Find **PlayStation 5 Monitor & Energy Tracker** in the list and click **Install**.
5. Go to the **Configuration** tab, enter your PS5's static IP address (e.g. `192.168.1.60`) and optional smart plug entities, then click **Save**.
6. Click **Start** and enable **Watchdog** and **Start on boot**.

---

## Configuration Reference

```yaml
ps5_ip: "192.168.1.60"
poll_interval_seconds: 10
debounce_seconds: 60
smart_plug_power_sensor: "sensor.sala_tvsocket_tvsocket_power"
smart_plug_energy_sensor: "sensor.sala_tvsocket_energy"
history_max_sessions: 20
```

---

## Entities Exposed

| Entity ID | Type | Description |
|---|---|---|
| `sensor.ps5_status` | `sensor` | Console state: `awake`, `standby`, or `off`. Provides session start, duration, and IP attributes. |
| `binary_sensor.ps5_in_use` | `binary_sensor` | Device class `running`. `on` when console is in active use; `off` when standby or off. |
| `sensor.ps5_session_history` | `sensor` | Total completed sessions. Exposes `total_play_time_hours`, `total_energy_kwh`, `last_session`, and `recent_sessions`. |

---

## Running Unit Tests Locally

```bash
python3 -m unittest discover -s tests -p "test_*.py"
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.
