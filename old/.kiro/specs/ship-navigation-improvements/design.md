# Design Document: Ship Navigation Improvements

## Overview

This design document describes the implementation of three navigation improvements for the Fleet Battle game: proper rudder angle constraints, smoother collision avoidance, and a throttle control system. These changes will make ship movement feel more realistic and give players better tactical control.

## Architecture

The navigation improvements integrate into the existing ship simulation loop:

```
┌─────────────────────────────────────────────────────────────────┐
│                      Game Loop (tick)                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ Player Input │───▶│   Throttle   │───▶│   Rudder     │      │
│  │   (W/S/A/D)  │    │   System     │    │   System     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────────────────────────────────────────────┐      │
│  │              Collision Avoidance System               │      │
│  │  (Smooth steering based on predicted ship paths)      │      │
│  └──────────────────────────────────────────────────────┘      │
│                            │                                    │
│                            ▼                                    │
│  ┌──────────────────────────────────────────────────────┐      │
│  │                   Physics Step                        │      │
│  │  (Apply thrust based on throttle, apply drag)         │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Ship Entity Extensions

Add new properties to the ship object:

```javascript
// New ship properties
{
  throttle: 50,        // 0-100 percentage, default 50%
  rudderAngle: 0,      // Current rudder angle in radians, clamped to ±π/6
}
```

### 2. Rudder System

The rudder system constrains steering to ±30 degrees and applies proportional turn rates.

```javascript
const MAX_RUDDER_ANGLE = Math.PI / 6; // 30 degrees

function applyRudder(ship, desiredTurn, dt) {
  // Clamp rudder angle to ±30 degrees
  const rudderAngle = clamp(desiredTurn, -MAX_RUDDER_ANGLE, MAX_RUDDER_ANGLE);
  ship.rudderAngle = rudderAngle;
  
  // Turn rate proportional to rudder angle
  const turnFraction = Math.abs(rudderAngle) / MAX_RUDDER_ANGLE;
  const turnRate = ship.kind.turnRate * turnFraction;
  const turnDirection = Math.sign(rudderAngle);
  
  ship.heading += turnDirection * turnRate * dt;
}
```

### 3. Throttle System

The throttle system manages engine power as a persistent percentage value.

```javascript
const THROTTLE_CHANGE_RATE = 25; // % per second

function updateThrottle(ship, input, dt) {
  if (input.throttleUp) {
    ship.throttle = Math.min(100, ship.throttle + THROTTLE_CHANGE_RATE * dt);
  }
  if (input.throttleDown) {
    ship.throttle = Math.max(0, ship.throttle - THROTTLE_CHANGE_RATE * dt);
  }
}

function applyThrust(ship, dt) {
  const targetSpeed = ship.kind.maxSpeed * (ship.throttle / 100);
  const currentSpeed = Math.hypot(ship.vx, ship.vy);
  
  // Accelerate or decelerate toward target speed
  const accel = (currentSpeed < targetSpeed) 
    ? ship.kind.accel 
    : -ship.kind.accel * 0.5;
  
  ship.vx += Math.cos(ship.heading) * accel * dt;
  ship.vy += Math.sin(ship.heading) * accel * dt;
}
```

### 4. Smooth Collision Avoidance System

The collision avoidance system predicts ship paths and applies gradual steering corrections.

```javascript
const AVOIDANCE_RANGE = 200;      // Detection range
const PREDICTION_TIME = 3.0;      // Seconds to look ahead
const MAX_AVOIDANCE_FORCE = 0.3;  // Maximum steering influence (0-1)

function calculateAvoidanceSteering(ship, allShips) {
  let avoidanceAngle = 0;
  let totalWeight = 0;
  
  for (const other of allShips) {
    if (other === ship || !other.alive) continue;
    
    // Calculate relative position and velocity
    const dx = other.x - ship.x;
    const dy = other.y - ship.y;
    const distance = Math.hypot(dx, dy);
    
    if (distance > AVOIDANCE_RANGE) continue;
    
    // Predict future positions
    const futureShipX = ship.x + ship.vx * PREDICTION_TIME;
    const futureShipY = ship.y + ship.vy * PREDICTION_TIME;
    const futureOtherX = other.x + other.vx * PREDICTION_TIME;
    const futureOtherY = other.y + other.vy * PREDICTION_TIME;
    
    // Calculate closest approach
    const futureDist = Math.hypot(futureOtherX - futureShipX, futureOtherY - futureShipY);
    const minSafeDist = ship.kind.radius + other.kind.radius + 80;
    
    if (futureDist < minSafeDist) {
      // Calculate avoidance direction (perpendicular to approach)
      const approachAngle = Math.atan2(dy, dx);
      const relativeVelAngle = Math.atan2(other.vy - ship.vy, other.vx - ship.vx);
      
      // Steer perpendicular to the collision course
      // Choose direction that requires less turning
      const perpLeft = approachAngle - Math.PI / 2;
      const perpRight = approachAngle + Math.PI / 2;
      const headingDiffLeft = Math.abs(normAngle(perpLeft - ship.heading));
      const headingDiffRight = Math.abs(normAngle(perpRight - ship.heading));
      
      const avoidDir = (headingDiffLeft < headingDiffRight) ? perpLeft : perpRight;
      
      // Weight by proximity (closer = stronger avoidance)
      const weight = 1 - (distance / AVOIDANCE_RANGE);
      avoidanceAngle += normAngle(avoidDir - ship.heading) * weight;
      totalWeight += weight;
    }
  }
  
  if (totalWeight > 0) {
    // Return smooth avoidance steering, scaled by MAX_AVOIDANCE_FORCE
    return clamp(avoidanceAngle / totalWeight, -MAX_AVOIDANCE_FORCE, MAX_AVOIDANCE_FORCE);
  }
  
  return 0;
}
```

## Data Models

### Ship State Extension

```javascript
// Extended ship state
interface ShipState {
  // Existing properties...
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  
  // New properties
  throttle: number;      // 0-100, engine power percentage
  rudderAngle: number;   // Current rudder angle in radians
}
```

### Input State

```javascript
interface InputState {
  throttleUp: boolean;   // W key
  throttleDown: boolean; // S key
  steerLeft: boolean;    // A key
  steerRight: boolean;   // D key
}
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Rudder Angle Clamping

