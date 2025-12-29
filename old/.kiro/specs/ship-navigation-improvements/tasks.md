# Implementation Plan: Ship Navigation Improvements

## Overview

This plan implements three navigation improvements: rudder angle constraints (±30°), smooth collision avoidance, and a throttle control system. Tasks are ordered to build incrementally, with each feature testable independently.

## Tasks

- [x] 1. Add throttle property to ship entities
  - Add `throttle` property (default 50) to `mkShip` function
  - Add `rudderAngle` property (default 0) to `mkShip` function
  - _Requirements: 3.1, 1.1_

- [x] 2. Implement throttle control system
  - [x] 2.1 Create throttle update function
    - Implement `updateThrottle(ship, dt)` that increases/decreases throttle based on W/S keys
    - Use `THROTTLE_CHANGE_RATE = 25` (% per second)
    - Clamp throttle to [0, 100]
    - _Requirements: 3.1, 3.5, 3.6, 4.3_

  - [x] 2.2 Modify playerControl to use throttle
    - Replace direct acceleration with throttle-based system
    - Calculate target speed as `throttle/100 * maxSpeed`
    - Apply acceleration toward target speed
    - _Requirements: 3.2, 3.3, 3.4, 4.1, 4.2_

  - [ ]* 2.3 Write property tests for throttle system
    - **Property 7: Throttle Value Clamping**
    - **Property 8: Target Speed Proportionality**
    - **Property 9: Throttle Input Response**
    - **Property 10: Throttle Persistence**
    - **Property 11: Throttle Incremental Change**
    - **Validates: Requirements 3.1, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3**

- [x] 3. Implement rudder angle constraints
  - [x] 3.1 Create rudder application function
    - Implement `applyRudder(ship, desiredTurn, dt)` function
    - Clamp rudder angle to ±π/6 (30 degrees)
    - Calculate turn rate proportional to rudder angle
    - Apply turn to ship heading
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 3.2 Update playerControl to use rudder system
    - Replace direct heading modification with rudder-based steering
    - A/D keys set desired turn direction
    - _Requirements: 1.1, 1.2_

  - [x] 3.3 Update steerToPoint to use rudder constraints
    - Modify AI steering to respect ±30° rudder limit
    - Remove emergency rudder override (was 45°)
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 3.4 Write property tests for rudder system
    - **Property 1: Rudder Angle Clamping**
    - **Property 2: Turn Rate Proportionality**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

- [x] 4. Implement smooth collision avoidance
  - [x] 4.1 Create velocity-based avoidance calculation
    - Implement `calculateAvoidanceSteering(ship, allShips)` function
    - Predict future positions using velocity vectors
    - Calculate perpendicular avoidance direction
    - Weight by distance (closer = stronger)
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6_

  - [x] 4.2 Integrate avoidance into steerToPoint
    - Replace current aggressive collision avoidance
    - Add avoidance steering as a smooth adjustment to desired heading
    - Cap avoidance influence with MAX_AVOIDANCE_FORCE
    - _Requirements: 2.2_

  - [x] 4.3 Update separationTeam to remove physical bumping
    - Keep collision detection for flooding/damage
    - Remove velocity-based separation push
    - Let steering-based avoidance handle separation
    - _Requirements: 2.2, 2.3_

  - [ ]* 4.4 Write property tests for collision avoidance
    - **Property 3: Avoidance Uses Velocity Prediction**
    - **Property 4: Avoidance Steering is Bounded**
    - **Property 5: Avoidance Direction is Perpendicular**
    - **Property 6: Avoidance Scales with Distance**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

- [x] 5. Update AI to use throttle
  - [x] 5.1 Add throttle logic to AI steering
    - AI ships use higher throttle when pursuing targets
    - AI ships use lower throttle when in formation
    - Default AI throttle based on distance to target/waypoint
    - _Requirements: 3.8_

  - [x] 5.2 Update capitalAutoPilot throttle behavior
    - Capital ships maintain moderate throttle in formation
    - Increase throttle when engaging enemies
    - _Requirements: 3.8_

- [x] 6. Update UI to display throttle
  - Add throttle indicator to HUD
  - Display as percentage (e.g., "Throttle: 75%")
  - _Requirements: 3.7_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties
- The implementation modifies existing functions rather than creating new files
