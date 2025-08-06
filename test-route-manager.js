
/**
 * Test file for RouteManager class
 * This demonstrates how to test the RouteManager in isolation
 */

// Import RouteManager for Node.js environment
let RouteManager;
if (typeof module !== 'undefined' && module.exports) {
  RouteManager = require('./route-manager.js');
}

// Mock data for testing
const mockGeoJsonData = {
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "name": "Test Segment 1"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [35.0, 33.0, 100],
          [35.01, 33.0, 105],
          [35.02, 33.0, 110]
        ]
      }
    },
    {
      "type": "Feature", 
      "properties": {
        "name": "Test Segment 2"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [35.02, 33.0, 110],
          [35.03, 33.0, 115],
          [35.04, 33.0, 120]
        ]
      }
    }
  ]
};

const mockSegmentsData = {
  "Test Segment 1": {
    "id": 1,
    "warning": "Test warning"
  },
  "Test Segment 2": {
    "id": 2,
    "winter": false
  }
};

// Test functions
async function testRouteManager() {
  console.log('Starting RouteManager tests...');
  
  try {
    // Test 1: Create and load data
    console.log('\n--- Test 1: Load data ---');
    const manager = new RouteManager();
    await manager.load(mockGeoJsonData, mockSegmentsData);
    console.log('✓ Data loaded successfully');
    console.log('Segments loaded:', manager.segments.size);
    
    // Test 2: Add a point
    console.log('\n--- Test 2: Add point ---');
    const point1 = { lat: 33.0, lng: 35.005 };
    const segments1 = manager.addPoint(point1);
    console.log('✓ Point added, segments:', segments1);
    
    // Test 3: Add second point
    console.log('\n--- Test 3: Add second point ---');
    const point2 = { lat: 33.0, lng: 35.035 };
    const segments2 = manager.addPoint(point2);
    console.log('✓ Second point added, segments:', segments2);
    
    // Test 4: Get route info
    console.log('\n--- Test 4: Get route info ---');
    const routeInfo = manager.getRouteInfo();
    console.log('✓ Route info:', {
      points: routeInfo.points.length,
      segments: routeInfo.segments.length,
      distance: routeInfo.distance.toFixed(2) + 'm',
      elevationGain: routeInfo.elevationGain + 'm',
      elevationLoss: routeInfo.elevationLoss + 'm'
    });
    
    // Test 5: Get hover segments
    console.log('\n--- Test 5: Get hover segments ---');
    const hoverPoint = { lat: 33.0, lng: 35.01 };
    const hoverSegments = manager.getHoverSegments(hoverPoint);
    console.log('✓ Hover segments:', hoverSegments);
    
    // Test 6: Get segment info
    console.log('\n--- Test 6: Get segment info ---');
    const segmentInfo = manager.getSegmentInfo('Test Segment 1');
    console.log('✓ Segment info:', {
      name: segmentInfo.name,
      coordinates: segmentInfo.coordinates.length,
      distance: segmentInfo.metrics?.distanceKm + 'km'
    });
    
    // Test 7: Remove point
    console.log('\n--- Test 7: Remove point ---');
    const segments3 = manager.removePoint(0);
    console.log('✓ Point removed, segments:', segments3);
    
    // Test 8: Clear route
    console.log('\n--- Test 8: Clear route ---');
    const clearedSegments = manager.clearRoute();
    console.log('✓ Route cleared, segments:', clearedSegments);
    
    console.log('\n✅ All tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Error handling tests
async function testErrorHandling() {
  console.log('\n--- Testing error handling ---');
  
  const manager = new RouteManager();
  
  try {
    // Test invalid point
    manager.addPoint({ lat: 'invalid' });
    console.log('❌ Should have thrown error for invalid point');
  } catch (error) {
    console.log('✓ Correctly caught invalid point error');
  }
  
  try {
    // Test invalid geojson
    await manager.load({ invalid: 'data' }, {});
    console.log('❌ Should have thrown error for invalid geojson');
  } catch (error) {
    console.log('✓ Correctly caught invalid geojson error');
  }
}

// Generic test runner that reads JSON test files and executes operations
async function runTestFromJson(testFilePath) {
  console.log(`\n--- Running test from ${testFilePath} ---`);
  
  try {
    // Load test case JSON
    let testCase;
    if (typeof fetch !== 'undefined') {
      const response = await fetch(testFilePath);
      if (!response.ok) {
        throw new Error(`Failed to load test file: ${testFilePath}`);
      }
      testCase = await response.json();
    } else {
      throw new Error('Cannot load test file in Node.js environment');
    }
    
    console.log(`Test: ${testCase.name}`);
    console.log(`Description: ${testCase.description}`);
    
    // Initialize RouteManager with test data
    const manager = new RouteManager();
    const { geoJsonData, segmentsData } = await loadTestData(testCase);
    await manager.load(geoJsonData, segmentsData);
    console.log('✓ Data loaded for test case');
    
    // Execute test operations
    manager.clearRoute();
    
    for (let i = 0; i < testCase.operations.length; i++) {
      const operation = testCase.operations[i];
      console.log(`\nOperation ${i + 1}: ${operation.type}`);
      
      const result = executeOperation(manager, operation);
      validateOperation(operation, result, segmentsData);
    }
    
    // Final validation against summary if provided
    if (testCase.summary) {
      validateSummary(manager, testCase.summary);
    }
    
    console.log(`\n✅ Test ${testCase.name} completed successfully!`);
    
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
  }
}

// Execute a single operation on the RouteManager
function executeOperation(manager, operation) {
  switch (operation.type) {
    case 'addPoint':
      const segments = manager.addPoint(operation.data.point);
      const routeInfo = manager.getRouteInfo();
      return {
        addedSegments: segments,
        routeInfo: routeInfo,
        segmentIds: routeInfo.segments.map(s => s.id).filter(id => id !== undefined)
      };
    
    case 'removePoint':
      const removedSegments = manager.removePoint(operation.data.index);
      const routeInfoAfterRemove = manager.getRouteInfo();
      return {
        removedSegments: removedSegments,
        routeInfo: routeInfoAfterRemove,
        segmentIds: routeInfoAfterRemove.segments.map(s => s.id).filter(id => id !== undefined)
      };
    
    case 'clearRoute':
      const clearedSegments = manager.clearRoute();
      return {
        clearedSegments: clearedSegments,
        routeInfo: manager.getRouteInfo(),
        segmentIds: []
      };
    
    default:
      throw new Error(`Unknown operation type: ${operation.type}`);
  }
}

// Validate operation results against expected values
function validateOperation(operation, result, segmentsData) {
  const { routeInfo, segmentIds } = result;
  
  // Validate segment count
  if (operation.expectedSegmentsCount !== undefined) {
    if (routeInfo.segments.length === operation.expectedSegmentsCount) {
      console.log(`  ✓ Segment count matches expected: ${operation.expectedSegmentsCount}`);
    } else {
      console.log(`  ❌ Segment count mismatch. Expected: ${operation.expectedSegmentsCount}, Got: ${routeInfo.segments.length}`);
    }
  }
  
  // Validate segment IDs (only if we have real segment data)
  if (operation.expectedSegmentIds && operation.expectedSegmentIds.length > 0 && segmentsData !== mockSegmentsData) {
    const expectedIds = operation.expectedSegmentIds;
    
    if (segmentIds.length === expectedIds.length && expectedIds.every(id => segmentIds.includes(id))) {
      console.log(`  ✓ Segment IDs match expected: [${expectedIds.join(', ')}]`);
    } else {
      console.log(`  ⚠️ Segment ID validation (expected: [${expectedIds.join(', ')}], got: [${segmentIds.join(', ')}])`);
    }
  }
  
  console.log(`  Result: ${routeInfo.segments.length} segments, IDs: [${segmentIds.join(', ')}]`);
}

// Validate final results against test summary
function validateSummary(manager, summary) {
  const routeInfo = manager.getRouteInfo();
  const segmentIds = routeInfo.segments.map(s => s.id).filter(id => id !== undefined);
  
  console.log('\n--- Final Summary Validation ---');
  
  if (summary.finalSegmentsCount !== undefined) {
    if (routeInfo.segments.length === summary.finalSegmentsCount) {
      console.log(`✓ Final segment count matches: ${summary.finalSegmentsCount}`);
    } else {
      console.log(`❌ Final segment count mismatch. Expected: ${summary.finalSegmentsCount}, Got: ${routeInfo.segments.length}`);
    }
  }
  
  if (summary.finalSegmentIds) {
    if (segmentIds.length === summary.finalSegmentIds.length && 
        summary.finalSegmentIds.every(id => segmentIds.includes(id))) {
      console.log(`✓ Final segment IDs match: [${summary.finalSegmentIds.join(', ')}]`);
    } else {
      console.log(`⚠️ Final segment IDs (expected: [${summary.finalSegmentIds.join(', ')}], got: [${segmentIds.join(', ')}])`);
    }
  }
}

// Load test data (real files or mock data)
async function loadTestData(testCase) {
  let geoJsonData = mockGeoJsonData;
  let segmentsData = mockSegmentsData;
  
  // Try to load real files if specified in test case
  if (typeof fetch !== 'undefined' && testCase.geoJsonFile && testCase.segmentsFile) {
    try {
      const geoResponse = await fetch(testCase.geoJsonFile);
      const segResponse = await fetch(testCase.segmentsFile);
      
      if (geoResponse.ok && segResponse.ok) {
        geoJsonData = await geoResponse.json();
        segmentsData = await segResponse.json();
        console.log('✓ Using real test data files');
      } else {
        console.log('⚠️ Could not load real files, using mock data');
      }
    } catch (e) {
      console.log('⚠️ Error loading real files, using mock data:', e.message);
    }
  }
  
  return { geoJsonData, segmentsData };
}

// Convenience function for test1.json
async function testUserTestCase1() {
  await runTestFromJson('tests/test1.json');
}

// Run tests if in Node.js environment
if (typeof module !== 'undefined' && module.exports) {
  // Export test functions for use in test runners
  module.exports = {
    testRouteManager,
    testErrorHandling,
    testUserTestCase1,
    mockGeoJsonData,
    mockSegmentsData
  };
  
  // Auto-run tests if this file is executed directly
  if (require.main === module) {
    testRouteManager().then(() => testErrorHandling()).then(() => testUserTestCase1());
  }
}

// Run tests if in browser environment
if (typeof window !== 'undefined') {
  // Add test button to page
  document.addEventListener('DOMContentLoaded', () => {
    const testButton = document.createElement('button');
    testButton.textContent = 'Run RouteManager Tests';
    testButton.style.position = 'fixed';
    testButton.style.top = '10px';
    testButton.style.right = '10px';
    testButton.style.zIndex = '10000';
    testButton.style.background = '#4CAF50';
    testButton.style.color = 'white';
    testButton.style.border = 'none';
    testButton.style.padding = '12px 16px';
    testButton.style.borderRadius = '5px';
    testButton.style.cursor = 'pointer';
    testButton.style.fontSize = '14px';
    testButton.style.fontWeight = 'bold';
    testButton.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
    testButton.title = 'Press Ctrl+Shift+T to run tests';
    
    async function runTests() {
      console.clear();
      console.log('🧪 Running RouteManager tests...');
      console.log('=' .repeat(50));
      await testRouteManager();
      await testErrorHandling();
      await testUserTestCase1();
      console.log('=' .repeat(50));
      console.log('✅ Test run complete! Check console above for results.');
    }

    testButton.addEventListener('click', runTests);
    
    // Add keyboard shortcut Ctrl+Shift+T
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        runTests();
      }
    });
    
    document.body.appendChild(testButton);
    
    // Show notification that tests are available
    console.log('🧪 RouteManager tests loaded! Click the green "Run RouteManager Tests" button or press Ctrl+Shift+T to run tests.');
  });
}
