
// Tutorial system for bike route planner
class Tutorial {
  constructor() {
    this.currentStep = 0;
    this.isActive = false;
    this.tutorialRoute = 'AQByAAcABAAFAFgAYABeAAoAeAAZAHIA';
    this.originalSegments = [];
    this.steps = [
      {
        title: 'ברוכים הבאים למתכנן מסלולי הרכיבה!',
        content: 'בואו נלמד יחד איך להשתמש במפה כדי לתכנן מסלולי רכיבה מותאמים אישית',
        target: null,
        position: 'center'
      },
      {
        title: 'חיפוש מיקום',
        content: 'השתמשו בשדה החיפוש כדי לנווט למקומות שונים במפה. נסו להקליד "דפנה" או "בניאס"',
        target: '.search-input-group',
        position: 'bottom'
      },
      {
        title: 'בחירת קטעי מסלול',
        content: 'לחצו על קטעי המפה כדי להוסיף אותם למסלול שלכם. הקטעים הנבחרים יוצגו בירוק',
        target: '#map',
        position: 'top',
        highlight: 'segments'
      },
      {
        title: 'מידע על המסלול',
        content: 'כאן תוכלו לראות את המרחק הכולל, עליות וירידות, וגרף הגובה של המסלול',
        target: '.route-description-panel',
        position: 'top'
      },
      {
        title: 'גרף הגובה האינטראקטיבי',
        content: 'העבירו את העכבר על גרף הגובה כדי לראות את הגובה בנקודות שונות במסלול',
        target: '.elevation-chart',
        position: 'top',
        action: 'hover-elevation'
      },
      {
        title: 'כפתורי ניהול המסלול',
        content: 'השתמשו בכפתורים האלה כדי לבטל פעולות, לאפס את המסלול או להוריד קובץ GPX',
        target: '.top-controls',
        position: 'bottom'
      },
      {
        title: 'הורדת קובץ GPX',
        content: 'לחצו על כפתור GPX כדי להוריד את המסלול ולהשתמש בו באפליקציות ניווט',
        target: '#download-gpx',
        position: 'bottom'
      },
      {
        title: 'זהו! אתם מוכנים לתכנן מסלולים',
        content: 'עכשיו אתם יכולים להתחיל לבנות מסלולי רכיבה מותאמים אישית. בהצלחה!',
        target: null,
        position: 'center'
      }
    ];
  }

  shouldShowTutorial() {
    // Don't show if tutorial was already seen
    if (localStorage.getItem('bikeRouteTutorialSeen') === 'true') {
      return false;
    }

    // Don't show if there's a route parameter
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('route')) {
      return false;
    }

