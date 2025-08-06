
/**
 * RouteManager - Handles route planning logic including loading geojson data,
 * managing route points, and calculating optimal routes through segments.
 */
class RouteManager {
  constructor() {
    this.segments = new Map(); // segmentName -> segment data
    this.segmentMetrics = new Map(); // segmentName -> pre-calculated metrics
    this.routePoints = [];
    this.selectedSegments = [];
    this.adjacencyMap = new Map(); // segment connectivity graph
  }

  /**
   * Load geojson and segments data
   * @param {Object} geoJsonData - The geojson feature collection
   * @param {Object} segmentsData - The segments metadata
   */
  async load(geoJsonData, segmentsData) {
    this.segments.clear();
    this.segmentMetrics.clear();
    this.adjacencyMap.clear();
    this.segmentsMetadata = segmentsData || {};

    if (!geoJsonData?.features) {
      throw new Error('Invalid geojson data');
    }

    // Load segments from geojson
    geoJsonData.features.forEach(feature => {
      if (feature.geometry?.type !== 'LineString') return;

      const name = feature.properties?.name || 'Unnamed Route';
      const coordinates = feature.geometry.coordinates.map(coord => ({
        lat: coord[1],
        lng: coord[0],
        elevation: coord[2] || 0
      }));

      // Merge geojson properties with segments metadata
      const segmentMetadata = this.segmentsMetadata[name] || {};
      const mergedProperties = {
        ...feature.properties,
        ...segmentMetadata
      };

      this.segments.set(name, {
        name,
        coordinates,
        properties: mergedProperties
      });
    });

    // Pre-calculate metrics for all segments
    this._preCalculateMetrics();

    // Build connectivity graph
    this._buildAdjacencyMap();

    console.log(`Loaded ${this.segments.size} segments with connectivity data`);
  }

  /**
   * Add a route point and recalculate the route
   * @param {Object} point - {lat, lng}
   * @returns {Array} Updated list of selected segments
   */
  addPoint(point) {
    if (!point?.lat || !point?.lng) {
      throw new Error('Invalid point coordinates');
    }

    // Snap point to nearest segment
    const snappedPoint = this._snapToNearestSegment(point);
    if (!snappedPoint) {
      return this.selectedSegments;
    }

    this.routePoints.push({
      ...snappedPoint,
      id: Date.now() + Math.random()
    });

    this._recalculateRoute();
    return [...this.selectedSegments];
  }

  /**
   * Get segments near a hover point for highlighting
   * @param {Object} point - {lat, lng}
   * @param {number} threshold - Distance threshold in meters (default: 100)
   * @returns {Array} Array of nearby segment names
   */
  getHoverSegments(point, threshold = 100) {
    if (!point?.lat || !point?.lng) return [];

    const nearbySegments = [];
    
    for (const [segmentName, segment] of this.segments) {
      const coords = segment.coordinates;
      for (let i = 0; i < coords.length - 1; i++) {
        const distance = this._distanceToLineSegment(point, coords[i], coords[i + 1]);
        if (distance <= threshold) {
          nearbySegments.push(segmentName);
          break;
        }
      }
    }

    return nearbySegments;
  }

  /**
   * Remove a route point by index
   * @param {number} index - Index of point to remove
   * @returns {Array} Updated list of selected segments
   */
  removePoint(index) {
    if (index < 0 || index >= this.routePoints.length) {
      return this.selectedSegments;
    }

    this.routePoints.splice(index, 1);
    this._recalculateRoute();
    return [...this.selectedSegments];
  }

  /**
   * Clear all route points and segments
   * @returns {Array} Empty segments array
   */
  clearRoute() {
    this.routePoints = [];
    this.selectedSegments = [];
    return [];
  }

  /**
   * Recalculate route based on current points
   * @param {Array} points - Array of route points
   * @returns {Array} Updated list of selected segments
   */
  recalculateRoute(points) {
    this.routePoints = [...points];
    this._recalculateRoute();
    return [...this.selectedSegments];
  }

