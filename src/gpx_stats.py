#!/usr/bin/env python3
"""Print start time, end time, and total distance of a GPX file.

Usage: gpx_stats.py FILE.gpx
"""

import math
import sys
import xml.etree.ElementTree as ET
from datetime import datetime

GPX_NS = "{http://www.topografix.com/GPX/1/1}"


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
  points: list[tuple[float, float, datetime | None]] = []
  for trkpt in root.iter(f"{GPX_NS}trkpt"):
    time_el = trkpt.find(f"{GPX_NS}time")
    time: datetime | None = None
    assert time_el is not None and time_el.text is not None
    time = parse_time(time_el.text)
    points.append((
        float(trkpt.attrib["lat"]),
        float(trkpt.attrib["lon"]),
        time,
    ))

  if not points:
    sys.exit("No track points found.")

  times = [t for _, _, t in points if t is not None]
  distance_m = sum(
      haversine_m(a[0], a[1], b[0], b[1]) for a, b in zip(points, points[1:]))

  def fmt(t: datetime) -> str:
    return t.astimezone().isoformat(sep=" ", timespec="seconds")

  print(f"* Start: {fmt(times[0]) if times else 'n/a'}")
  print(f"* End: {fmt(times[-1]) if times else 'n/a'}")
  print(f"* Distance: {distance_m / 1000:.2f} km")


if __name__ == "__main__":
  main()
