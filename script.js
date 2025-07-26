let map;
let selectedSegments = [];
let routePolylines = [];
let undoStack = [];
let redoStack = [];
let kmlData = null;
let segmentsData = null;
let segmentMetrics = {}; // Pre-calculated distance, elevation, and directionality data

const COLORS = {
  WARNING_ORANGE: '#ff9800',
  WARNING_RED: '#f44336',
  SEGMENT_SELECTED: '#006699', // Green for selected segments
  SEGMENT_HOVER: '#666633', // Orange for hovered segments
  SEGMENT_HOVER_SELECTED: '#003399', // Brighter green when hovering over a selected segment
  SEGMENT_SIDEBAR_HOVER: '#666633', // Brown when hovering a segment in the sidebar
  ELEVATION_MARKER: '#ff4444', // Red for the elevation marker
  HIGHLIGHT_WHITE: '#ffffff', // White for highlighting all segments
};

// Function to highlight all segments in white and then return to original colors
function highlightAllSegments() {
  // First phase: highlight all segments in white
  routePolylines.forEach(polylineData => {
    const layerId = polylineData.layerId;
    if (map.getLayer(layerId)) {
      map.setPaintProperty(layerId, 'line-color', COLORS.HIGHLIGHT_WHITE);
      map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight + 2);
    }
  });

  // Second phase: return to original colors after 800ms
  setTimeout(() => {
    routePolylines.forEach(polylineData => {
      const layerId = polylineData.layerId;
      if (map.getLayer(layerId)) {
        if (selectedSegments.includes(polylineData.segmentName)) {
          // Return selected segments to green
          map.setPaintProperty(layerId, 'line-color', COLORS.SEGMENT_SELECTED);
          map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight + 1);
        } else {
          // Return non-selected segments to original style
          map.setPaintProperty(layerId, 'line-color', polylineData.originalStyle.color);
          map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight);
        }
      }
    });
  }, 800);
}

// Save state for undo/redo
function saveState() {
  undoStack.push([...selectedSegments]);
  redoStack = []; // Clear redo stack when new action is performed
  updateUndoRedoButtons();
  clearRouteFromUrl(); // Clear route parameter when making changes
}

function clearRouteFromUrl() {
  const url = new URL(window.location);
  if (url.searchParams.has('route')) {
    url.searchParams.delete('route');
    window.history.replaceState({}, document.title, url.toString());
  }
}

function undo() {
  if (undoStack.length > 0) {
    redoStack.push([...selectedSegments]);
    selectedSegments = undoStack.pop();
    updateSegmentStyles();
    updateRouteListAndDescription();
    updateUndoRedoButtons();
    clearRouteFromUrl(); // Clear route parameter on undo
  }
}

function redo() {
  if (redoStack.length > 0) {
    undoStack.push([...selectedSegments]);
    selectedSegments = redoStack.pop();
    updateSegmentStyles();
    updateRouteListAndDescription();
    updateUndoRedoButtons();
    clearRouteFromUrl(); // Clear route parameter on redo
  }
}

function updateUndoRedoButtons() {
  document.getElementById('undo-btn').disabled = undoStack.length === 0;
  document.getElementById('redo-btn').disabled = redoStack.length === 0;
  document.getElementById('reset-btn').disabled = selectedSegments.length === 0;
}

function resetRoute() {
  // Save current state for potential undo
  if (selectedSegments.length > 0) {
    saveState();
  }

  // Clear selected segments
  selectedSegments = [];

  // Clear undo/redo stacks
  undoStack = [];
  redoStack = [];

  // Reset all segment styles to original
  routePolylines.forEach(polylineData => {
    const layerId = polylineData.layerId;
    map.setPaintProperty(layerId, 'line-color', polylineData.originalStyle.color);
    map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight);
  });

  // Remove any existing markers
  if (window.hoverMarker) {
    window.hoverMarker.remove();
    window.hoverMarker = null;
  }

  if (window.elevationMarker) {
    window.elevationMarker.remove();
    window.elevationMarker = null;
  }

  // Hide segment name display
  const segmentDisplay = document.getElementById('segment-name-display');
  segmentDisplay.style.display = 'none';

  // Update UI
  updateRouteListAndDescription();
  updateUndoRedoButtons();
  clearRouteFromUrl(); // Clear route parameter when resetting
}

function updateSegmentStyles() {
  routePolylines.forEach(polylineData => {
    const layerId = polylineData.layerId;
    // Check if layer exists before trying to set properties
    if (map.getLayer(layerId)) {
      if (selectedSegments.includes(polylineData.segmentName)) {
        map.setPaintProperty(layerId, 'line-color', COLORS.SEGMENT_SELECTED);
        map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight + 1);
      } else {
        map.setPaintProperty(layerId, 'line-color', polylineData.originalStyle.color);
        map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight);
      }
    }
  });
}

