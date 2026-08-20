import * as L from 'leaflet';

function insertMapDiv(): HTMLElement {
  const headers = document.getElementsByTagName('h2');
  if (headers.length < 2) {
    throw new Error(
        `hike.js: expected at least two <h2> headers to place the map, found ${
            headers.length}.`);
  }
  const div = document.createElement('div');
  div.id = 'hike-map';
  headers[1].before(div);
  return div;
}

function parseTrackPoints(dataIslandId: string): L.LatLng[] {
  const island = document.getElementById(dataIslandId);
  if (island === null) {
    throw new Error(
        `hike.js: data island #${dataIslandId} not found ` +
        `(page has scope "hike" but the build emitted no track data).`);
  }
  const text = island.textContent?.trim() ?? '';
  if (text === '') {
    throw new Error(`hike.js: data island ${dataIslandId} is empty`);
  }
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  return Array.from(doc.getElementsByTagName('trkpt'))
      .map(
          (pt) => L.latLng(
              Number(pt.getAttribute('lat')), Number(pt.getAttribute('lon'))));
}

function renderHikeMap(): void {
  const latLngs = parseTrackPoints('hike-data');
  const map = L.map(insertMapDiv());

  L.tileLayer(
       'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
       {
         maxZoom: 19,
         attribution:
             '&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a>'
       })
      .addTo(map);

  const casing =
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
  map.fitBounds(track.getBounds(), {padding: [24, 24]});
}

renderHikeMap();
