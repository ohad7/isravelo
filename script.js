let map;
let selectedSegments = [];
let routePolylines = [];
let undoStack = [];
let redoStack = [];
let kmlData = null;

// Save state for undo/redo
function saveState() {
  undoStack.push([...selectedSegments]);
  redoStack = []; // Clear redo stack when new action is performed
  updateUndoRedoButtons();
}

function undo() {
  if (undoStack.length > 0) {
    redoStack.push([...selectedSegments]);
    selectedSegments = undoStack.pop();
    updateSegmentStyles();
    updateRouteListAndDescription();
    updateUndoRedoButtons();
  }
}

function redo() {
  if (redoStack.length > 0) {
    undoStack.push([...selectedSegments]);
    selectedSegments = redoStack.pop();
    updateSegmentStyles();
    updateRouteListAndDescription();
    updateUndoRedoButtons();
  }
}

function updateUndoRedoButtons() {
  document.getElementById('undo-btn').disabled = undoStack.length === 0;
  document.getElementById('redo-btn').disabled = redoStack.length === 0;
}

function updateSegmentStyles() {
  routePolylines.forEach(polylineData => {
    const layerId = polylineData.layerId;
    if (selectedSegments.includes(polylineData.segmentName)) {
      map.setPaintProperty(layerId, 'line-color', '#00ff00');
      map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight + 1);
    } else {
      map.setPaintProperty(layerId, 'line-color', polylineData.originalStyle.color);
      map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight);
    }
  });
}

