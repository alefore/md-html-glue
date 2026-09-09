// hike.ts
//
// Renders a hike page's interactive map (Leaflet + Swisstopo tiles) and two
// altitude profiles (altitude vs. time, altitude vs. distance) from a GPX
// data island (<script type="application/gpx+xml" id="hike-data">).
//
// Page contract: the document must contain the data island and at least two
// <h2> headers; the map and profiles are inserted before the second <h2>.

import * as L from 'leaflet';
import {formatDuration, lineplot, SvgWriter, XYPlot} from 'mini_svg';

interface TrackPoint {
  latLng: L.LatLng;
  ele: number;   // meters over sea level
  time: number;  // milliseconds since epoch
}

function interpolate(a: TrackPoint, b: TrackPoint, t: number): TrackPoint {
  const lerp = (x: number, y: number) => x + t * (y - x);
  return {
    latLng: L.latLng(
        lerp(a.latLng.lat, b.latLng.lat), lerp(a.latLng.lng, b.latLng.lng)),
    ele: lerp(a.ele, b.ele),
    time: lerp(a.time, b.time),
  };
}

interface Segment {
  from: TrackPoint;
  to: TrackPoint;
  horizontal: number;  // m
  vertical: number;    // m, signed
  seconds: number;
}

interface Limits {
  jitter: number;    // m; 3D displacement below which a segment is never judged
  maxGrade: number;  // rise/run
  maxSpeed: number;  // m/s, horizontal
  maxVerticalSpeed: number;  // m/s
}

const WALKING: Limits = {
  jitter: 15,
  maxGrade: 1.5,         // ~56°; steeper than any trail or staircase
  maxSpeed: 3.5,         // ~12.6 km/h; a run, not a hike
  maxVerticalSpeed: 0.6  // ~2160 m/h; beyond sustained human ascent
};


function toSegments(points: readonly TrackPoint[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1], to = points[i];
    out.push({
      from,
      to,
      horizontal: from.latLng.distanceTo(to.latLng),
      vertical: to.ele - from.ele,
      seconds: (to.time - from.time) / 1000,
    });
  }
  return out;
}

function onFoot(s: Segment, l: Limits): boolean {
  const rise = Math.abs(s.vertical);
  if (Math.hypot(s.horizontal, rise) < l.jitter) return true;
  const dt = Math.max(s.seconds, 1);
  return rise / Math.max(s.horizontal, 1) <= l.maxGrade &&
      s.horizontal / dt <= l.maxSpeed && rise / dt <= l.maxVerticalSpeed;
}

function sum<T>(items: readonly T[], f: (item: T) => number): number {
  return items.reduce((acc, item) => acc + f(item), 0);
}

class Stats {
  readonly walked: readonly Segment[];
  readonly jumps: readonly Segment[];

  constructor(segments: readonly Segment[], limits: Limits = WALKING) {
    const walked: Segment[] = [];
    const jumps: Segment[] = [];
    segments.forEach((s) => {
      (onFoot(s, limits) ? walked : jumps).push(s);
    });
    this.walked = walked;
    this.jumps = jumps;
  }

  distance2d(): number {
    return sum(this.walked, s => s.horizontal);
  }

  distance3d(): number {
    return sum(this.walked, s => Math.hypot(s.horizontal, s.vertical));
  }

  ascent(): number {
    return sum(this.walked, s => Math.max(s.vertical, 0));
  }

  descent(): number {
    return sum(this.walked, s => Math.max(-s.vertical, 0));
  }

  /** First point to last point, including time spent in jumps. */
  elapsedSeconds(): number {
    return sum(this.walked, s => s.seconds) + sum(this.jumps, s => s.seconds);
  }

  /** Time in on-foot segments at or above minSpeed (m/s). */
  movingSeconds(minSpeed = 0.5): number {
    return sum(
        this.walked.filter(
            s => s.seconds > 0 && s.horizontal / s.seconds >= minSpeed),
        s => s.seconds,
    );
  }

  movingTimePercentage(minSpeed = 0.5): number {
    const elapsed = this.elapsedSeconds();
    if (elapsed === 0) throw new Error('Track has zero duration');
    return 100 * this.movingSeconds(minSpeed) / elapsed;
  }
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

const X_AXES = ['time', 'distance'] as const;
const Y_AXES =
    ['time', 'distance', 'altitude', 'altitudeRelative', 'pace', 'speed'] as
    const;
type XAxis = (typeof X_AXES)[number];
type YAxis = (typeof Y_AXES)[number];

const AXIS_LABELS: Record<string, string> = {
  time: 'Time',
  distance: 'Distance (km)',
  altitude: 'Altitude (masl)',
  altitudeRelative: 'δ Altitude (masl)',
  pace: 'Pace (time/km)',
  speed: 'Speed (km/h)',
};

const getOptions = <T extends string>(axes: ReadonlyArray<T>) =>
    axes.map(axis => [axis, AXIS_LABELS[axis]] as [T, string]);

class DefaultGraphSequence<T> {
  private currentIndex: number = 0;

