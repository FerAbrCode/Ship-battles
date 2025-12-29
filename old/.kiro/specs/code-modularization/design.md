# Design Document: Code Modularization

## Overview

This design describes the refactoring of the Fleet Battle game from a single monolithic HTML file into a modular JavaScript architecture. The game will be split into 8 logical modules plus an updated index.html that imports and initializes them. This modularization enables AI agents and developers to work on specific systems without navigating 3000+ lines of code.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         index.html                                   │
│  (HTML structure, CSS styles, module imports, initialization)        │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           js/game.js                                 │
│  (Main game loop, state management, module coordination)             │
└─────────────────────────────────────────────────────────────────────┘
          │           │           │           │           │
          ▼           ▼           ▼           ▼           ▼
    ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
    │config.js│ │entities │ │combat.js│ │  ai.js  │ │rendering│
    │         │ │   .js   │ │         │ │         │ │   .js   │
    └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
          │           │           │           │           │
          └───────────┴───────────┴─────┬─────┴───────────┘
                                        ▼
                              ┌─────────────────┐
                              │    utils.js     │
                              │ (shared helpers)│
                              └─────────────────┘
                                        │
                              ┌─────────────────┐
                              │   input.js      │
                              │ (event handling)│
                              └─────────────────┘
```

## Components and Interfaces

### 1. js/config.js - Configuration Module

Contains all game constants, ship definitions, and map data.

```javascript
// Exports
export const TAU = Math.PI * 2;
export const MAP_SCALE = 2.0;
export const WORLD = { w: 6400, h: 4400 };
export const VIEW = { w: 1000, h: 650 };

export const DIFFS = { easy: {...}, med: {...}, hard: {...} };
export const MAPS = [...];
export const BATTLES = {...};

export const DD = { type: 'DD', radius: 14, hp: 130, ... };
export const BB = { type: 'BB', radius: 22, hp: 340, ... };
export const CV = { type: 'CV', radius: 26, hp: 360, ... };
export const TB = { type: 'TB', radius: 12, hp: 60, ... };
export const BATTERY = {...};
export const MISSILE = {...};
export const FX = {...};
export const FIGHTER = {...};
export const RECON = {...};

// Collision/physics constants
export const DRAG_DD = 0.9960;
export const DRAG_BB = 0.9970;
export const SHIP_SPEED_SCALE = 0.28;
export const MAX_RUDDER_ANGLE = Math.PI / 6;
export const AVOIDANCE_RANGE = 200;
export const PREDICTION_TIME = 3.0;
export const MAX_AVOIDANCE_FORCE = 0.3;
```

### 2. js/utils.js - Utility Functions

Math helpers and common utilities used across all modules.

```javascript
// Exports
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => {...};
export const len = (x, y) => Math.hypot(x, y);
export const normAngle = (a) => {...};
export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
export const rand = (a, b) => a + Math.random() * (b - a);
```

### 3. js/entities.js - Entity Management

Ship and battery creation, formation logic.

```javascript
// Imports
import { DD, BB, CV, TB, BATTERY, ... } from './config.js';
import { clamp, rand, ... } from './utils.js';

// Exports
export function mkShip(team, kind, x, y, heading, tag) {...}
export function mkBattery(team, x, y, heading) {...}
export function formationOffsets(formKey, count, forSpawn) {...}
export function formationSpawns(anchor, formKey, count) {...}
export function setFormation(teamArr, formKey) {...}
export function formationPoint(leader, ship) {...}
export function pickCapitalLeader(arr) {...}
```

### 4. js/combat.js - Combat System

Weapons, damage, detection, and status effects.

```javascript
// Imports
import { MISSILE, FX, RADAR_RANGE, ... } from './config.js';
import { clamp, dist2, ... } from './utils.js';

// Exports
export function smokeAt(x, y, team, kind, state) {...}
export function trySmoke(ship, state) {...}
export function tryMissile(ship, state) {...}
export function tryFireAtPoint(ship, tx, ty, accuracy, state) {...}
export function tryExtinguish(ship, silent) {...}
export function damageShip(ship, rawDmg, cause, state) {...}
export function damageBattery(b, rawDmg, cause, state) {...}
export function updateDetections(state) {...}
export function canSee(team, targetShip) {...}
export function inSmoke(ship, state) {...}
export function statusStep(dt, state) {...}
export function shellsStep(dt, state) {...}
export function missilesStep(dt, state) {...}
export function smokesStep(state) {...}
```

### 5. js/ai.js - AI System

Enemy AI, allied autopilot, and steering logic.

```javascript
// Imports
import { AVOIDANCE_RANGE, MAX_AVOIDANCE_FORCE, ... } from './config.js';
import { clamp, normAngle, angleTo, ... } from './utils.js';
import { formationPoint, pickCapitalLeader } from './entities.js';
import { tryFireAtPoint, tryMissile, trySmoke, ... } from './combat.js';

// Exports
export function calculateAvoidanceSteering(ship, allShips) {...}
export function steerToPoint(ship, tx, ty, dt, speedMax, state) {...}
export function avoidLandTarget(ship, tx, ty, state) {...}
export function aiStep(ship, dt, state) {...}
export function capitalAutoPilot(ship, dt, state) {...}
export function autoSupportLaunch(ship, dt, state) {...}
export function separationTeam(arr, dt) {...}
export function checkShipCollisions(dt, state) {...}
```

### 6. js/rendering.js - Rendering System

All canvas drawing functions.

```javascript
// Imports
import { VIEW, WORLD, TAU, FX, ... } from './config.js';
import { clamp, lerp } from './utils.js';

