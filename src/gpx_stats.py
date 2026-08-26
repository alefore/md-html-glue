#!/usr/bin/env python3
"""Print start time, end time, total distance, duration, average speed, and 1km splits of a GPX file.

Usage: gpx_stats.py FILE.gpx
"""

import math
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from typing import NamedTuple

GPX_NS = "{http://www.topografix.com/GPX/1/1}"
INTERVAL_SIZE_M = 1000.0
STOP_SPEED_THRESHOLD_M_S = 0.3  # roughly 1.1 km/h


def format_duration(td: timedelta) -> str:
  """Formats a timedelta into mm:ss or hh:mm:ss."""
  m, s = divmod(int(td.total_seconds()), 60)
  h, m = divmod(m, 60)
  if h > 0:
    return f"{h}h{m:02d}m{s:02d}s"
  return f"{m}m{s:02d}s"


class Split(NamedTuple):
  label: str
  start: datetime | None
  duration: timedelta
  gain: float
  loss: float
  moving_pct: float

  @staticmethod
  def print_header(show_moving_pct: bool) -> None:
    # Standardized alignment widths for both header and rows
    header = f"| {'Interval (km)':<13} | {'Start Time':<10} | {'Duration':<10} | {'Gain (m)':<8} | {'Loss (m)':<8}"
    sep = f"|{'-'*14}:|{'-'*11}:|{'-'*11}:|{'-'*9}:|{'-'*9}:"

    if show_moving_pct:
      header += f" | {'Moving %':<8}"
      sep += f"|{'-'*9}:"

    print(header + " |")
    print(sep + "|")

  def print_row(self, show_moving_pct: bool) -> None:
    start_str = self.start.astimezone().strftime(
        "%H:%M:%S") if self.start else "N/A"
    duration_str = format_duration(self.duration)

    row = f"| {self.label:<13} | {start_str:<10} | {duration_str:<10} | {int(self.gain):<8} | {int(self.loss):<8}"

    if show_moving_pct:
      row += f" | {f'{round(self.moving_pct)}%':<8}"

    print(row + " |")


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
  """Distance in meters between two WGS84 coordinates."""
  r = 6371000.0
  phi1, phi2 = math.radians(lat1), math.radians(lat2)
  dphi = math.radians(lat2 - lat1)
  dlmb = math.radians(lon2 - lon1)
  a = (
      math.sin(dphi / 2)**2 +
      math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2)**2)
  return 2 * r * math.asin(math.sqrt(a))


def parse_time(text: str) -> datetime:
  return datetime.fromisoformat(text)


def main() -> None:
  if len(sys.argv) != 2:
    sys.exit(f"Usage: {sys.argv[0]} FILE.gpx")

  root = ET.parse(sys.argv[1]).getroot()
  # Store: lat, lon, ele, time
  points: list[tuple[float, float, float, datetime | None]] = []

  for trkpt in root.iter(f"{GPX_NS}trkpt"):
    time_el = trkpt.find(f"{GPX_NS}time")
    ele_el = trkpt.find(f"{GPX_NS}ele")

    time: datetime | None = None
    if time_el is not None and time_el.text is not None:
      time = parse_time(time_el.text)

    ele = float(ele_el.text) if ele_el is not None and ele_el.text else 0.0

    points.append((
        float(trkpt.attrib["lat"]),
        float(trkpt.attrib["lon"]),
        ele,
        time,
    ))

  if not points:
    sys.exit("No track points found.")

  times = [t for _, _, _, t in points if t is not None]

  # ---------------------------
  # Global Stats Calculation
  # ---------------------------
  def fmt(t: datetime) -> str:
    return t.astimezone().isoformat(sep=" ", timespec="seconds")

  total_dist_m = sum(
      haversine_m(a[0], a[1], b[0], b[1]) for a, b in zip(points, points[1:]))

  print(f"* Start: {fmt(times[0]) if times else 'n/a'}")
  print(f"* End: {fmt(times[-1]) if times else 'n/a'}")
  print(f"* Distance: {total_dist_m / 1000:.2f} km")

  if len(times) >= 2:
    total_duration = times[-1] - times[0]
    duration_secs = total_duration.total_seconds()

    print(f"* Duration: {format_duration(total_duration)}")

    if duration_secs > 0 and total_dist_m > 0:
      dist_km = total_dist_m / 1000.0
      pace_secs_per_km = duration_secs / dist_km
      pace_m, pace_s = divmod(int(pace_secs_per_km), 60)
      speed_kmh = dist_km / (duration_secs / 3600.0)

      print(
          f"* Average speed: {pace_m}m{pace_s:02d}s / km ({speed_kmh:.2f} km / h)"
      )
    else:
      print("* Average speed: n/a")
  else:
    print("* Duration: n/a")
    print("* Average speed: n/a")

  print()

  # ---------------------------
  # Interval Splits Calculation
  # ---------------------------
  interval_km = 1
  start_t = points[0][3]

  int_dist = 0.0
  int_gain = 0.0
  int_loss = 0.0
  int_moving_time = 0.0
  int_stopped_time = 0.0

  splits: list[Split] = []

  def add_split(label: str, end_t: datetime | None) -> None:
    """Helper to calculate final interval stats and append a Split."""
    duration = (end_t - start_t) if end_t and start_t else timedelta(0)
    total_time = int_moving_time + int_stopped_time
    moving_pct = (int_moving_time / total_time * 100) if total_time > 0 else 0

    splits.append(
        Split(
            label=label,
            start=start_t,
            duration=duration,
            gain=int_gain,
            loss=int_loss,
            moving_pct=moving_pct,
        ))

  for i in range(1, len(points)):
    prev_p = points[i - 1]
    curr_p = points[i]

    # Distance
    d = haversine_m(prev_p[0], prev_p[1], curr_p[0], curr_p[1])
    int_dist += d

    # Elevation
    d_ele = curr_p[2] - prev_p[2]
    if d_ele > 0:
      int_gain += d_ele
    elif d_ele < 0:
      int_loss += abs(d_ele)

    # Time & Speed (for Moving vs Stopped)
    if curr_p[3] and prev_p[3]:
      dt = (curr_p[3] - prev_p[3]).total_seconds()
      if dt > 0:
        speed = d / dt
        if speed > STOP_SPEED_THRESHOLD_M_S:
          int_moving_time += dt
        else:
          int_stopped_time += dt

    # Check if we crossed the interval boundary (1km)
    if int_dist >= INTERVAL_SIZE_M:
      add_split(str(interval_km), curr_p[3])

      # Reset / Setup for next interval
      interval_km += 1
      start_t = curr_p[3]

      # Carry over the residual distance to the next interval
      int_dist -= INTERVAL_SIZE_M
      int_gain = 0.0
      int_loss = 0.0
      int_moving_time = 0.0
      int_stopped_time = 0.0

  # Append remaining distance as the final interval
  if int_dist > 50:
    add_split(f"{interval_km} ({int_dist/1000:.2f}km)", points[-1][3])

  if not splits:
    return

  # ---------------------------
  # Render Table
  # ---------------------------
  show_moving_pct = any(round(s.moving_pct) < 100 for s in splits)

  print("### Splits")
  Split.print_header(show_moving_pct)
  for s in splits:
    s.print_row(show_moving_pct)


if __name__ == "__main__":
  main()
