// hike-map.ts
//
// Renders a hike track (GPX <trkpt> entries embedded as a data island)
// on an interactive Leaflet map with Swisstopo tiles.
//
// Dependencies: npm install leaflet && npm install --save-dev @types/leaflet
// Also include Leaflet's CSS in your page:
//   <link rel="stylesheet"
//   href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
//
// Expected HTML:
//   <div id="hike-map" style="height: 480px"></div>
//   <script type="application/gpx+xml" id="hike-data">
//     <trkpt lat="47.2565" lon="9.4109"><ele>1650.2</ele></trkpt>
//     <trkpt lat="47.2569" lon="9.4121"><ele>1662.8</ele></trkpt>
//     ...
//   </script>
//
// Usage:
//   renderHikeMap("hike-map", "hike-data");

import * as L from 'leaflet';

interface TrackPoint {
  lat: number;
  lon: number;
}

function parseTrackPoints(dataIslandId: string): TrackPoint[] {
  const island = document.getElementById(dataIslandId);
  if (island === null)
    throw new Error(`Data island #${dataIslandId} not found.`);

  // Wrap in a root element so the content is valid XML even if it's a bare
  // list of <trkpt> entries (works equally if it's a full GPX document).
  const doc = new DOMParser().parseFromString(
      `<root>${island.textContent}</root>`, 'application/xml');

  return Array.from(doc.getElementsByTagName('trkpt'))
      .map((pt) => ({
             lat: Number(pt.getAttribute('lat')),
             lon: Number(pt.getAttribute('lon')),
           }));
}

function renderHikeMap(mapDivId: string, dataIslandId: string): L.Map {
  const points = parseTrackPoints(dataIslandId);
  if (points.length === 0) throw new Error('No <trkpt> entries found.');

  const map = L.map(mapDivId);

  L.tileLayer(
       'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
       {
         maxZoom: 19,
         attribution:
             '&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a>',
       })
      .addTo(map);

  const latLngs = points.map((p) => L.latLng(p.lat, p.lon));
  const track = L.polyline(latLngs, {color: '#d40000', weight: 3}).addTo(map);

  // Start / end markers.
  L.circleMarker(latLngs[0], {radius: 6, color: '#008000', fillOpacity: 1})
      .addTo(map)
      .bindTooltip('Start');
  L.circleMarker(
       latLngs[latLngs.length - 1],
       {radius: 6, color: '#000000', fillOpacity: 1})
      .addTo(map)
      .bindTooltip('End');

  map.fitBounds(track.getBounds(), {padding: [24, 24]});
  return map;
}

renderHikeMap('hike-map', 'hike-data');