function initMap() {
  try {
    mapboxgl.accessToken = 'pk.eyJ1Ijoib3NlcmZhdHkiLCJhIjoiY21kNmdzb3NnMDlqZTJrc2NzNmh3aGk1aCJ9.dvA6QY0N5pQ2IISZHp53kg';

    map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [35.617497, 33.183536], // Centered on the bike routes area
      zoom: 11.5
    });

    // Set Hebrew language after map loads
    map.on('load', () => {
      // Try to set Hebrew labels, but handle errors gracefully
      try {
        const layers = ['country-label', 'state-label', 'settlement-label'];
        layers.forEach(layerId => {
          if (map.getLayer(layerId)) {
            map.setLayoutProperty(layerId, 'text-field', [
              'coalesce',
              ['get', 'name_he'],
              ['get', 'name']
            ]);
          }
        });
      } catch (error) {
        console.warn('Could not set Hebrew labels:', error);
      }
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
          map.setPaintProperty(layerId, 'line-color', COLORS.SEGMENT_SELECTED);
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
          map.setPaintProperty(layerId, 'line-color', COLORS.SEGMENT_HOVER);
          map.setPaintProperty(layerId, 'line-width', closestSegment.originalStyle.weight + 2);
        } else {
          // Make selected segment more prominent
          map.setPaintProperty(layerId, 'line-color', COLORS.SEGMENT_HOVER_SELECTED);
          map.setPaintProperty(layerId, 'line-width', closestSegment.originalStyle.weight + 3);
        }

        // Show segment info using pre-calculated data
        const name = closestSegment.segmentName;
        const metrics = segmentMetrics[name];
        const segmentDistanceKm = metrics ? metrics.distanceKm : '0.0';
        const segmentElevationGain = metrics ? metrics.forward.elevationGain : 0;
        const segmentElevationLoss = metrics ? metrics.forward.elevationLoss : 0;

        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.innerHTML = `<strong>${name}</strong> <br> 📏 ${segmentDistanceKm} ק"מ • ⬆️ ${segmentElevationGain} מ' • ⬇️ ${segmentElevationLoss} מ'`;

        // Check for warnings in segments data and add to segment display
        const segmentInfo = segmentsData[name];
        if (segmentInfo) {
          if (segmentInfo.winter === false) {
            segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_ORANGE}; font-size: 12px; margin-top: 5px;">❄️ מסלול בוצי בחורף</div>`;
          }
          if (segmentInfo.warning) {
            segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_RED}; font-size: 12px; margin-top: 5px;">⚠️ ${segmentInfo.warning}</div>`;
          }
        }

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
          map.setPaintProperty(layerId, 'line-color', COLORS.SEGMENT_SELECTED);
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
          // Segment is already selected - check if we can add it again
          handleSelectedSegmentClick(name);
        }
        updateRouteListAndDescription();
      }
    });

  } catch (error) {
    document.getElementById('error-message').style.display = 'block';
    document.getElementById('error-message').textContent = 'Error loading map: ' + error.message;
  }
}

// Route sharing functions
function encodeRoute(segmentNames) {
  if (!segmentNames || segmentNames.length === 0) return '';

  // Convert segment names to IDs using segments data
  const segmentIds = segmentNames.map(name => {
    const segmentInfo = segmentsData[name];
    return segmentInfo ? segmentInfo.id : 0;
  }).filter(id => id > 0);

  if (segmentIds.length === 0) return '';

  // Create binary data with version byte + segment IDs
  // Need to ensure proper alignment for Uint16Array (2-byte aligned)
  const totalBytes = 2 + segmentIds.length * 2; // 2 bytes for version padding + segment data
  const binaryData = new ArrayBuffer(totalBytes);
  const uint8Array = new Uint8Array(binaryData);

  // Write version as first byte, pad second byte to maintain alignment
  uint8Array[0] = ROUTE_VERSION;
  uint8Array[1] = 0; // Padding byte for alignment

  // Write segment IDs as 16-bit values starting from byte offset 2
  const view = new Uint16Array(binaryData, 2);
  segmentIds.forEach((id, index) => {
    view[index] = id;
  });

  // Convert to base64
  let binaryString = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binaryString += String.fromCharCode(uint8Array[i]);
  }

  return btoa(binaryString);
}

function decodeRoute(routeString) {
  if (!routeString) return [];

  try {
    // Decode from base64
    const binaryString = atob(routeString);
    const binaryData = new ArrayBuffer(binaryString.length);
    const uint8Array = new Uint8Array(binaryData);

    for (let i = 0; i < binaryString.length; i++) {
      uint8Array[i] = binaryString.charCodeAt(i);
    }

    // Check for empty data
    if (binaryData.byteLength === 0) {
      console.warn('Empty route data');
      return [];
    }

    // Read version from first byte
    const version = uint8Array[0];

    if (version !== ROUTE_VERSION) {
      console.warn(`Unsupported route version: ${version}. Expected version ${ROUTE_VERSION}.`);
      return [];
    }

    // Parse segment data (skip version and padding bytes)
    const segmentDataOffset = 2;
    const segmentDataLength = binaryData.byteLength - segmentDataOffset;

    if (segmentDataLength % 2 !== 0) {
      console.warn('Invalid route data: segment data length is not even');
      return [];
    }

    const view = new Uint16Array(binaryData, segmentDataOffset);
    const segmentIds = Array.from(view);

    // Convert IDs back to segment names
    const segmentNames = [];
    for (const segmentName in segmentsData) {
      const segmentInfo = segmentsData[segmentName];
      if (segmentInfo && segmentIds.includes(segmentInfo.id)) {
        const index = segmentIds.indexOf(segmentInfo.id);
        segmentNames[index] = segmentName;
      }
    }

    return segmentNames.filter(name => name); // Remove empty slots
  } catch (error) {
    console.error('Error decoding route:', error);
    return [];
  }
}

function shareRoute() {
  const routeId = encodeRoute(selectedSegments);
  if (!routeId) {
    alert('אין מסלול לשיתוף. בחרו קטעים כדי ליצור מסלול.');
    return;
  }

  const url = new URL(window.location);
  url.searchParams.set('route', routeId);
  const shareUrl = url.toString();

  // Show share modal
  showShareModal(shareUrl);
}