*For any* desired turn angle input to the rudder system, the resulting rudder angle SHALL always be within the range [-π/6, +π/6] (±30 degrees).

**Validates: Requirements 1.1, 1.2**

### Property 2: Turn Rate Proportionality

*For any* valid rudder angle within ±30 degrees, the ship's turn rate SHALL equal `(|rudderAngle| / MAX_RUDDER_ANGLE) * ship.kind.turnRate`.

**Validates: Requirements 1.3, 1.4**

### Property 3: Avoidance Uses Velocity Prediction

*For any* two ships where one is within avoidance range of the other, the collision avoidance calculation SHALL incorporate the velocity vectors of both ships to predict future positions.

**Validates: Requirements 2.1, 2.4**

### Property 4: Avoidance Steering is Bounded

*For any* collision avoidance scenario, the steering adjustment applied per frame SHALL not exceed `MAX_AVOIDANCE_FORCE` (ensuring smooth, gradual corrections).

**Validates: Requirements 2.2**

### Property 5: Avoidance Direction is Perpendicular

*For any* collision avoidance maneuver, the avoidance steering direction SHALL be approximately perpendicular to the approach vector (±90 degrees from the line between ships), not opposite to the ship's current heading.

**Validates: Requirements 2.3**

### Property 6: Avoidance Scales with Distance

*For any* ship within avoidance range, the avoidance force weight SHALL be proportional to `(1 - distance / AVOIDANCE_RANGE)`, being stronger when closer and weaker at the edge of detection.

**Validates: Requirements 2.5, 2.6**

### Property 7: Throttle Value Clamping

*For any* throttle modification operation, the resulting throttle value SHALL always be within the range [0, 100].

**Validates: Requirements 3.1**

### Property 8: Target Speed Proportionality

*For any* throttle value T, the ship's target speed SHALL equal `(T / 100) * ship.kind.maxSpeed`.

**Validates: Requirements 3.4**

### Property 9: Throttle Input Response

*For any* frame where the throttle-up key is pressed, the throttle SHALL increase (unless already at 100%). *For any* frame where the throttle-down key is pressed, the throttle SHALL decrease (unless already at 0%).

**Validates: Requirements 3.5, 3.6**

### Property 10: Throttle Persistence

*For any* frame where no throttle keys are pressed, the throttle value SHALL remain unchanged from the previous frame.

**Validates: Requirements 4.1, 4.2**

### Property 11: Throttle Incremental Change

*For any* single frame of throttle key input, the throttle change SHALL not exceed `THROTTLE_CHANGE_RATE * dt` (ensuring gradual changes, not instant jumps).

**Validates: Requirements 4.3**

## Error Handling

### Invalid Input Handling

- If throttle value somehow becomes NaN or undefined, reset to 50% (default)
- If rudder angle calculation produces NaN, reset to 0 (straight ahead)
- If collision avoidance detects division by zero (ships at same position), skip that ship

### Edge Cases

- Ships at exactly the same position: Use random perpendicular direction for avoidance
- Throttle at boundaries (0% or 100%): Clamp and ignore further input in that direction
- Multiple ships requiring conflicting avoidance: Weight by distance, closest ship has priority

## Testing Strategy

### Unit Tests

Unit tests will verify specific examples and edge cases:

1. Rudder at exactly ±30 degrees produces maximum turn rate
2. Throttle at 0% produces zero thrust
3. Throttle at 100% produces maximum acceleration
4. Two ships on direct collision course trigger avoidance
5. UI displays correct throttle percentage

### Property-Based Tests

Property-based tests will use a JavaScript PBT library (fast-check) to verify universal properties:

- **Minimum 100 iterations** per property test
- Each test tagged with: **Feature: ship-navigation-improvements, Property N: [property text]**

Test configuration:
```javascript
import fc from 'fast-check';

// Example property test structure
describe('Ship Navigation Properties', () => {
  it('Property 1: Rudder angle is always clamped to ±30 degrees', () => {
    fc.assert(
      fc.property(
        fc.float({ min: -Math.PI, max: Math.PI }), // Any desired turn angle
        (desiredAngle) => {
          const result = applyRudder(desiredAngle);
          return result >= -Math.PI/6 && result <= Math.PI/6;
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Integration Points

- Verify throttle integrates with existing physics step
- Verify collision avoidance works with formation system
- Verify rudder constraints work with AI steering
