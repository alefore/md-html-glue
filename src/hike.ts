// hike.ts
//
// Renders a hike page's interactive map (Leaflet + Swisstopo tiles) and two
// altitude profiles (altitude vs. time, altitude vs. distance) from a GPX
// data island (<script type="application/gpx+xml" id="hike-data">).
//
// Page contract: the document must contain the data island and at least two
// <h2> headers; the map and profiles are inserted before the second <h2>.

import * as L from 'leaflet';

interface TrackPoint {
  latLng: L.LatLng;
  ele: number;   // meters over sea level
  time: number;  // milliseconds since epoch
}

function parseTrack(dataIslandId: string): TrackPoint[] {
  const island = document.getElementById(dataIslandId);
  if (island === null) {
    throw new Error(`hike.js: data island #${dataIslandId} not found.`);
  }
  const text = island.textContent?.trim() ?? '';
  if (text === '') {
    throw new Error(
        `hike.js: data island #${dataIslandId} is empty — ` +
        `the build inlined no GPX content (empty .gpx file?).`);
  }
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(
        'hike.js: data island is not valid XML: ' +
        doc.getElementsByTagName('parsererror')[0].textContent);
  }
  const points = Array.from(doc.getElementsByTagName('trkpt')).map((pt, i) => {
    const ele = pt.getElementsByTagName('ele')[0]?.textContent;
    const time = pt.getElementsByTagName('time')[0]?.textContent;
    if (ele == null || time == null) {
      throw new Error(`hike.js: trkpt #${i} lacks <ele> or <time>.`);
    }
    return {
      latLng: L.latLng(
          Number(pt.getAttribute('lat')), Number(pt.getAttribute('lon'))),
      ele: Number(ele),
      time: new Date(time).getTime(),
    };
  });
  if (points.length < 2) {
    throw new Error(
        `hike.js: need at least 2 track points, ` +
        `found ${points.length}.`);
  }
  return points;
}

// Cumulative distance from start, in meters, per point.
function cumulativeDistances(points: TrackPoint[]): number[] {
  const result = [0];
  for (let i = 1; i < points.length; i++) {
    result.push(
        result[i - 1] + points[i - 1].latLng.distanceTo(points[i].latLng));
  }
  return result;
}

// Returns the container inserted before the second <h2>, holding the map
// and both profiles.
function insertContainers(): {
  mapDiv: HTMLElement; timeDiv: HTMLElement; distanceDiv: HTMLElement;
  progressDiv: HTMLElement;
} {
  const headers = document.getElementsByTagName('h2');
  if (headers.length < 2) {
    throw new Error(
        `hike.js: expected at least two <h2> headers to place ` +
        `the map, found ${headers.length}.`);
  }
  const make = (id: string): HTMLElement => {
    const div = document.createElement('div');
    div.id = id;
    return div;
  };
  const mapDiv = make('hike-map');
  const timeDiv = make('hike-profile-time');
  const distanceDiv = make('hike-profile-distance');
  const progressDiv = make('hike-profile-progress');
  headers[1].before(mapDiv, timeDiv, distanceDiv, progressDiv);
  return {mapDiv, timeDiv, distanceDiv, progressDiv};
}

