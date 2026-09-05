// hike.ts
//
// Renders a hike page's interactive map (Leaflet + Swisstopo tiles) and two
// altitude profiles (altitude vs. time, altitude vs. distance) from a GPX
// data island (<script type="application/gpx+xml" id="hike-data">).
//
// Page contract: the document must contain the data island and at least two
// <h2> headers; the map and profiles are inserted before the second <h2>.

import * as L from 'leaflet';
import {lineplot, SvgWriter, XYPlot} from 'mini_svg';

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

// Pace in seconds / km.
function secondsPerKm(points: TrackPoint[]): number[] {
  const result = [0];
  for (let i = 1; i < points.length; i++) {
    const distanceKm = points[i].latLng.distanceTo(points[i - 1].latLng) / 1000;
    const timeDistanceSeconds =
        Math.max(0, points[i].time - points[i - 1].time) / 1000;
    if (distanceKm === 0)
      result.push(result[result.length - 1]);
    else
      result.push(timeDistanceSeconds / distanceKm);
  }
  // Repeating the first value is much more useful than inserting a 0.
  result[0] = result[1];
  return result;
}

function smooth(points: number[]) {
  let current = points[0];
  return points.map((p) => {
    current = current * 0.5 + p * 0.5;
    return current;
  });
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
  divId: string;
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

type XAxis = 'time'|'distance';
type YAxis = 'time'|'distance'|'altitude'|'pace';

const X_OPTIONS: ReadonlyArray<[XAxis, string]> = [
  ['time', 'Time'],
  ['distance', 'Distance'],
];

const Y_OPTIONS: ReadonlyArray<[YAxis, string]> = [
  ['time', 'Time'],
  ['distance', 'Distance'],
  ['altitude', 'Altitude'],
  ['pace', 'Pace'],
];

function createSelect<T extends string>(
    labelText: string,
    options: ReadonlyArray<[T, string]>,
    ): {label: HTMLLabelElement; select: HTMLSelectElement} {
  const label = document.createElement('label');
  label.append(`${labelText} `);
  const select = label.appendChild(document.createElement('select'));
  options.forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  });
  return {label, select};
}

function newGraph(containerDiv: HTMLDivElement, points: TrackPoint[]): void {
  const form = containerDiv.appendChild(document.createElement('form'));
  const graph = containerDiv.appendChild(document.createElement('div'));
  graph.classList.add('hike-plot');

  const x = createSelect('X', X_OPTIONS);
  const y = createSelect('Y', Y_OPTIONS);
  form.append(x.label, '\n', y.label);

  const update = () => {
    renderGraphSvg(
        graph, x.select.value as XAxis, y.select.value as YAxis, points);
  };
  form.addEventListener('change', update);
  update();
}

export function renderGraphForm(
    containerDiv: HTMLDivElement, points: TrackPoint[]): void {
  containerDiv
      .appendChild(Object.assign(document.createElement('button'), {
        textContent: 'Additional Graph',
        onclick: (event: MouseEvent) => newGraph(containerDiv, points)
      }))
      .click();
}

function renderGraphSvg(
    graphDiv: HTMLElement, xAxis: XAxis, yAxis: YAxis,
    points: TrackPoint[]): void {
  const t0 = points[0].time;
  const km = cumulativeDistances(points).map((d) => d / 1000);
  const pace = smooth(secondsPerKm(points));

  const xValue = ({
    time: (index: number) => (points[index].time - t0) / 60000,
    distance: (index: number) => km[index],
  } satisfies Record<XAxis, (index: number) => number>)[xAxis];
  const yValue = ({
    time: (index: number) => (points[index].time - t0) / 60000,
    distance: (index: number) => km[index],
    altitude: (index: number) => points[index].ele,
    pace: (index: number) => pace[index]
  } satisfies Record<YAxis, (index: number) => number>)[yAxis];

  const data = {
    [yAxis]: points.map((p, i) => [xValue(i), yValue(i)] as [number, number])
  };
  graphDiv.innerHTML = lineplot(
      new SvgWriter({width: 700, height: 220}), new XYPlot({
        xLabel: xAxis,
        yLabel: yAxis,
        xAxisValues: {
          maxCount: 10,
          // timeFormat: xAxis === 'time' ? {timeStyle: 'short'} : undefined
        },
        yAxisValues: {
          maxCount: 10,
          // timeFormat: yAxis === 'time' ? {timeStyle: 'short'} : undefined
        },
        margins: {top: 12, bottom: 36, left: 60, right: 16}
      }),
      data);
}

function main(): void {
  const points = parseTrack('hike-data');

  const container =
      Object.assign(document.createElement('div'), {id: 'hike-views'});
  const headers = document.getElementsByTagName('h2');
  if (headers.length < 2) {
    throw new Error(
        `hike.js: expected at least two <h2> headers to place ` +
        `the map, found ${headers.length}.`);
  }
  headers[1].before(container);

  renderMap(
      container.appendChild(
          Object.assign(document.createElement('div'), {id: 'hike-map'})),
      points);
  renderGraphForm(container, points);
}

main();
