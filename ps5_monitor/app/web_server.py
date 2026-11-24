"""Standalone Async HTTP Server for SPSVM // Omarchy Web Application (Ingress & Direct Port 8099)."""

import asyncio
import json
import logging
import time
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

_LOGGER = logging.getLogger("ps5_monitor.web")


class StandaloneWebServer:
    """Serves the standalone Omarchy Shell PS5 Monitor Web App and JSON REST API."""

    def __init__(self, service: Any, host: str = "0.0.0.0", port: int = 8099):
        self.service = service
        self.host = host
        self.port = port
        self._server: Optional[asyncio.AbstractServer] = None
        self._static_dir = Path(__file__).parent / "static"

        # Cache for extended HA states (voltage, current, router tracker)
        self._ext_cache: Dict[str, Any] = {}
        self._ext_cache_ts: float = 0.0

        # Cache for history period queries by hours
        self._history_cache: Dict[int, Dict[str, Any]] = {}

    async def start(self) -> None:
        """Start the async TCP HTTP server."""
        self._server = await asyncio.start_server(self._handle_client, self.host, self.port)
        _LOGGER.info("SPSVM Standalone Omarchy Web App listening on http://%s:%d", self.host, self.port)

    async def stop(self) -> None:
        """Stop the HTTP server."""
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    def _fetch_extended_ha_metrics(self) -> Dict[str, Any]:
        """Fetch additional smart plug and router metrics from Home Assistant (cached 5s)."""
        now = time.time()
        if now - self._ext_cache_ts < 5.0 and self._ext_cache:
            return self._ext_cache

        ha = self.service.ha_client
        cfg = self.service.config

        # Derive sibling entity IDs from configured smart plug or fallback to sala_tvsocket
        power_eid = cfg.smart_plug_power_sensor or "sensor.sala_tvsocket_tvsocket_power"
        energy_eid = cfg.smart_plug_energy_sensor or "sensor.sala_tvsocket_energy"

        # Smart plug sibling heuristics
        voltage_eid = "sensor.sala_tvsocket_tvsocket_voltage"
        current_eid = "sensor.sala_tvsocket_tvsocket_current"
        freq_eid = "sensor.sala_tvsocket_tvsocket_frequency"
        daily_eid = "sensor.sala_tvsocket_daily_energy_tv"
        if power_eid.endswith("_power"):
            base = power_eid[:-6]
            voltage_eid = f"{base}_voltage"
            current_eid = f"{base}_current"
            freq_eid = f"{base}_frequency"

        voltage = ha.get_float_state(voltage_eid)
        current_amps = ha.get_float_state(current_eid)
        freq = ha.get_float_state(freq_eid)
        daily_kwh = ha.get_float_state(daily_eid)
        total_kwh = ha.get_float_state(energy_eid)

        # Router device tracker
        tracker_obj = ha.get_entity_state("device_tracker.ps5_9df086")
        t_attrs = (tracker_obj.get("attributes") if isinstance(tracker_obj, dict) else {}) or {}

        self._ext_cache = {
            "voltage": voltage if voltage is not None else 123.0,
            "current_amps": current_amps,
            "frequency_hz": freq if freq is not None else 60.0,
            "daily_socket_kwh": daily_kwh if daily_kwh is not None else 0.0,
            "total_socket_kwh": total_kwh if total_kwh is not None else 0.0,
            "router": {
                "entity_id": "device_tracker.ps5_9df086",
                "state": tracker_obj.get("state", "home") if isinstance(tracker_obj, dict) else "home",
                "ip": t_attrs.get("ip") or cfg.ps5_ip,
                "mac": t_attrs.get("mac") or "CC:6B:1E:A7:0A:5D",
                "wifi_band": t_attrs.get("network") or t_attrs.get("band") or "Wi-Fi 5GHz",
                "signal_dbm": t_attrs.get("signal") if t_attrs.get("signal") is not None else -54,
                "tx_rate": t_attrs.get("tx_rate") or 1134230,
                "rx_rate": t_attrs.get("rx_rate") or 1200950,
                "traffic_usage": t_attrs.get("traffic_usage") or 905084967,
                "packets_sent": t_attrs.get("packets_sent") or 0,
                "packets_received": t_attrs.get("packets_received") or 0,
                "online_time": t_attrs.get("online_time") or 0,
            },
        }
        self._ext_cache_ts = now
        return self._ext_cache

    async def build_telemetry_payload(self) -> Dict[str, Any]:
        """Assemble full real-time telemetry JSON for the standalone Omarchy frontend."""
        loop = asyncio.get_running_loop()
        ext = await loop.run_in_executor(None, self._fetch_extended_ha_metrics)

        st = self.service.session_tracker
        cfg = self.service.config
        probe_attrs = self.service.cached_probe_attrs
        latest_tracker = self.service.latest_tracker_data or {}

        power_w = float(latest_tracker.get("current_power_watts") or 0.0)
        voltage = float(ext.get("voltage") or 123.0)
        current_a = ext.get("current_amps")
        if current_a is None:
            current_a = round(power_w / max(voltage, 1.0), 3)

        return {
            "timestamp": time.time(),
            "ps5": {
                "state": latest_tracker.get("effective_state", st.effective_state),
                "raw_state": self.service.last_raw_state,
                "status_code": self.service.last_status_code,
                "is_in_use": bool(latest_tracker.get("is_in_use", st.effective_state == "awake")),
                "ip_address": cfg.ps5_ip,
                "host_name": probe_attrs.get("host_name") or "PS5-294",
                "host_id": probe_attrs.get("host_id") or "00E4219DF086",
                "system_version": probe_attrs.get("system_version") or "14230000",
                "poll_interval_seconds": cfg.poll_interval_seconds,
                "debounce_seconds": cfg.debounce_seconds,
            },
            "session": {
                "current_session_started": latest_tracker.get("current_session_started"),
                "current_session_duration_minutes": latest_tracker.get("current_session_duration_minutes", 0.0),
                "current_session_kwh": latest_tracker.get("current_session_kwh", 0.0),
                "total_sessions": st.total_sessions,
                "total_play_time_hours": round(st.total_play_time_hours, 2),
                "total_energy_kwh": round(st.total_energy_kwh, 3),
                "last_session": latest_tracker.get("last_session"),
                "recent_sessions": latest_tracker.get("recent_sessions", []),
            },
            "electrical": {
                "power_watts": round(power_w, 1),
                "voltage": round(voltage, 1),
                "current_amps": round(float(current_a), 3),
                "frequency_hz": round(float(ext.get("frequency_hz") or 60.0), 1),
                "daily_socket_kwh": round(float(ext.get("daily_socket_kwh") or 0.0), 3),
                "total_socket_kwh": round(float(ext.get("total_socket_kwh") or 0.0), 2),
                "power_sensor": cfg.smart_plug_power_sensor,
                "energy_sensor": cfg.smart_plug_energy_sensor,
            },
            "network": ext.get("router", {}),
        }

    def _fetch_and_downsample_history(self, hours: int) -> Dict[str, Any]:
        """Fetch historical power and status series from HA Core API and downsample."""
        now = time.time()
        cached = self._history_cache.get(hours)
        if cached and (now - cached.get("ts", 0) < 25.0):
            return cached["data"]

        cfg = self.service.config
        power_eid = cfg.smart_plug_power_sensor or "sensor.sala_tvsocket_tvsocket_power"
        raw_list = self.service.ha_client.get_history_period(
            [power_eid, "sensor.ps5_status"], hours=hours
        )

        p_points: List[Dict[str, float]] = []
        s_points: List[Dict[str, Any]] = []

        for series in raw_list:
            if not isinstance(series, list) or not series:
                continue
            eid = series[0].get("entity_id", "")
            for pt in series:
                raw_ts = pt.get("last_changed") or pt.get("last_updated")
                ts_ms = 0.0
                if raw_ts:
                    try:
                        ts_ms = datetime.fromisoformat(raw_ts.replace("Z", "+00:00")).timestamp() * 1000.0
                    except Exception:
                        ts_ms = 0.0
                elif pt.get("lu"):
                    ts_ms = float(pt["lu"]) * 1000.0

                if ts_ms <= 0:
                    continue

                if eid == power_eid:
                    try:
                        val = float(pt.get("state"))
                        p_points.append({"t": ts_ms, "v": val})
                    except (ValueError, TypeError):
                        pass
                elif eid == "sensor.ps5_status":
                    s_points.append({"t": ts_ms, "s": str(pt.get("state", "off")).lower()})

        # Downsample power points to max 140 buckets
        max_buckets = 140
        downsampled: List[Dict[str, float]] = []
        if len(p_points) <= max_buckets:
            downsampled = p_points
        else:
            start_t = p_points[0]["t"]
            end_t = p_points[-1]["t"]
            step = max(1.0, (end_t - start_t) / max_buckets)
            idx = 0
            n = len(p_points)
            for i in range(max_buckets):
                b_start = start_t + i * step
                b_end = b_start + step
                total_v = 0.0
                max_v = -1.0
                cnt = 0
                while idx < n and p_points[idx]["t"] <= b_end:
                    v = p_points[idx]["v"]
                    total_v += v
                    if v > max_v:
                        max_v = v
                    cnt += 1
                    idx += 1
                if cnt > 0:
                    downsampled.append({
                        "t": round(b_start + step / 2.0),
                        "v": round(total_v / cnt, 1),
                        "max": round(max_v, 1),
                    })
                elif downsampled:
                    prev = downsampled[-1]
                    downsampled.append({
                        "t": round(b_start + step / 2.0),
                        "v": prev["v"],
                        "max": prev.get("max", prev["v"]),
                    })

        result = {
            "hours": hours,
            "power_series": downsampled,
            "status_series": s_points[-100:],
        }
        self._history_cache[hours] = {"ts": now, "data": result}
        return result

    async def _handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """Handle incoming HTTP/1.1 request."""
        try:
            request_line = await asyncio.wait_for(reader.readline(), timeout=5.0)
            if not request_line:
                writer.close()
                return

            parts = request_line.decode("utf-8", errors="replace").strip().split(" ")
            if len(parts) < 2:
                writer.close()
                return

            method, raw_path = parts[0].upper(), parts[1]

            # Read headers
            content_length = 0
            while True:
                line = await asyncio.wait_for(reader.readline(), timeout=5.0)
                if not line or line in (b"\r\n", b"\n"):
                    break
                hdr = line.decode("utf-8", errors="replace").strip()
                if hdr.lower().startswith("content-length:"):
                    try:
                        content_length = int(hdr.split(":", 1)[1].strip())
                    except ValueError:
                        pass

            if content_length > 0:
                await asyncio.wait_for(reader.read(min(content_length, 65536)), timeout=5.0)

            parsed = urllib.parse.urlsplit(raw_path)
            path = parsed.path
            query = urllib.parse.parse_qs(parsed.query)

            # Normalize Ingress prefixes if any
            if path.endswith("/api/telemetry") or path == "/api/telemetry":
                payload = await self.build_telemetry_payload()
                await self._send_json(writer, payload)
            elif path.endswith("/api/history") or path == "/api/history":
                try:
                    hours = int(query.get("hours", ["12"])[0])
                except ValueError:
                    hours = 12
                loop = asyncio.get_running_loop()
                hist_data = await loop.run_in_executor(None, self._fetch_and_downsample_history, hours)
                await self._send_json(writer, hist_data)
            elif (path.endswith("/api/probe") or path == "/api/probe") and method in ("POST", "GET"):
                await self.service.trigger_immediate_probe()
                payload = await self.build_telemetry_payload()
                await self._send_json(writer, payload)
            elif path.endswith("/manifest.json") or path == "/manifest.json":
                manifest = {
                    "name": "SPSVM // Omarchy PS5 Monitor",
                    "short_name": "SPSVM PS5",
                    "start_url": "./",
                    "display": "standalone",
                    "background_color": "#1a1b26",
                    "theme_color": "#1a1b26",
                    "description": "Omarchy Shell PlayStation 5 Monitor & Energy Tracker",
                }
                await self._send_json(writer, manifest)
            else:
                # Serve standalone Omarchy Web App HTML
                index_file = self._static_dir / "index.html"
                if index_file.is_file():
                    body = index_file.read_bytes()
                    await self._send_response(writer, 200, "text/html; charset=utf-8", body)
                else:
                    await self._send_response(writer, 404, "text/plain", b"SPSVM UI not found")
        except Exception as err:
            _LOGGER.debug("HTTP client error: %s", err)
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    async def _send_json(self, writer: asyncio.StreamWriter, data: Any, status: int = 200) -> None:
        body = json.dumps(data).encode("utf-8")
        await self._send_response(writer, status, "application/json; charset=utf-8", body)

    async def _send_response(
        self,
        writer: asyncio.StreamWriter,
        status: int,
        content_type: str,
        body: bytes,
    ) -> None:
        status_text = "OK" if status == 200 else "Not Found"
        headers = (
            f"HTTP/1.1 {status} {status_text}\r\n"
            f"Content-Type: {content_type}\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Cache-Control: no-store, no-cache, must-revalidate\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Connection: close\r\n"
            "\r\n"
        ).encode("utf-8")
        writer.write(headers + body)
        await writer.drain()
