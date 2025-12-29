# Implementation Plan: Code Modularization

## Overview

This plan refactors the Fleet Battle game from a single index.html file into modular JavaScript files. Tasks are ordered to build the dependency tree from the bottom up, starting with modules that have no dependencies.

## Tasks

- [x] 1. Create project structure
  - Create js/ directory
  - _Requirements: 1.1_

- [x] 2. Extract configuration module
  - [x] 2.1 Create js/config.js with all constants
    - Extract TAU, MAP_SCALE, WORLD, VIEW constants
    - Extract DIFFS difficulty settings
    - Extract MAPS array with all map definitions
    - Extract BATTLES configuration
    - Extract ship definitions (DD, BB, CV, TB, BATTERY)
    - Extract MISSILE, FX, FIGHTER, RECON constants
    - Extract physics constants (DRAG_DD, DRAG_BB, speeds, etc.)
    - Export all constants
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 3. Extract utilities module
  - [x] 3.1 Create js/utils.js with math helpers
    - Extract clamp, lerp, dist2, len functions
    - Extract normAngle, angleTo functions
    - Extract rand function
    - Export all utilities
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 3.2 Write property tests for utils
    - **Property 1: Clamp Function Bounds**
    - **Property 2: Lerp Interpolation Range**
    - **Property 3: Random Number Range**
    - **Validates: Requirements 3.1, 3.2**

- [x] 4. Extract entities module
  - [x] 4.1 Create js/entities.js with entity creation
    - Extract mkShip function
    - Extract mkBattery function
    - Extract formation functions (formationOffsets, formationSpawns, setFormation)
    - Extract formationPoint, pickCapitalLeader functions
    - Import from config.js and utils.js
    - Export all entity functions
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 4.2 Write property tests for entities
    - **Property 4: Ship Creation Validity**
    - **Validates: Requirements 4.1**

- [x] 5. Extract combat module
  - [x] 5.1 Create js/combat.js with combat functions
    - Extract smoke functions (smokeAt, trySmoke, inSmoke, updateSmokeDeployment)
    - Extract weapon functions (fireShellAtPoint, tryFireAtPoint, tryMissile)
    - Extract tryExtinguish function
    - Extract damage functions (damageShip, damageBattery, sinkIfDead)
    - Extract status functions (statusStep)
    - Extract detection functions (updateDetections, canSee, revealToTeam, shotSpotting)
    - Extract turretStep, qbez, shellPos functions
    - Extract step functions (shellsStep, missilesStep, smokesStep, fxStep)
    - Import from config.js and utils.js
    - Export all combat functions
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 5.2 Write property tests for combat
    - **Property 5: Damage Reduction by Armor**
    - **Property 6: Status Effect Damage Over Time**
    - **Validates: Requirements 5.2, 5.3**

- [x] 6. Extract AI module
  - [x] 6.1 Create js/ai.js with AI functions
    - Extract collision avoidance (calculateAvoidanceSteering)
    - Extract steering functions (steerToPoint, avoidLandTarget)
    - Extract AI throttle functions (updateAIThrottle, calculateAITargetThrottle)
    - Extract aiStep function
    - Extract capitalAutoPilot function
    - Extract autoSupportLaunch function
    - Extract separation functions (separationTeam, checkShipCollisions)
    - Extract target selection (pickTargetDetectable, avoidHostileBatteries)
    - Extract aliveShips, teamHasContact helpers
    - Import from config.js, utils.js, entities.js, combat.js
    - Export all AI functions
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 7. Extract rendering module
  - [x] 7.1 Create js/rendering.js with drawing functions
    - Extract texture generation (makeNoisePattern, makeDetailedWaterPattern, makeDetailedLandPattern)
    - Extract waterBackground function
    - Extract drawLand function with islandR, islandPath helpers
    - Extract ship drawing (drawShip, drawTrail, drawWake)
    - Extract projectile drawing (drawShell, drawMissile, drawBullets)
    - Extract effect drawing (drawSmoke, drawFx)
    - Extract aircraft drawing (drawAircraft, drawRecon)
    - Extract drawBatteries function
    - Extract drawRadar function
    - Extract drawRadarSweepOverlay function
    - Create main draw function that calls all others
    - Import from config.js and utils.js
    - Export all rendering functions
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 8. Extract input module
  - [x] 8.1 Create js/input.js with input handling
    - Extract keys Set and mouse object
    - Extract keyboard event handlers
    - Extract mouse event handlers
    - Extract updateThrottle function
    - Extract applyRudder function
    - Extract playerControl function
    - Create initInput function to set up event listeners
    - Import from config.js and utils.js
    - Export input state and functions
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 9. Extract game module
  - [x] 9.1 Create js/game.js with game state and loop
    - Create state object with all game state
    - Extract diff, setDifficulty, setMap, setPlayerClass functions
    - Extract menu functions (showMenu, hideMenu, toggleMenu, syncMenuButton)
    - Extract showMsg function
    - Extract withinWorld function
    - Extract inLand, resolveShipLand functions
    - Extract spawnCoastalBatteries function
    - Extract resetWorld function
    - Extract recon functions (reconPickWaypoint, tryRecon, reconStep, isInGreyZone)
    - Extract fighter functions (tryLaunchFighters, airStep, bulletsStep)
    - Extract batteriesStep function
    - Extract physicsStep, trailStep functions
    - Extract updateUI function
    - Extract endCheck, restartLevel, nextLevel functions
    - Extract tick function (main game loop)
    - Create init function for game initialization
    - Import from all other modules
    - Export state and game functions
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 10. Update index.html
  - [x] 10.1 Modify index.html to use modules
    - Remove all JavaScript code from script tag
    - Add type="module" to script tag
    - Import game.js and call init function
    - Keep HTML structure and CSS unchanged
    - _Requirements: 1.3, 10.1, 10.2_

- [ ] 11. Checkpoint - Test the refactored game
  - Load the game in browser
  - Verify game starts and menu works
  - Test basic gameplay (movement, shooting, AI)
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Clean up
  - [ ] 12.1 Verify all features work
    - Test all ship types (DD, BB, CV, TB)
    - Test all weapons (shells, missiles, smoke)
    - Test AI behavior
    - Test all maps
    - _Requirements: 10.1, 10.2, 10.3_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each module should be testable independently after creation
- The game should remain playable after each major task
- Property tests validate universal correctness properties
- Integration testing verifies the refactored game matches original behavior
