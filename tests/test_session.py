"""Unit tests for SessionTracker, debouncing, energy calculations, and persistence."""

import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "ps5_monitor", "app")))

from session import SessionTracker


class TestSessionTracker(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.tracker = SessionTracker(data_dir=self.test_dir, max_history=10)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_initial_state(self):
        """Test initial state with empty history."""
        self.assertEqual(self.tracker.effective_state, "off")
        self.assertEqual(self.tracker.total_sessions, 0)
        self.assertEqual(self.tracker.total_play_time_hours, 0.0)
        self.assertEqual(self.tracker.total_energy_kwh, 0.0)
        self.assertEqual(len(self.tracker.sessions), 0)

    def test_session_start_on_awake(self):
        """Test transitioning from standby/off to awake initiates a session."""
        res = self.tracker.update_state(
            raw_state="awake",
            current_power=180.0,
            current_energy_kwh=10.5,
            debounce_seconds=60,
        )
        self.assertEqual(res["effective_state"], "awake")
        self.assertTrue(res["is_in_use"])
        self.assertIsNotNone(res["current_session_started"])
        self.assertIsNotNone(self.tracker.active_session)
        self.assertEqual(self.tracker.active_session.start_kwh, 10.5)

    def test_debounce_suppresses_short_glitch(self):
        """Test a brief disconnect (e.g. 5 seconds) during gaming is debounced."""
        # 1. Start session
        self.tracker.update_state(raw_state="awake", current_power=190.0, current_energy_kwh=10.0, debounce_seconds=30)
        start_time = self.tracker.active_session.start_timestamp

        # 2. Console briefly drops to 'off' (e.g. UDP packet dropped or game restart)
        res_glitch = self.tracker.update_state(
            raw_state="off",
            current_power=0.0,
            current_energy_kwh=10.0,
            debounce_seconds=30,
        )
        # Effective state should REMAIN 'awake' because debounce_seconds is 30!
        self.assertEqual(res_glitch["effective_state"], "awake")
        self.assertTrue(res_glitch["is_in_use"])
        self.assertIsNotNone(self.tracker.active_session.disconnect_timestamp)

        # 3. Console returns to 'awake' within debounce window
        res_recovered = self.tracker.update_state(
            raw_state="awake",
            current_power=185.0,
            current_energy_kwh=10.05,
            debounce_seconds=30,
        )
        self.assertEqual(res_recovered["effective_state"], "awake")
        self.assertTrue(res_recovered["is_in_use"])
        # Disconnect timestamp should be cleared
        self.assertIsNone(self.tracker.active_session.disconnect_timestamp)
        # Session start timestamp should be unchanged
        self.assertEqual(self.tracker.active_session.start_timestamp, start_time)

    def test_session_ends_after_debounce_expiration(self):
        """Test that sustained standby/off longer than debounce_seconds ends the session."""
        # Start session with simulated start time 1 hour ago
        self.tracker.update_state(raw_state="awake", current_power=180.0, current_energy_kwh=20.0, debounce_seconds=10)
        self.tracker.active_session.start_timestamp = time.time() - 3600  # 1 hour ago

        # Set disconnect timestamp 15 seconds ago (debounce is 10s)
        self.tracker.active_session.disconnect_timestamp = time.time() - 15

        res = self.tracker.update_state(
            raw_state="standby",
            current_power=2.5,
            current_energy_kwh=20.25,
            debounce_seconds=10,
        )

        self.assertEqual(res["effective_state"], "standby")
        self.assertFalse(res["is_in_use"])
        self.assertIsNone(self.tracker.active_session)
        self.assertEqual(self.tracker.total_sessions, 1)
        self.assertAlmostEqual(self.tracker.total_energy_kwh, 0.25, places=2)
        self.assertGreaterEqual(self.tracker.total_play_time_hours, 0.95)

        last_sess = res["last_session"]
        self.assertIsNotNone(last_sess)
        self.assertAlmostEqual(last_sess["energy_kwh"], 0.25, places=2)
        self.assertGreater(last_sess["duration_minutes"], 55)

    def test_persistence_and_reload(self):
        """Test data survives instantiating a new SessionTracker instance (simulating add-on restart)."""
        # Create and end a session
        self.tracker.update_state(raw_state="awake", current_power=200.0, current_energy_kwh=50.0, debounce_seconds=5)
        self.tracker.active_session.start_timestamp = time.time() - 1800  # 30 min
        self.tracker.active_session.disconnect_timestamp = time.time() - 10

        self.tracker.update_state(raw_state="standby", current_power=0.0, current_energy_kwh=50.1, debounce_seconds=5)
        self.assertEqual(self.tracker.total_sessions, 1)

        # Create new tracker pointing to same directory
        reloaded = SessionTracker(data_dir=self.test_dir, max_history=10)
        self.assertEqual(reloaded.total_sessions, 1)
        self.assertAlmostEqual(reloaded.total_energy_kwh, 0.1, places=2)
        self.assertEqual(len(reloaded.sessions), 1)
        self.assertAlmostEqual(reloaded.sessions[0].energy_kwh, 0.1, places=2)

    def test_graceful_handling_without_smart_plug(self):
        """Test tracker works seamlessly with None power and energy sensors."""
        res1 = self.tracker.update_state(raw_state="awake", current_power=None, current_energy_kwh=None, debounce_seconds=5)
        self.assertEqual(res1["effective_state"], "awake")
        self.assertEqual(res1["current_session_kwh"], 0.0)

        self.tracker.active_session.start_timestamp = time.time() - 600
        self.tracker.active_session.disconnect_timestamp = time.time() - 10

        res2 = self.tracker.update_state(raw_state="off", current_power=None, current_energy_kwh=None, debounce_seconds=5)
        self.assertEqual(res2["effective_state"], "off")
        self.assertEqual(self.tracker.total_sessions, 1)
        self.assertEqual(self.tracker.total_energy_kwh, 0.0)


if __name__ == "__main__":
    unittest.main()
