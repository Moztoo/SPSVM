"""MQTT Discovery and state publishing for Home Assistant."""

import json
import logging
import os
from typing import Any, Dict, Optional

_LOGGER = logging.getLogger(__name__)

try:
    import paho.mqtt.client as mqtt
    PAHO_AVAILABLE = True
except ImportError:
    PAHO_AVAILABLE = False
    _LOGGER.info("paho-mqtt library not installed; MQTT discovery disabled.")


class PS5MQTTClient:
    """Manages Home Assistant MQTT Discovery and entity publishing."""

    DISCOVERY_PREFIX = "homeassistant"
    BASE_TOPIC = "ps5_monitor"

    def __init__(
        self,
        host: str = "",
        port: int = 1883,
        username: str = "",
        password: str = "",
        discovery_prefix: str = "homeassistant",
    ):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.discovery_prefix = discovery_prefix
        self.client: Optional[Any] = None
        self.is_connected: bool = False
        self._discovery_published: bool = False

    @classmethod
    def auto_detect(
        cls,
        options_host: str = "",
        options_port: int = 1883,
        options_user: str = "",
        options_pass: str = "",
        supervisor_mqtt: Optional[Dict[str, Any]] = None,
    ) -> "PS5MQTTClient":
        """Factory that resolves MQTT settings from options, env vars, or supervisor service."""
        # 1. Options
        if options_host:
            return cls(
                host=options_host,
                port=options_port or 1883,
                username=options_user,
                password=options_pass,
            )

        # 2. Environment variables
        env_host = os.environ.get("MQTT_HOST", "").strip()
        if env_host:
            env_port = int(os.environ.get("MQTT_PORT", 1883))
            env_user = os.environ.get("MQTT_USER", "").strip()
            env_pass = os.environ.get("MQTT_PASSWORD", "")
            return cls(host=env_host, port=env_port, username=env_user, password=env_pass)

        # 3. Supervisor service
        if supervisor_mqtt and isinstance(supervisor_mqtt, dict):
            sup_host = supervisor_mqtt.get("host", "").strip()
            if sup_host:
                return cls(
                    host=sup_host,
                    port=int(supervisor_mqtt.get("port", 1883)),
                    username=supervisor_mqtt.get("username", "").strip(),
                    password=supervisor_mqtt.get("password", ""),
                )

        return cls(host="")

    def connect(self) -> bool:
        """Establish connection to the MQTT broker."""
        if not PAHO_AVAILABLE or not self.host:
            return False

        try:
            # Handle paho-mqtt v2 CallbackAPIVersion if supported
            if hasattr(mqtt, "CallbackAPIVersion"):
                self.client = mqtt.Client(
                    callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                    client_id="spsvm_ps5_monitor",
                )
            else:
                self.client = mqtt.Client(client_id="spsvm_ps5_monitor")

            if self.username:
                self.client.username_pw_set(self.username, self.password)

            def on_connect(client, userdata, flags, rc, properties=None):
                rc_code = rc if isinstance(rc, int) else getattr(rc, "value", 0)
                if rc_code == 0:
                    self.is_connected = True
                    _LOGGER.info("Connected to MQTT broker at %s:%d", self.host, self.port)
                    self.publish_discovery()
                else:
                    self.is_connected = False
                    _LOGGER.warning("MQTT connection failed with code %s", rc_code)

            def on_disconnect(client, userdata, disconnect_flags_or_rc, reason_code=None, properties=None):
                self.is_connected = False
                _LOGGER.debug("Disconnected from MQTT broker")

            self.client.on_connect = on_connect
            self.client.on_disconnect = on_disconnect

            self.client.connect_async(self.host, self.port, keepalive=60)
            self.client.loop_start()
            return True
        except Exception as err:
            _LOGGER.warning("Could not connect to MQTT broker %s:%d: %s", self.host, self.port, err)
            self.is_connected = False
            return False

    def get_device_info(self) -> Dict[str, Any]:
        """Return standardized device information for Home Assistant registry grouping."""
        return {
            "identifiers": ["spsvm_ps5_monitor"],
            "name": "PlayStation 5",
            "manufacturer": "Sony",
            "model": "PlayStation 5 Console",
            "sw_version": "SPSVM 1.0.0",
        }

    def publish_discovery(self) -> None:
        """Publish MQTT Discovery configs for sensor, binary_sensor, and history."""
        if not self.is_connected or not self.client:
            return

        device = self.get_device_info()

        # 1. Main Status Sensor (sensor.ps5_status)
        status_config = {
            "name": "PS5 Status",
            "unique_id": "ps5_monitor_status",
            "object_id": "ps5_status",
            "state_topic": f"{self.BASE_TOPIC}/status/state",
            "json_attributes_topic": f"{self.BASE_TOPIC}/status/attributes",
            "icon": "mdi:sony-playstation",
            "device": device,
        }
        self._publish_json(
            f"{self.discovery_prefix}/sensor/{self.BASE_TOPIC}/status/config",
            status_config,
            retain=True,
        )

        # 2. Binary Presence Sensor (binary_sensor.ps5_in_use)
        in_use_config = {
            "name": "PS5 In Use",
            "unique_id": "ps5_monitor_in_use",
            "object_id": "ps5_in_use",
            "state_topic": f"{self.BASE_TOPIC}/in_use/state",
            "payload_on": "ON",
            "payload_off": "OFF",
            "device_class": "running",
            "icon": "mdi:controller",
            "device": device,
        }
        self._publish_json(
            f"{self.discovery_prefix}/binary_sensor/{self.BASE_TOPIC}/in_use/config",
            in_use_config,
            retain=True,
        )

        # 3. Session History Sensor (sensor.ps5_session_history)
        history_config = {
            "name": "PS5 Session History",
            "unique_id": "ps5_monitor_session_history",
            "object_id": "ps5_session_history",
            "state_topic": f"{self.BASE_TOPIC}/session_history/state",
            "json_attributes_topic": f"{self.BASE_TOPIC}/session_history/attributes",
            "unit_of_measurement": "sessions",
            "icon": "mdi:history",
            "device": device,
        }
        self._publish_json(
            f"{self.discovery_prefix}/sensor/{self.BASE_TOPIC}/session_history/config",
            history_config,
            retain=True,
        )

        self._discovery_published = True
        _LOGGER.info("Published Home Assistant MQTT Discovery entity configurations.")

    def publish_state(self, tracker_data: Dict[str, Any], probe_data: Optional[Dict[str, Any]] = None) -> None:
        """Publish updated state and attributes over MQTT."""
        if not self.is_connected or not self.client:
            return

        effective_state = tracker_data.get("effective_state", "off")
        is_in_use = tracker_data.get("is_in_use", False)
        probe_attrs = probe_data or {}

        # 1. Status Sensor State & Attributes
        self.client.publish(f"{self.BASE_TOPIC}/status/state", effective_state, retain=True)

        status_attributes = {
            "ip_address": probe_attrs.get("ip_address"),
            "host_name": probe_attrs.get("host_name"),
            "host_id": probe_attrs.get("host_id"),
            "system_version": probe_attrs.get("system_version"),
            "current_session_started": tracker_data.get("current_session_started"),
            "current_session_duration_minutes": tracker_data.get("current_session_duration_minutes", 0),
            "current_session_kwh": tracker_data.get("current_session_kwh", 0.0),
            "current_power_watts": tracker_data.get("current_power_watts", 0.0),
        }
        self._publish_json(f"{self.BASE_TOPIC}/status/attributes", status_attributes, retain=True)

        # 2. Binary Sensor State
        self.client.publish(
            f"{self.BASE_TOPIC}/in_use/state",
            "ON" if is_in_use else "OFF",
            retain=True,
        )

        # 3. Session History Sensor State & Attributes
        total_sessions = tracker_data.get("total_sessions", 0)
        self.client.publish(f"{self.BASE_TOPIC}/session_history/state", str(total_sessions), retain=True)

        history_attributes = {
            "total_play_time_hours": tracker_data.get("total_play_time_hours", 0.0),
            "total_energy_kwh": tracker_data.get("total_energy_kwh", 0.0),
            "last_session": tracker_data.get("last_session"),
            "recent_sessions": tracker_data.get("recent_sessions", []),
        }
        self._publish_json(f"{self.BASE_TOPIC}/session_history/attributes", history_attributes, retain=True)

    def _publish_json(self, topic: str, payload: Dict[str, Any], retain: bool = False) -> None:
        if self.client:
            json_str = json.dumps(payload)
            self.client.publish(topic, json_str, retain=retain)

    def stop(self) -> None:
        """Disconnect and stop MQTT background network thread."""
        if self.client:
            try:
                self.client.loop_stop()
                self.client.disconnect()
            except Exception:
                pass
            self.is_connected = False