// Exports
export function initPatterns(ctx) {...}
export function waterBackground(ctx, time) {...}
export function drawLand(ctx, camX, camY, mapId, time) {...}
export function drawShip(ctx, ship, camX, camY, selected, time) {...}
export function drawTrail(ctx, ship, camX, camY, time) {...}
export function drawWake(ctx, ship, camX, camY) {...}
export function drawShell(ctx, sh, camX, camY) {...}
export function drawMissile(ctx, m, camX, camY, time) {...}
export function drawSmoke(ctx, sm, camX, camY, time) {...}
export function drawFx(ctx, f, camX, camY, time) {...}
export function drawRadar(ctx, state) {...}
export function drawAircraft(ctx, camX, camY, aircraft, time) {...}
export function drawRecon(ctx, camX, camY, recons) {...}
export function drawBatteries(ctx, camX, camY, batteries) {...}
export function drawBullets(ctx, camX, camY, bullets) {...}
export function drawRadarSweepOverlay(ctx, ship, camX, camY, time) {...}
export function draw(ctx, state) {...}
```

### 7. js/input.js - Input Handling

Keyboard and mouse event management.

```javascript
// Exports
export const keys = new Set();
export const mouse = { x: 500, y: 325 };

export function initInput(canvas, callbacks) {...}
export function updateThrottle(ship, dt) {...}
export function applyRudder(ship, desiredTurn, dt) {...}
export function playerControl(ship, dt, state) {...}
```

### 8. js/game.js - Game State & Loop

Main game state, loop, and module coordination.

```javascript
// Imports
import * as Config from './config.js';
import * as Utils from './utils.js';
import * as Entities from './entities.js';
import * as Combat from './combat.js';
import * as AI from './ai.js';
import * as Rendering from './rendering.js';
import * as Input from './input.js';

// Game state
export const state = {
  started: false, menuOpen: true, diffKey: 'med', mapId: 0, playerClass: 'dd',
  level: 1, selected: 0, time: 0, camX: 0, camY: 0,
  player: [], enemy: [], shells: [], missiles: [], smokes: [], fx: [],
  aircraft: [], bullets: [], batteries: [], recons: [], ended: false,
};

// Exports
export function resetWorld(level) {...}
export function restartLevel() {...}
export function nextLevel() {...}
export function tick(now) {...}
export function init(canvas, ui) {...}
```

## Data Models

### Module Dependencies

```
config.js     ← (no dependencies)
utils.js      ← (no dependencies)
entities.js   ← config.js, utils.js
combat.js     ← config.js, utils.js
ai.js         ← config.js, utils.js, entities.js, combat.js
rendering.js  ← config.js, utils.js
input.js      ← config.js, utils.js
game.js       ← all modules
```

### File Structure

```
project/
├── index.html          (HTML, CSS, module initialization)
├── js/
│   ├── config.js       (~200 lines)
│   ├── utils.js        (~30 lines)
│   ├── entities.js     (~250 lines)
│   ├── combat.js       (~400 lines)
│   ├── ai.js           (~500 lines)
│   ├── rendering.js    (~700 lines)
│   ├── input.js        (~100 lines)
│   └── game.js         (~300 lines)
└── old/
    └── (existing files)
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Clamp Function Bounds

*For any* input value v and bounds [lo, hi] where lo ≤ hi, the clamp function SHALL return a value within [lo, hi].

**Validates: Requirements 3.1**

### Property 2: Lerp Interpolation Range

*For any* values a, b and interpolation factor t in [0, 1], the lerp function SHALL return a value between a and b (inclusive).

**Validates: Requirements 3.1**

### Property 3: Random Number Range

*For any* bounds [a, b] where a < b, the rand function SHALL return a value in the range [a, b).

**Validates: Requirements 3.2**

### Property 4: Ship Creation Validity

*For any* valid ship kind (DD, BB, CV, TB) and spawn position, mkShip SHALL create a ship object with all required properties (x, y, vx, vy, heading, hp, alive, throttle, rudderAngle).

**Validates: Requirements 4.1**

### Property 5: Damage Reduction by Armor

*For any* ship with armor value A and raw damage D, the actual damage applied SHALL equal D × (1 - A).

**Validates: Requirements 5.2**

### Property 6: Status Effect Damage Over Time

*For any* ship that is on fire, the ship's HP SHALL decrease by fireDps × dt each frame while on fire.

**Validates: Requirements 5.3**

## Error Handling

### Module Loading Errors

- If a module fails to load, the game should display an error message
- Missing exports should be caught during initialization
- Invalid configuration values should use defaults

### Runtime Errors

- Division by zero in distance calculations: return 0 or skip
- NaN values in ship properties: reset to defaults
- Missing state properties: initialize with defaults

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. Each module exports expected functions/constants
2. Config contains all ship types with required properties
3. Utils functions handle edge cases (clamp at boundaries, lerp at t=0 and t=1)
4. Entity creation produces valid objects
5. Damage calculation with 0% and 100% armor

### Property-Based Tests

Property-based tests use fast-check to verify universal properties:

- **Minimum 100 iterations** per property test
- Each test tagged with: **Feature: code-modularization, Property N: [property text]**

```javascript
import fc from 'fast-check';
import { clamp, lerp, rand } from './js/utils.js';

describe('Utils Properties', () => {
  it('Property 1: clamp always returns value in bounds', () => {
    fc.assert(
      fc.property(
        fc.float(), fc.float(), fc.float(),
        (v, a, b) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const result = clamp(v, lo, hi);
          return result >= lo && result <= hi;
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Integration Testing

- Load the refactored game and verify it starts
- Play through basic scenarios to verify behavior matches original
- Test all ship types and weapons function correctly

