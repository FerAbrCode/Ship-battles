# Requirements Document

## Introduction

This document specifies the modularization of the Fleet Battle game codebase. The current implementation has all code (~3000 lines of JavaScript) in a single `index.html` file. This refactoring will split the code into logical modules to improve maintainability, readability, and enable AI agents to work more effectively with the codebase.

## Glossary

- **Module**: A separate JavaScript file containing related functionality
- **Game_Core**: The central game state management and main loop
- **Entity_System**: Ship, aircraft, and projectile creation and management
- **Combat_System**: Weapons, damage, and status effects
- **AI_System**: Enemy and allied ship autopilot behavior
- **Rendering_System**: Canvas drawing and visual effects
- **Input_System**: Keyboard and mouse handling
- **UI_System**: HUD, menu, and user interface management
- **Config**: Constants, ship definitions, and map data

## Requirements

### Requirement 1: Module Structure

**User Story:** As a developer, I want the game code split into logical modules, so that I can understand and modify specific systems without navigating a 3000-line file.

#### Acceptance Criteria

1. THE codebase SHALL be organized into separate JavaScript module files
2. WHEN a module is loaded, THE Module SHALL export its public functions and constants
3. THE index.html SHALL import all modules and initialize the game
4. EACH Module SHALL contain only related functionality (single responsibility)

### Requirement 2: Configuration Module

**User Story:** As a developer, I want all game constants and configuration in one place, so that I can easily tune game balance.

#### Acceptance Criteria

1. THE Config module SHALL contain all ship type definitions (DD, BB, CV, TB)
2. THE Config module SHALL contain all map definitions and spawn points
3. THE Config module SHALL contain all game constants (speeds, ranges, cooldowns)
4. THE Config module SHALL contain difficulty settings
5. THE Config module SHALL export all definitions for use by other modules

### Requirement 3: Utility Functions Module

**User Story:** As a developer, I want math and helper utilities separated, so that they can be reused across modules.

#### Acceptance Criteria

1. THE Utils module SHALL contain all math utilities (clamp, lerp, dist2, normAngle, etc.)
2. THE Utils module SHALL contain the random number generator
3. THE Utils module SHALL be importable by all other modules

### Requirement 4: Entity Management Module

**User Story:** As a developer, I want entity creation and management in a dedicated module, so that ship/aircraft logic is centralized.

#### Acceptance Criteria

1. THE Entity module SHALL contain ship creation function (mkShip)
2. THE Entity module SHALL contain battery creation function (mkBattery)
3. THE Entity module SHALL contain formation management functions
4. THE Entity module SHALL manage entity state updates

### Requirement 5: Combat System Module

**User Story:** As a developer, I want combat logic separated, so that weapons and damage can be modified independently.

#### Acceptance Criteria

1. THE Combat module SHALL contain all weapon firing functions (shells, missiles, smoke)
2. THE Combat module SHALL contain damage calculation and application
3. THE Combat module SHALL contain status effect management (fire, flooding)
4. THE Combat module SHALL contain detection and radar logic

### Requirement 6: AI System Module

**User Story:** As a developer, I want AI behavior in a dedicated module, so that enemy and ally behavior can be tuned separately.

#### Acceptance Criteria

1. THE AI module SHALL contain enemy ship AI logic
2. THE AI module SHALL contain allied ship autopilot logic
3. THE AI module SHALL contain formation following behavior
4. THE AI module SHALL contain target selection logic

### Requirement 7: Rendering Module

**User Story:** As a developer, I want all drawing code separated, so that visual changes don't affect game logic.

#### Acceptance Criteria

1. THE Rendering module SHALL contain water background rendering
2. THE Rendering module SHALL contain land/island rendering
3. THE Rendering module SHALL contain ship and entity drawing
4. THE Rendering module SHALL contain effects and UI overlay rendering
5. THE Rendering module SHALL contain minimap/radar rendering

### Requirement 8: Input Handling Module

**User Story:** As a developer, I want input handling separated, so that controls can be modified without touching game logic.

#### Acceptance Criteria

1. THE Input module SHALL handle keyboard events
2. THE Input module SHALL handle mouse events
3. THE Input module SHALL provide input state to other modules
4. THE Input module SHALL manage player ship control

### Requirement 9: Game State Module

**User Story:** As a developer, I want game state management centralized, so that the game flow is clear.

#### Acceptance Criteria

1. THE Game module SHALL contain the main game state object
2. THE Game module SHALL contain the game loop (tick function)
3. THE Game module SHALL contain level reset and progression logic
4. THE Game module SHALL coordinate all other modules

### Requirement 10: Backward Compatibility

**User Story:** As a player, I want the game to work exactly as before after refactoring, so that my gameplay experience is unchanged.

#### Acceptance Criteria

1. WHEN the refactored game loads, THE Game SHALL behave identically to the original
2. THE Game SHALL maintain all existing features and mechanics
3. THE Game SHALL have no new bugs introduced by the refactoring