function renderMap(mapDiv: HTMLElement, points: TrackPoint[]): void {
  const map = L.map(mapDiv);
  L.tileLayer(
       'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
       {
         maxZoom: 19,
         attribution:
             '&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a>',
       })
      .addTo(map);

  const latLngs = points.map((p) => p.latLng);
  L.polyline(latLngs, {className: 'hike-track-casing'}).addTo(map);
  const track = L.polyline(latLngs, {className: 'hike-track'}).addTo(map);
  L.circleMarker(latLngs[0], {radius: 6, color: '#008000', fillOpacity: 1})
      .addTo(map)
      .bindTooltip('Start');
  L.circleMarker(
       latLngs[latLngs.length - 1],
       {radius: 6, color: '#000000', fillOpacity: 1})
      .addTo(map)
      .bindTooltip('End');

  // Add hourly boundary markers
  const HOUR_MS = 60 * 60 * 1000;
  const totalDuration = points[points.length - 1].time - points[0].time;
  const intervalMs = totalDuration < 10 * HOUR_MS ? HOUR_MS / 2 : HOUR_MS;

  let targetTime = points[0].time + intervalMs;

  points.forEach((p) => {
    if (p.time >= targetTime) {
      const date = new Date(p.time);
      const timeStr =
          `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
      L.circleMarker(p.latLng, {className: 'hike-hour-boundary', radius: 6})
          .addTo(map)
          .bindTooltip(timeStr);

      while (targetTime <= p.time) {
        targetTime += intervalMs;
      }
    }
  });

  map.fitBounds(track.getBounds(), {padding: [24, 24]});
}


const SVG_NS = 'http://www.w3.org/2000/svg';

interface Series {
  xs: number[];  // one x per track point, ascending
  ys: number[];  // y value per point (altitude, distance, ...)
  xTickFormat: (x: number) => string;
  xTickStep: number;  // in x units
  xLabel: string;
  yLabel: string;
  yTickFormat?: (y: number) => string;  // default: String(y)
}

// A humane tick step: 1/2/5 × 10^k covering roughly `target` intervals.
function niceStep(range: number, target: number): number {
  const raw = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= raw) return m * pow;
  }
  return 10 * pow;
}

function renderProfile(container: HTMLElement, series: Series): void {
  const width = 700, height = 220;
  const margin = {top: 12, right: 16, bottom: 36, left: 90};
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const xMin = series.xs[0], xMax = series.xs[series.xs.length - 1];
  const yStep = niceStep(Math.max(...series.ys) - Math.min(...series.ys), 5);
  const yMin = Math.floor(Math.min(...series.ys) / yStep) * yStep;
  const yMax = Math.ceil(Math.max(...series.ys) / yStep) * yStep;

  const toX = (x: number): number =>
      margin.left + ((x - xMin) / (xMax - xMin)) * plotW;
  const toY = (y: number): number =>
      margin.top + (1 - (y - yMin) / (yMax - yMin)) * plotH;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.classList.add('hike-profile');

  const el =
      (name: string, attrs: Record<string, string>, textContent?: string):
          SVGElement => {
            const e = document.createElementNS(SVG_NS, name);
            for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
            if (textContent !== undefined) e.textContent = textContent;
            svg.appendChild(e);
            return e;
          };

  // Horizontal gridlines + y labels.
  const yTickFormat = series.yTickFormat ?? ((y: number) => String(y));
  const yTicks = Math.round((yMax - yMin) / yStep);
  for (let i = 0; i <= yTicks; i++) {
    const y = yMin + i * yStep;
    el('line', {
      x1: String(margin.left),
      x2: String(width - margin.right),
      y1: String(toY(y)),
      y2: String(toY(y)),
      class: 'hike-profile-grid',
    });
    el('text', {
      x: String(margin.left - 6),
      y: String(toY(y)),
      class: 'hike-profile-ylabel',
    },
       yTickFormat(y));
  }

  // X ticks + labels.
  const x0 = Math.ceil(xMin / series.xTickStep) * series.xTickStep;
  for (let x = x0; x <= xMax; x += series.xTickStep) {
    el('line', {
      x1: String(toX(x)),
      x2: String(toX(x)),
      y1: String(margin.top),
      y2: String(margin.top + plotH),
      class: 'hike-profile-grid',
    });
    if (x > x0)
      el('text', {
        x: String(toX(x)),
        y: String(margin.top + plotH + 16),
        class: 'hike-profile-xlabel',
      },
         series.xTickFormat(x));
  }
  el('text', {
    x: String(margin.left + plotW / 2),
    y: String(height - 4),
    class: 'hike-profile-xtitle',
  },
     series.xLabel);
  el('text', {
    x: '14',
    y: String(margin.top + plotH / 2),
    transform: `rotate(-90 14 ${margin.top + plotH / 2})`,
    class: 'hike-profile-ytitle',
  },
     series.yLabel);

  // Filled area under the curve, then the curve itself.
  const line =
      series.xs
          .map((x, i) => `${toX(x).toFixed(1)},${toY(series.ys[i]).toFixed(1)}`)
          .join(' ');
  el('polygon', {
    points: `${toX(xMin).toFixed(1)},${toY(yMin).toFixed(1)} ${line} ` +
        `${toX(xMax).toFixed(1)},${toY(yMin).toFixed(1)}`,
    class: 'hike-profile-area',
  });
  el('polyline', {points: line, class: 'hike-profile-line'});

  container.appendChild(svg);
}

function renderProfiles(
    timeDiv: HTMLElement, distanceDiv: HTMLElement, progressDiv: HTMLElement,
    points: TrackPoint[]): void {
  const eles = points.map((p) => p.ele);

  const t0 = points[0].time;
  const minutes = points.map((p) => (p.time - t0) / 60000);
  const formatTime = (m: number): string => {
    const h = Math.floor(m / 60);
    return `${h}:${String(Math.round(m % 60)).padStart(2, '0')}`;
  };
  const formatKm = (d: number): string =>
      d % 1 === 0 ? String(d) : d.toFixed(1);
  const km = cumulativeDistances(points).map((d) => d / 1000);

  renderProfile(timeDiv, {
    xs: minutes,
    ys: eles,
    xTickStep: niceStep(minutes[minutes.length - 1], 6),
    xTickFormat: formatTime,
    xLabel: 'Time (h:mm)',
    yLabel: 'Altitude (masl)',
  });

  renderProfile(distanceDiv, {
    xs: km,
    ys: eles,
    xTickStep: niceStep(km[km.length - 1], 6),
    xTickFormat: formatKm,
    xLabel: 'Distance (km)',
    yLabel: 'Altitude (masl)',
  });

  renderProfile(progressDiv, {
    xs: minutes,
    ys: km,
    xTickStep: niceStep(minutes[minutes.length - 1], 6),
    xTickFormat: formatTime,
    xLabel: 'Time (h:mm)',
    yTickFormat: formatKm,
    yLabel: 'Distance (km)',
  });
}

function main(): void {
  const points = parseTrack('hike-data');
  const {mapDiv, timeDiv, distanceDiv, progressDiv} = insertContainers();
  renderMap(mapDiv, points);
  renderProfiles(timeDiv, distanceDiv, progressDiv, points);
}

main();
