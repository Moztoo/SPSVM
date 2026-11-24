"""PlayStation 5 Device Discovery Protocol (DDP) probe and parser."""

import asyncio
import logging
import re
import socket
from dataclasses import dataclass
from typing import Dict, Optional

_LOGGER = logging.getLogger(__name__)

# PS5 DDP Discovery message (UDP)
PS5_DDP_PROBE_V3 = (
    "SRCH * HTTP/1.1\r\n"
    "device-discovery-protocol-version:00030010\r\n"
    "\r\n"
).encode("utf-8")

# PS4 fallback probe if needed
PS4_DDP_PROBE_V2 = (
    "SRCH * HTTP/1.1\r\n"
    "device-discovery-protocol-version:00020020\r\n"
    "\r\n"
).encode("utf-8")


@dataclass
class PS5ProbeResult:
    """Result of probing a PlayStation 5 console."""
    state: str  # 'awake', 'standby', 'off'
    status_code: Optional[int] = None
    host_name: Optional[str] = None
    host_id: Optional[str] = None
    host_type: Optional[str] = None
    system_version: Optional[str] = None
    raw_response: Optional[str] = None
    headers: Optional[Dict[str, str]] = None

    @property
    def is_awake(self) -> bool:
        return self.state == "awake"

    @property
    def is_standby(self) -> bool:
        return self.state == "standby"

    @property
    def is_off(self) -> bool:
        return self.state == "off"


class PS5Discovery:
    """Handles low-level UDP discovery probe queries to PlayStation consoles."""

    def __init__(self, port: int = 987):
        self.port = port

    @staticmethod
    def parse_response(data: bytes) -> PS5ProbeResult:
        """Parse HTTP-formatted UDP response from PlayStation."""
        text = data.decode("utf-8", errors="replace")
        lines = [line.strip() for line in text.splitlines() if line.strip()]

        if not lines:
            return PS5ProbeResult(state="off", raw_response=text)

        status_code = None
        # Match HTTP status line: HTTP/1.1 200 OK or HTTP/1.1 620 Server Standby
        first_line = lines[0]
        status_match = re.search(r"HTTP/\d\.\d\s+(\d{3})", first_line, re.IGNORECASE)
        if status_match:
            try:
                status_code = int(status_match.group(1))
            except ValueError:
                pass

        headers: Dict[str, str] = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        # Check device-status header if status_code wasn't in line 1
        if "device-status" in headers:
            try:
                dev_status = int(headers["device-status"])
                if status_code is None or status_code not in (200, 620):
                    status_code = dev_status
            except ValueError:
                pass

        host_name = headers.get("host-name")
        host_id = headers.get("host-id")
        host_type = headers.get("host-type")
        system_version = headers.get("system-version")

        # Determine state according to spec:
        # HTTP 200: Console is AWAKE (Active)
        # HTTP 620: Console is in STANDBY (Rest Mode)
        # Otherwise: If status is unknown or 0, fallback
        if status_code == 200:
            state = "awake"
        elif status_code == 620:
            state = "standby"
        elif status_code is not None and 200 <= status_code < 300:
            state = "awake"
        elif status_code is not None and 600 <= status_code < 700:
            state = "standby"
        else:
            state = "off"

        return PS5ProbeResult(
            state=state,
            status_code=status_code,
            host_name=host_name,
            host_id=host_id,
            host_type=host_type,
            system_version=system_version,
            raw_response=text,
            headers=headers,
        )

    def probe_sync(self, ip: str, retries: int = 3, timeout: float = 1.2) -> PS5ProbeResult:
        """Send synchronous UDP probe to the PS5 with retries."""
        if not ip or ip == "0.0.0.0":
            return PS5ProbeResult(state="off")

        for attempt in range(1, retries + 1):
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(timeout)
            try:
                sock.sendto(PS5_DDP_PROBE_V3, (ip, self.port))
                data, _ = sock.recvfrom(2048)
                result = self.parse_response(data)
                _LOGGER.debug(
                    "Probe attempt %d/%d to %s:%d succeeded: state=%s, code=%s",
                    attempt, retries, ip, self.port, result.state, result.status_code
                )
                return result
            except socket.timeout:
                _LOGGER.debug(
                    "Probe attempt %d/%d to %s:%d timed out",
                    attempt, retries, ip, self.port
                )
            except OSError as err:
                _LOGGER.debug(
                    "Probe attempt %d/%d to %s:%d network error: %s",
                    attempt, retries, ip, self.port, err
                )
            finally:
                sock.close()

        return PS5ProbeResult(state="off")

    async def probe(self, ip: str, retries: int = 3, timeout: float = 1.2) -> PS5ProbeResult:
        """Asynchronously probe the PS5 without blocking the event loop."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.probe_sync, ip, retries, timeout)
