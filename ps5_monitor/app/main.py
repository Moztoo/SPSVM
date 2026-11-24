"""Main entrypoint for PlayStation 5 Monitor & Energy Tracker."""

import asyncio
import logging
import signal
import sys
from typing import Any, Dict, Optional

from config import AddonConfig
from ddp import PS5Discovery
from ha_client import HomeAssistantClient
from mqtt_client import PS5MQTTClient
from session import SessionTracker
from web_server import StandaloneWebServer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
_LOGGER = logging.getLogger("ps5_monitor")


class PS5MonitorService:
    """Core daemon service orchestrating probe, session tracking, reporting, and standalone web UI."""

    def __init__(self, config: AddonConfig):
        self.config = config
        self.running = False
        self.discovery = PS5Discovery()
        self.session_tracker = SessionTracker(
            data_dir=config.data_dir,
            max_history=config.history_max_sessions,
        )
        self.ha_client = HomeAssistantClient()
        self.mqtt_client: Optional[PS5MQTTClient] = None
        self.web_server = StandaloneWebServer(self, host="0.0.0.0", port=8099)
        self._last_state_reported: Optional[str] = None

        self.cached_probe_attrs: Dict[str, Any] = {
            "ip_address": self.config.ps5_ip,
            "host_name": None,
            "host_id": None,
            "system_version": None,
        }
        self.latest_tracker_data: Dict[str, Any] = {}
        self.last_raw_state: str = "off"
        self.last_status_code: Optional[int] = None

    def setup_mqtt(self) -> None:
        """Initialize and connect MQTT client with auto-discovery."""
        supervisor_mqtt = self.ha_client.get_supervisor_mqtt_service()
        self.mqtt_client = PS5MQTTClient.auto_detect(
            options_host=self.config.mqtt_host,
            options_port=self.config.mqtt_port,
            options_user=self.config.mqtt_user,
            options_pass=self.config.mqtt_password,
            supervisor_mqtt=supervisor_mqtt,
        )

        if self.mqtt_client.host:
            _LOGGER.info("MQTT Broker detected (%s:%d). Connecting...", self.mqtt_client.host, self.mqtt_client.port)
            connected = self.mqtt_client.connect()
            if not connected:
                _LOGGER.warning("Could not connect to MQTT broker initially. Will fallback to HA REST API.")
        else:
            _LOGGER.info("No MQTT broker configured or detected. Operating in HA REST API mode.")

    def sync_ha_rest_api(self, tracker_data: dict, probe_attrs: dict) -> None:
        """Update entity states directly in Home Assistant Core REST API."""
        effective_state = tracker_data.get("effective_state", "off")
        is_in_use = tracker_data.get("is_in_use", False)

        # 1. sensor.ps5_status
        status_attributes = {
            "friendly_name": "PS5 Status",
            "ip_address": self.config.ps5_ip,
            "host_name": probe_attrs.get("host_name"),
            "host_id": probe_attrs.get("host_id"),
            "system_version": probe_attrs.get("system_version"),
            "current_session_started": tracker_data.get("current_session_started"),
            "current_session_duration_minutes": tracker_data.get("current_session_duration_minutes", 0),
            "current_session_kwh": tracker_data.get("current_session_kwh", 0.0),
            "current_power_watts": tracker_data.get("current_power_watts", 0.0),
            "icon": "mdi:sony-playstation",
        }
        self.ha_client.set_entity_state("sensor.ps5_status", effective_state, status_attributes)

        # 2. binary_sensor.ps5_in_use
        in_use_attributes = {
            "friendly_name": "PS5 In Use",
            "device_class": "running",
            "icon": "mdi:controller",
        }
        self.ha_client.set_entity_state(
            "binary_sensor.ps5_in_use",
            "on" if is_in_use else "off",
            in_use_attributes,
        )

        # 3. sensor.ps5_session_history
        history_attributes = {
            "friendly_name": "PS5 Session History",
            "unit_of_measurement": "sessions",
            "total_play_time_hours": tracker_data.get("total_play_time_hours", 0.0),
            "total_energy_kwh": tracker_data.get("total_energy_kwh", 0.0),
            "last_session": tracker_data.get("last_session"),
            "recent_sessions": tracker_data.get("recent_sessions", []),
            "icon": "mdi:history",
        }
        self.ha_client.set_entity_state(
            "sensor.ps5_session_history",
            tracker_data.get("total_sessions", 0),
            history_attributes,
        )

    async def trigger_immediate_probe(self) -> None:
        """Perform a single probe + state update cycle immediately."""
        probe_res = await self.discovery.probe(self.config.ps5_ip, retries=2, timeout=1.0)
        raw_state = probe_res.state
        self.last_raw_state = raw_state
        self.last_status_code = probe_res.status_code

        if probe_res.host_name:
            self.cached_probe_attrs["host_name"] = probe_res.host_name
        if probe_res.host_id:
            self.cached_probe_attrs["host_id"] = probe_res.host_id
        if probe_res.system_version:
            self.cached_probe_attrs["system_version"] = probe_res.system_version

        current_power = None
        current_energy = None
        if self.config.smart_plug_power_sensor:
            current_power = self.ha_client.get_float_state(self.config.smart_plug_power_sensor)
        if self.config.smart_plug_energy_sensor:
            current_energy = self.ha_client.get_float_state(self.config.smart_plug_energy_sensor)

        tracker_data = self.session_tracker.update_state(
            raw_state=raw_state,
            current_power=current_power,
            current_energy_kwh=current_energy,
            debounce_seconds=self.config.debounce_seconds,
        )
        self.latest_tracker_data = tracker_data

        effective_state = tracker_data.get("effective_state")
        if effective_state != self._last_state_reported:
            _LOGGER.info(
                "PS5 State Transition: %s -> %s (Raw: %s, Code: %s)",
                self._last_state_reported,
                effective_state,
                raw_state,
                probe_res.status_code,
            )
            self._last_state_reported = effective_state

        if self.mqtt_client and self.mqtt_client.is_connected:
            self.mqtt_client.publish_state(tracker_data, self.cached_probe_attrs)

        self.sync_ha_rest_api(tracker_data, self.cached_probe_attrs)

    async def run(self) -> None:
        """Main service loop."""
        self.running = True
        _LOGGER.info(
            "SPSVM PS5 Monitor started. Target IP: %s (Poll: %ds, Debounce: %ds)",
            self.config.ps5_ip,
            self.config.poll_interval_seconds,
            self.config.debounce_seconds,
        )

        self.setup_mqtt()
        await self.web_server.start()

        while self.running:
            try:
                await self.trigger_immediate_probe()

                effective_state = self.latest_tracker_data.get("effective_state", "off")
                if effective_state == "awake" or self.session_tracker.active_session is not None:
                    sleep_time = self.config.poll_interval_seconds
                else:
                    sleep_time = min(30, max(self.config.poll_interval_seconds, 30))

                await asyncio.sleep(sleep_time)

            except asyncio.CancelledError:
                _LOGGER.info("Service loop cancelled.")
                break
            except Exception as err:
                _LOGGER.error("Unexpected error in monitor loop: %s", err, exc_info=True)
                await asyncio.sleep(5)

    def stop(self) -> None:
        """Clean shutdown and flush session data."""
        self.running = False
        _LOGGER.info("Shutting down SPSVM monitor...")
        self.session_tracker.save()
        if self.mqtt_client:
            self.mqtt_client.stop()
        _LOGGER.info("Shutdown complete.")


def handle_signals(service: PS5MonitorService, loop: asyncio.AbstractEventLoop) -> None:
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, lambda: asyncio.create_task(shutdown(service, loop)))
        except (NotImplementedError, RuntimeError):
            pass


async def shutdown(service: PS5MonitorService, loop: asyncio.AbstractEventLoop) -> None:
    await service.web_server.stop()
    service.stop()
    tasks = [t for t in asyncio.all_tasks(loop) if t is not asyncio.current_task()]
    for task in tasks:
        task.cancel()


def main() -> None:
    config = AddonConfig.load()
    service = PS5MonitorService(config)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    handle_signals(service, loop)

    try:
        loop.run_until_complete(service.run())
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        service.stop()
        loop.close()


if __name__ == "__main__":
    main()
