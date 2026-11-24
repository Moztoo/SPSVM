# SPSVM: PlayStation 5 Monitor & Energy Tracker

![SPSVM Logo](logo.png)

A high-performance, local-only Home Assistant Installable Add-on designed to monitor a **PlayStation 5** console over the local network via low-level UDP discovery protocols, track gaming session history, and correlate physical smart plug energy metrics.

---

## Key Features

- **Direct Low-Level Discovery (DDP)**: Probes UDP port 987 directly on your local network. No PlayStation Network (PSN) accounts, credentials, or cloud polling required.
- **Accurate Power State Detection**:
  - `awake`: PS5 is powered on and in active use (`HTTP/1.1 200 OK`).
  - `standby`: PS5 is in Rest Mode (`HTTP/1.1 620 Server Standby`).
  - `off`: PS5 is powered down or unreachable after 3 UDP retries.
- **Smart Plug Energy Correlation**: Optionally link a smart plug power entity (Watts) and energy entity (kWh) to accurately meter how much power your gaming sessions consume.
- **Session Lifecycle & Glitch Debounce**: Automatically logs session start/end, duration, energy consumed (kWh), and average power (Watts). Features configurable debouncing (default 60s) so temporary network drops or console reboots don't break session records.
- **Persistent Storage**: All session analytics and cumulative metrics are saved to `/data/sessions.json` so data persists across add-on reboots and updates.
- **Dual-Channel Home Assistant Integration**:
  - **MQTT Auto-Discovery**: Automatically discovers Mosquitto broker credentials or accepts custom broker settings.
  - **Home Assistant REST API**: Direct fallback via Supervisor token (`http://supervisor/core/api`) ensuring instant entity creation even without an MQTT broker.

---

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `ps5_ip` | `string` | `"192.168.1.60"` | Local IP address of your PlayStation 5 console. |
| `poll_interval_seconds` | `int (5-60)` | `10` | UDP probe interval in seconds during active transitions. |
| `debounce_seconds` | `int (10-300)` | `60` | Grace period in seconds before declaring a session finished when the console drops offline. |
| `smart_plug_power_sensor` | `string?` | `""` | Entity ID of your smart plug's instantaneous power sensor (e.g. `sensor.ps5_smart_plug_power`). |
| `smart_plug_energy_sensor` | `string?` | `""` | Entity ID of your smart plug's cumulative energy sensor (e.g. `sensor.ps5_smart_plug_energy`). |
| `history_max_sessions` | `int (5-100)` | `20` | Maximum number of completed sessions retained in the recent sessions history attribute. |
| `mqtt_host` | `string?` | `""` | Optional MQTT host. Leave empty to auto-detect the official Mosquitto broker add-on. |
| `mqtt_port` | `int?` | `1883` | MQTT port. |
| `mqtt_user` | `string?` | `""` | Optional MQTT username. |
| `mqtt_password` | `password?` | `""` | Optional MQTT password. |

---

## Entities Exposed to Home Assistant

### 1. `sensor.ps5_status`
- **State**: `awake`, `standby`, or `off`
- **Attributes**:
  - `ip_address`: `192.168.1.60`
  - `host_name`: Console name (e.g. `PS5-LivingRoom`)
  - `host_id`: Console unique ID
  - `system_version`: System software version
  - `current_session_started`: ISO-8601 timestamp of active session start (or `null`)
  - `current_session_duration_minutes`: Current session elapsed time in minutes
  - `current_session_kwh`: Energy consumed so far in the current session
  - `current_power_watts`: Instantaneous power reading from smart plug

### 2. `binary_sensor.ps5_in_use`
- **State**: `on` when `awake`, `off` when `standby` or `off`.
- **Device Class**: `running`
- **Use Case**: Simple condition for automations (e.g., triggering ambient lighting, setting home status, or sending push notifications).

### 3. `sensor.ps5_session_history`
- **State**: Total count of completed gaming sessions.
- **Unit of Measurement**: `sessions`
- **Attributes**:
  - `total_play_time_hours`: Cumulative gaming hours.
  - `total_energy_kwh`: Cumulative energy consumed during all recorded sessions.
  - `last_session`:
    ```json
    {
      "started_at": "2026-11-24T14:00:00Z",
      "ended_at": "2026-11-24T15:30:00Z",
      "duration_minutes": 90.0,
      "energy_kwh": 0.28,
      "avg_power_watts": 186.5
    }
    ```
  - `recent_sessions`: List of the last N completed sessions.

---

## Automation Examples

### 1. Push Notification When PS5 Session Starts
```yaml
alias: "PS5 - Gaming Session Started Notification"
trigger:
  - platform: state
    entity_id: binary_sensor.ps5_in_use
    to: "on"
action:
  - service: notify.notify
    data:
      title: "🎮 PlayStation 5 Active"
      message: "A gaming session just started on the PS5."
```

### 2. Session Summary Notification Upon Ending
```yaml
alias: "PS5 - Session Summary on Shutdown"
trigger:
  - platform: state
    entity_id: binary_sensor.ps5_in_use
    from: "on"
    to: "off"
action:
  - service: notify.notify
    data:
      title: "🎮 PS5 Session Finished"
      message: >-
        Duration: {{ state_attr('sensor.ps5_session_history', 'last_session').duration_minutes }} min |
        Energy: {{ state_attr('sensor.ps5_session_history', 'last_session').energy_kwh }} kWh |
        Avg Power: {{ state_attr('sensor.ps5_session_history', 'last_session').avg_power_watts }} W
```

---

## Architecture Compatibility
- `aarch64` (Raspberry Pi 4/5, Home Assistant Green/Yellow, Odroid)
- `amd64` (x86_64 Generic PC, Intel NUC, Proxmox VM)