function initMap() {
  try {
    mapboxgl.accessToken = 'pk.eyJ1Ijoib3NlcmZhdHkiLCJhIjoiY21kNmdzb3NnMDlqZTJrc2NzNmh3aGk1aCJ9.dvA6QY0N5pQ2IISZHp53kg';

    map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [35.6, 33.2], // Centered on the bike routes area
      zoom: 11
    });

    // Set Hebrew language after map loads
    map.on('load', () => {
      map.setLayoutProperty('country-label', 'text-field', [
        'get',
        ['literal', 'name_he'],
        ['literal', 'name']
      ]);
      map.setLayoutProperty('state-label', 'text-field', [
        'get',
        ['literal', 'name_he'],
        ['literal', 'name']
      ]);
      map.setLayoutProperty('settlement-label', 'text-field', [
        'get',
        ['literal', 'name_he'],
        ['literal', 'name']
      ]);
      loadKMLFile();
    });



    // Add global mouse move handler for proximity-based highlighting
    map.on('mousemove', (e) => {
      const mousePoint = e.lngLat;
      const mousePixel = map.project(mousePoint);
      const threshold = 15; // pixels
      let closestSegment = null;
      let minDistance = Infinity;

      // Find closest segment within threshold
      routePolylines.forEach(polylineData => {
        const coords = polylineData.coordinates;
        for (let i = 0; i < coords.length - 1; i++) {
          const startPixel = map.project([coords[i].lng, coords[i].lat]);
          const endPixel = map.project([coords[i + 1].lng, coords[i + 1].lat]);

          const distance = distanceToLineSegmentPixels(
            mousePixel,
            startPixel,
            endPixel
          );

          if (distance < threshold && distance < minDistance) {
            minDistance = distance;
            closestSegment = polylineData;
          }
        }
      });

      // Reset all segments to normal style first
      routePolylines.forEach(polylineData => {
        const layerId = polylineData.layerId;
        if (selectedSegments.includes(polylineData.segmentName)) {
          // Keep selected segments green
          map.setPaintProperty(layerId, 'line-color', '#00ff00');
          map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight + 1);
        } else {
          // Reset non-selected segments to original style
          map.setPaintProperty(layerId, 'line-color', polylineData.originalStyle.color);
          map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight);
        }
      });

      // Highlight closest segment if found
      if (closestSegment) {
        const layerId = closestSegment.layerId;
        map.getCanvas().style.cursor = 'pointer';

        if (!selectedSegments.includes(closestSegment.segmentName)) {
          // Highlight non-selected segment
          map.setPaintProperty(layerId, 'line-color', '#ff6600');
          map.setPaintProperty(layerId, 'line-width', closestSegment.originalStyle.weight + 2);
        } else {
          // Make selected segment more prominent
          map.setPaintProperty(layerId, 'line-color', '#00dd00');
          map.setPaintProperty(layerId, 'line-width', closestSegment.originalStyle.weight + 3);
        }

        // Show segment info
        const name = closestSegment.segmentName;
        let segmentDistance = 0;
        for (let i = 0; i < closestSegment.coordinates.length - 1; i++) {
          segmentDistance += getDistance(closestSegment.coordinates[i], closestSegment.coordinates[i + 1]);
        }
        const segmentDistanceKm = (segmentDistance / 1000).toFixed(1);
        const segmentElevationGain = Math.round(closestSegment.coordinates.length * 0.4);
        const segmentElevationLoss = Math.round(closestSegment.coordinates.length * 0.3);

        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.innerHTML = `<strong>${name}</strong> • 📏 ${segmentDistanceKm} ק"מ • ⬆️ ${segmentElevationGain} מ' • ⬇️ ${segmentElevationLoss} מ'`;
        segmentDisplay.style.display = 'block';
      } else {
        // No segment close enough - reset cursor and hide display
        map.getCanvas().style.cursor = '';
        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.style.display = 'none';
      }
    });

    // Add global click handler for proximity-based selection
    map.on('click', (e) => {
      const clickPoint = e.lngLat;
      const clickPixel = map.project(clickPoint);
      const threshold = 15; // pixels
      let closestSegment = null;
      let minDistance = Infinity;

      // Find closest segment within threshold
      routePolylines.forEach(polylineData => {
        const coords = polylineData.coordinates;
        for (let i = 0; i < coords.length - 1; i++) {
          const startPixel = map.project([coords[i].lng, coords[i].lat]);
          const endPixel = map.project([coords[i + 1].lng, coords[i + 1].lat]);

          const distance = distanceToLineSegmentPixels(
            clickPixel,
            startPixel,
            endPixel
          );

          if (distance < threshold && distance < minDistance) {
            minDistance = distance;
            closestSegment = polylineData;
          }
        }
      });

      // Select/deselect closest segment if found
      if (closestSegment) {
        const name = closestSegment.segmentName;
        const layerId = closestSegment.layerId;

        if (!selectedSegments.includes(name)) {
          saveState();
          selectedSegments.push(name);
          map.setPaintProperty(layerId, 'line-color', '#00ff00');
          map.setPaintProperty(layerId, 'line-width', closestSegment.originalStyle.weight + 1);

          // Smart focusing logic (same as before)
          if (closestSegment.coordinates.length > 0 && selectedSegments.length > 1) {
            const previousSegmentName = selectedSegments[selectedSegments.length - 2];
            const previousPolyline = routePolylines.find(p => p.segmentName === previousSegmentName);

            if (previousPolyline) {
              const prevCoords = previousPolyline.coordinates;
              const prevStart = prevCoords[0];
              const prevEnd = prevCoords[prevCoords.length - 1];

              const currentStart = closestSegment.coordinates[0];
              const currentEnd = closestSegment.coordinates[closestSegment.coordinates.length - 1];

              const prevEndToCurrentStart = getDistance(prevEnd, currentStart);
              const prevEndToCurrentEnd = getDistance(prevEnd, currentEnd);
              const prevStartToCurrentStart = getDistance(prevStart, currentStart);
              const prevStartToCurrentEnd = getDistance(prevStart, currentEnd);

              const minDistance = Math.min(prevEndToCurrentStart, prevEndToCurrentEnd, prevStartToCurrentStart, prevStartToCurrentEnd);

              let focusPoint;
              if (minDistance === prevEndToCurrentStart) {
                focusPoint = [currentEnd.lng, currentEnd.lat];
              } else if (minDistance === prevEndToCurrentEnd) {
                focusPoint = [currentStart.lng, currentStart.lat];
              } else if (minDistance === prevStartToCurrentStart) {
                focusPoint = [currentEnd.lng, currentEnd.lat];
              } else {
                focusPoint = [currentStart.lng, currentStart.lat];
              }

              map.panTo(focusPoint, {
                duration: 1000
              });
            }
          }
        } else {
          saveState();
          const index = selectedSegments.indexOf(name);
          selectedSegments.splice(index, 1);
          map.setPaintProperty(layerId, 'line-color', closestSegment.originalStyle.color);
          map.setPaintProperty(layerId, 'line-width', closestSegment.originalStyle.weight);
        }
        updateRouteListAndDescription();
      }
    });

  } catch (error) {
    document.getElementById('error-message').style.display = 'block';
    document.getElementById('error-message').textContent = 'Error loading map: ' + error.message;
  }
}

async function loadKMLFile() {
  try {
    const response = await fetch('./bike_roads_v02.geojson');
    const geoJsonData = await response.json();
    parseGeoJSON(geoJsonData);
  } catch (error) {
    document.getElementById('error-message').style.display = 'block';
    document.getElementById('error-message').textContent = 'Error loading GeoJSON file: ' + error.message;
  }
}