function showResetModal() {
  // Create modal elements
  const modal = document.createElement('div');
  modal.className = 'reset-modal';
  modal.innerHTML = `
    <div class="reset-modal-content">
      <div class="reset-modal-header">
        <h3>🗑️ איפוס מסלול</h3>
      </div>
      <div class="reset-modal-body">
        <p>האם אתה בטוח שברצונך לאפס את המסלול?</p>
        <p class="reset-warning">פעולה זו תמחק את כל הקטעים שנבחרו (${selectedSegments.length} קטעים)</p>
        <div class="reset-modal-buttons">
          <button class="reset-confirm-btn">כן, אפס מסלול</button>
          <button class="reset-cancel-btn">ביטול</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners
  const confirmBtn = modal.querySelector('.reset-confirm-btn');
  const cancelBtn = modal.querySelector('.reset-cancel-btn');

  confirmBtn.addEventListener('click', () => {
    resetRoute();
    document.body.removeChild(modal);
  });

  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  // Add escape key listener
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      document.body.removeChild(modal);
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

function showShareModal(shareUrl) {
  // Create modal elements
  const modal = document.createElement('div');
  modal.className = 'share-modal';
  modal.innerHTML = `
    <div class="share-modal-content">
      <div class="share-modal-header">
        <h3>שיתוף המסלול</h3>
        <button class="share-modal-close">&times;</button>
      </div>
      <div class="share-modal-body">
        <div class="share-url-container">
          <input type="text" class="share-url-input" value="${shareUrl}" readonly>
          <button class="copy-url-btn">העתק קישור</button>
        </div>
        <div class="share-buttons">
          <button class="share-btn-social twitter" onclick="shareToTwitter('${encodeURIComponent(shareUrl)}')">
            🐦 Twitter
          </button>
          <button class="share-btn-social facebook" onclick="shareToFacebook('${encodeURIComponent(shareUrl)}')">
            📘 Facebook
          </button>
          <button class="share-btn-social whatsapp" onclick="shareToWhatsApp('${encodeURIComponent(shareUrl)}')">
            💬 WhatsApp
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners
  const closeBtn = modal.querySelector('.share-modal-close');
  const copyBtn = modal.querySelector('.copy-url-btn');
  const urlInput = modal.querySelector('.share-url-input');

  closeBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  copyBtn.addEventListener('click', () => {
    urlInput.select();
    navigator.clipboard.writeText(shareUrl).then(() => {
      copyBtn.textContent = 'הועתק!';
      copyBtn.style.background = '#4CAF50';
      setTimeout(() => {
        copyBtn.textContent = 'העתק קישור';
        copyBtn.style.background = '#4682B4';
      }, 2000);
    }).catch(() => {
      document.execCommand('copy');
      copyBtn.textContent = 'הועתק!';
      copyBtn.style.background = '#4CAF50';
      setTimeout(() => {
        copyBtn.textContent = 'העתק קישור';
        copyBtn.style.background = '#4682B4';
      }, 2000);
    });
  });
}

function shareToTwitter(url) {
  const text = 'בדקו את מסלול הרכיבה שיצרתי במפת שבילי אופניים - גליל עליון וגולן!';
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${url}`, '_blank');
}

function shareToFacebook(url) {
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank');
}

function shareToWhatsApp(url) {
  const text = 'בדקו את מסלול הרכיבה שיצרתי במפת שבילי אופניים - גליל עליון וגולן!';
  window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + decodeURIComponent(url))}`, '_blank');
}

function getRouteParameter() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('route');
}

function loadRouteFromUrl() {
  const routeParam = getRouteParameter();

  if (routeParam && segmentsData) {

    const decodedSegments = decodeRoute(routeParam);
    if (decodedSegments.length > 0) {
      selectedSegments = decodedSegments;
      // Wait a bit for map to be fully loaded before updating styles
      setTimeout(() => {
        updateSegmentStyles();
        updateRouteListAndDescription();
        hideRouteLoadingIndicator();
      }, 500);

      return true;
    } else {
      hideRouteLoadingIndicator();
    }
  }
  return false;
}

function showRouteLoadingIndicator() {
  const routeParam = getRouteParameter();

  if (!routeParam || !segmentsData) {
    return;
  }

  // Remove existing indicator if any
  const existing = document.getElementById('route-loading-indicator');
  if (existing) {
    existing.remove();
  }

  const indicator = document.createElement('div');
  indicator.id = 'route-loading-indicator';
  indicator.className = 'route-loading';
  indicator.innerHTML = '⏳ טוען מסלול...';

  const legendContainer = document.querySelector('.legend-container');
  legendContainer.appendChild(indicator);
}

function hideRouteLoadingIndicator() {
  const indicator = document.getElementById('route-loading-indicator');
  if (indicator) {
    indicator.remove();
  }
}

async function loadSegmentsData() {
  try {
    const response = await fetch('./segments.json');
    segmentsData = await response.json();
  } catch (error) {
    console.warn('Could not load segments.json:', error);
    segmentsData = {};
  }
}

