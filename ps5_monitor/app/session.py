"""Session lifecycle tracking, debouncing, energy calculations, and persistence."""

import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

_LOGGER = logging.getLogger(__name__)


def utc_now_iso() -> str:
    """Return current UTC time in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class CompletedSession:
    """Record of a completed gaming session."""
    started_at: str
    ended_at: str
    duration_minutes: float
    energy_kwh: float
    avg_power_watts: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "duration_minutes": round(self.duration_minutes, 1),
            "energy_kwh": round(self.energy_kwh, 3),
            "avg_power_watts": round(self.avg_power_watts, 1),
        }


@dataclass
class ActiveSession:
    """Information regarding currently active gaming session."""
    started_at_iso: str
    start_timestamp: float
    start_kwh: Optional[float] = None
    power_samples: List[float] = field(default_factory=list)
    disconnect_timestamp: Optional[float] = None


class SessionTracker:
    """Tracks PlayStation 5 sessions with debounce, energy metrics, and persistent storage."""

    def __init__(self, data_dir: str = "/data", max_history: int = 20):
        self.data_dir = Path(data_dir)
        self.file_path = self.data_dir / "sessions.json"
        self.max_history = max_history

        # Cumulative metrics
        self.total_play_time_hours: float = 0.0
        self.total_sessions: int = 0
        self.total_energy_kwh: float = 0.0
        self.sessions: List[CompletedSession] = []

        # Current active session
        self.active_session: Optional[ActiveSession] = None

        # Effective state (after debounce)
        self.effective_state: str = "off"

        # Load persisted data on init
        self.load()

    def load(self) -> None:
        """Load session history and cumulative stats from disk."""
        if not self.file_path.is_file():
            _LOGGER.info("No existing session file at %s, starting fresh.", self.file_path)
            return

        try:
            with open(self.file_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            self.total_play_time_hours = float(data.get("total_play_time_hours", 0.0))
            self.total_sessions = int(data.get("total_sessions", 0))
            self.total_energy_kwh = float(data.get("total_energy_kwh", 0.0))

            raw_sessions = data.get("sessions", [])
            self.sessions = []
            for item in raw_sessions:
                self.sessions.append(
                    CompletedSession(
                        started_at=item.get("started_at", ""),
                        ended_at=item.get("ended_at", ""),
                        duration_minutes=float(item.get("duration_minutes", 0.0)),
                        energy_kwh=float(item.get("energy_kwh", 0.0)),
                        avg_power_watts=float(item.get("avg_power_watts", 0.0)),
                    )
                )

            # Check if an active session was saved
            saved_active = data.get("active_session")
            if saved_active and isinstance(saved_active, dict):
                started_iso = saved_active.get("started_at_iso", utc_now_iso())
                start_ts = float(saved_active.get("start_timestamp", time.time()))
                start_kwh = saved_active.get("start_kwh")
                if start_kwh is not None:
                    start_kwh = float(start_kwh)
                samples = [float(x) for x in saved_active.get("power_samples", [])]
                self.active_session = ActiveSession(
                    started_at_iso=started_iso,
                    start_timestamp=start_ts,
                    start_kwh=start_kwh,
                    power_samples=samples,
                )
                self.effective_state = "awake"
                _LOGGER.info("Restored in-progress session started at %s", started_iso)

            _LOGGER.info(
                "Loaded session history: %d sessions, %.2f hours, %.3f kWh",
                self.total_sessions, self.total_play_time_hours, self.total_energy_kwh
            )
        except Exception as err:
            _LOGGER.warning("Failed to load sessions from %s: %s", self.file_path, err)

    def save(self) -> None:
        """Atomically persist session history and cumulative stats to disk."""
        try:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            temp_path = self.data_dir / "sessions.json.tmp"

            payload: Dict[str, Any] = {
                "total_play_time_hours": round(self.total_play_time_hours, 2),
                "total_sessions": self.total_sessions,
                "total_energy_kwh": round(self.total_energy_kwh, 3),
                "sessions": [s.to_dict() for s in self.sessions],
            }

            if self.active_session:
                payload["active_session"] = {
                    "started_at_iso": self.active_session.started_at_iso,
                    "start_timestamp": self.active_session.start_timestamp,
                    "start_kwh": self.active_session.start_kwh,
                    "power_samples": self.active_session.power_samples[-100:],  # keep last 100 samples
                }
            else:
                payload["active_session"] = None

            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)

            temp_path.replace(self.file_path)
            _LOGGER.debug("Persisted sessions to %s", self.file_path)
        except Exception as err:
            _LOGGER.error("Failed to save sessions to %s: %s", self.file_path, err)

    def _start_session(self, current_energy_kwh: Optional[float], current_power: Optional[float]) -> None:
        """Start a new gaming session."""
        now_iso = utc_now_iso()
        now_ts = time.time()
        samples = [current_power] if current_power is not None and current_power > 0 else []

        self.active_session = ActiveSession(
            started_at_iso=now_iso,
            start_timestamp=now_ts,
            start_kwh=current_energy_kwh,
            power_samples=samples,
        )
        self.effective_state = "awake"
        _LOGGER.info("PS5 Gaming Session STARTED at %s (starting kWh: %s)", now_iso, current_energy_kwh)
        self.save()

    def _end_session(self, current_energy_kwh: Optional[float]) -> None:
        """Conclude the active gaming session and record statistics."""
        if not self.active_session:
            return

        end_iso = utc_now_iso()
        # Use disconnect timestamp if available to avoid counting debounce wait time
        end_ts = self.active_session.disconnect_timestamp or time.time()
        start_ts = self.active_session.start_timestamp

        duration_sec = max(0.0, end_ts - start_ts)
        duration_minutes = duration_sec / 60.0
        duration_hours = duration_sec / 3600.0

        # Energy calculation
        energy_kwh = 0.0
        if (
            self.active_session.start_kwh is not None
            and current_energy_kwh is not None
            and current_energy_kwh >= self.active_session.start_kwh
        ):
            energy_kwh = current_energy_kwh - self.active_session.start_kwh
        elif self.active_session.power_samples and duration_hours > 0:
            # Estimate energy from average power if direct cumulative energy was unavailable
            avg_power = sum(self.active_session.power_samples) / len(self.active_session.power_samples)
            energy_kwh = (avg_power * duration_hours) / 1000.0

        # Average power calculation
        avg_power_watts = 0.0
        if self.active_session.power_samples:
            avg_power_watts = sum(self.active_session.power_samples) / len(self.active_session.power_samples)
        elif duration_hours > 0 and energy_kwh > 0:
            avg_power_watts = (energy_kwh * 1000.0) / duration_hours

        completed = CompletedSession(
            started_at=self.active_session.started_at_iso,
            ended_at=end_iso,
            duration_minutes=duration_minutes,
            energy_kwh=energy_kwh,
            avg_power_watts=avg_power_watts,
        )

        # Update cumulative counters
        self.total_play_time_hours += duration_hours
        self.total_sessions += 1
        self.total_energy_kwh += energy_kwh

        # Insert at front of sessions list (newest first)
        self.sessions.insert(0, completed)
        if len(self.sessions) > self.max_history:
            self.sessions = self.sessions[: self.max_history]

        _LOGGER.info(
            "PS5 Gaming Session ENDED. Duration: %.1f min, Energy: %.3f kWh, Avg Power: %.1f W",
            duration_minutes, energy_kwh, avg_power_watts
        )

        self.active_session = None
        self.save()

    def update_state(
        self,
        raw_state: str,
        current_power: Optional[float] = None,
        current_energy_kwh: Optional[float] = None,
        debounce_seconds: int = 60,
    ) -> Dict[str, Any]:
        """Update tracker with latest raw probe state and smart plug metrics."""
        now_ts = time.time()

        if raw_state == "awake":
            if self.active_session is None:
                # Transitioned from STANDBY/OFF to AWAKE -> Start session!
                self._start_session(current_energy_kwh, current_power)
            else:
                # Ongoing session
                if self.active_session.disconnect_timestamp is not None:
                    # Cancelled debounce! Glitch recovered
                    _LOGGER.info(
                        "PS5 returned to AWAKE within debounce window (%.1fs). Session remains active.",
                        now_ts - self.active_session.disconnect_timestamp
                    )
                    self.active_session.disconnect_timestamp = None

                if current_power is not None and current_power > 0:
                    self.active_session.power_samples.append(current_power)
                    # Limit sample count in memory
                    if len(self.active_session.power_samples) > 500:
                        self.active_session.power_samples = self.active_session.power_samples[-500:]

            self.effective_state = "awake"

        else:  # raw_state is 'standby' or 'off'
            if self.active_session is not None:
                # Active session is experiencing a potential end/disconnect
                if self.active_session.disconnect_timestamp is None:
                    self.active_session.disconnect_timestamp = now_ts
                    _LOGGER.debug(
                        "PS5 transitioned to %s; starting %ds debounce timer...",
                        raw_state, debounce_seconds
                    )

                disconnect_duration = now_ts - self.active_session.disconnect_timestamp
                if disconnect_duration >= debounce_seconds:
                    # Debounce threshold exceeded: finalize session
                    _LOGGER.info(
                        "PS5 remained in %s for %.1fs (>= %ds debounce). Concluding session.",
                        raw_state, disconnect_duration, debounce_seconds
                    )
                    self._end_session(current_energy_kwh)
                    self.effective_state = raw_state
                else:
                    # Still within debounce window: keep effective state as awake
                    self.effective_state = "awake"
            else:
                self.effective_state = raw_state

        # Compute real-time attributes
        current_session_duration = 0.0
        current_session_kwh = 0.0
        current_session_started = None

        if self.active_session:
            current_session_started = self.active_session.started_at_iso
            dur_sec = max(0.0, now_ts - self.active_session.start_timestamp)
            current_session_duration = round(dur_sec / 60.0, 1)

            if (
                self.active_session.start_kwh is not None
                and current_energy_kwh is not None
                and current_energy_kwh >= self.active_session.start_kwh
            ):
                current_session_kwh = round(current_energy_kwh - self.active_session.start_kwh, 3)
            elif self.active_session.power_samples and dur_sec > 0:
                avg_p = sum(self.active_session.power_samples) / len(self.active_session.power_samples)
                current_session_kwh = round((avg_p * (dur_sec / 3600.0)) / 1000.0, 3)

        last_session_dict = self.sessions[0].to_dict() if self.sessions else None
        recent_sessions_list = [s.to_dict() for s in self.sessions]

        return {
            "effective_state": self.effective_state,
            "is_in_use": (self.effective_state == "awake"),
            "current_session_started": current_session_started,
            "current_session_duration_minutes": current_session_duration,
            "current_session_kwh": current_session_kwh,
            "current_power_watts": current_power if current_power is not None else 0.0,
            "total_play_time_hours": round(self.total_play_time_hours, 2),
            "total_energy_kwh": round(self.total_energy_kwh, 3),
            "total_sessions": self.total_sessions,
            "last_session": last_session_dict,
            "recent_sessions": recent_sessions_list,
        }