function parseGeoJSON(geoJsonData) {
  try {
    kmlData = JSON.stringify(geoJsonData);

    if (!geoJsonData.features || geoJsonData.features.length === 0) {
      document.getElementById('error-message').style.display = 'block';
      document.getElementById('error-message').textContent = 'No route segments found in the GeoJSON file.';
      return;
    }

    document.getElementById('error-message').style.display = 'none';

    // Clear existing layers and sources
    routePolylines.forEach(polylineData => {
      if (map.getLayer(polylineData.layerId)) {
        map.removeLayer(polylineData.layerId);
      }
      if (map.getSource(polylineData.layerId)) {
        map.removeSource(polylineData.layerId);
      }
    });
    routePolylines = [];

    let bounds = new mapboxgl.LngLatBounds();

    geoJsonData.features.forEach(feature => {
      if (feature.geometry.type !== 'LineString') return;

      const name = feature.properties.name || 'Unnamed Route';
      const coordinates = feature.geometry.coordinates;

      // Convert coordinates from [lng, lat] to {lat, lng} objects for distance calculations
      const coordObjects = coordinates.map(coord => ({
        lat: coord[1],
        lng: coord[0]
      }));

      // Extract style information from properties
      let originalColor = feature.properties.stroke || feature.properties['stroke-color'] || '#0288d1';
      let originalWeight = feature.properties['stroke-width'] || 3;
      let originalOpacity = feature.properties['stroke-opacity'] || 0.8;

      const layerId = `route-${name.replace(/\s+/g, '-').replace(/[^\w-]/g, '')}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Add source and layer to map
      map.addSource(layerId, {
        type: 'geojson',
        data: feature
      });

      map.addLayer({
        id: layerId,
        type: 'line',
        source: layerId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': originalColor,
          'line-width': originalWeight,
          'line-opacity': originalOpacity
        }
      });

      // Store polyline data
      const polylineData = {
        segmentName: name,
        layerId: layerId,
        coordinates: coordObjects,
        originalStyle: {
          color: originalColor,
          weight: originalWeight,
          opacity: originalOpacity
        }
      };
      routePolylines.push(polylineData);

      // Add coordinates to bounds for auto-fitting
      coordinates.forEach(coord => bounds.extend(coord));

      // Add hover effects with segment name display
      map.on('mouseenter', layerId, (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (!selectedSegments.includes(name)) {
          map.setPaintProperty(layerId, 'line-width', originalWeight + 2);
          map.setPaintProperty(layerId, 'line-opacity', 1);
        }

        // Calculate segment details
        let segmentDistance = 0;
        for (let i = 0; i < coordObjects.length - 1; i++) {
          segmentDistance += getDistance(coordObjects[i], coordObjects[i + 1]);
        }
        const segmentDistanceKm = (segmentDistance / 1000).toFixed(1);
        const segmentElevationGain = Math.round(coordObjects.length * 0.4);
        const segmentElevationLoss = Math.round(coordObjects.length * 0.3);

        // Update segment name display with details
        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.innerHTML = `<strong>${name}</strong> • 📏 ${segmentDistanceKm} ק"מ • ⬆️ ${segmentElevationGain} מ' • ⬇️ ${segmentElevationLoss} מ'`;
        segmentDisplay.style.display = 'block';
      });

      // Add hover functionality for selected segments to show distance from start
      map.on('mousemove', layerId, (e) => {
        if (selectedSegments.includes(name)) {
          const hoverPoint = e.lngLat;
          const orderedCoords = getOrderedCoordinates();

          if (orderedCoords.length > 0) {
            // Find the closest point on this specific segment
            let minDistanceToSegment = Infinity;
            let closestPointOnSegment = null;
            let closestSegmentIndex = 0;

            // Find closest point on the current segment
            for (let i = 0; i < coordObjects.length - 1; i++) {
              const segmentStart = coordObjects[i];
              const segmentEnd = coordObjects[i + 1];

              // Calculate closest point on line segment
              const closestPoint = getClosestPointOnLineSegment(
                { lat: hoverPoint.lat, lng: hoverPoint.lng },
                segmentStart,
                segmentEnd
              );

              const distance = getDistance(
                { lat: hoverPoint.lat, lng: hoverPoint.lng },
                closestPoint
              );

              if (distance < minDistanceToSegment) {
                minDistanceToSegment = distance;
                closestPointOnSegment = closestPoint;
                closestSegmentIndex = i;
              }
            }

            if (closestPointOnSegment && minDistanceToSegment < 100) { // 100 meter threshold
              // Calculate distance from start of route to this point
              let distanceFromStart = 0;

              // Add distance from previous segments
              for (let i = 0; i < selectedSegments.length; i++) {
                const segName = selectedSegments[i];
                if (segName === name) break;

                const prevPolyline = routePolylines.find(p => p.segmentName === segName);
                if (prevPolyline) {
                  for (let j = 0; j < prevPolyline.coordinates.length - 1; j++) {
                    distanceFromStart += getDistance(prevPolyline.coordinates[j], prevPolyline.coordinates[j + 1]);
                  }
                }
              }

              // Add distance within current segment up to hover point
              for (let i = 0; i < closestSegmentIndex; i++) {
                distanceFromStart += getDistance(coordObjects[i], coordObjects[i + 1]);
              }

              // Add partial distance to closest point on segment
              const segmentStart = coordObjects[closestSegmentIndex];
              const segmentEnd = coordObjects[closestSegmentIndex + 1];
              const segmentLength = getDistance(segmentStart, segmentEnd);
              const distanceToClosest = getDistance(segmentStart, closestPointOnSegment);
              const ratio = distanceToClosest / segmentLength;

              if (!isNaN(ratio) && ratio >= 0 && ratio <= 1) {
                distanceFromStart += distanceToClosest;
              }

              const distanceKm = (distanceFromStart / 1000).toFixed(1);

              // Show distance in top right display
              const segmentDisplay = document.getElementById('segment-name-display');
              segmentDisplay.innerHTML = `📍 מרחק מההתחלה: ${distanceKm} ק"מ`;
              segmentDisplay.style.display = 'block';

              // Add visible circle marker at closest point
              if (window.hoverMarker) {
                window.hoverMarker.remove();
              }

              const el = document.createElement('div');
              el.className = 'hover-circle';
              el.style.cssText = `
                width: 12px;
                height: 12px;
                background: #ff4444;
                border: 3px solid white;
                border-radius: 50%;
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                cursor: pointer;
              `;

              window.hoverMarker = new mapboxgl.Marker(el)
                .setLngLat([closestPointOnSegment.lng, closestPointOnSegment.lat])
                .addTo(map);
            }
          }
        }
      });

      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
        if (!selectedSegments.includes(name)) {
          map.setPaintProperty(layerId, 'line-width', originalWeight);
          map.setPaintProperty(layerId, 'line-opacity', originalOpacity);
        }

        // Hide segment name display
        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.style.display = 'none';

        // Remove hover marker
        if (window.hoverMarker) {
          window.hoverMarker.remove();
          window.hoverMarker = null;
        }
      });
    });

    // Fit map to show all route segments
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 20 });
    }

  } catch (error) {
    document.getElementById('error-message').style.display = 'block';
    document.getElementById('error-message').textContent = 'Error parsing GeoJSON file: ' + error.message;
  }
}

