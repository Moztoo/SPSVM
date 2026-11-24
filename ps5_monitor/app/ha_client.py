"""Home Assistant Core REST API client and Supervisor integration."""

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

_LOGGER = logging.getLogger(__name__)


class HomeAssistantClient:
    """Interacts with Home Assistant Core API via Supervisor proxy."""

    def __init__(self, token: Optional[str] = None, base_url: str = "http://supervisor/core/api"):
        self.token = token or os.environ.get("SUPERVISOR_TOKEN") or os.environ.get("HASSIO_TOKEN", "")
        self.base_url = base_url.rstrip("/")
        self.supervisor_url = "http://supervisor"
        self._disabled = not bool(self.token)
        if self._disabled:
            _LOGGER.info("No SUPERVISOR_TOKEN found; Home Assistant Core REST API client disabled.")
        else:
            _LOGGER.info("Home Assistant Core REST API client enabled using Supervisor token.")

    def _make_request(
        self,
        endpoint: str,
        method: str = "GET",
        payload: Optional[Dict[str, Any]] = None,
        timeout: float = 5.0,
    ) -> Optional[Dict[str, Any]]:
        """Perform an HTTP request with Authorization Bearer header."""
        if self._disabled:
            return None

        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "User-Agent": "SPSVM-PS5-Monitor/1.0",
        }

        data_bytes = None
        if payload is not None:
            data_bytes = json.dumps(payload).encode("utf-8")

        req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                res_data = response.read().decode("utf-8")
                if res_data:
                    return json.loads(res_data)
                return {}
        except urllib.error.HTTPError as err:
            _LOGGER.debug("HTTP %s on %s %s: %s", err.code, method, url, err.reason)
            return None
        except Exception as err:
            _LOGGER.debug("Request failed on %s %s: %s", method, url, err)
            return None

    def get_entity_state(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve state object for a given entity_id from Home Assistant."""
        if not entity_id:
            return None
        return self._make_request(f"states/{entity_id}")

    def get_float_state(self, entity_id: str) -> Optional[float]:
        """Retrieve numeric float state of an entity (e.g. Watts or kWh)."""
        data = self.get_entity_state(entity_id)
        if not data:
            return None
        raw_state = data.get("state")
        if raw_state in (None, "unknown", "unavailable"):
            return None
        try:
            return float(raw_state)
        except (ValueError, TypeError):
            _LOGGER.debug("Could not parse numeric state '%s' for %s", raw_state, entity_id)
            return None

    def set_entity_state(self, entity_id: str, state: Any, attributes: Optional[Dict[str, Any]] = None) -> bool:
        """Create or update an entity state directly in Home Assistant state machine."""
        payload = {
            "state": str(state),
            "attributes": attributes or {},
        }
        res = self._make_request(f"states/{entity_id}", method="POST", payload=payload)
        return res is not None

    def get_supervisor_mqtt_service(self) -> Optional[Dict[str, Any]]:
        """Query Supervisor for Mosquitto add-on MQTT credentials."""
        if self._disabled:
            return None

        url = f"{self.supervisor_url}/services/mqtt"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=5.0) as response:
                res = json.loads(response.read().decode("utf-8"))
                if res.get("result") == "ok" and "data" in res:
                    _LOGGER.info("Auto-discovered Mosquitto broker from Supervisor service.")
                    return res["data"]
        except Exception as err:
            _LOGGER.debug("Supervisor MQTT service not found or not active: %s", err)
        return None

    def get_history_period(self, entity_ids: list, hours: int = 12) -> Any:
        """Fetch historical state changes for given entity_ids over the last N hours."""
        if self._disabled or not entity_ids:
            return []
        from datetime import datetime, timedelta, timezone

        start_iso = (datetime.now(timezone.utc) - timedelta(hours=max(1, min(hours, 168)))).isoformat()
        entities_csv = ",".join([e for e in entity_ids if e])
        endpoint = f"history/period/{start_iso}?filter_entity_id={entities_csv}&minimal_response=true&no_attributes=true"
        res = self._make_request(endpoint, method="GET", timeout=10.0)
        return res if isinstance(res, list) else []