async function loadKMLFile() {
  try {
    await loadSegmentsData();
    showRouteLoadingIndicator();
    const response = await fetch('./bike_roads_v09.geojson');
    const geoJsonData = await response.json();
    parseGeoJSON(geoJsonData);

    // Try to load route from URL after everything is loaded
    setTimeout(() => {
      loadRouteFromUrl();
      
      // Initialize tutorial after everything is loaded
      if (typeof initTutorial === 'function') {
        initTutorial();
      }
    }, 1000);
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

      // Convert coordinates from [lng, lat, elevation] to {lat, lng, elevation} objects
      const coordObjects = coordinates.map(coord => ({
        lat: coord[1],
        lng: coord[0],
        elevation: coord[2] // Preserve elevation data if available
      }));

      // Extract style information from properties
      let originalColor = feature.properties.stroke || feature.properties['stroke-color'] || '#0288d1';

      // Convert colors according to specification
      if (originalColor === '#0288d1' || originalColor === 'rgb(2, 136, 209)') {
        originalColor = 'rgb(101, 170, 162)';
      } else if (originalColor == '#e6ee9c' || originalColor === 'rgb(230, 238, 156)') {
        originalColor = 'rgb(138, 147, 158)';
      } else {
        originalColor = 'rgb(174, 144, 103)';
      }

      // temporarily overriding weight and opacity:
      //let originalWeight = feature.properties['stroke-width'] || 3;
      //let originalOpacity = feature.properties['stroke-opacity'] || 0.8;
      let originalWeight = 3;
      let originalOpacity = 1.0;

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

        // Get pre-calculated segment metrics
        const metrics = segmentMetrics[name];
        const segmentDistanceKm = metrics ? metrics.distanceKm : '0.0';
        const segmentElevationGain = metrics ? metrics.forward.elevationGain : 0;
        const segmentElevationLoss = metrics ? metrics.forward.elevationLoss : 0;

        // Update segment name display with details
        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.innerHTML = `<strong>${name}</strong> <br> 📏 ${segmentDistanceKm} ק"מ • ⬆️ ${segmentElevationGain} מ' • ⬇️ ${segmentElevationLoss} מ'`;
        segmentDisplay.style.display = 'block';

        // Check for warnings in segments data and add to segment display
        const segmentInfo = segmentsData[name];
        if (segmentInfo) {
          if (segmentInfo.winter === false) {
            segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_ORANGE}; font-size: 12px; margin-top: 5px;">❄️ מסלול בוצי בחורף</div>`;
          }
          if (segmentInfo.warning) {
            segmentDisplay.innerHTML += `<div style="color: ${COLORS.WARNING_RED}; font-size: 12px; margin-top: 5px;">⚠️ ${segmentInfo.warning}</div>`;
          }
        }
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
                background: ${COLORS.ELEVATION_MARKER};
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
          window.hoverMarker.remove(); window.hoverMarker = null;
        }
      });
    });

    // Pre-calculate all segment metrics for fast access
    preCalculateSegmentMetrics();

    // Keep map at current position instead of auto-fitting to all segments
    // if (!bounds.isEmpty()) {
    //   map.fitBounds(bounds, { padding: 20 });
    // }

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

// Function to smooth elevation values using distance-based window smoothing
function smoothElevations(coords, distanceWindow = 100) {
  if (coords.length === 0) {
    return coords;
  }

  // Ensure all coordinates have elevation values
  const coordsWithElevation = coords.map(coord => {
    let elevation;
    if (coord.elevation !== undefined) {
      elevation = coord.elevation;
    } else {
      // Fallback calculation if elevation is not available
      elevation = 200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50;
    }
    return {
      lat: coord.lat,
      lng: coord.lng,
      elevation: elevation
    };
  });

  // Apply distance-based window smoothing
  const smoothedElevations = distanceWindowSmoothing(
    coordsWithElevation,
    distanceWindow,
    (index) => coordsWithElevation[index].elevation,
    (accumulated, start, end) => accumulated / (end - start + 1)
  );

  // Preserve original first and last elevations
  if (coordsWithElevation.length > 0) {
    smoothedElevations[0] = coordsWithElevation[0].elevation;
    smoothedElevations[coordsWithElevation.length - 1] = coordsWithElevation[coordsWithElevation.length - 1].elevation;
  }

  // Create smoothed coordinate objects
  const smoothed = coordsWithElevation.map((coord, index) => ({
    lat: coord.lat,
    lng: coord.lng,
    elevation: smoothedElevations[index]
  }));

  return smoothed;
}

// Distance-based window smoothing algorithm
function distanceWindowSmoothing(
  points,
  distanceWindow,
  accumulate,
  compute,
  remove = null
) {
  let result = [];

  let start = 0,
    end = 0,
    accumulated = 0;

  for (let i = 0; i < points.length; i++) {
    // Remove points that are too far behind
    while (
      start + 1 < i &&
      getDistance(points[start], points[i]) > distanceWindow
    ) {
      if (remove) {
        accumulated -= remove(start);
      } else {
        accumulated -= accumulate(start);
      }
      start++;
    }

    // Add points that are within distance ahead
    while (
      end < points.length &&
      getDistance(points[i], points[end]) <= distanceWindow
    ) {
      accumulated += accumulate(end);
      end++;
    }

    result[i] = compute(accumulated, start, end - 1);
  }

  return result;
}

