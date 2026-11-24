"""Configuration manager for PlayStation 5 Monitor & Energy Tracker Add-on."""

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

_LOGGER = logging.getLogger(__name__)

DEFAULT_OPTIONS_PATH = "/data/options.json"


@dataclass
class AddonConfig:
    ps5_ip: str = "192.168.1.60"
    poll_interval_seconds: int = 10
    debounce_seconds: int = 60
    smart_plug_power_sensor: str = ""
    smart_plug_energy_sensor: str = ""
    history_max_sessions: int = 20
    mqtt_host: str = ""
    mqtt_port: int = 1883
    mqtt_user: str = ""
    mqtt_password: str = ""
    data_dir: str = "/data"

    @classmethod
    def load(cls, options_path: str = DEFAULT_OPTIONS_PATH) -> "AddonConfig":
        config_data = {}
        path = Path(options_path)
        if path.is_file():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    config_data = json.load(f)
                _LOGGER.info("Loaded options from %s", options_path)
            except Exception as e:
                _LOGGER.warning("Could not read options file %s: %s", options_path, e)
        else:
            _LOGGER.info("Options file %s not found, checking environment or defaults", options_path)

        # Allow environment overrides if present
        ps5_ip = config_data.get("ps5_ip") or os.environ.get("PS5_IP", "192.168.1.60")
        poll_interval = int(config_data.get("poll_interval_seconds") or os.environ.get("POLL_INTERVAL_SECONDS", 10))
        debounce = int(config_data.get("debounce_seconds") or os.environ.get("DEBOUNCE_SECONDS", 60))
        power_sensor = (config_data.get("smart_plug_power_sensor") or os.environ.get("SMART_PLUG_POWER_SENSOR", "")).strip()
        energy_sensor = (config_data.get("smart_plug_energy_sensor") or os.environ.get("SMART_PLUG_ENERGY_SENSOR", "")).strip()
        max_sessions = int(config_data.get("history_max_sessions") or os.environ.get("HISTORY_MAX_SESSIONS", 20))

        mqtt_host = (config_data.get("mqtt_host") or os.environ.get("MQTT_HOST", "")).strip()
        mqtt_port_raw = config_data.get("mqtt_port") or os.environ.get("MQTT_PORT", 1883)
        try:
            mqtt_port = int(mqtt_port_raw)
        except (ValueError, TypeError):
            mqtt_port = 1883
        mqtt_user = (config_data.get("mqtt_user") or os.environ.get("MQTT_USER", "")).strip()
        mqtt_password = config_data.get("mqtt_password") or os.environ.get("MQTT_PASSWORD", "")

        data_dir = "/data" if Path("/data").is_dir() else str(Path.cwd() / "data")
        Path(data_dir).mkdir(parents=True, exist_ok=True)

        return cls(
            ps5_ip=ps5_ip.strip(),
            poll_interval_seconds=max(5, min(poll_interval, 60)),
            debounce_seconds=max(10, min(debounce, 300)),
            smart_plug_power_sensor=power_sensor,
            smart_plug_energy_sensor=energy_sensor,
            history_max_sessions=max(5, min(max_sessions, 100)),
            mqtt_host=mqtt_host,
            mqtt_port=mqtt_port,
            mqtt_user=mqtt_user,
            mqtt_password=mqtt_password,
            data_dir=data_dir,
        )