  /**
   * Find closest segment to a point
   * @param {Object} point - {lat, lng}
   * @returns {string|null} Closest segment name
   */
  findClosestSegment(point) {
    const snapped = this._snapToNearestSegment(point);
    return snapped ? snapped.segmentName : null;
  }

  /**
   * Find path between two points
   * @param {Object} startPoint - {lat, lng}
   * @param {Object} endPoint - {lat, lng}
   * @returns {Array} Array of segment names forming the path
   */
  findPathBetweenPoints(startPoint, endPoint) {
    return this._findPathBetweenPoints(startPoint, endPoint);
  }

  /**
   * Get current route information
   * @returns {Object} Route data including points, segments, and metrics
   */
  getRouteInfo() {
    const totalDistance = this._calculateTotalDistance();
    const elevation = this._calculateElevationChanges();
    
    return {
      points: [...this.routePoints],
      segments: [...this.selectedSegments],
      distance: totalDistance,
      elevationGain: elevation.gain,
      elevationLoss: elevation.loss,
      orderedCoordinates: this._getOrderedCoordinates()
    };
  }

  /**
   * Get segment information by name
   * @param {string} segmentName 
   * @returns {Object|null} Segment data with metrics
   */
  getSegmentInfo(segmentName) {
    const segment = this.segments.get(segmentName);
    const metrics = this.segmentMetrics.get(segmentName);
    
    if (!segment) return null;

    return {
      ...segment,
      metrics: metrics || null
    };
  }

  // Private methods

  _preCalculateMetrics() {
    for (const [segmentName, segment] of this.segments) {
      const coords = segment.coordinates;
      
      // Calculate distance
      let distance = 0;
      for (let i = 0; i < coords.length - 1; i++) {
        distance += this._getDistance(coords[i], coords[i + 1]);
      }

      // Apply elevation smoothing
      const smoothedCoords = this._smoothElevations(coords, 100);

      // Calculate elevation changes
      let elevationGainForward = 0;
      let elevationLossForward = 0;
      const minElevationChange = 1.0;

      for (let i = 0; i < smoothedCoords.length - 1; i++) {
        const elevationChange = smoothedCoords[i + 1].elevation - smoothedCoords[i].elevation;
        
        if (Math.abs(elevationChange) >= minElevationChange) {
          if (elevationChange > 0) {
            elevationGainForward += elevationChange;
          } else {
            elevationLossForward += Math.abs(elevationChange);
          }
        }
      }

      this.segmentMetrics.set(segmentName, {
        distance,
        distanceKm: (distance / 1000).toFixed(1),
        forward: {
          elevationGain: Math.round(elevationGainForward),
          elevationLoss: Math.round(elevationLossForward)
        },
        reverse: {
          elevationGain: Math.round(elevationLossForward),
          elevationLoss: Math.round(elevationGainForward)
        },
        startPoint: coords[0],
        endPoint: coords[coords.length - 1],
        smoothedCoords
      });
    }
  }

  _buildAdjacencyMap() {
    const connectionThreshold = 100; // meters

    for (const segmentName of this.segments.keys()) {
      this.adjacencyMap.set(segmentName, []);
    }

    const segmentArray = Array.from(this.segments.entries());
    
    for (let i = 0; i < segmentArray.length; i++) {
      for (let j = i + 1; j < segmentArray.length; j++) {
        const [name1, segment1] = segmentArray[i];
        const [name2, segment2] = segmentArray[j];

        if (this._areSegmentsConnected(segment1, segment2, connectionThreshold)) {
          this.adjacencyMap.get(name1).push(name2);
          this.adjacencyMap.get(name2).push(name1);
        }
      }
    }
  }