// Pre-calculate all segment metrics for fast access
function preCalculateSegmentMetrics() {
  segmentMetrics = {};

  routePolylines.forEach(polylineData => {
    const coords = polylineData.coordinates;
    const segmentName = polylineData.segmentName;

    // Calculate distance
    let distance = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      distance += getDistance(coords[i], coords[i + 1]);
    }

    // Apply elevation smoothing before calculating gains/losses
    const smoothedCoords = smoothElevations(coords, 100);

    // Calculate elevation gains and losses in both directions using smoothed data
    let elevationGainForward = 0;
    let elevationLossForward = 0;
    let elevationGainReverse = 0;
    let elevationLossReverse = 0;

    // Forward direction using smoothed elevations with minimum threshold
    const minElevationChange = 1.0; // Ignore elevation changes smaller than 1 meter

    for (let i = 0; i < smoothedCoords.length - 1; i++) {
      const currentElevation = smoothedCoords[i].elevation;
      const nextElevation = smoothedCoords[i + 1].elevation;

      const elevationChange = nextElevation - currentElevation;

      // Only count elevation changes that meet the minimum threshold
      if (Math.abs(elevationChange) >= minElevationChange) {
        if (elevationChange > 0) {
          elevationGainForward += elevationChange;
        } else {
          elevationLossForward += Math.abs(elevationChange);
        }
      }
    }

    // Reverse direction (just swap the gains and losses)
    elevationGainReverse = elevationLossForward;
    elevationLossReverse = elevationGainForward;

    // Store pre-calculated metrics
    segmentMetrics[segmentName] = {
      distance: distance,
      distanceKm: (distance / 1000).toFixed(1),
      forward: {
        elevationGain: Math.round(elevationGainForward),
        elevationLoss: Math.round(elevationLossForward)
      },
      reverse: {
        elevationGain: Math.round(elevationGainReverse),
        elevationLoss: Math.round(elevationLossReverse)
      },
      startPoint: coords[0],
      endPoint: coords[coords.length - 1],
      smoothedCoords: smoothedCoords // Store smoothed coordinates for elevation profile
    };
  });
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

// Function to check if route is continuous and find first broken segment
function checkRouteContinuity() {
  if (selectedSegments.length <= 1) return { isContinuous: true, brokenSegmentIndex: -1 };

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
      return { isContinuous: false, brokenSegmentIndex: i };
    }
  }

  return { isContinuous: true, brokenSegmentIndex: -1 };
}

// Function to check if any selected segments have winter warning and find first one
function hasWinterSegments() {
  for (let i = 0; i < selectedSegments.length; i++) {
    const segmentInfo = segmentsData[selectedSegments[i]];
    if (segmentInfo && segmentInfo.winter === false) {
      return { hasWinter: true, firstWinterSegment: selectedSegments[i] };
    }
  }
  return { hasWinter: false, firstWinterSegment: null };
}

// Function to check if any selected segments have warnings and find first one
function hasSegmentWarnings() {
  for (let i = 0; i < selectedSegments.length; i++) {
    const segmentInfo = segmentsData[selectedSegments[i]];
    if (segmentInfo && segmentInfo.warning) {
      return { hasWarnings: true, firstWarningSegment: selectedSegments[i] };
    }
  }
  return { hasWarnings: false, firstWarningSegment: null };
}

// Function to update route warning visibility
function updateRouteWarning() {
  const routeWarning = document.getElementById('route-warning');
  const winterWarning = document.getElementById('winter-warning');
  const segmentWarning = document.getElementById('segment-warning');

  const continuityResult = checkRouteContinuity();
  const winterResult = hasWinterSegments();
  const warningsResult = hasSegmentWarnings();

  // Show broken route warning
  if (selectedSegments.length > 1 && !continuityResult.isContinuous) {
    routeWarning.style.display = 'block';
  } else {
    routeWarning.style.display = 'none';
  }

  // Show winter warning
  if (winterResult.hasWinter) {
    winterWarning.style.display = 'block';
  } else {
    winterWarning.style.display = 'none';
  }

  // Show segment warnings indicator
  if (warningsResult.hasWarnings) {
    segmentWarning.style.display = 'block';
  } else {
    segmentWarning.style.display = 'none';
  }
}

// Function to handle clicking on an already selected segment
function handleSelectedSegmentClick(segmentName) {
  if (selectedSegments.length === 0) return;

  // Check if this segment can be added again at the end of the route
  const canAddAgain = canSegmentBeAddedAgain(segmentName);
  
  if (canAddAgain) {
    // Show confirmation dialog
    showSegmentActionDialog(segmentName);
  } else {
    // Just remove the segment if it can't be added again
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
      clearRouteFromUrl();
    }
  }
}

// Function to check if a segment can be added again at the end of the route
function canSegmentBeAddedAgain(segmentName) {
  if (selectedSegments.length === 0) return false;

  const lastSegmentName = selectedSegments[selectedSegments.length - 1];
  const lastPolyline = routePolylines.find(p => p.segmentName === lastSegmentName);
  const targetPolyline = routePolylines.find(p => p.segmentName === segmentName);

  if (!lastPolyline || !targetPolyline) return false;

  // Get the actual end point of the current route considering directionality
  const routeEndPoint = getRouteEndPoint();
  if (!routeEndPoint) return false;

  // Check distance to both ends of the target segment
  const targetCoords = targetPolyline.coordinates;
  const targetStart = targetCoords[0];
  const targetEnd = targetCoords[targetCoords.length - 1];

  const distanceToStart = getDistance(routeEndPoint, targetStart);
  const distanceToEnd = getDistance(routeEndPoint, targetEnd);
  const tolerance = 100; // 100 meters tolerance

  return Math.min(distanceToStart, distanceToEnd) <= tolerance;
}

// Helper function to get the actual end point of the current route considering directionality
function getRouteEndPoint() {
  if (selectedSegments.length === 0) return null;

  const orderedCoords = getOrderedCoordinates();
  if (orderedCoords.length === 0) return null;

  return orderedCoords[orderedCoords.length - 1];
}

