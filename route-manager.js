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
      throw new Error("Invalid geojson data");
    }

    // Load segments from geojson
    geoJsonData.features.forEach((feature) => {
      if (feature.geometry?.type !== "LineString") return;

      const name = feature.properties?.name || "Unnamed Route";
      const coordinates = feature.geometry.coordinates.map((coord) => ({
        lat: coord[1],
        lng: coord[0],
        elevation: coord[2] || 0,
      }));

      // Merge geojson properties with segments metadata
      const segmentMetadata = this.segmentsMetadata[name] || {};
      const mergedProperties = {
        ...feature.properties,
        ...segmentMetadata,
      };

      this.segments.set(name, {
        name,
        coordinates,
        properties: mergedProperties,
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
      throw new Error("Invalid point coordinates");
    }

    // Snap point to nearest segment
    const snappedPoint = this._snapToNearestSegment(point);
    if (!snappedPoint) {
      return this.selectedSegments;
    }

    this.routePoints.push({
      ...snappedPoint,
      id: Date.now() + Math.random(),
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
        const distance = this._distanceToLineSegment(
          point,
          coords[i],
          coords[i + 1],
        );
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
      orderedCoordinates: this._getOrderedCoordinates(),
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
      metrics: metrics || null,
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
        const elevationChange =
          smoothedCoords[i + 1].elevation - smoothedCoords[i].elevation;

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
          elevationLoss: Math.round(elevationLossForward),
        },
        reverse: {
          elevationGain: Math.round(elevationLossForward),
          elevationLoss: Math.round(elevationGainForward),
        },
        startPoint: coords[0],
        endPoint: coords[coords.length - 1],
        smoothedCoords,
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

        if (
          this._areSegmentsConnected(segment1, segment2, connectionThreshold)
        ) {
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
        const pointOnSegment = this._getClosestPointOnLineSegment(
          point,
          segmentStart,
          segmentEnd,
        );
        const distance = this._getDistance(point, pointOnSegment);

        if (distance < threshold && distance < minDistance) {
          minDistance = distance;
          closestSegment = segmentName;
          closestPoint = pointOnSegment;
        }
      }
    }

    return closestPoint
      ? { ...closestPoint, segmentName: closestSegment }
      : null;
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
    this.selectedSegments = this._findOptimalRouteThroughPoints(
      this.routePoints,
    );
  }

  _findOptimalRouteThroughPoints(points) {
    if (points.length === 0) return [];
    if (points.length === 1) {
      return points[0].segmentName ? [points[0].segmentName] : [];
    }

    let allSegments = [];

    // Process each new point by extending the route
    for (let i = 0; i < points.length; i++) {
      const point = points[i];

      if (i === 0) {
        // First point - just add its segment
        if (point.segmentName) {
          allSegments.push(point.segmentName);
        }
      } else {
        // Extend route to reach this new point
        const extensionSegments = this._findRouteExtensionToPoint(
          point,
          allSegments,
        );

        console.log("Pushing extension segments:", extensionSegments);
        allSegments.push(...extensionSegments);
      }
    }

    return allSegments;
  }

  _findRouteExtensionToPoint(targetPoint, currentRouteSegments) {
    console.log("_findRouteExtensionToPoint");
    if (!targetPoint.segmentName) return [];

    const closestSegmentToPoint = targetPoint.segmentName;

    // If the route is empty, the extension is just the target point's segment
    if (currentRouteSegments.length === 0) {
      return [closestSegmentToPoint];
    }

    const lastSegmentOfRoute = currentRouteSegments[currentRouteSegments.length - 1];
    
    // Determine the actual endpoint of the current route by analyzing the route's directionality
    const routeEndpoint = this._getCurrentRouteEndpoint(currentRouteSegments);
    if (!routeEndpoint) return [closestSegmentToPoint];

    // Get the last segment's data to understand its endpoints
    const lastSegmentData = this.segments.get(lastSegmentOfRoute);
    if (!lastSegmentData) return [closestSegmentToPoint];

    const lastSegmentCoords = lastSegmentData.coordinates;
    const lastSegmentStart = lastSegmentCoords[0];
    const lastSegmentEnd = lastSegmentCoords[lastSegmentCoords.length - 1];

    // Determine which end of the last segment is the actual route endpoint
    const distanceToStart = this._getDistance(routeEndpoint, lastSegmentStart);
    const distanceToEnd = this._getDistance(routeEndpoint, lastSegmentEnd);
    const isRouteEndAtSegmentEnd = distanceToEnd < distanceToStart;

    console.log("Route endpoint:", routeEndpoint);
    console.log("Last segment start:", lastSegmentStart);
    console.log("Last segment end:", lastSegmentEnd);
    console.log("Route end is at segment end:", isRouteEndAtSegmentEnd);

    // Check direct connectivity from the actual route endpoint
    const connectionsFromLastSegment = this.adjacencyMap.get(lastSegmentOfRoute) || [];
    
    console.log("Adjacent to", lastSegmentOfRoute, ":", connectionsFromLastSegment);

    if (connectionsFromLastSegment.includes(closestSegmentToPoint)) {
      // Check if the target segment is reachable from the current route endpoint
      const targetSegmentData = this.segments.get(closestSegmentToPoint);
      if (!targetSegmentData) return [closestSegmentToPoint];

      const targetCoords = targetSegmentData.coordinates;
      const targetStart = targetCoords[0];
      const targetEnd = targetCoords[targetCoords.length - 1];

      // Check distances from route endpoint to both ends of target segment
      const distanceToTargetStart = this._getDistance(routeEndpoint, targetStart);
      const distanceToTargetEnd = this._getDistance(routeEndpoint, targetEnd);
      const connectionThreshold = 100; // meters

      if (Math.min(distanceToTargetStart, distanceToTargetEnd) <= connectionThreshold) {
        // Direct connection possible
        if (lastSegmentOfRoute !== closestSegmentToPoint) {
          return [closestSegmentToPoint];
        } else {
          return []; // Segment is already part of the route
        }
      } else {
        // Need to reverse through the last segment first to reach the other end
        console.log("Need to reverse through last segment to reach target");
        return [lastSegmentOfRoute, closestSegmentToPoint];
      }
    } else {
      // Not directly connected - find the shortest path from the route's endpoint
      const segmentData = this.segments.get(closestSegmentToPoint);
      if (!segmentData) return [closestSegmentToPoint];

      const coords = segmentData.coordinates;
      const segmentStartPoint = coords[0];
      const segmentEndPoint = coords[coords.length - 1];

      // If route endpoint is at the start of the last segment, we need to consider reversing first
      let pathOptions = [];

      if (isRouteEndAtSegmentEnd) {
        // Route ends at the end of last segment - search from there
        const pathToStart = this._findPathFromPointToSegmentEntry(routeEndpoint, closestSegmentToPoint, segmentStartPoint);
        const pathToEnd = this._findPathFromPointToSegmentEntry(routeEndpoint, closestSegmentToPoint, segmentEndPoint);
        pathOptions = [pathToStart, pathToEnd];
      } else {
        // Route ends at the start of last segment - consider both direct paths and reversing first
        const pathToStart = this._findPathFromPointToSegmentEntry(routeEndpoint, closestSegmentToPoint, segmentStartPoint);
        const pathToEnd = this._findPathFromPointToSegmentEntry(routeEndpoint, closestSegmentToPoint, segmentEndPoint);
        
        // Also consider reversing through the last segment first
        const reverseEndpoint = lastSegmentEnd;
        const pathToStartFromReverse = this._findPathFromPointToSegmentEntry(reverseEndpoint, closestSegmentToPoint, segmentStartPoint);
        const pathToEndFromReverse = this._findPathFromPointToSegmentEntry(reverseEndpoint, closestSegmentToPoint, segmentEndPoint);
        
        // Add the reverse segment to these paths
        const pathToStartWithReverse = pathToStartFromReverse.length > 0 ? [lastSegmentOfRoute, ...pathToStartFromReverse] : [];
        const pathToEndWithReverse = pathToEndFromReverse.length > 0 ? [lastSegmentOfRoute, ...pathToEndFromReverse] : [];
        
        pathOptions = [pathToStart, pathToEnd, pathToStartWithReverse, pathToEndWithReverse];
      }

      // Filter out empty paths and choose the shortest one
      const validPaths = pathOptions.filter(path => path.length > 0);
      
      if (validPaths.length === 0) {
        return [closestSegmentToPoint];
      }

      let shortestPath = validPaths[0];
      let shortestDistance = this._calculatePathDistance(shortestPath);

      for (let i = 1; i < validPaths.length; i++) {
        const distance = this._calculatePathDistance(validPaths[i]);
        if (distance < shortestDistance) {
          shortestDistance = distance;
          shortestPath = validPaths[i];
        }
      }

      console.log("Selected shortest path:", shortestPath, "distance:", shortestDistance);

      // Remove the first segment if it's the same as the last segment in current route
      // (unless it's a reversal which we want to keep)
      if (shortestPath.length > 0 && shortestPath[0] === lastSegmentOfRoute && 
          shortestPath.length > 1 && shortestPath[1] !== lastSegmentOfRoute) {
        // This is not a reversal, so remove the duplicate
        return shortestPath.slice(1);
      }

      return shortestPath;
    }
  }

  _findPathBetweenPoints(startPoint, endPoint, usedSegments = new Set()) {
    const startSegment = this._findSegmentForPoint(startPoint);
    const endSegment = this._findSegmentForPoint(endPoint);

    if (!startSegment || !endSegment) return [];
    if (startSegment === endSegment) {
      return [startSegment];
    }

    // Check if segments are directly connected first
    const startConnections = this.adjacencyMap.get(startSegment) || [];
    if (startConnections.includes(endSegment)) {
      return [startSegment, endSegment];
    }

    // Use shortest path algorithm
    const shortestPath = this._findShortestSegmentPath(
      startSegment,
      endSegment,
    );

    return shortestPath;
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

    // Fallback: if no path found, assume direct connection (though this might be an error state)
    return [startSegmentName, endSegmentName];
  }

  _findPathFromPointToSegmentEntry(startPoint, targetSegmentName, targetEntryPoint) {
    // Find the closest segment to the start point
    const startSegmentName = this._findClosestSegmentName(startPoint);
    if (!startSegmentName) return [];
    
    // Use the existing path finding logic
    return this._findPathToSegmentEntryPoint(startSegmentName, targetSegmentName, targetEntryPoint);
  }

  _findClosestSegmentName(point) {
    const snapped = this._snapToNearestSegment(point);
    return snapped ? snapped.segmentName : null;
  }

  _findPathToSegmentEntryPoint(
    startSegmentName,
    targetSegmentName,
    targetEntryPoint,
  ) {
    // Get the end point of the current route (last segment)
    const startSegmentData = this.segments.get(startSegmentName);
    if (!startSegmentData) return [];

    const startCoords = startSegmentData.coordinates;
    const routeEndPoint = startCoords[startCoords.length - 1];
    const routeStartPoint = startCoords[0];

    // Get target segment data
    const targetSegmentData = this.segments.get(targetSegmentName);
    if (!targetSegmentData) return [];

    const targetCoords = targetSegmentData.coordinates;
    const targetStart = targetCoords[0];
    const targetEnd = targetCoords[targetCoords.length - 1];

    // Calculate paths to both entry points of target segment
    const pathToTargetStart = this._findShortestSegmentPath(
      startSegmentName,
      targetSegmentName,
    );
    const pathToTargetEnd = this._findShortestSegmentPath(
      startSegmentName,
      targetSegmentName,
    );

    // Calculate total distance for path to start of target segment
    let distanceToStart = 0;
    // First check if we need to reverse through current segment
    const distanceFromRouteEndToTargetStart = this._getDistance(
      routeEndPoint,
      targetStart,
    );
    const distanceFromRouteStartToTargetStart = this._getDistance(
      routeStartPoint,
      targetStart,
    );

    if (
      distanceFromRouteStartToTargetStart < distanceFromRouteEndToTargetStart
    ) {
      // Need to reverse through current segment
      const startSegmentMetrics = this.segmentMetrics.get(startSegmentName);
      if (startSegmentMetrics) {
        distanceToStart += startSegmentMetrics.distance; // Add distance to traverse current segment in reverse
      }
    }

    // Add distances for intermediate segments in the path
    for (
      let i = pathToTargetStart[0] === startSegmentName ? 1 : 0;
      i < pathToTargetStart.length;
      i++
    ) {
      const segmentMetrics = this.segmentMetrics.get(pathToTargetStart[i]);
      if (segmentMetrics) {
        distanceToStart += segmentMetrics.distance;
      }
    }

    // Calculate total distance for path to end of target segment
    let distanceToEnd = 0;
    // First check if we need to reverse through current segment
    const distanceFromRouteEndToTargetEnd = this._getDistance(
      routeEndPoint,
      targetEnd,
    );
    const distanceFromRouteStartToTargetEnd = this._getDistance(
      routeStartPoint,
      targetEnd,
    );

    if (distanceFromRouteStartToTargetEnd < distanceFromRouteEndToTargetEnd) {
      // Need to reverse through current segment
      const startSegmentMetrics = this.segmentMetrics.get(startSegmentName);
      if (startSegmentMetrics) {
        distanceToEnd += startSegmentMetrics.distance; // Add distance to traverse current segment in reverse
      }
    }

    // Add distances for intermediate segments in the path
    for (
      let i = pathToTargetEnd[0] === startSegmentName ? 1 : 0;
      i < pathToTargetEnd.length;
      i++
    ) {
      const segmentMetrics = this.segmentMetrics.get(pathToTargetEnd[i]);
      if (segmentMetrics) {
        distanceToEnd += segmentMetrics.distance;
      }
    }

    // Choose the path with shorter total distance
    if (distanceToStart <= distanceToEnd) {
      // Path to start of target segment is shorter
      if (
        distanceFromRouteStartToTargetStart < distanceFromRouteEndToTargetStart
      ) {
        return [startSegmentName, ...pathToTargetStart];
      } else {
        return pathToTargetStart;
      }
    } else {
      // Path to end of target segment is shorter
      if (distanceFromRouteStartToTargetEnd < distanceFromRouteEndToTargetEnd) {
        return [startSegmentName, ...pathToTargetEnd];
      } else {
        return pathToTargetEnd;
      }
    }
  }

  _getCurrentRouteEndpoint(segments) {
    if (segments.length === 0) return null;

    const orderedCoords = this._getOrderedCoordinatesForSegments(segments);
    return orderedCoords.length > 0
      ? orderedCoords[orderedCoords.length - 1]
      : null;
  }

  _isSegmentNecessaryForConnection(
    existingSegments,
    candidateSegment,
    pathSegments,
  ) {
    // If this is one of only two segments in the path, it's necessary
    if (pathSegments.length <= 2) return true;

    // If we have no existing segments, the first one is necessary
    if (existingSegments.length === 0) return true;

    // Check if this segment connects to the last segment in our route
    const lastSegment = existingSegments[existingSegments.length - 1];
    const candidateIndex = pathSegments.indexOf(candidateSegment);
    const lastSegmentIndex = pathSegments.indexOf(lastSegment);

    // Only add if this segment immediately follows the last one in the shortest path
    // and there's no alternative direct connection
    if (candidateIndex === lastSegmentIndex + 1) {
      // Check if the last segment and candidate are actually connected
      const lastSegmentConnections = this.adjacencyMap.get(lastSegment) || [];
      return lastSegmentConnections.includes(candidateSegment);
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
            coords = this._orientSegmentForConnection(
              coords,
              nextSegment.coordinates,
              true,
            );
          }
        }
        orderedCoords = [...coords];
      } else {
        // Orient subsequent segments to connect with previous
        const lastPoint = orderedCoords[orderedCoords.length - 1];
        coords = this._orientSegmentForConnection(
          coords,
          null,
          false,
          lastPoint,
        );

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
        this._getDistance(firstStart, nextEnd),
      ];

      const minIndex = distances.indexOf(Math.min(...distances));
      return minIndex === 2 || minIndex === 3 ? coords.reverse() : coords;
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
      loss: Math.round(totalLoss),
    };
  }

  // Utility methods

  _getDistance(point1, point2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (point1.lat * Math.PI) / 180;
    const φ2 = (point2.lat * Math.PI) / 180;
    const Δφ = ((point2.lat - point1.lat) * Math.PI) / 180;
    const Δλ = ((point2.lng - point1.lng) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
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

    const coordsWithElevation = coords.map((coord) => ({
      lat: coord.lat,
      lng: coord.lng,
      elevation:
        coord.elevation !== undefined
          ? coord.elevation
          : 200 + Math.sin(coord.lat * 10) * 100 + Math.cos(coord.lng * 8) * 50,
    }));

    const smoothedElevations = this._distanceWindowSmoothing(
      coordsWithElevation,
      distanceWindow,
      (index) => coordsWithElevation[index].elevation,
      (accumulated, start, end) => accumulated / (end - start + 1),
    );

    if (coordsWithElevation.length > 0) {
      smoothedElevations[0] = coordsWithElevation[0].elevation;
      smoothedElevations[coordsWithElevation.length - 1] =
        coordsWithElevation[coordsWithElevation.length - 1].elevation;
    }

    return coordsWithElevation.map((coord, index) => ({
      lat: coord.lat,
      lng: coord.lng,
      elevation: smoothedElevations[index],
    }));
  }

  _minimizePath(fullPath, startSegment, endSegment) {
    // If path is short, return as is
    if (fullPath.length <= 3) return fullPath;

    // Try to find a shorter connection
    // For now, just return the start and end segments if they represent the user's clicks
    return [startSegment, endSegment];
  }

  _arePointsInCorrectDirection(startPoint, endPoint, startSegment, endSegment) {
    // Get segment coordinates
    const startSegmentData = this.segments.get(startSegment);
    const endSegmentData = this.segments.get(endSegment);

    if (!startSegmentData || !endSegmentData) return true;

    // Find positions of points along their segments
    const startPosition = this._getPositionAlongSegment(
      startPoint,
      startSegmentData.coordinates,
    );
    const endPosition = this._getPositionAlongSegment(
      endPoint,
      endSegmentData.coordinates,
    );

    // If same segment, ensure end point is after start point
    if (startSegment === endSegment) {
      return endPosition >= startPosition;
    }

    return true; // For different segments, assume direction is correct
  }

  _getPositionAlongSegment(point, segmentCoords) {
    let minDistance = Infinity;
    let bestPosition = 0;
    let accumulatedDistance = 0;

    for (let i = 0; i < segmentCoords.length - 1; i++) {
      const segmentStart = segmentCoords[i];
      const segmentEnd = segmentCoords[i + 1];
      const closestPoint = this._getClosestPointOnLineSegment(
        point,
        segmentStart,
        segmentEnd,
      );
      const distance = this._getDistance(point, closestPoint);

      if (distance < minDistance) {
        minDistance = distance;
        // Calculate position as distance along segment
        const distanceToClosest = this._getDistance(segmentStart, closestPoint);
        bestPosition = accumulatedDistance + distanceToClosest;
      }

      accumulatedDistance += this._getDistance(segmentStart, segmentEnd);
    }

    return bestPosition;
  }

  _calculatePathDistance(segmentPath) {
    let totalDistance = 0;
    for (const segmentName of segmentPath) {
      const metrics = this.segmentMetrics.get(segmentName);
      if (metrics) {
        totalDistance += metrics.distance;
      }
    }
    return totalDistance;
  }

  _distanceWindowSmoothing(points, distanceWindow, accumulate, compute) {
    let result = [];
    let start = 0,
      end = 0,
      accumulated = 0;

    for (let i = 0; i < points.length; i++) {
      while (
        start + 1 < i &&
        this._getDistance(points[start], points[i]) > distanceWindow
      ) {
        accumulated -= accumulate(start);
        start++;
      }

      while (
        end < points.length &&
        this._getDistance(points[i], points[end]) <= distanceWindow
      ) {
        accumulated += accumulate(end);
        end++;
      }

      result[i] = compute(accumulated, start, end - 1);
    }

    return result;
  }
}

// Export for use in other files
if (typeof module !== "undefined" && module.exports) {
  module.exports = RouteManager;
}
