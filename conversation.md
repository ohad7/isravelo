## create a one HTML page that displays an application that makes it possible to plan a bike route. the possible routes are available in a KML file and the user should be able to see the map, the map will contain all the different road segments available. each road segment will be a separate Placemark in the KML file, when the user clicks a route, it will be added to the list of segments. once the user is ready with all the road segments, the application will generate a description of the route and will give him an option to download a GPX file that describes the route to be used in a navigation app. 

An application that makes it possible to plan a bike route. the possible routes are available in a KML file and the user should be able to see the map, the map will contain all the different road segments available. each road segment will be a separate Placemark in the KML file, when the user clicks a route, it will be added to the list of segments. once the user is ready with all the road segments, the application will generate a description of the route and will give him an option to download a GPX file that describes the route to be used in a navigation app.

```html
<!DOCTYPE html>
<html>
<head>
  <title>Bike Route Planner</title>
  <style>
    #map {
      height: 500px;
      width: 100%;
    }
    #route-list {
      margin-top: 10px;
      border: 1px solid #ccc;
      padding: 10px;
    }
  </style>
</head>
<body>

  <h1>Bike Route Planner</h1>

  <input type="file" id="kml-file" accept=".kml">

  <div id="map"></div>

  <h2>Selected Route Segments</h2>
  <ul id="route-list"></ul>

  <h2>Route Description</h2>
  <div id="route-description"></div>

  <button id="download-gpx" disabled>Download GPX</button>

  <script>
    let map;
    let selectedSegments = [];

    function initMap() {
      map = new google.maps.Map(document.getElementById('map'), {
        center: {lat: -19.257753, lng: 146.823688},
        zoom: 2,
        mapTypeId: 'terrain'
      });
    }

    document.getElementById('kml-file').addEventListener('change', (event) => {
      const file = event.target.files[0];
      const reader = new FileReader();

      reader.onload = (e) => {
        const kmlData = e.target.result;
        const parser = new DOMParser();
        const kml = parser.parseFromString(kmlData, 'application/xml');
        const placemarks = kml.getElementsByTagName('Placemark');

        for (const placemark of placemarks) {
          const name = placemark.getElementsByTagName('name')[0].textContent;
          const coordinatesStr = placemark.getElementsByTagName('coordinates')[0].textContent.trim();
          const coordinates = coordinatesStr.split(/\s+/).map(coordStr => {
            const [lng, lat] = coordStr.split(',').map(parseFloat);
            return {lat, lng};
          });

          const path = new google.maps.Polyline({
            path: coordinates,
            geodesic: true,
            strokeColor: '#FF0000',
            strokeOpacity: 1.0,
            strokeWeight: 2
          });

          path.setMap(map);

          google.maps.event.addListener(path, 'click', () => {
            if (!selectedSegments.includes(name)) {
              selectedSegments.push(name);
              updateRouteListAndDescription();
            }
          });
        }
      };

      reader.readAsText(file);
    });

    function updateRouteListAndDescription() {
      const routeList = document.getElementById('route-list');
      const routeDescription = document.getElementById('route-description');
      const downloadButton = document.getElementById('download-gpx');

      routeList.innerHTML = '';
      selectedSegments.forEach(segmentName => {
        const li = document.createElement('li');
        li.textContent = segmentName;
        routeList.appendChild(li);
      });

      routeDescription.textContent = "Your route consists of the following segments: " + selectedSegments.join(', ');
      downloadButton.disabled = selectedSegments.length === 0;
    }

    document.getElementById('download-gpx').addEventListener('click', () => {
      const kmlFile = document.getElementById('kml-file').files[0];
      const reader = new FileReader();

      reader.onload = (e) => {
        const kmlData = e.target.result;
        const parser = new DOMParser();
        const kml = parser.parseFromString(kmlData, 'application/xml');
        const placemarks = kml.getElementsByTagName('Placemark');

        let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BikeRoutePlanner" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <trk>
    <name>Planned Bike Route</name>
    <trkseg>`;

        selectedSegments.forEach(segmentName => {
          for (const placemark of placemarks) {
            if (placemark.getElementsByTagName('name')[0].textContent === segmentName) {
              const coordinatesStr = placemark.getElementsByTagName('coordinates')[0].textContent.trim();
              const coordinates = coordinatesStr.split(/\s+/);
              coordinates.forEach(coordStr => {
                const [lng, lat] = coordStr.split(',');
                gpx += `
      <trkpt lat="${lat}" lon="${lng}"></trkpt>`;
              });
            }
          }
        });

        gpx += `
    </trkseg>
  </trk>
</gpx>`;

        const blob = new Blob([gpx], {type: 'application/gpx+xml'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bike_route.gpx';
        a.click();
        URL.revokeObjectURL(url);
      };

      reader.readAsText(kmlFile);
    });
  </script>
  <script async defer src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&callback=initMap">
  </script>
</body>
</html>
```