// Function to show segment action dialog
function showSegmentActionDialog(segmentName) {
  const modal = document.createElement('div');
  modal.className = 'segment-action-modal';
  modal.innerHTML = `
    <div class="segment-action-modal-content">
      <div class="segment-action-modal-header">
        <h3>פעולה על הקטע</h3>
      </div>
      <div class="segment-action-modal-body">
        <p>הקטע "<strong>${segmentName}</strong>" כבר נמצא במסלול.</p>
        <p>מה ברצונך לעשות?</p>
        <div class="segment-action-buttons">
          <button class="segment-action-btn add-again-btn">🔄 הוסף שוב לסוף המסלול</button>
          <button class="segment-action-btn remove-btn">🗑️ הסר מהמסלול</button>
          <button class="segment-action-btn cancel-btn">✖️ ביטול</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners
  const addAgainBtn = modal.querySelector('.add-again-btn');
  const removeBtn = modal.querySelector('.remove-btn');
  const cancelBtn = modal.querySelector('.cancel-btn');

  addAgainBtn.addEventListener('click', () => {
    saveState();
    selectedSegments.push(segmentName);
    updateSegmentStyles();
    updateRouteListAndDescription();
    clearRouteFromUrl();
    document.body.removeChild(modal);
  });

  removeBtn.addEventListener('click', () => {
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
      clearRouteFromUrl();
    }
    document.body.removeChild(modal);
  });

  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  // Add escape key listener
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      document.body.removeChild(modal);
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

// Function to focus map on a specific segment
function focusOnSegment(segmentName) {
  const polyline = routePolylines.find(p => p.segmentName === segmentName);
  if (!polyline) return;

  const coords = polyline.coordinates;
  if (coords.length === 0) return;

  // Calculate bounds for the segment
  let minLat = coords[0].lat, maxLat = coords[0].lat;
  let minLng = coords[0].lng, maxLng = coords[0].lng;

  coords.forEach(coord => {
    minLat = Math.min(minLat, coord.lat);
    maxLat = Math.max(maxLat, coord.lat);
    minLng = Math.min(minLng, coord.lng);
    maxLng = Math.max(maxLng, coord.lng);
  });

  // Add some padding around the segment
  const latPadding = (maxLat - minLat) * 0.2 || 0.01;
  const lngPadding = (maxLng - minLng) * 0.2 || 0.01;

  const bounds = new mapboxgl.LngLatBounds(
    [minLng - lngPadding, minLat - latPadding],
    [maxLng + lngPadding, maxLat + latPadding]
  );

  map.fitBounds(bounds, {
    padding: 50,
    duration: 1000
  });

  // Temporarily highlight the segment
  const layerId = polyline.layerId;
  const originalColor = map.getPaintProperty(layerId, 'line-color');
  const originalWidth = map.getPaintProperty(layerId, 'line-width');

  map.setPaintProperty(layerId, 'line-color', '#ff0000');
  map.setPaintProperty(layerId, 'line-width', originalWidth + 3);

  // Reset after 2 seconds
  setTimeout(() => {
    if (selectedSegments.includes(segmentName)) {
      map.setPaintProperty(layerId, 'line-color', COLORS.SEGMENT_SELECTED);
      map.setPaintProperty(layerId, 'line-width', polyline.originalStyle.weight + 1);
    } else {
      map.setPaintProperty(layerId, 'line-color', polyline.originalStyle.color);
      map.setPaintProperty(layerId, 'line-width', polyline.originalStyle.weight);
    }
  }, 2000);
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

  // First, apply smoothing to the entire route coordinates and calculate elevation for all coordinates
  const routeWithElevation = orderedCoords.map(coord => {
    let elevation;
    if (coord.elevation !== undefined) {
      elevation = coord.elevation;
    } else {
      // Fallback: calculate elevation based on position (simulated)
      elevation = 200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50;
    }
    return { ...coord, elevation };
  });

  // Apply smoothing to the entire route
  const smoothedRouteCoords = smoothElevations(routeWithElevation, 100); // Slightly larger window for route-level smoothing

  const coordsWithElevation = smoothedRouteCoords.map((coord, index) => {
    const distance = index === 0 ? 0 : smoothedRouteCoords.slice(0, index + 1).reduce((total, c, idx) => {
      if (idx === 0) return 0;
      return total + getDistance(smoothedRouteCoords[idx - 1], c);
    }, 0);
    return { ...coord, distance };
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

  // Add SVG for continuous elevation profile with proper viewBox
  elevationHtml += `
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style="position: absolute; top: 0; left: 0;">
      <defs>
        <linearGradient id="elevationGradient" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" style="stop-color:#748873;stop-opacity:1" />
          <stop offset="33%" style="stop-color:#D1A980;stop-opacity:1" />
          <stop offset="66%" style="stop-color:#E5E0D8;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#F8F8F8;stop-opacity:1" />
        </linearGradient>
      </defs>
      <path d="${pathData}" fill="url(#elevationGradient)" stroke="#748873" stroke-width="0.5"/>
    </svg>
  `;

  // Add invisible hover overlay that covers the entire height
  elevationHtml += '<div class="elevation-hover-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; cursor: pointer;"></div>';

  elevationHtml += '</div>';
  elevationHtml += '<div class="elevation-labels">';
  elevationHtml += `<span class="distance-label">${(totalDistance / 1000).toFixed(1)} ק"מ</span>`;
  elevationHtml += '<span class="distance-label">0 ק"מ</span>';
  elevationHtml += '</div>';
  elevationHtml += '</div>';

  // Store elevation data globally for hover functionality
  window.currentElevationData = elevationData;
  window.currentTotalDistance = totalDistance;

  return elevationHtml;
}