  _areSegmentsConnected(segment1, segment2, threshold) {
    const coords1 = segment1.coordinates;
    const coords2 = segment2.coordinates;

    if (coords1.length === 0 || coords2.length === 0) return false;

    const endpoints1 = [coords1[0], coords1[coords1.length - 1]];
    const endpoints2 = [coords2[0], coords2[coords2.length - 1]];

    for (const point1 of endpoints1) {
      for (const point2 of endpoints2) {
        if (this._getDistance(point1, point2) <= threshold) {
          return true;
        }
      }
    }

    return false;
  }

  _snapToNearestSegment(point) {
    let closestSegment = null;
    let minDistance = Infinity;
    let closestPoint = null;
    const threshold = 100; // meters

    for (const [segmentName, segment] of this.segments) {
      const coords = segment.coordinates;
      
      for (let i = 0; i < coords.length - 1; i++) {
        const segmentStart = coords[i];
        const segmentEnd = coords[i + 1];
        const pointOnSegment = this._getClosestPointOnLineSegment(point, segmentStart, segmentEnd);
        const distance = this._getDistance(point, pointOnSegment);

        if (distance < threshold && distance < minDistance) {
          minDistance = distance;
          closestSegment = segmentName;
          closestPoint = pointOnSegment;
        }
      }
    }

    return closestPoint ? { ...closestPoint, segmentName: closestSegment } : null;
  }

  _recalculateRoute() {
    if (this.routePoints.length === 0) {
      this.selectedSegments = [];
      return;
    }

    if (this.routePoints.length === 1) {
      const point = this.routePoints[0];
      if (point.segmentName) {
        this.selectedSegments = [point.segmentName];
      }
      return;
    }

    // Find optimal route through all points
    this.selectedSegments = this._findOptimalRouteThroughPoints(this.routePoints);
  }

  _findOptimalRouteThroughPoints(points) {
    if (points.length === 0) return [];
    if (points.length === 1) {
      return points[0].segmentName ? [points[0].segmentName] : [];
    }

    const allSegments = [];
    const usedSegments = new Set();

    for (let i = 0; i < points.length - 1; i++) {
      const currentPoint = points[i];
      const nextPoint = points[i + 1];

      let actualStartPoint = currentPoint;
      if (i > 0) {
        const currentRouteCoords = this._getCurrentRouteEndpoint(allSegments);
        if (currentRouteCoords) {
          actualStartPoint = currentRouteCoords;
        }
      }

      const pathSegments = this._findPathBetweenPoints(actualStartPoint, nextPoint, usedSegments);
      
      // Add all segments in the path to ensure proper connectivity
      for (const segmentName of pathSegments) {
        // Avoid duplicates
        if (allSegments.length === 0 || allSegments[allSegments.length - 1] !== segmentName) {
          allSegments.push(segmentName);
          usedSegments.add(segmentName);
        }
      }
    }

    return allSegments;
  }

  _findPathBetweenPoints(startPoint, endPoint, usedSegments = new Set()) {
    const startSegment = this._findSegmentForPoint(startPoint);
    const endSegment = this._findSegmentForPoint(endPoint);

    if (!startSegment || !endSegment) return [];
    if (startSegment === endSegment) return [startSegment];

    // Check if segments are directly connected first
    const startConnections = this.adjacencyMap.get(startSegment) || [];
    if (startConnections.includes(endSegment)) {
      return [startSegment, endSegment];
    }

    // Use shortest path only if direct connection isn't possible
    const shortestPath = this._findShortestSegmentPath(startSegment, endSegment);
    
    // For simple cases, prefer direct segments only
    if (shortestPath.length <= 2) {
      return shortestPath;
    }
    
    // For longer paths, try to minimize intermediate segments
    return this._minimizePath(shortestPath, startSegment, endSegment);
  }

  _findSegmentForPoint(point) {
    if (point.segmentName) return point.segmentName;
    
    const snapped = this._snapToNearestSegment(point);
    return snapped ? snapped.segmentName : null;
  }