// Helper function to calculate distance between two points
function getDistance(point1, point2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = point1.lat * Math.PI / 180;
  const φ2 = point2.lat * Math.PI / 180;
  const Δφ = (point2.lat - point1.lat) * Math.PI / 180;
  const Δλ = (point2.lng - point1.lng) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Helper function to calculate distance from point to line segment
function distanceToLineSegment(point, lineStart, lineEnd) {
  const A = point.lng - lineStart.lng;
  const B = point.lat - lineStart.lat;
  const C = lineEnd.lng - lineStart.lng;
  const D = lineEnd.lat - lineStart.lat;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;
  if (param < 0) {
    xx = lineStart.lng;
    yy = lineStart.lat;
  } else if (param > 1) {
    xx = lineEnd.lng;
    yy = lineEnd.lat;
  } else {
    xx = lineStart.lng + param * C;
    yy = lineStart.lat + param * D;
  }

  return getDistance(point, { lat: yy, lng: xx });
}

// Helper function to calculate distance from point to line segment in pixels
function distanceToLineSegmentPixels(point, lineStart, lineEnd) {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;
  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }

  const dx = point.x - xx;
  const dy = point.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

// Helper function to find closest point on line segment
function getClosestPointOnLineSegment(point, lineStart, lineEnd) {
  const A = point.lng - lineStart.lng;
  const B = point.lat - lineStart.lat;
  const C = lineEnd.lng - lineStart.lng;
  const D = lineEnd.lat - lineStart.lat;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;
  if (param < 0) {
    xx = lineStart.lng;
    yy = lineStart.lat;
  } else if (param > 1) {
    xx = lineEnd.lng;
    yy = lineEnd.lat;
  } else {
    xx = lineStart.lng + param * C;
    yy = lineStart.lat + param * D;
  }

  return { lat: yy, lng: xx };
}

// Function to check if route is continuous
function checkRouteContinuity() {
  if (selectedSegments.length <= 1) return true;

  const tolerance = 100; // 100 meters tolerance

  for (let i = 0; i < selectedSegments.length - 1; i++) {
    const currentSegmentName = selectedSegments[i];
    const nextSegmentName = selectedSegments[i + 1];

    const currentPolyline = routePolylines.find(p => p.segmentName === currentSegmentName);
    const nextPolyline = routePolylines.find(p => p.segmentName === nextSegmentName);

    if (!currentPolyline || !nextPolyline) continue;

    const currentCoords = currentPolyline.coordinates;
    const nextCoords = nextPolyline.coordinates;

    // Get endpoints of current segment
    const currentStart = currentCoords[0];
    const currentEnd = currentCoords[currentCoords.length - 1];

    // Get endpoints of next segment
    const nextStart = nextCoords[0];
    const nextEnd = nextCoords[nextCoords.length - 1];

    // Check all possible connections
    const distances = [
      getDistance(currentEnd, nextStart),
      getDistance(currentEnd, nextEnd),
      getDistance(currentStart, nextStart),
      getDistance(currentStart, nextEnd)
    ];

    const minDistance = Math.min(...distances);

    // If minimum distance is greater than tolerance, route is broken
    if (minDistance > tolerance) {
      return false;
    }
  }

  return true;
}

// Function to update route warning visibility
function updateRouteWarning() {
  const routeWarning = document.getElementById('route-warning');
  const isContinuous = checkRouteContinuity();

  if (selectedSegments.length > 1 && !isContinuous) {
    routeWarning.style.display = 'block';
  } else {
    routeWarning.style.display = 'none';
  }
}

// Function to order coordinates based on route connectivity
function getOrderedCoordinates() {
  if (selectedSegments.length === 0) return [];

  let orderedCoords = [];

  for (let i = 0; i < selectedSegments.length; i++) {
    const segmentName = selectedSegments[i];
    const polyline = routePolylines.find(p => p.segmentName === segmentName);

    if (!polyline) continue;

    let coords = [...polyline.coordinates];

    // For the first segment, check if we need to orient it correctly
    if (i === 0) {
      // If there's a second segment, orient the first segment to connect better
      if (selectedSegments.length > 1) {
        const nextSegmentName = selectedSegments[1];
        const nextPolyline = routePolylines.find(p => p.segmentName === nextSegmentName);
        
        if (nextPolyline) {
          const nextCoords = nextPolyline.coordinates;
          const firstStart = coords[0];
          const firstEnd = coords[coords.length - 1];
          const nextStart = nextCoords[0];
          const nextEnd = nextCoords[nextCoords.length - 1];

          // Calculate all possible connection distances
          const distances = [
            getDistance(firstEnd, nextStart),    // first end to next start
            getDistance(firstEnd, nextEnd),      // first end to next end
            getDistance(firstStart, nextStart),  // first start to next start
            getDistance(firstStart, nextEnd)     // first start to next end
          ];

          const minDistance = Math.min(...distances);
          const minIndex = distances.indexOf(minDistance);

          // If the best connection is from first start, reverse the first segment
          if (minIndex === 2 || minIndex === 3) {
            coords.reverse();
          }
        }
      }
      orderedCoords = [...coords];
    } else {
      // For subsequent segments, determine which end connects better
      const lastPoint = orderedCoords[orderedCoords.length - 1];
      const segmentStart = coords[0];
      const segmentEnd = coords[coords.length - 1];

      const distanceToStart = getDistance(lastPoint, segmentStart);
      const distanceToEnd = getDistance(lastPoint, segmentEnd);

      // If the end is closer, reverse the coordinates
      if (distanceToEnd < distanceToStart) {
        coords.reverse();
      }

      // Add coordinates (skip first point to avoid duplication if they're very close)
      const firstPoint = coords[0];
      if (getDistance(lastPoint, firstPoint) > 10) { // 10 meters threshold
        orderedCoords.push(...coords);
      } else {
        orderedCoords.push(...coords.slice(1));
      }
    }
  }

  return orderedCoords;
}

// Function to generate elevation profile
function generateElevationProfile() {
  const orderedCoords = getOrderedCoordinates();
  if (orderedCoords.length === 0) return '';

  let elevationHtml = '<div class="elevation-profile">';
  elevationHtml += '<h4>גרף גובה (Elevation Profile)</h4>';
  elevationHtml += '<div class="elevation-chart" id="elevation-chart" style="position: relative;">';

  const totalDistance = orderedCoords.reduce((total, coord, index) => {
    if (index === 0) return 0;
    return total + getDistance(orderedCoords[index - 1], coord);
  }, 0);

  if (totalDistance === 0) {
    elevationHtml += '</div></div>';
    return elevationHtml;
  }

  // Create continuous elevation profile with interpolation
  const profileWidth = 300; // pixels
  const elevationData = [];
  
  // First, calculate elevation for all coordinates
  const coordsWithElevation = orderedCoords.map((coord, index) => {
    const elevation = 200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50;
    const distance = index === 0 ? 0 : orderedCoords.slice(0, index + 1).reduce((total, c, idx) => {
      if (idx === 0) return 0;
      return total + getDistance(orderedCoords[idx - 1], c);
    }, 0);
    return { ...coord, elevation, distance };
  });

  // Find min/max elevation
  let minElevation = Math.min(...coordsWithElevation.map(c => c.elevation));
  let maxElevation = Math.max(...coordsWithElevation.map(c => c.elevation));
  const elevationRange = maxElevation - minElevation || 100;

  // Create continuous profile by interpolating between points
  for (let x = 0; x <= profileWidth; x++) {
    const distanceAtX = (x / profileWidth) * totalDistance;
    
    // Find the two closest points to interpolate between
    let beforePoint = null;
    let afterPoint = null;
    
    for (let i = 0; i < coordsWithElevation.length - 1; i++) {
      if (coordsWithElevation[i].distance <= distanceAtX && coordsWithElevation[i + 1].distance >= distanceAtX) {
        beforePoint = coordsWithElevation[i];
        afterPoint = coordsWithElevation[i + 1];
        break;
      }
    }
    
    let elevation, coord;
    if (beforePoint && afterPoint && beforePoint !== afterPoint) {
      // Interpolate elevation and coordinates
      const ratio = (distanceAtX - beforePoint.distance) / (afterPoint.distance - beforePoint.distance);
      elevation = beforePoint.elevation + (afterPoint.elevation - beforePoint.elevation) * ratio;
      coord = {
        lat: beforePoint.lat + (afterPoint.lat - beforePoint.lat) * ratio,
        lng: beforePoint.lng + (afterPoint.lng - beforePoint.lng) * ratio
      };
    } else if (beforePoint) {
      elevation = beforePoint.elevation;
      coord = beforePoint;
    } else {
      elevation = coordsWithElevation[0].elevation;
      coord = coordsWithElevation[0];
    }
    
    const heightPercent = Math.max(5, ((elevation - minElevation) / elevationRange) * 80 + 10);
    const distancePercent = (x / profileWidth) * 100;
    
    elevationData.push({
      elevation,
      distance: distanceAtX,
      coord,
      heightPercent,
      distancePercent,
      pixelX: x
    });
  }

  // Create continuous elevation profile using SVG path
  let pathData = '';
  elevationData.forEach((point, index) => {
    const x = point.distancePercent;
    const y = 100 - point.heightPercent; // Flip Y coordinate for SVG
    
    if (index === 0) {
      pathData += `M ${x} ${y}`;
    } else {
      pathData += ` L ${x} ${y}`;
    }
  });
  
  // Close the path to create a filled area
  pathData += ` L 100 100 L 0 100 Z`;

  // Add SVG for continuous elevation profile
  elevationHtml += `
    <svg width="100%" height="100%" style="position: absolute; top: 0; left: 0;">
      <defs>
        <linearGradient id="elevationGradient" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" style="stop-color:#8B4513;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#CD853F;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#F4A460;stop-opacity:1" />
        </linearGradient>
      </defs>
      <path d="${pathData}" fill="url(#elevationGradient)" stroke="#654321" stroke-width="1"/>
    </svg>
  `;

  // Add invisible hover overlay that covers the entire height
  elevationHtml += '<div class="elevation-hover-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; cursor: pointer;"></div>';

  elevationHtml += '</div>';
  elevationHtml += '<div class="elevation-labels">';
  elevationHtml += '<span class="distance-label">0 ק"מ</span>';
  elevationHtml += `<span class="distance-label">${(totalDistance / 1000).toFixed(1)} ק"מ</span>`;
  elevationHtml += '</div>';
  elevationHtml += '</div>';

  // Store elevation data globally for hover functionality
  window.currentElevationData = elevationData;
  window.currentTotalDistance = totalDistance;

  return elevationHtml;
}

function updateRouteListAndDescription() {
  const routeList = document.getElementById('route-list');
  const routeDescription = document.getElementById('route-description');
  const downloadButton = document.getElementById('download-gpx');

  if (selectedSegments.length === 0) {
    routeList.innerHTML = '<p style="color: #666; font-style: italic;">תכננו מסלול על ידי לחיצה על קטע והוספתו למסלול. ליחצו על הסר כדי להסיר קטע ממסלול. בסיום הורידו קובץ GPX כדי להעלות לאפליקציית הניווט שלכם.</p>';
    routeDescription.innerHTML = 'לחץ על קטעי מפה כדי לבנות את המסלול שלך.';
    downloadButton.disabled = true;
    updateRouteWarning();
    return;
  }

  routeList.innerHTML = '';
  selectedSegments.forEach((segmentName, index) => {
    const segmentDiv = document.createElement('div');
    segmentDiv.className = 'segment-item';
    segmentDiv.innerHTML = `
      <span><strong>${index + 1}.</strong> ${segmentName}</span>
      <button class="remove-btn" onclick="removeSegment('${segmentName}')">הסר</button>
    `;

    // Add hover effects for sidebar segments
    segmentDiv.addEventListener('mouseenter', () => {
      const polyline = routePolylines.find(p => p.segmentName === segmentName);
      if (polyline) {
        map.setPaintProperty(polyline.layerId, 'line-color', '#654321');
        map.setPaintProperty(polyline.layerId, 'line-width', polyline.originalStyle.weight + 3);

        // Show segment summary in top right display
        const coordObjects = polyline.coordinates;
        let segmentDistance = 0;
        for (let i = 0; i < coordObjects.length - 1; i++) {
          segmentDistance += getDistance(coordObjects[i], coordObjects[i + 1]);
        }
        const segmentDistanceKm = (segmentDistance / 1000).toFixed(1);
        const segmentElevationGain = Math.round(coordObjects.length * 0.4);
        const segmentElevationLoss = Math.round(coordObjects.length * 0.3);

        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.innerHTML = `<strong>${segmentName}</strong> • 📏 ${segmentDistanceKm} ק"מ • ⬆️ ${segmentElevationGain} מ' • ⬇️ ${segmentElevationLoss} מ'`;
        segmentDisplay.style.display = 'block';
      }
    });

    segmentDiv.addEventListener('mouseleave', () => {
      const polyline = routePolylines.find(p => p.segmentName === segmentName);
      if (polyline) {
        map.setPaintProperty(polyline.layerId, 'line-color', '#00ff00');
        map.setPaintProperty(polyline.layerId, 'line-width', polyline.originalStyle.weight + 1);

        // Hide segment summary display
        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.style.display = 'none';
      }
    });

    routeList.appendChild(segmentDiv);
  });

  // Calculate total distance and elevation changes
  const orderedCoords = getOrderedCoordinates();
  let totalDistance = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;

  for (let i = 0; i < orderedCoords.length - 1; i++) {
    totalDistance += getDistance(orderedCoords[i], orderedCoords[i + 1]);
  }

  // Calculate elevation changes (simulated)
  totalElevationGain = Math.round(orderedCoords.length * 0.4);
  totalElevationLoss = Math.round(orderedCoords.length * 0.3);

  const totalDistanceKm = (totalDistance / 1000).toFixed(1);

  const elevationProfile = generateElevationProfile();

  routeDescription.innerHTML = `
    <strong>📏 מרחק:</strong> ${totalDistanceKm} ק"מ
    <strong>⬆️</strong> ${totalElevationGain} מ'
    <strong>⬇️</strong> ${totalElevationLoss} מ'
    ${elevationProfile}
  `;

  downloadButton.disabled = false;
  updateRouteWarning();

  // Add elevation profile hover functionality after DOM is updated
  setTimeout(() => {
    const elevationOverlay = document.querySelector('.elevation-hover-overlay');
    if (elevationOverlay && window.currentElevationData) {
      elevationOverlay.addEventListener('mousemove', (e) => {
        const rect = elevationOverlay.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const xPercent = (x / rect.width) * 100;
        
        // Find closest elevation data point
        let closestPoint = null;
        let minDistance = Infinity;
        
        window.currentElevationData.forEach(point => {
          const distance = Math.abs(point.distancePercent - xPercent);
          if (distance < minDistance) {
            minDistance = distance;
            closestPoint = point;
          }
        });
        
        if (closestPoint) {
          // Remove existing elevation marker if any
          if (window.elevationMarker) {
            window.elevationMarker.remove();
          }

          // Create red circle marker
          const el = document.createElement('div');
          el.className = 'elevation-marker';
          el.style.cssText = `
            width: 16px;
            height: 16px;
            background: #ff0000;
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 8px rgba(255, 0, 0, 0.6);
            cursor: pointer;
          `;

          window.elevationMarker = new mapboxgl.Marker(el)
            .setLngLat([closestPoint.coord.lng, closestPoint.coord.lat])
            .addTo(map);

          // Update segment display with elevation info
          const segmentDisplay = document.getElementById('segment-name-display');
          segmentDisplay.innerHTML = `📍 מרחק: ${(closestPoint.distance / 1000).toFixed(1)} ק"מ • גובה: ${Math.round(closestPoint.elevation)} מ'`;
          segmentDisplay.style.display = 'block';
        }
      });

      elevationOverlay.addEventListener('mouseleave', () => {
        // Remove elevation marker
        if (window.elevationMarker) {
          window.elevationMarker.remove();
          window.elevationMarker = null;
        }

        // Hide segment display
        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.style.display = 'none';
      });
    }
  }, 100);
}

function removeSegment(segmentName) {
  const index = selectedSegments.indexOf(segmentName);
  if (index > -1) {
    saveState();
    selectedSegments.splice(index, 1);

    // Reset polyline to original style
    const polyline = routePolylines.find(p => p.segmentName === segmentName);
    if (polyline) {
      map.setPaintProperty(polyline.layerId, 'line-color', polyline.originalStyle.color);
      map.setPaintProperty(polyline.layerId, 'line-width', polyline.originalStyle.weight);
    }

    updateSegmentStyles();
    updateRouteListAndDescription();
  }
}

// Search functionality
function searchLocation() {
  const searchInput = document.getElementById('location-search');
  const searchError = document.getElementById('search-error');
  const query = searchInput.value.trim();

  if (!query) {
    searchError.textContent = 'נא להכניס מיקום לחיפוש';
    searchError.style.display = 'block';
    return;
  }

  searchError.style.display = 'none';

  // Use Nominatim (OpenStreetMap) geocoding service
  const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;

  fetch(geocodeUrl)
    .then(response => response.json())
    .then(data => {
      if (data && data.length > 0) {
        const result = data[0];
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);

        // Only pan to the location without showing markers or popups
        const zoomLevel = result.type === 'city' ? 12 :
          result.type === 'town' ? 13 :
            result.type === 'village' ? 14 : 13;

        map.flyTo({
          center: [lon, lat],
          zoom: zoomLevel,
          duration: 1000
        });

        searchInput.value = '';
      } else {
        searchError.textContent = 'מיקום לא נמצא. נא לנסות מונח חיפוש אחר.';
        searchError.style.display = 'block';
      }
    })
    .catch(error => {
      console.error('Search error:', error);
      searchError.textContent = 'שגיאה בחיפוש מיקום. נא לנסות שוב.';
      searchError.style.display = 'block';
    });
}