function updateRouteListAndDescription() {
  const routeDescription = document.getElementById('route-description');
  const downloadButton = document.getElementById('download-gpx');

  if (selectedSegments.length === 0) {
    routeDescription.innerHTML = 'לחץ על קטעי מפה כדי לבנות את המסלול שלך.';
    downloadButton.disabled = true;
    updateRouteWarning();
    updateUndoRedoButtons(); // Update reset button state
    return;
  }

  // Calculate total distance using pre-calculated data
  let totalDistance = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;

  selectedSegments.forEach(segmentName => {
    const metrics = segmentMetrics[segmentName];
    if (metrics) {
      totalDistance += metrics.distance;
    }
  });

  // Calculate elevation changes using pre-calculated data and smart directionality
  totalElevationGain = 0;
  totalElevationLoss = 0;

  // Determine directionality for each segment and use pre-calculated elevation data
  for (let segIndex = 0; segIndex < selectedSegments.length; segIndex++) {
    const segmentName = selectedSegments[segIndex];
    const metrics = segmentMetrics[segmentName];

    if (!metrics) continue;

    let isReversed = false;

    // Determine if this segment needs to be reversed based on connectivity
    if (segIndex > 0) {
      // Get connection info from previous segment
      const prevSegmentName = selectedSegments[segIndex - 1];
      const prevMetrics = segmentMetrics[prevSegmentName];

      if (prevMetrics) {
        // Use pre-calculated endpoints to determine connectivity
        const prevStart = prevMetrics.startPoint;
        const prevEnd = prevMetrics.endPoint;
        const currentStart = metrics.startPoint;
        const currentEnd = metrics.endPoint;

        // Check which connection makes more sense based on previous segment's orientation
        let prevLastPoint;
        if (segIndex === 1) {
          // For the first connection, determine previous segment's orientation
          if (selectedSegments.length > 1) {
            const nextSegmentName = selectedSegments[1];
            const nextMetrics = segmentMetrics[nextSegmentName];

            if (nextMetrics) {
              const distances = [
                getDistance(prevEnd, currentStart),
                getDistance(prevEnd, currentEnd),
                getDistance(prevStart, currentStart),
                getDistance(prevStart, currentEnd)
              ];

              const minIndex = distances.indexOf(Math.min(...distances));
              prevLastPoint = (minIndex === 2 || minIndex === 3) ? prevStart : prevEnd;
            } else {
              prevLastPoint = prevEnd;
            }
          } else {
            prevLastPoint = prevEnd;
          }
        } else {
          // For subsequent segments, assume the previous one ended correctly
          prevLastPoint = prevEnd; // This would need to be tracked better, but simplified for now
        }

        const distanceToStart = getDistance(prevLastPoint, currentStart);
        const distanceToEnd = getDistance(prevLastPoint, currentEnd);

        isReversed = distanceToEnd < distanceToStart;
      }
    } else if (selectedSegments.length > 1) {
      // For first segment, check orientation with second segment
      const nextSegmentName = selectedSegments[1];
      const nextMetrics = segmentMetrics[nextSegmentName];

      if (nextMetrics) {
        const firstStart = metrics.startPoint;
        const firstEnd = metrics.endPoint;
        const nextStart = nextMetrics.startPoint;
        const nextEnd = nextMetrics.endPoint;

        const distances = [
          getDistance(firstEnd, nextStart),
          getDistance(firstEnd, nextEnd),
          getDistance(firstStart, nextStart),
          getDistance(firstStart, nextEnd)
        ];

        const minIndex = distances.indexOf(Math.min(...distances));
        isReversed = (minIndex === 2 || minIndex === 3);
      }
    }

    // Use pre-calculated elevation data based on direction
    if (isReversed) {
      totalElevationGain += metrics.reverse.elevationGain;
      totalElevationLoss += metrics.reverse.elevationLoss;
    } else {
      totalElevationGain += metrics.forward.elevationGain;
      totalElevationLoss += metrics.forward.elevationLoss;
    }
  }

  totalElevationGain = Math.round(totalElevationGain);
  totalElevationLoss = Math.round(totalElevationLoss);

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
  updateUndoRedoButtons(); // Update reset button state

  // Add elevation profile hover functionality after DOM is updated
  setTimeout(() => {
    const elevationOverlay = document.querySelector('.elevation-hover-overlay');
    if (elevationOverlay && window.currentElevationData) {
      
      // Common function to handle both mouse and touch events
      const handleElevationInteraction = (clientX) => {
        const rect = elevationOverlay.getBoundingClientRect();
        const x = clientX - rect.left;
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
            background: ${COLORS.ELEVATION_MARKER};
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
      };

      const handleElevationLeave = () => {
        // Remove elevation marker
        if (window.elevationMarker) {
          window.elevationMarker.remove();
          window.elevationMarker = null;
        }

        // Hide segment display
        const segmentDisplay = document.getElementById('segment-name-display');
        segmentDisplay.style.display = 'none';
      };

      // Mouse events for desktop
      elevationOverlay.addEventListener('mousemove', (e) => {
        handleElevationInteraction(e.clientX);
      });

      elevationOverlay.addEventListener('mouseleave', handleElevationLeave);

      // Touch events for mobile
      elevationOverlay.addEventListener('touchstart', (e) => {
        e.preventDefault(); // Prevent scrolling
        const touch = e.touches[0];
        handleElevationInteraction(touch.clientX);
      });

      elevationOverlay.addEventListener('touchmove', (e) => {
        e.preventDefault(); // Prevent scrolling
        const touch = e.touches[0];
        handleElevationInteraction(touch.clientX);
      });

      elevationOverlay.addEventListener('touchend', (e) => {
        e.preventDefault();
        // Don't hide immediately on touch end to allow viewing
        // Instead, hide after a delay
        setTimeout(handleElevationLeave, 2000);
      });

      elevationOverlay.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        handleElevationLeave();
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
    clearRouteFromUrl(); // Clear route parameter when removing segments
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
        // const zoomLevel = result.type === 'city' ? 12 :
        //   result.type === 'town' ? 13 :
        //     result.type === 'village' ? 14 : 13;

        map.flyTo({
          center: [lon, lat],
          zoom: 11.5,
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

function showDownloadModal() {
  // Create modal elements
  const modal = document.createElement('div');
  modal.className = 'download-modal';
  modal.innerHTML = `
    <div class="download-modal-content">
      <div class="download-modal-header">
        <h3>הורדת מסלול GPX</h3>
        <button class="download-modal-close">&times;</button>
      </div>
      <div class="download-modal-body">
        <h4>קטעי מסלול נבחרים</h4>
        <div id="route-segments-list"></div>
        
        <h4>תיאור המסלול</h4>
        <div id="download-route-description"></div>

        <div class="download-modal-actions">
          <button id="download-gpx-final" class="download-confirm-btn">📥 הורדת GPX</button>
          <button id="share-route-modal" class="share-final-btn" title="שיתוף מסלול">🔗 שיתוף מסלול</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Populate route segments list
  const routeSegmentsList = modal.querySelector('#route-segments-list');
  if (selectedSegments.length === 0) {
    routeSegmentsList.innerHTML = '<p style="color: #666; font-style: italic;">אין קטעים נבחרים</p>';
  } else {
    let segmentsHtml = '<div class="modal-route-list">';
    selectedSegments.forEach((segmentName, index) => {
      // Check for warnings
      let warningIcons = '';
      const segmentInfo = segmentsData[segmentName];
      if (segmentInfo) {
        if (segmentInfo.winter === false) {
          warningIcons += ' ❄️';
        }
        if (segmentInfo.warning) {
          warningIcons += ' ⚠️';
        }
      }

      segmentsHtml += `
        <div class="modal-segment-item">
          <span><strong>${index + 1}.</strong> ${segmentName}${warningIcons}</span>
        </div>
      `;
    });
    segmentsHtml += '</div>';
    routeSegmentsList.innerHTML = segmentsHtml;
  }

  // Populate route description
  const downloadRouteDescription = modal.querySelector('#download-route-description');
  downloadRouteDescription.innerHTML = document.getElementById('route-description').innerHTML;

  // Add event listeners
  const closeBtn = modal.querySelector('.download-modal-close');
  const downloadBtn = modal.querySelector('#download-gpx-final');
  const shareBtn = modal.querySelector('#share-route-modal');

  closeBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  downloadBtn.addEventListener('click', () => {
    downloadGPX();
    document.body.removeChild(modal);
  });

  shareBtn.addEventListener('click', () => {
     shareRoute();
     document.body.removeChild(modal);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  // Add escape key listener
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      document.body.removeChild(modal);
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

function downloadGPX() {
  if (!kmlData) return;

  const orderedCoords = getOrderedCoordinates();

  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BikeRoutePlanner" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <trk>
    <name>מסלול רכיבה מתוכנן</name>
    <trkseg>`;

  orderedCoords.forEach(coord => {
    // Use actual elevation from coordinates if available, otherwise calculate
    let elevation;
    if (coord.elevation !== undefined) {
      elevation = coord.elevation;
    } else {
      // Fallback: calculate elevation based on position (simulated)
      elevation = 200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50;
    }
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
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
  // Initialize the map when page loads
  initMap();

  // Download GPX functionality
  document.getElementById('download-gpx').addEventListener('click', () => {
    showDownloadModal();
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

  // Reset button
  document.getElementById('reset-btn').addEventListener('click', () => {
    if (selectedSegments.length > 0) {
      showResetModal();
    } else {
      resetRoute();
    }
  });

  

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

  // Warning box click handlers
  document.getElementById('route-warning').addEventListener('click', function() {
    const continuityResult = checkRouteContinuity();
    if (!continuityResult.isContinuous && continuityResult.brokenSegmentIndex >= 0) {
      const segmentName = selectedSegments[continuityResult.brokenSegmentIndex];
      focusOnSegment(segmentName);
    }
  });

  document.getElementById('winter-warning').addEventListener('click', function() {
    const winterResult = hasWinterSegments();
    if (winterResult.hasWinter && winterResult.firstWinterSegment) {
      focusOnSegment(winterResult.firstWinterSegment);
    }
  });

  document.getElementById('segment-warning').addEventListener('click', function() {
    const warningsResult = hasSegmentWarnings();
    if (warningsResult.hasWarnings && warningsResult.firstWarningSegment) {
      focusOnSegment(warningsResult.firstWarningSegment);
    }
  });

  // Help tutorial button
  const helpTutorialBtn = document.getElementById('help-tutorial-btn');
  if (helpTutorialBtn) {
    helpTutorialBtn.addEventListener('click', () => {
      if (typeof tutorial !== 'undefined' && tutorial && typeof tutorial.startManually === 'function') {
        tutorial.startManually();
      }
    });
  }

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

const ROUTE_VERSION = 1;