  constructor(private readonly items: T[]) {
    if (items.length === 0) {
      throw new Error('Sequence must contain at least one item.');
    }
  }

  getNext(): T {
    const item = this.items[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.items.length;
    return item;
  }
}

interface GraphConfig {
  x: XAxis;
  y: YAxis;
}

function createSelect<T extends string>(
    labelText: string, options: ReadonlyArray<[T, string]>,
    initialValue: T): {label: HTMLLabelElement; select: HTMLSelectElement} {
  const label = document.createElement('label');
  label.append(`${labelText} `);
  const select = label.appendChild(document.createElement('select'));
  options.forEach(
      ([value, text]) =>
          select.appendChild(Object.assign(document.createElement('option'), {
            value: value,
            textContent: text,
            selected: value === initialValue
          })));
  return {label, select};
}

function newGraph(
    containerDiv: HTMLDivElement, points: TrackPoint[],
    graphSequence: DefaultGraphSequence<GraphConfig>): void {
  const form = containerDiv.appendChild(document.createElement('form'));
  const graph = containerDiv.appendChild(document.createElement('div'));
  graph.classList.add('hike-plot');

  const config: GraphConfig = graphSequence.getNext();
  const x = createSelect<XAxis>('X', getOptions(X_AXES), config.x);
  const y = createSelect<YAxis>('Y', getOptions(Y_AXES), config.y);
  form.append(x.label, '\n', y.label);

  const update = () => renderGraphSvg(
      graph, x.select.value as XAxis, y.select.value as YAxis, points);
  form.addEventListener('change', update);
  update();
}

export function renderGraphForm(
    containerDiv: HTMLDivElement, points: TrackPoint[]): void {
  const graphDefaults = new DefaultGraphSequence<GraphConfig>([
    {x: 'time', y: 'pace'},
    {x: 'time', y: 'altitude'},
    {x: 'distance', y: 'altitude'},
    {x: 'time', y: 'distance'},
  ]);
  containerDiv.appendChild(
      Object.assign(document.createElement('h3'), {textContent: 'Graphs'}));
  containerDiv
      .appendChild(Object.assign(document.createElement('button'), {
        textContent: 'Additional Graph',
        onclick: (event: MouseEvent) =>
            newGraph(containerDiv, points, graphDefaults)
      }))
      .click();
}

function renderGraphSvg(
    graphDiv: HTMLElement, xAxis: XAxis, yAxis: YAxis,
    points: TrackPoint[]): void {
  const km = cumulativeDistances(points).map((d) => d / 1000);
  const pace = smooth(secondsPerKm(points));

  const accessors = {
    time: (index: number) => points[index].time - points[0].time,
    distance: (index: number) => km[index],
    altitude: (index: number) => points[index].ele,
    altitudeRelative: (index: number) => points[index].ele - points[0].ele,
    pace: (index: number) => 1000 * pace[index],
    speed: (index: number) => (60 * 60) / pace[index],
  } satisfies Record<XAxis|YAxis, (index: number) => number>;
  const xValue = accessors[xAxis];
  const yValue = accessors[yAxis];

  const data = {
    [yAxis]: points.map((p, i) => [xValue(i), yValue(i)] as [number, number])
  };
  const durationAxes = ['time', 'pace'];
  graphDiv.innerHTML = lineplot(
      new SvgWriter({width: 700, height: 220}), new XYPlot({
        xLabel: AXIS_LABELS[xAxis],
        yLabel: AXIS_LABELS[yAxis],
        xAxisValues: {
          maxCount: 10,
          isDuration: durationAxes.includes(xAxis) ? true : undefined
        },
        yAxisValues: {
          maxCount: 10,
          isDuration: durationAxes.includes(yAxis) ? true : undefined
        },
        margins: {top: 12, bottom: 36, left: 90, right: 16}
      }),
      data);
}

const showKm = (value: number): string => {
  return `${(value / 1000).toFixed(1)} km`;
};

function addStats(container: HTMLDivElement, points: TrackPoint[]): void {
  container.appendChild(
      Object.assign(document.createElement('h3'), {textContent: 'Stats'}));
  const statsList = container.appendChild(document.createElement('dl'));
  const totalStats = new Stats(toSegments(points));
  const addStat = (name: string, value: string): void => {
    statsList.append(
        Object.assign(document.createElement('dt'), {textContent: name}),
        Object.assign(document.createElement('dd'), {textContent: value}));
  };
  const showPace = (distanceMeters: number, timeSeconds: number): string => {
    const distanceKm = distanceMeters / 1000;
    return `${formatDuration({
      durationMs: 1000 * timeSeconds / distanceKm
    })}/km (${(distanceKm / (timeSeconds / (60 * 60))).toFixed(1)} km/h)`
  };

  addStat('Start', new Date(points[0].time).toLocaleString());
  const distance3d = totalStats.distance3d();
  addStat(
      'Distance',
      `${showKm(distance3d)}  (2D: ${showKm(totalStats.distance2d())})`);
  const totalTime = totalStats.elapsedSeconds();
  const movingTime = totalStats.movingSeconds();
  addStat('Total time', `${formatDuration({durationMs: 1000 * totalTime})}`);
  addStat('Moving time', `${formatDuration({
            durationMs: 1000 * movingTime
          })} (${(100 * movingTime / totalTime).toFixed(1)}%)`);
  addStat('Speed', showPace(distance3d, totalTime));
  addStat('Moving Speed', showPace(distance3d, movingTime));
  addStat(
      'Elevation',
      `↑${totalStats.ascent().toFixed(0)}m ↓${
          totalStats.descent().toFixed(0)}m`);
}

function splitByDistance(
    points: readonly TrackPoint[],
    meters: number,
    limits: Limits = WALKING,
    ): TrackPoint[][] {
  if (meters <= 0) throw new Error(`Interval must be positive, got ${meters}`);
  const first = points[0];
  if (first === undefined) throw new Error('Empty track');

  const intervals: TrackPoint[][] = [];
  let current: TrackPoint[] = [first];
  let remaining = meters;

  for (const s of toSegments(points)) {
    const h = onFoot(s, limits) ? s.horizontal : 0;
    let covered = 0;  // fraction of `s` already handed out
    while ((1 - covered) * h >= remaining) {
      covered = Math.min(covered + remaining / h, 1);
      const cut = interpolate(s.from, s.to, covered);
      current.push(cut);
      intervals.push(current);
      current = [cut];
      remaining = meters;
    }
    remaining -= (1 - covered) * h;
    if (covered < 1) current.push(s.to);
  }
  if (current.length >= 2) intervals.push(current);
  return intervals;
}

function addIntervals(
    container: HTMLDivElement, points: readonly TrackPoint[]): void {
  container.appendChild(
      Object.assign(document.createElement('h3'), {textContent: 'Intervals'}));
  const table = container.appendChild(Object.assign(
      document.createElement('table'), {classList: 'hike-intervals'}));
  const theadRow = table.appendChild(document.createElement('thead'))
                       .appendChild(document.createElement('tr'));
  const intervals =
      splitByDistance(points, 1000).map(p => new Stats(toSegments(p)));
  const displayMovingPercent =
      intervals.some(s => s.elapsedSeconds() > s.movingSeconds());

  const headers = ['Interval (km)', 'Start', 'Duration', '↑m', '↓m'];
  if (displayMovingPercent) headers.push('Moving');
  headers.forEach(
      (name) => theadRow.appendChild(
          Object.assign(document.createElement('th'), {textContent: name})));

  const tbody = table.appendChild(document.createElement('tbody'));
  intervals.map((stats, index) => {
    const row = tbody.appendChild(document.createElement('tr'));
    const addCell = (value: string): void => {
      row.appendChild(
          Object.assign(document.createElement('td'), {textContent: value}));
    };
    const idTail =
        stats.distance2d() >= 999.99 ? '' : ` (${showKm(stats.distance2d())})`;
    addCell(`${index + 1}${idTail}`);
    addCell(new Date(stats.walked[0].from.time).toLocaleTimeString());
    addCell(formatDuration({durationMs: 1000 * stats.elapsedSeconds()}));
    addCell(`${stats.ascent().toFixed(0)}`);
    addCell(`${stats.descent().toFixed(0)}`);
    if (displayMovingPercent) {
      addCell(`${
          (100 * stats.movingSeconds() / stats.elapsedSeconds()).toFixed(1)}%`);
    }
  });
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

  addStats(container, points);
  addIntervals(container, points);

  container.appendChild(
      Object.assign(document.createElement('h3'), {textContent: 'Map'}));
  renderMap(
      container.appendChild(
          Object.assign(document.createElement('div'), {id: 'hike-map'})),
      points);
  renderGraphForm(container, points);
}

main();