// Function to scroll to section
function scrollToSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (section) {
    section.scrollIntoView({ behavior: 'smooth' });
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
  // Initialize the map when page loads
  initMap();

  // Download GPX functionality
  document.getElementById('download-gpx').addEventListener('click', () => {
    if (!kmlData) return;

    const orderedCoords = getOrderedCoordinates();

    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BikeRoutePlanner" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <trk>
    <name>מסלול רכיבה מתוכנן</name>
    <trkseg>`;

    orderedCoords.forEach(coord => {
      // Simulate elevation based on coordinate variations (replace with real elevation data if available)
      const elevation = 200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50;
      gpx += `
      <trkpt lat="${coord.lat}" lon="${coord.lng}">
        <ele>${Math.round(elevation)}</ele>
      </trkpt>`;
    });

    gpx += `
    </trkseg>
  </trk>
</gpx>`;

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bike_route.gpx';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Search functionality
  document.getElementById('search-btn').addEventListener('click', searchLocation);
  document.getElementById('location-search').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      searchLocation();
    }
  });

  // Undo/redo buttons
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('redo-btn').addEventListener('click', redo);

  // Legend toggle functionality
  document.getElementById('legend-toggle').addEventListener('click', function() {
    const legendBox = document.getElementById('legend-box');
    const isOpen = legendBox.classList.contains('open');

    if (isOpen) {
      legendBox.classList.remove('open');
      legendBox.classList.add('closed');
    } else {
      legendBox.classList.remove('closed');
      legendBox.classList.add('open');
    }
  });

  // Keyboard shortcuts for undo/redo
  document.addEventListener('keydown', function(e) {
    //console.log('e.ctrlKey:' + e.ctrlKey + ' key:' + e.key)

    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z') {
      e.preventDefault();
      redo();
    }
  });
});