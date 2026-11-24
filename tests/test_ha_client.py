"""Unit tests for Home Assistant REST client and MQTT discovery payloads."""

import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "ps5_monitor", "app")))

from ha_client import HomeAssistantClient
from mqtt_client import PS5MQTTClient


class TestHomeAssistantClient(unittest.TestCase):
    def test_disabled_without_token(self):
        client = HomeAssistantClient(token="")
        self.assertTrue(client._disabled)
        self.assertIsNone(client.get_entity_state("sensor.dummy"))
        self.assertIsNone(client.get_float_state("sensor.dummy"))
        self.assertFalse(client.set_entity_state("sensor.dummy", "on"))

    @patch("urllib.request.urlopen")
    def test_get_float_state_numeric(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"state": "184.5"}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        client = HomeAssistantClient(token="mock_token")
        val = client.get_float_state("sensor.ps5_smart_plug_power")
        self.assertEqual(val, 184.5)

    @patch("urllib.request.urlopen")
    def test_get_float_state_unavailable(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"state": "unavailable"}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        client = HomeAssistantClient(token="mock_token")
        val = client.get_float_state("sensor.ps5_smart_plug_power")
        self.assertIsNone(val)


class TestPS5MQTTClient(unittest.TestCase):
    def setUp(self):
        self.mqtt_client = PS5MQTTClient(host="127.0.0.1", port=1883)
        self.mqtt_client.client = MagicMock()
        self.mqtt_client.is_connected = True

    def test_publish_discovery_topics(self):
        """Verify standard Home Assistant discovery topics and payloads."""
        self.mqtt_client.publish_discovery()

        calls = self.mqtt_client.client.publish.call_args_list
        topics = [call[0][0] for call in calls]

        # Ensure all 3 required discovery topics are published
        self.assertIn("homeassistant/sensor/ps5_monitor/status/config", topics)
        self.assertIn("homeassistant/binary_sensor/ps5_monitor/in_use/config", topics)
        self.assertIn("homeassistant/sensor/ps5_monitor/session_history/config", topics)

    def test_publish_state_payloads(self):
        """Verify state update topic structures."""
        tracker_data = {
            "effective_state": "awake",
            "is_in_use": True,
            "current_session_started": "2026-11-24T14:00:00Z",
            "current_session_duration_minutes": 45.0,
            "current_session_kwh": 0.15,
            "current_power_watts": 185.0,
            "total_play_time_hours": 10.5,
            "total_energy_kwh": 2.1,
            "total_sessions": 7,
            "last_session": {"duration_minutes": 30},
            "recent_sessions": [],
        }
        probe_attrs = {
            "ip_address": "192.168.1.60",
            "host_name": "PS5-LivingRoom",
            "host_id": "123456",
            "system_version": "09000000",
        }

        self.mqtt_client.publish_state(tracker_data, probe_attrs)

        calls = self.mqtt_client.client.publish.call_args_list
        topics = [call[0][0] for call in calls]

        self.assertIn("ps5_monitor/status/state", topics)
        self.assertIn("ps5_monitor/status/attributes", topics)
        self.assertIn("ps5_monitor/in_use/state", topics)
        self.assertIn("ps5_monitor/session_history/state", topics)
        self.assertIn("ps5_monitor/session_history/attributes", topics)


if __name__ == "__main__":
    unittest.main()