    return true;
  }

  start() {
    if (!this.shouldShowTutorial()) {
      return;
    }

    this.isActive = true;
    this.originalSegments = [...selectedSegments];
    
    // Load tutorial route
    this.loadTutorialRoute();
    
    // Create tutorial overlay
    this.createTutorialOverlay();
    
    // Show first step
    this.showStep(0);
  }

  loadTutorialRoute() {
    // Decode and load the tutorial route
    const decodedSegments = decodeRoute(this.tutorialRoute);
    if (decodedSegments.length > 0) {
      selectedSegments.length = 0;
      selectedSegments.push(...decodedSegments);
      
      // Wait for map to be ready and update styles
      setTimeout(() => {
        updateSegmentStyles();
        updateRouteListAndDescription();
      }, 500);
    }
  }

  createTutorialOverlay() {
    // Create dark overlay
    const overlay = document.createElement('div');
    overlay.className = 'tutorial-overlay';
    overlay.id = 'tutorial-overlay';
    document.body.appendChild(overlay);

    // Create tutorial modal
    const modal = document.createElement('div');
    modal.className = 'tutorial-modal';
    modal.id = 'tutorial-modal';
    document.body.appendChild(modal);
  }

  showStep(stepIndex) {
    if (stepIndex >= this.steps.length) {
      this.finish();
      return;
    }

    this.currentStep = stepIndex;
    const step = this.steps[stepIndex];
    const modal = document.getElementById('tutorial-modal');

    // Clear previous highlights
    this.clearHighlights();

    // Update modal content
    modal.innerHTML = `
      <div class="tutorial-content">
        <div class="tutorial-header">
          <h3>${step.title}</h3>
          <div class="tutorial-progress">
            <span>${stepIndex + 1} מתוך ${this.steps.length}</span>
          </div>
        </div>
        <div class="tutorial-body">
          <p>${step.content}</p>
        </div>
        <div class="tutorial-footer">
          ${stepIndex > 0 ? '<button class="tutorial-btn tutorial-prev">הקודם</button>' : ''}
          ${stepIndex < this.steps.length - 1 ? 
            '<button class="tutorial-btn tutorial-next">הבא</button>' : 
            '<button class="tutorial-btn tutorial-done">סיום</button>'
          }
          <button class="tutorial-btn tutorial-skip">דלג על המדריך</button>
        </div>
      </div>
    `;

    // Position modal
    this.positionModal(step);

    // Add highlights if needed
    if (step.highlight) {
      this.addHighlight(step);
    }

    // Add event listeners
    this.addStepEventListeners(step);
  }

  positionModal(step) {
    const modal = document.getElementById('tutorial-modal');
    
    if (!step.target || step.position === 'center') {
      modal.className = 'tutorial-modal tutorial-center';
      return;
    }

    const target = document.querySelector(step.target);
    if (!target) {
      modal.className = 'tutorial-modal tutorial-center';
      return;
    }

    const targetRect = target.getBoundingClientRect();
    modal.className = `tutorial-modal tutorial-${step.position}`;

    // Position based on target and direction
    switch (step.position) {
      case 'top':
        modal.style.left = `${targetRect.left + targetRect.width / 2}px`;
        modal.style.top = `${targetRect.top - 20}px`;
        modal.style.transform = 'translate(-50%, -100%)';
        break;
      case 'bottom':
        modal.style.left = `${targetRect.left + targetRect.width / 2}px`;
        modal.style.top = `${targetRect.bottom + 20}px`;
        modal.style.transform = 'translate(-50%, 0)';
        break;
      case 'left':
        modal.style.left = `${targetRect.left - 20}px`;
        modal.style.top = `${targetRect.top + targetRect.height / 2}px`;
        modal.style.transform = 'translate(-100%, -50%)';
        break;
      case 'right':
        modal.style.left = `${targetRect.right + 20}px`;
        modal.style.top = `${targetRect.top + targetRect.height / 2}px`;
        modal.style.transform = 'translate(0, -50%)';
        break;
    }
  }

  addHighlight(step) {
    if (step.highlight === 'segments') {
      // Highlight all selected segments with a pulsing effect
      routePolylines.forEach(polylineData => {
        if (selectedSegments.includes(polylineData.segmentName)) {
          const layerId = polylineData.layerId;
          map.setPaintProperty(layerId, 'line-color', '#ffff00');
          map.setPaintProperty(layerId, 'line-width', polylineData.originalStyle.weight + 3);
        }
      });

      // Animate the highlight
      let pulseCount = 0;
      const pulseInterval = setInterval(() => {
        routePolylines.forEach(polylineData => {
          if (selectedSegments.includes(polylineData.segmentName)) {
            const layerId = polylineData.layerId;
            const isHighlighted = pulseCount % 2 === 0;
            map.setPaintProperty(layerId, 'line-color', isHighlighted ? '#ffff00' : '#006699');
          }
        });
        pulseCount++;
        
        if (pulseCount >= 6) {
          clearInterval(pulseInterval);
          // Reset to normal selection style
          updateSegmentStyles();
        }
      }, 500);
    }

    if (step.target && step.target !== '#map') {
      const target = document.querySelector(step.target);
      if (target) {
        target.classList.add('tutorial-highlight');
      }
    }
  }

  clearHighlights() {
    // Remove tutorial highlight class from all elements
    document.querySelectorAll('.tutorial-highlight').forEach(el => {
      el.classList.remove('tutorial-highlight');
    });
  }

  addStepEventListeners(step) {
    const modal = document.getElementById('tutorial-modal');

    // Next button
    const nextBtn = modal.querySelector('.tutorial-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.showStep(this.currentStep + 1);
      });
    }

    // Previous button
    const prevBtn = modal.querySelector('.tutorial-prev');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        this.showStep(this.currentStep - 1);
      });
    }

    // Done button
    const doneBtn = modal.querySelector('.tutorial-done');
    if (doneBtn) {
      doneBtn.addEventListener('click', () => {
        this.finish();
      });
    }

    // Skip button
    const skipBtn = modal.querySelector('.tutorial-skip');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        this.finish();
      });
    }

    // Special actions for specific steps
    if (step.action === 'hover-elevation') {
      // Simulate elevation hover
      setTimeout(() => {
        const elevationChart = document.querySelector('.elevation-chart');
        if (elevationChart) {
          // Create a fake hover event to show the elevation marker
          const event = new MouseEvent('mousemove', {
            clientX: elevationChart.getBoundingClientRect().left + elevationChart.getBoundingClientRect().width / 2,
            clientY: elevationChart.getBoundingClientRect().top + elevationChart.getBoundingClientRect().height / 2
          });
          
          const overlay = elevationChart.querySelector('.elevation-hover-overlay');
          if (overlay) {
            overlay.dispatchEvent(event);
          }
        }
      }, 1000);
    }
  }

  finish() {
    this.isActive = false;
    
    // Mark tutorial as seen
    localStorage.setItem('bikeRouteTutorialSeen', 'true');
    
    // Clear tutorial route
    selectedSegments.length = 0;
    selectedSegments.push(...this.originalSegments);
    updateSegmentStyles();
    updateRouteListAndDescription();
    
    // Remove tutorial elements
    this.clearHighlights();
    
    const overlay = document.getElementById('tutorial-overlay');
    const modal = document.getElementById('tutorial-modal');
    
    if (overlay) overlay.remove();
    if (modal) modal.remove();
    
    // Remove elevation marker if it exists
    if (window.elevationMarker) {
      window.elevationMarker.remove();
      window.elevationMarker = null;
    }
  }

  // Method to reset tutorial (for testing purposes)
  static reset() {
    localStorage.removeItem('bikeRouteTutorialSeen');
  }
}

// Initialize tutorial when DOM is ready
let tutorial = null;

function initTutorial() {
  tutorial = new Tutorial();
  
  // Start tutorial after map is loaded and ready
  setTimeout(() => {
    if (tutorial.shouldShowTutorial()) {
      tutorial.start();
    }
  }, 2000); // Wait for map and data to load
}

// Export for global access
window.Tutorial = Tutorial;
window.initTutorial = initTutorial;
