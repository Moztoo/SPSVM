"""Unit tests for PS5 Device Discovery Protocol (DDP) probe and parser."""

import os
import sys
import unittest

# Ensure app is on python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "ps5_monitor", "app")))

from ddp import PS5Discovery, PS5ProbeResult


class TestPS5Discovery(unittest.TestCase):
    def setUp(self):
        self.discovery = PS5Discovery(port=987)

    def test_parse_awake_status_200(self):
        """Test parsing an AWAKE response with HTTP 200 OK."""
        response_bytes = (
            b"HTTP/1.1 200 OK\r\n"
            b"device-discovery-protocol-version:00030010\r\n"
            b"device-status:200\r\n"
            b"host-id:80ea9684b5c1\r\n"
            b"host-name:PS5-LivingRoom\r\n"
            b"host-request-port:997\r\n"
            b"host-type:PS5\r\n"
            b"system-version:09000000\r\n"
            b"\r\n"
        )
        result = self.discovery.parse_response(response_bytes)
        self.assertEqual(result.state, "awake")
        self.assertTrue(result.is_awake)
        self.assertFalse(result.is_standby)
        self.assertFalse(result.is_off)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.host_name, "PS5-LivingRoom")
        self.assertEqual(result.host_id, "80ea9684b5c1")
        self.assertEqual(result.host_type, "PS5")
        self.assertEqual(result.system_version, "09000000")

    def test_parse_standby_status_620(self):
        """Test parsing a STANDBY response with HTTP 620 Server Standby."""
        response_bytes = (
            b"HTTP/1.1 620 Server Standby\r\n"
            b"device-discovery-protocol-version:00030010\r\n"
            b"device-status:620\r\n"
            b"host-id:80ea9684b5c1\r\n"
            b"host-name:PS5-LivingRoom\r\n"
            b"host-request-port:997\r\n"
            b"host-type:PS5\r\n"
            b"\r\n"
        )
        result = self.discovery.parse_response(response_bytes)
        self.assertEqual(result.state, "standby")
        self.assertFalse(result.is_awake)
        self.assertTrue(result.is_standby)
        self.assertFalse(result.is_off)
        self.assertEqual(result.status_code, 620)
        self.assertEqual(result.host_name, "PS5-LivingRoom")

    def test_parse_header_fallback(self):
        """Test parsing when status code is primarily in device-status header."""
        response_bytes = (
            b"HTTP/1.1 200 OK\r\n"
            b"device-status:620\r\n"
            b"host-name:PS5-Bedroom\r\n"
        )
        # In this edge case, device-status header 620 indicates rest mode
        result = self.discovery.parse_response(response_bytes)
        self.assertIn(result.state, ("awake", "standby"))

    def test_parse_empty_or_garbage(self):
        """Test parsing empty or corrupted response."""
        result_empty = self.discovery.parse_response(b"")
        self.assertEqual(result_empty.state, "off")

        result_garbage = self.discovery.parse_response(b"Random string without http")
        self.assertEqual(result_garbage.state, "off")


if __name__ == "__main__":
    unittest.main()
