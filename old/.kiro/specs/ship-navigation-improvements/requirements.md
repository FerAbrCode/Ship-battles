# Requirements Document

## Introduction

This document specifies improvements to the ship navigation system in the Fleet Battle game. The changes address three key areas: proper rudder angle constraints, smoother collision avoidance behavior, and a new throttle control system for variable ship speed.

## Glossary

- **Ship**: A naval vessel entity in the game with properties including position, velocity, heading, and kind (DD, BB, CV, TB)
- **Rudder_Angle**: The angle of the ship's rudder relative to the centerline, controlling turn rate
- **Throttle**: A percentage value (0-100%) controlling the ship's engine power output
- **Collision_Avoidance_System**: The subsystem that detects nearby ships and adjusts steering to prevent collisions
- **Heading**: The direction the ship is facing, measured in radians
- **Max_Speed**: The maximum velocity a ship can achieve at 100% throttle

## Requirements

### Requirement 1: Rudder Angle Constraints

**User Story:** As a player, I want the ship's rudder to be constrained to realistic angles (±30 degrees), so that ship turning feels authentic and predictable.

#### Acceptance Criteria

1. THE Rudder_Angle SHALL be constrained to a maximum of +30 degrees (π/6 radians) and minimum of -30 degrees (-π/6 radians)
2. WHEN a steering input requests a turn beyond ±30 degrees, THE Ship SHALL apply the maximum allowed rudder angle of ±30 degrees
3. THE Ship turn rate SHALL be proportional to the current rudder angle within the ±30 degree range
4. WHEN the rudder angle is at maximum (±30 degrees), THE Ship SHALL turn at its maximum turn rate

### Requirement 2: Smooth Collision Avoidance

**User Story:** As a player, I want ships to smoothly steer away from potential collisions, so that fleet movements look natural rather than jerky.

#### Acceptance Criteria

1. WHEN the Collision_Avoidance_System detects another ship within avoidance range, THE Ship SHALL calculate an evasive heading based on the other ship's velocity and predicted path
2. THE Collision_Avoidance_System SHALL apply gradual steering adjustments rather than abrupt direction changes
3. WHEN avoiding a collision, THE Ship SHALL steer to pass behind or alongside the other ship's predicted path rather than reversing direction
4. THE Collision_Avoidance_System SHALL consider the relative speed and heading of both ships when calculating avoidance maneuvers
5. WHEN multiple ships are nearby, THE Collision_Avoidance_System SHALL prioritize avoiding the closest threat while maintaining smooth steering
6. THE avoidance steering force SHALL scale smoothly with distance, being minimal at the outer detection range and increasing as ships get closer

### Requirement 3: Throttle Control System

**User Story:** As a player, I want to control my ship's engine power with a throttle, so that I can manage speed tactically during combat.

#### Acceptance Criteria

1. THE Ship SHALL have a throttle property ranging from 0% to 100%
2. WHEN throttle is at 0%, THE Ship SHALL not apply forward thrust and gradually decelerate due to drag
3. WHEN throttle is at 100%, THE Ship SHALL accelerate toward its maximum speed
4. THE Ship's target speed SHALL be proportional to the throttle percentage (throttle × max_speed)
5. WHEN the player presses the forward key (W), THE Ship throttle SHALL increase
6. WHEN the player presses the backward key (S), THE Ship throttle SHALL decrease
7. THE throttle value SHALL be displayed in the ship's UI indicator
8. WHEN an AI ship is navigating, THE AI SHALL adjust throttle based on tactical situation (higher when pursuing, lower when in formation)

### Requirement 4: Throttle Persistence

**User Story:** As a player, I want my throttle setting to persist until I change it, so that I don't have to hold keys to maintain speed.

#### Acceptance Criteria

1. THE throttle value SHALL persist between frames without requiring continuous key input
2. WHEN no throttle keys are pressed, THE Ship SHALL maintain its current throttle setting
3. THE throttle SHALL change incrementally when keys are pressed, not jump to 0% or 100% instantly
