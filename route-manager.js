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
      return [...this.selectedSegments];
    }

    // Remove the point from internal array
    this.routePoints.splice(index, 1);
    
    // Recalculate route based on remaining points
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
    // Filter out any undefined or invalid points from routePoints
    this.routePoints = this.routePoints.filter(point => 
      point && point.lat !== undefined && point.lng !== undefined
    );

    if (this.routePoints.length === 0) {
      this.selectedSegments = [];
      return;
    }

    if (this.routePoints.length === 1) {
      const point = this.routePoints[0];
      if (point && point.segmentName) {
        this.selectedSegments = [point.segmentName];
      } else {
        this.selectedSegments = [];
      }
      return;
    }

    // Find optimal route through all points
    try {
      this.selectedSegments = this._findOptimalRouteThroughPoints(
        this.routePoints,
      );
    } catch (error) {
      console.error("Error in _findOptimalRouteThroughPoints:", error);
      this.selectedSegments = [];
    }
  }

  _findOptimalRouteThroughPoints(points) {
    if (points.length === 0) return [];
    
    // Filter out any undefined or invalid points
    const validPoints = points.filter(point => point && point.lat !== undefined && point.lng !== undefined);
    
    if (validPoints.length === 0) return [];
    if (validPoints.length === 1) {
      return validPoints[0].segmentName ? [validPoints[0].segmentName] : [];
    }

    let allSegments = [];

    // Process each new point by extending the route
    for (let i = 0; i < validPoints.length; i++) {
      const point = validPoints[i];

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

    const lastSegmentOfRoute =
      currentRouteSegments[currentRouteSegments.length - 1];

    // Check if we're clicking on the same segment as the last one
    if (lastSegmentOfRoute === closestSegmentToPoint) {
      return [];
      // // Get segment data
      // const segmentData = this.segments.get(closestSegmentToPoint);
      // if (!segmentData) return [];

      // const segmentCoords = segmentData.coordinates;

      // // Determine if the last segment is being used in reverse in the current route
      // const isLastSegmentReversed = this._isSegmentReversedInRoute(lastSegmentOfRoute, currentRouteSegments);

      // // To determine if we're moving forward, compare the current click position
      // // with the previous click position on this segment, accounting for directionality
      // let isMovingForward = true; // default assumption

      // if (this.routePoints.length >= 2) {
      //   // Get the previous point (second to last)
      //   const previousPoint = this.routePoints[this.routePoints.length - 2];

      //   // Get positions accounting for the segment's current directionality in the route
      //   const previousPointPosition = this._getPositionAlongSegment(previousPoint, segmentCoords, isLastSegmentReversed);
      //   const targetPointPosition = this._getPositionAlongSegment(targetPoint, segmentCoords, isLastSegmentReversed);

      //   // Compare positions: if current point is further along the segment than previous point,
      //   // we're moving forward. If it's closer to the start, we're moving backward.
      //   isMovingForward = targetPointPosition > previousPointPosition;

      //   console.log("Segment reversed in route:", isLastSegmentReversed);
      //   console.log("Previous point position:", previousPointPosition);
      //   console.log("Target point position:", targetPointPosition);
      //   console.log("Is moving forward:", isMovingForward);
      // }

      // if (isMovingForward) {
      //   // Continuing in the same direction - no need to add the segment again
      //   console.log("Point continues in same direction on same segment - no reversal needed");
      //   return [];
      // } else {
      //   // Point is going backward - need to add the segment in reverse
      //   console.log("Point reverses direction on same segment - adding reversal");
      //   return [lastSegmentOfRoute];
      // }
    }

    // Different segment - proceed with normal adjacency logic
    const routeEndpoint = this._getCurrentRouteEndpoint(currentRouteSegments);
    if (!routeEndpoint) return [closestSegmentToPoint];

    // Check direct connectivity from the actual route endpoint
    const connectionsFromLastSegment =
      this.adjacencyMap.get(lastSegmentOfRoute) || [];

    console.log(
      "Adjacent to",
      lastSegmentOfRoute,
      ":",
      connectionsFromLastSegment,
    );

    if (connectionsFromLastSegment.includes(closestSegmentToPoint)) {
      // Check if the target segment is reachable from the current route endpoint
      const targetSegmentData = this.segments.get(closestSegmentToPoint);
      if (!targetSegmentData) return [closestSegmentToPoint];

      const targetCoords = targetSegmentData.coordinates;
      const targetStart = targetCoords[0];
      const targetEnd = targetCoords[targetCoords.length - 1];

      // Check distances from route endpoint to both ends of target segment
      const distanceToTargetStart = this._getDistance(
        routeEndpoint,
        targetStart,
      );
      const distanceToTargetEnd = this._getDistance(routeEndpoint, targetEnd);
      const connectionThreshold = 100; // meters

      if (
        Math.min(distanceToTargetStart, distanceToTargetEnd) <=
        connectionThreshold
      ) {
        // Direct connection possible
        return [closestSegmentToPoint];
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

      // If route endpoint is at the end of the last segment, we need to consider reversing first
      const lastSegmentData = this.segments.get(lastSegmentOfRoute);
      const lastSegmentEnd = lastSegmentData
        ? lastSegmentData.coordinates[lastSegmentData.coordinates.length - 1]
        : null;
      const isRouteEndAtSegmentEnd =
        routeEndpoint &&
        lastSegmentEnd &&
        this._getDistance(routeEndpoint, lastSegmentEnd) < 50; // Use a small threshold

      // Check if route endpoint is at the start of the last segment
      const lastSegmentStart = lastSegmentData
        ? lastSegmentData.coordinates[0]
        : null;
      const isRouteEndAtSegmentStart =
        routeEndpoint &&
        lastSegmentStart &&
        this._getDistance(routeEndpoint, lastSegmentStart) < 50;

      // Determine the most logical entry point from the current route's endpoint to the target segment
      let pathOptions = [];

      // Path from current route endpoint to start of target segment
      const pathToTargetStart = this._findPathToSegmentEntryPoint(
        lastSegmentOfRoute,
        closestSegmentToPoint,
        segmentStartPoint,
      );
      pathOptions.push(pathToTargetStart);

      // Path from current route endpoint to end of target segment
      const pathToTargetEnd = this._findPathToSegmentEntryPoint(
        lastSegmentOfRoute,
        closestSegmentToPoint,
        segmentEndPoint,
      );
      pathOptions.push(pathToTargetEnd);

      // If the route ends at the end of the last segment, consider reversing through it
      if (isRouteEndAtSegmentEnd) {
        // Path from the start of the last segment (after reversing) to the start of the target segment
        const reverseEndpoint = lastSegmentStart; // The other end of the last segment
        if (reverseEndpoint) {
          const pathToTargetStartFromReverse =
            this._findPathToSegmentEntryPoint(
              lastSegmentOfRoute,
              closestSegmentToPoint,
              segmentStartPoint,
              reverseEndpoint,
            );
          if (
            pathToTargetStartFromReverse.length > 0 &&
            pathToTargetStartFromReverse[0] === lastSegmentOfRoute
          ) {
            pathOptions.push(pathToTargetStartFromReverse);
          } else if (pathToTargetStartFromReverse.length > 0) {
            pathOptions.push([
              lastSegmentOfRoute,
              ...pathToTargetStartFromReverse,
            ]);
          }

          // Path from the start of the last segment (after reversing) to the end of the target segment
          const pathToTargetEndFromReverse = this._findPathToSegmentEntryPoint(
            lastSegmentOfRoute,
            closestSegmentToPoint,
            segmentEndPoint,
            reverseEndpoint,
          );
          if (
            pathToTargetEndFromReverse.length > 0 &&
            pathToTargetEndFromReverse[0] === lastSegmentOfRoute
          ) {
            pathOptions.push(pathToTargetEndFromReverse);
          } else if (pathToTargetEndFromReverse.length > 0) {
            pathOptions.push([
              lastSegmentOfRoute,
              ...pathToTargetEndFromReverse,
            ]);
          }
        }
      }

      // Filter out empty paths and choose the shortest one
      const validPaths = pathOptions.filter((path) => path && path.length > 0);

      if (validPaths.length === 0) {
        // If no valid path found, just return the target segment as a fallback
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

      console.log(
        "Selected shortest path:",
        shortestPath,
        "distance:",
        shortestDistance,
      );

      // If the shortest path starts with the last segment of the current route,
      // and it's not a reversal path, we should remove the duplicate segment.
      if (shortestPath.length > 0 && shortestPath[0] === lastSegmentOfRoute) {
        // Check if the path is actually a reversal. A reversal implies the path starts with the same segment.
        // If the path is just a continuation, we might have a duplicate.
        // For simplicity, if the path starts with the same segment, and it's not the only segment,
        // we consider it a potential duplicate and remove it if it's not a reversal.
        // A more robust check would involve comparing endpoints and directionality.
        // For now, we'll keep it simple: if it starts with the same segment, and the path is longer than 1,
        // and the next segment in the path is different, we might be duplicating.
        if (shortestPath.length > 1 && shortestPath[1] !== lastSegmentOfRoute) {
          // This looks like a path that starts with the current segment and then moves to another.
          // We need to ensure we don't add the last segment twice if it wasn't a reversal.
          // Let's re-evaluate how the path is constructed in _findPathToSegmentEntryPoint.
          // If the connection logic within _findPathToSegmentEntryPoint correctly handles the starting segment,
          // then we might not need to slice here.
          // A simpler heuristic: if the current route endpoint is close to the start of the last segment,
          // and the path to the target segment involves that same segment, it's likely a reversal.
          // If the current route endpoint is close to the end of the last segment,
          // and the path involves that segment, it's a continuation.
          // Let's assume for now that _findPathToSegmentEntryPoint correctly manages the start segment.
          // If we encounter issues, we can refine this logic.
        }
      }

      // Ensure the returned path doesn't duplicate the last segment of the current route if it's not a reversal
      if (
        shortestPath.length > 0 &&
        shortestPath[0] === lastSegmentOfRoute &&
        !this._isReversalPath(currentRouteSegments, shortestPath)
      ) {
        return shortestPath.slice(1);
      }

      return shortestPath;
    }
  }

  _isReversalPath(currentRouteSegments, potentialPath) {
    if (currentRouteSegments.length === 0 || potentialPath.length === 0)
      return false;
    const lastSegmentOfRoute =
      currentRouteSegments[currentRouteSegments.length - 1];
    // A reversal path typically means the first segment in the potential path is the same as the last segment of the current route.
    // We need to ensure this is a genuine reversal, not just a continuation.
    // This is a complex check and might require more context about how `potentialPath` is generated.
    // For now, a simple check: if the path starts with the same segment, it's potentially a reversal.
    return potentialPath[0] === lastSegmentOfRoute;
  }

  _isSegmentReversedInRoute(segmentName, routeSegments) {
    const segmentIndex = routeSegments.lastIndexOf(segmentName);
    if (segmentIndex === -1 || segmentIndex === 0) return false;

    // Get the segment and its predecessor in the route
    const segment = this.segments.get(segmentName);
    const prevSegmentName = routeSegments[segmentIndex - 1];
    const prevSegment = this.segments.get(prevSegmentName);

    if (!segment || !prevSegment) return false;

    const segmentStart = segment.coordinates[0];
    const segmentEnd = segment.coordinates[segment.coordinates.length - 1];
    const prevSegmentStart = prevSegment.coordinates[0];
    const prevSegmentEnd =
      prevSegment.coordinates[prevSegment.coordinates.length - 1];

    // Determine how the previous segment connects to this segment
    const distanceFromPrevEndToSegmentStart = this._getDistance(
      prevSegmentEnd,
      segmentStart,
    );
    const distanceFromPrevEndToSegmentEnd = this._getDistance(
      prevSegmentEnd,
      segmentEnd,
    );
    const distanceFromPrevStartToSegmentStart = this._getDistance(
      prevSegmentStart,
      segmentStart,
    );
    const distanceFromPrevStartToSegmentEnd = this._getDistance(
      prevSegmentStart,
      segmentEnd,
    );

    const minDistance = Math.min(
      distanceFromPrevEndToSegmentStart,
      distanceFromPrevEndToSegmentEnd,
      distanceFromPrevStartToSegmentStart,
      distanceFromPrevStartToSegmentEnd,
    );

    // If the closest connection is to the end of the current segment, it's reversed
    return (
      minDistance === distanceFromPrevEndToSegmentEnd ||
      minDistance === distanceFromPrevStartToSegmentEnd
    );
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

  _findPathFromPointToSegmentEntry(
    startSegmentName,
    targetSegmentName,
    targetEntryPoint,
    routeEndpoint = null, // Added to explicitly pass the route's current endpoint
  ) {
    // If routeEndpoint is not provided, find it from the startSegmentName
    if (!routeEndpoint) {
      const startSegmentData = this.segments.get(startSegmentName);
      if (!startSegmentData) return [];
      routeEndpoint =
        startSegmentData.coordinates[startSegmentData.coordinates.length - 1];
    }

    // Use the existing path finding logic from the route's endpoint to the target segment entry
    return this._findPathToSegmentEntryPoint(
      startSegmentName,
      targetSegmentName,
      targetEntryPoint,
      routeEndpoint,
    );
  }

  _findClosestSegmentName(point) {
    const snapped = this._snapToNearestSegment(point);
    return snapped ? snapped.segmentName : null;
  }

  _findPathToSegmentEntryPoint(
    startSegmentName,
    targetSegmentName,
    targetEntryPoint,
    routeEndpoint, // The actual end point of the current route
  ) {
    // Get the end point of the current route (last segment)
    const startSegmentData = this.segments.get(startSegmentName);
    if (!startSegmentData) return [];

    const startCoords = startSegmentData.coordinates;
    const routeStartPoint = startCoords[0]; // Start of the current segment

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

    // Check if we need to traverse the starting segment in reverse
    const distanceFromRouteEndToTargetStart = this._getDistance(
      routeEndpoint,
      targetStart,
    );
    const distanceFromRouteStartToTargetStart = this._getDistance(
      routeStartPoint,
      targetStart,
    );

    let segmentToAddForStart = [];
    if (
      distanceFromRouteStartToTargetStart < distanceFromRouteEndToTargetStart
    ) {
      // It's shorter to start from the beginning of the current segment, implies reversing the current segment
      const startSegmentMetrics = this.segmentMetrics.get(startSegmentName);
      if (startSegmentMetrics) {
        distanceToStart += startSegmentMetrics.distance; // Add distance to traverse current segment in reverse
        segmentToAddForStart = [startSegmentName]; // Indicate we need to add the current segment
      }
    } else {
      // It's shorter to start from the end of the current segment, implies direct continuation
      const startSegmentMetrics = this.segmentMetrics.get(startSegmentName);
      if (startSegmentMetrics) {
        distanceToStart += startSegmentMetrics.distance;
        segmentToAddForStart = [startSegmentName];
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

    // Check if we need to traverse the starting segment in reverse
    const distanceFromRouteEndToTargetEnd = this._getDistance(
      routeEndpoint,
      targetEnd,
    );
    const distanceFromRouteStartToTargetEnd = this._getDistance(
      routeStartPoint,
      targetEnd,
    );

    let segmentToAddForEnd = [];
    if (distanceFromRouteStartToTargetEnd < distanceFromRouteEndToTargetEnd) {
      // It's shorter to start from the beginning of the current segment, implies reversing the current segment
      const startSegmentMetrics = this.segmentMetrics.get(startSegmentName);
      if (startSegmentMetrics) {
        distanceToEnd += startSegmentMetrics.distance; // Add distance to traverse current segment in reverse
        segmentToAddForEnd = [startSegmentName];
      }
    } else {
      // It's shorter to start from the end of the current segment, implies direct continuation
      const startSegmentMetrics = this.segmentMetrics.get(startSegmentName);
      if (startSegmentMetrics) {
        distanceToEnd += startSegmentMetrics.distance;
        segmentToAddForEnd = [startSegmentName];
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
      // We need to correctly include the starting segment if it's part of the path
      const finalPath = [
        ...segmentToAddForStart,
        ...pathToTargetStart.filter((seg) => seg !== startSegmentName),
      ];
      return finalPath;
    } else {
      // Path to end of target segment is shorter
      const finalPath = [
        ...segmentToAddForEnd,
        ...pathToTargetEnd.filter((seg) => seg !== startSegmentName),
      ];
      return finalPath;
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
    // Add null/undefined checks
    if (!point1 || !point2 || 
        point1.lat === undefined || point1.lng === undefined ||
        point2.lat === undefined || point2.lng === undefined) {
      console.warn("Invalid points passed to _getDistance:", point1, point2);
      return Infinity; // Return a large distance for invalid points
    }

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

  _getPositionAlongSegment(point, segmentCoords, isReversed = false) {
    let minDistance = Infinity;
    let bestPosition = 0;
    let accumulatedDistance = 0;

    // If segment is reversed, we need to calculate position from the end
    const coords = isReversed ? [...segmentCoords].reverse() : segmentCoords;

    for (let i = 0; i < coords.length - 1; i++) {
      const segmentStart = coords[i];
      const segmentEnd = coords[i + 1];
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