  _findShortestSegmentPath(startSegmentName, endSegmentName) {
    if (startSegmentName === endSegmentName) return [startSegmentName];

    const queue = [[startSegmentName]];
    const visited = new Set([startSegmentName]);

    while (queue.length > 0) {
      const currentPath = queue.shift();
      const currentSegment = currentPath[currentPath.length - 1];

      const connectedSegments = this.adjacencyMap.get(currentSegment) || [];
      
      for (const neighborSegment of connectedSegments) {
        if (neighborSegment === endSegmentName) {
          return [...currentPath, neighborSegment];
        }

        if (!visited.has(neighborSegment)) {
          visited.add(neighborSegment);
          queue.push([...currentPath, neighborSegment]);
        }
      }
    }

    return [startSegmentName, endSegmentName];
  }

  _getCurrentRouteEndpoint(segments) {
    if (segments.length === 0) return null;
    
    const orderedCoords = this._getOrderedCoordinatesForSegments(segments);
    return orderedCoords.length > 0 ? orderedCoords[orderedCoords.length - 1] : null;
  }

  _isSegmentNecessaryForConnection(existingSegments, candidateSegment, pathSegments) {
    // If this is one of only two segments in the path, it's necessary
    if (pathSegments.length <= 2) return true;
    
    // If we already have segments and this creates a gap, it's necessary
    if (existingSegments.length > 0) {
      const lastSegment = existingSegments[existingSegments.length - 1];
      const candidateIndex = pathSegments.indexOf(candidateSegment);
      const lastSegmentIndex = pathSegments.indexOf(lastSegment);
      
      // If this segment immediately follows the last one in the path, it's necessary
      return candidateIndex === lastSegmentIndex + 1;
    }
    
    return false;
  }

  _getOrderedCoordinates() {
    return this._getOrderedCoordinatesForSegments(this.selectedSegments);
  }

  _getOrderedCoordinatesForSegments(segments) {
    if (segments.length === 0) return [];

    let orderedCoords = [];

    for (let i = 0; i < segments.length; i++) {
      const segmentName = segments[i];
      const segment = this.segments.get(segmentName);
      if (!segment) continue;

      let coords = [...segment.coordinates];

      if (i === 0) {
        // Orient first segment correctly if there's a second segment
        if (segments.length > 1) {
          const nextSegment = this.segments.get(segments[1]);
          if (nextSegment) {
            coords = this._orientSegmentForConnection(coords, nextSegment.coordinates, true);
          }
        }
        orderedCoords = [...coords];
      } else {
        // Orient subsequent segments to connect with previous
        const lastPoint = orderedCoords[orderedCoords.length - 1];
        coords = this._orientSegmentForConnection(coords, null, false, lastPoint);

        const firstPoint = coords[0];
        const connectionDistance = this._getDistance(lastPoint, firstPoint);

        if (connectionDistance <= 50) {
          orderedCoords.push(...coords.slice(1));
        } else {
          orderedCoords.push(...coords);
        }
      }
    }

    return orderedCoords;
  }

  _orientSegmentForConnection(coords, nextCoords, isFirst, lastPoint = null) {
    if (isFirst && nextCoords) {
      const firstStart = coords[0];
      const firstEnd = coords[coords.length - 1];
      const nextStart = nextCoords[0];
      const nextEnd = nextCoords[nextCoords.length - 1];

      const distances = [
        this._getDistance(firstEnd, nextStart),
        this._getDistance(firstEnd, nextEnd),
        this._getDistance(firstStart, nextStart),
        this._getDistance(firstStart, nextEnd)
      ];

      const minIndex = distances.indexOf(Math.min(...distances));
      return (minIndex === 2 || minIndex === 3) ? coords.reverse() : coords;
    }

    if (lastPoint) {
      const segmentStart = coords[0];
      const segmentEnd = coords[coords.length - 1];

      const distanceToStart = this._getDistance(lastPoint, segmentStart);
      const distanceToEnd = this._getDistance(lastPoint, segmentEnd);

      return distanceToEnd < distanceToStart ? coords.reverse() : coords;
    }

    return coords;
  }

  _calculateTotalDistance() {
    let totalDistance = 0;
    for (const segmentName of this.selectedSegments) {
      const metrics = this.segmentMetrics.get(segmentName);
      if (metrics) {
        totalDistance += metrics.distance;
      }
    }
    return totalDistance;
  }

  _calculateElevationChanges() {
    let totalGain = 0;
    let totalLoss = 0;

    for (let i = 0; i < this.selectedSegments.length; i++) {
      const segmentName = this.selectedSegments[i];
      const metrics = this.segmentMetrics.get(segmentName);
      if (!metrics) continue;

      let isReversed = false;
      if (i > 0) {
        // Determine orientation based on connectivity
        const prevSegmentName = this.selectedSegments[i - 1];
        const prevMetrics = this.segmentMetrics.get(prevSegmentName);
        
        if (prevMetrics) {
          const currentStart = metrics.startPoint;
          const currentEnd = metrics.endPoint;
          const prevEnd = prevMetrics.endPoint;
          
          const distanceToStart = this._getDistance(prevEnd, currentStart);
          const distanceToEnd = this._getDistance(prevEnd, currentEnd);
          
          isReversed = distanceToEnd < distanceToStart;
        }
      }

      if (isReversed) {
        totalGain += metrics.reverse.elevationGain;
        totalLoss += metrics.reverse.elevationLoss;
      } else {
        totalGain += metrics.forward.elevationGain;
        totalLoss += metrics.forward.elevationLoss;
      }
    }

    return {
      gain: Math.round(totalGain),
      loss: Math.round(totalLoss)
    };
  }

  // Utility methods

  _getDistance(point1, point2) {
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

  _distanceToLineSegment(point, lineStart, lineEnd) {
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

    return this._getDistance(point, { lat: yy, lng: xx });
  }

  _getClosestPointOnLineSegment(point, lineStart, lineEnd) {
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

  _smoothElevations(coords, distanceWindow = 100) {
    if (coords.length === 0) return coords;

    const coordsWithElevation = coords.map(coord => ({
      lat: coord.lat,
      lng: coord.lng,
      elevation: coord.elevation !== undefined ? coord.elevation : 
        200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50
    }));

    const smoothedElevations = this._distanceWindowSmoothing(
      coordsWithElevation,
      distanceWindow,
      (index) => coordsWithElevation[index].elevation,
      (accumulated, start, end) => accumulated / (end - start + 1)
    );

    if (coordsWithElevation.length > 0) {
      smoothedElevations[0] = coordsWithElevation[0].elevation;
      smoothedElevations[coordsWithElevation.length - 1] = coordsWithElevation[coordsWithElevation.length - 1].elevation;
    }

    return coordsWithElevation.map((coord, index) => ({
      lat: coord.lat,
      lng: coord.lng,
      elevation: smoothedElevations[index]
    }));
  }

  _minimizePath(fullPath, startSegment, endSegment) {
    // If path is short, return as is
    if (fullPath.length <= 3) return fullPath;
    
    // Try to find a shorter connection
    // For now, just return the start and end segments if they represent the user's clicks
    return [startSegment, endSegment];
  }

  _distanceWindowSmoothing(points, distanceWindow, accumulate, compute) {
    let result = [];
    let start = 0, end = 0, accumulated = 0;

    for (let i = 0; i < points.length; i++) {
      while (start + 1 < i && this._getDistance(points[start], points[i]) > distanceWindow) {
        accumulated -= accumulate(start);
        start++;
      }

      while (end < points.length && this._getDistance(points[i], points[end]) <= distanceWindow) {
        accumulated += accumulate(end);
        end++;
      }

      result[i] = compute(accumulated, start, end - 1);
    }

    return result;
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RouteManager;
}
