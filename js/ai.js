// ═══════════════════════════════════════════════════════════════════════════
// AI MODULE - Enemy AI, allied autopilot, and steering logic
// ═══════════════════════════════════════════════════════════════════════════

import { 
  WORLD, TAU, AVOIDANCE_RANGE, PREDICTION_TIME, MAX_AVOIDANCE_FORCE,
  MAX_RUDDER_ANGLE, RUDDER_RETURN_RATE, ANGULAR_INERTIA, ANGULAR_ACCEL,
  THROTTLE_CHANGE_RATE, RADAR_RANGE, BATTERY, mapById, ESCORT_LOCK_RADIUS
} from './config.js';
import { clamp, lerp, dist2, len, normAngle, angleTo, rand } from './utils.js';
import { formationPoint, pickCapitalLeader, reassignEscortPositions } from './entities.js';
import { 
  tryFireAtPoint, tryMissile, trySmoke, tryExtinguish, 
  turretStep, canSee, shotSpotting 
} from './combat.js';

// ═══════════════════════════════════════════════════════════════════════════
// LAND COLLISION
// ═══════════════════════════════════════════════════════════════════════════
export function inLand(x, y, pad, state) {
  const m = mapById(state.mapId);
  for (const c of m.land) {
    const dx = x - c.x, dy = y - c.y;
    const rr = (c.r + pad);
    if (dx*dx + dy*dy <= rr*rr) return c;
  }
  return null;
}

// Check if path from (sx,sy) to (tx,ty) crosses any island
function pathCrossesLand(sx, sy, tx, ty, pad, state) {
  const m = mapById(state.mapId);
  const vx = tx - sx, vy = ty - sy;
  const vv = vx*vx + vy*vy;
  if (vv < 1e-6) return null;
  const pathLen = Math.sqrt(vv);
  
  for (const c of m.land) {
    const margin = c.r + pad;
    
    // Check multiple points along the path for better detection
    const numChecks = Math.max(5, Math.ceil(pathLen / 200));
    for (let i = 0; i <= numChecks; i++) {
      const t = i / numChecks;
      const px = sx + vx * t;
      const py = sy + vy * t;
      const dx = px - c.x, dy = py - c.y;
      const d = Math.hypot(dx, dy);
      if (d < margin) {
        return { island: c, t, cx: px, cy: py, d };
      }
    }
    
    // Also check closest point on line segment to island center
    const t = clamp(((c.x - sx)*vx + (c.y - sy)*vy) / vv, 0, 1);
    const cx = sx + vx*t, cy = sy + vy*t;
    const dx = cx - c.x, dy = cy - c.y;
    const d = Math.hypot(dx, dy);
    if (d < margin) {
      return { island: c, t, cx, cy, d };
    }
  }
  return null;
}

// Find waypoint to navigate around an island
function findWaypointAroundIsland(sx, sy, tx, ty, island, pad, state) {
  const m = mapById(state.mapId);
  const margin = island.r + pad + 200; // Extra large margin for safety
  
  // Calculate angle from island center to ship and to target
  const angleToShip = Math.atan2(sy - island.y, sx - island.x);
  const angleToTarget = Math.atan2(ty - island.y, tx - island.x);
  
  // Determine which way to go around (shorter angular distance)
  let angleDiff = angleToTarget - angleToShip;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
  
  // Try both directions and pick the one that's clearer
  const dir = Math.sign(angleDiff) || 1;
  
  // Pick waypoint at 90 degrees around the island in the shorter direction
  const waypointAngle = angleToShip + dir * Math.PI * 0.5;
  let wpX = island.x + Math.cos(waypointAngle) * margin;
  let wpY = island.y + Math.sin(waypointAngle) * margin;
  
  // Check if this waypoint is blocked by another island
  for (let i = 0; i < 6; i++) {
    let blocked = false;
    for (const c of m.land) {
      if (c === island) continue;
      const dx = wpX - c.x, dy = wpY - c.y;
      const d = Math.hypot(dx, dy);
      if (d < c.r + pad + 100) {
        // Push away from this island too
        const pushAngle = Math.atan2(dy, dx);
        wpX = c.x + Math.cos(pushAngle) * (c.r + pad + 150);
        wpY = c.y + Math.sin(pushAngle) * (c.r + pad + 150);
        blocked = true;
        break;
      }
    }
    if (!blocked) break;
  }
  
  return { x: clamp(wpX, 200, WORLD.w - 200), y: clamp(wpY, 200, WORLD.h - 200) };
}

export function avoidLandTarget(ship, tx, ty, state) {
  const m = mapById(state.mapId);
  const pad = (ship && ship.kind) ? (ship.kind.radius + 120) : 140; // Larger padding
  
  // First, make sure target isn't inside an island
  let x = tx, y = ty;
  for (let k = 0; k < 8; k++) {
    const hit = inLand(x, y, pad, state);
    if (!hit) break;
    const dx = x - hit.x, dy = y - hit.y;
    const d = Math.hypot(dx, dy) || 1;
    const want = hit.r + pad + 80;
    x = hit.x + (dx / d) * want;
    y = hit.y + (dy / d) * want;
  }
  
  // Check if direct path crosses any island
  const crossing = pathCrossesLand(ship.x, ship.y, x, y, pad, state);
  if (crossing) {
    // Find waypoint to go around the island
    const wp = findWaypointAroundIsland(ship.x, ship.y, x, y, crossing.island, pad, state);
    
    // Check if path to waypoint also crosses land (nested islands)
    const wpCrossing = pathCrossesLand(ship.x, ship.y, wp.x, wp.y, pad, state);
    if (wpCrossing && wpCrossing.island !== crossing.island) {
      // Go around the closer island first
      const wp2 = findWaypointAroundIsland(ship.x, ship.y, wp.x, wp.y, wpCrossing.island, pad, state);
      return { x: clamp(wp2.x, 50, WORLD.w - 50), y: clamp(wp2.y, 50, WORLD.h - 50) };
    }
    
    return { x: clamp(wp.x, 50, WORLD.w - 50), y: clamp(wp.y, 50, WORLD.h - 50) };
  }
  
  return { x: clamp(x, 50, WORLD.w - 50), y: clamp(y, 50, WORLD.h - 50) };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMANDER PATH PLANNING - Smooth curved routes avoiding land
// ═══════════════════════════════════════════════════════════════════════════

// Large margin for commander routes - must account for escort formation radius
// Escort positions are at FORM_SEP * 4.0 from center (see entities.js getEscortPositions)
// FORM_SEP = 45 * MAP_SCALE = 45 * 2.8 = 126, so outer ring is ~504 units
const ESCORT_FORMATION_RADIUS = 550; // How far escorts can be from commander (with safety margin)
const COMMANDER_LAND_MARGIN = 400 + ESCORT_FORMATION_RADIUS; // Extra margin so escorts don't touch coast

// Get distance to nearest land from a point
function distanceToNearestLand(x, y, state) {
  const m = mapById(state.mapId);
  let minDist = Infinity;
  for (const c of m.land) {
    const dx = x - c.x, dy = y - c.y;
    const d = Math.hypot(dx, dy) - c.r;
    if (d < minDist) minDist = d;
  }
  return minDist;
}

// Check if a point is safe (far enough from all land)
function isPointSafe(x, y, margin, state) {
  return distanceToNearestLand(x, y, state) >= margin;
}

// Push a point away from all nearby islands until safe
function pushToSafePoint(x, y, margin, state) {
  const m = mapById(state.mapId);
  let px = x, py = y;
  
  for (let iter = 0; iter < 15; iter++) {
    let totalPushX = 0, totalPushY = 0;
    let needsPush = false;
    
    for (const c of m.land) {
      const dx = px - c.x, dy = py - c.y;
      const d = Math.hypot(dx, dy);
      const minDist = c.r + margin;
      
      if (d < minDist && d > 0.1) {
        const pushStrength = (minDist - d) + 50;
        totalPushX += (dx / d) * pushStrength;
        totalPushY += (dy / d) * pushStrength;
        needsPush = true;
      }
    }
    
    if (!needsPush) break;
    px += totalPushX;
    py += totalPushY;
  }
  
  return { 
    x: clamp(px, margin + 100, WORLD.w - margin - 100), 
    y: clamp(py, margin + 100, WORLD.h - margin - 100) 
  };
}

// Generate a smooth curved path from start to end, avoiding all land
function generateSmoothPath(sx, sy, ex, ey, margin, state) {
  const m = mapById(state.mapId);
  const path = [];
  
  // First, ensure start and end are safe
  const safeEnd = pushToSafePoint(ex, ey, margin, state);
  ex = safeEnd.x;
  ey = safeEnd.y;
  
  // Check if direct path is clear
  const directClear = isDirectPathClear(sx, sy, ex, ey, margin, state);
  
  if (directClear) {
    // Direct path is safe - just go straight
    path.push({ x: ex, y: ey });
    return path;
  }
  
  // Need to curve around obstacles
  // Find all islands that block the path
  const blockingIslands = [];
  for (const c of m.land) {
    if (doesPathPassNearIsland(sx, sy, ex, ey, c, margin)) {
      blockingIslands.push(c);
    }
  }
  
  if (blockingIslands.length === 0) {
    path.push({ x: ex, y: ey });
    return path;
  }
  
  // Sort blocking islands by distance from start
  blockingIslands.sort((a, b) => {
    const da = Math.hypot(a.x - sx, a.y - sy);
    const db = Math.hypot(b.x - sx, b.y - sy);
    return da - db;
  });
  
  // Generate waypoints that curve around each blocking island
  let currentX = sx, currentY = sy;
  
  for (const island of blockingIslands) {
    const waypoint = generateCurveAroundIsland(currentX, currentY, ex, ey, island, margin, state);
    if (waypoint) {
      path.push(waypoint);
      currentX = waypoint.x;
      currentY = waypoint.y;
    }
  }
  
  // Add final destination
  path.push({ x: ex, y: ey });
  
  return path;
}

// Check if direct path is clear of all land
function isDirectPathClear(sx, sy, ex, ey, margin, state) {
  const m = mapById(state.mapId);
  const steps = Math.max(10, Math.ceil(Math.hypot(ex - sx, ey - sy) / 100));
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = sx + (ex - sx) * t;
    const y = sy + (ey - sy) * t;
    
    if (!isPointSafe(x, y, margin, state)) {
      return false;
    }
  }
  return true;
}

// Check if path passes near an island
function doesPathPassNearIsland(sx, sy, ex, ey, island, margin) {
  const vx = ex - sx, vy = ey - sy;
  const vv = vx * vx + vy * vy;
  if (vv < 1) return false;
  
  // Find closest point on line to island center
  const t = clamp(((island.x - sx) * vx + (island.y - sy) * vy) / vv, 0, 1);
  const closestX = sx + vx * t;
  const closestY = sy + vy * t;
  const dist = Math.hypot(closestX - island.x, closestY - island.y);
  
  return dist < island.r + margin + 100;
}

// Generate a waypoint that curves around an island
function generateCurveAroundIsland(sx, sy, ex, ey, island, margin, state) {
  const curveMargin = island.r + margin + 150;
  
  // Calculate angles from island to start and end
  const angleToStart = Math.atan2(sy - island.y, sx - island.x);
  const angleToEnd = Math.atan2(ey - island.y, ex - island.x);
  
  // Determine which way to go around (shorter angular path)
  let angleDiff = angleToEnd - angleToStart;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
  
  // Place waypoint at perpendicular to the path, on the outside of the curve
  const midAngle = angleToStart + angleDiff * 0.5;
  
  // Try the perpendicular direction
  let wpX = island.x + Math.cos(midAngle) * curveMargin;
  let wpY = island.y + Math.sin(midAngle) * curveMargin;
  
  // Make sure waypoint is safe
  const safeWp = pushToSafePoint(wpX, wpY, margin, state);
  
  return { x: safeWp.x, y: safeWp.y };
}

// Plan a patrol route for the commander that avoids land with smooth curves
export function planCommanderRoute(ship, state, targetX, targetY) {
  const margin = COMMANDER_LAND_MARGIN;
  
  // Ensure destination is safe
  const safeDest = pushToSafePoint(targetX, targetY, margin, state);
  
  // Generate smooth path
  const path = generateSmoothPath(ship.x, ship.y, safeDest.x, safeDest.y, margin, state);
  
  // Validate all waypoints are safe
  const validPath = [];
  for (const wp of path) {
    if (isPointSafe(wp.x, wp.y, margin * 0.8, state)) {
      validPath.push(wp);
    } else {
      const safe = pushToSafePoint(wp.x, wp.y, margin, state);
      validPath.push(safe);
    }
  }
  
  return validPath;
}

// Plan engagement route to enemy position
export function planEngagementRoute(ship, enemyX, enemyY, gunRange, state) {
  const margin = COMMANDER_LAND_MARGIN;
  
  // Calculate optimal engagement position (at gun range, not head-on)
  const angleToEnemy = Math.atan2(enemyY - ship.y, enemyX - ship.x);
  const strafeDir = ship.ai.strafe || 1;
  
  // Approach from an angle, not directly
  const approachAngle = angleToEnemy + strafeDir * Math.PI * 0.3;
  const engageDistance = gunRange * 0.85;
  
  let engageX = enemyX - Math.cos(approachAngle) * engageDistance;
  let engageY = enemyY - Math.sin(approachAngle) * engageDistance;
  
  // Make sure engagement point is safe
  const safeEngage = pushToSafePoint(engageX, engageY, margin, state);
  
  return planCommanderRoute(ship, state, safeEngage.x, safeEngage.y);
}


// ═══════════════════════════════════════════════════════════════════════════
// COLLISION AVOIDANCE - Predictive path-based avoidance
// ═══════════════════════════════════════════════════════════════════════════
function getShipPriority(ship) {
  // Higher priority = larger ship = stand-on vessel (doesn't maneuver)
  switch (ship.kind.type) {
    case 'CV': return 4;
    case 'BB': return 3;
    case 'DD': return 2;
    case 'TB': return 1;
    default: return 0;
  }
}

// Predict where a ship will be in t seconds
function predictPosition(ship, t) {
  return {
    x: ship.x + (ship.vx || 0) * t,
    y: ship.y + (ship.vy || 0) * t
  };
}

// Check if a point is too close to a ship's predicted position
function isPointNearShipPath(px, py, ship, lookAhead, margin) {
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * lookAhead;
    const pos = predictPosition(ship, t);
    const dist = Math.hypot(px - pos.x, py - pos.y);
    if (dist < margin) {
      return { blocked: true, time: t, shipPos: pos, dist };
    }
  }
  return { blocked: false };
}

// Check if path from A to B crosses any ship's trajectory
function doesPathCrossShipTrajectory(sx, sy, ex, ey, ships, excludeShip, lookAhead, margin) {
  const pathLen = Math.hypot(ex - sx, ey - sy);
  const steps = Math.max(5, Math.ceil(pathLen / 50));
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = sx + (ex - sx) * t;
    const py = sy + (ey - sy) * t;
    
    for (const ship of ships) {
      if (!ship || !ship.alive || ship === excludeShip) continue;
      
      const shipMargin = ship.kind.radius + margin;
      const check = isPointNearShipPath(px, py, ship, lookAhead, shipMargin);
      if (check.blocked) {
        return { blocked: true, ship, pathT: t, ...check };
      }
    }
  }
  return { blocked: false };
}

// Find a waypoint to go around a ship's trajectory
function findWaypointAroundShip(sx, sy, ex, ey, blockingShip, blockTime, margin, allShips, excludeShip) {
  // Get the blocking ship's predicted position
  const blockPos = predictPosition(blockingShip, blockTime);
  const avoidRadius = blockingShip.kind.radius + margin + 80;
  
  // Calculate direction from blocking position to our path
  const pathMidX = (sx + ex) / 2;
  const pathMidY = (sy + ey) / 2;
  const toPath = Math.atan2(pathMidY - blockPos.y, pathMidX - blockPos.x);
  
  // Try going around on both sides, pick the clearer one
  const pathAngle = Math.atan2(ey - sy, ex - sx);
  const perpLeft = pathAngle + Math.PI / 2;
  const perpRight = pathAngle - Math.PI / 2;
  
  // Calculate waypoints on both sides
  const leftWp = {
    x: blockPos.x + Math.cos(perpLeft) * avoidRadius,
    y: blockPos.y + Math.sin(perpLeft) * avoidRadius
  };
  const rightWp = {
    x: blockPos.x + Math.cos(perpRight) * avoidRadius,
    y: blockPos.y + Math.sin(perpRight) * avoidRadius
  };
  
  // Check which side is clearer
  const leftBlocked = doesPathCrossShipTrajectory(sx, sy, leftWp.x, leftWp.y, allShips, excludeShip, 2.0, margin * 0.8);
  const rightBlocked = doesPathCrossShipTrajectory(sx, sy, rightWp.x, rightWp.y, allShips, excludeShip, 2.0, margin * 0.8);
  
  // Prefer the side closer to our destination
  const leftDistToEnd = Math.hypot(leftWp.x - ex, leftWp.y - ey);
  const rightDistToEnd = Math.hypot(rightWp.x - ex, rightWp.y - ey);
  
  if (!leftBlocked.blocked && !rightBlocked.blocked) {
    return leftDistToEnd < rightDistToEnd ? leftWp : rightWp;
  } else if (!leftBlocked.blocked) {
    return leftWp;
  } else if (!rightBlocked.blocked) {
    return rightWp;
  }
  
  // Both blocked - go further around
  const furtherRadius = avoidRadius + 60;
  return leftDistToEnd < rightDistToEnd 
    ? { x: blockPos.x + Math.cos(perpLeft) * furtherRadius, y: blockPos.y + Math.sin(perpLeft) * furtherRadius }
    : { x: blockPos.x + Math.cos(perpRight) * furtherRadius, y: blockPos.y + Math.sin(perpRight) * furtherRadius };
}

// Plan a path to target that avoids all ship trajectories
export function planPathAroundShips(ship, targetX, targetY, allShips, state) {
  const margin = ship.kind.radius + 30;
  const lookAhead = 3.0;
  const path = [];
  
  let currentX = ship.x, currentY = ship.y;
  let destX = targetX, destY = targetY;
  
  // Try to build path with up to 3 waypoints
  for (let iteration = 0; iteration < 3; iteration++) {
    const crossing = doesPathCrossShipTrajectory(currentX, currentY, destX, destY, allShips, ship, lookAhead, margin);
    
    if (!crossing.blocked) {
      // Path is clear
      break;
    }
    
    // Find waypoint to go around the blocking ship
    const wp = findWaypointAroundShip(currentX, currentY, destX, destY, crossing.ship, crossing.time, margin, allShips, ship);
    
    // Clamp waypoint to world bounds
    wp.x = clamp(wp.x, 100, WORLD.w - 100);
    wp.y = clamp(wp.y, 100, WORLD.h - 100);
    
    path.push({ x: wp.x, y: wp.y });
    currentX = wp.x;
    currentY = wp.y;
  }
  
  return path;
}

// Lightweight avoidance for immediate collision prevention
export function calculateAvoidanceSteering(ship, allShips) {
  let steerAdjust = 0;
  let throttleAdjust = 0;
  const myPriority = getShipPriority(ship);
  
  for (const other of allShips) {
    if (!other || !other.alive || other === ship) continue;
    if (other.team !== ship.team) continue; // Only avoid friendly ships
    
    const otherPriority = getShipPriority(other);
    const dx = other.x - ship.x;
    const dy = other.y - ship.y;
    const currentDist = Math.hypot(dx, dy);
    const safeDistance = ship.kind.radius + other.kind.radius + 40;
    
    // Skip if too far
    if (currentDist > safeDistance * 4) continue;
    
    // Check predicted positions
    const myFuture = predictPosition(ship, 2.0);
    const otherFuture = predictPosition(other, 2.0);
    const futureDist = Math.hypot(myFuture.x - otherFuture.x, myFuture.y - otherFuture.y);
    
    // Calculate urgency based on future distance
    const urgency = Math.max(0, 1 - (futureDist / (safeDistance * 3)));
    
    if (urgency < 0.1) continue;
    
    // Smaller ships MUST avoid larger ships more aggressively
    const priorityDiff = otherPriority - myPriority;
    let avoidStrength = urgency;
    
    if (priorityDiff > 0) {
      // Other ship is bigger - we must avoid more
      avoidStrength *= (1 + priorityDiff * 0.5);
    } else if (priorityDiff === 0) {
      // Same size - both avoid gently
      avoidStrength *= 0.3;
    } else {
      // We're bigger - minimal avoidance
      avoidStrength *= 0.1;
    }
    
    // Determine which way to steer
    const toOther = Math.atan2(dy, dx);
    const relBearing = normAngle(toOther - ship.heading);
    const steerDir = relBearing > 0 ? -1 : 1;
    
    steerAdjust += steerDir * avoidStrength * 0.15;
    
    // Adjust speed - slow down if other is ahead, speed up if behind
    const aheadness = Math.cos(relBearing);
    if (aheadness > 0.3 && priorityDiff >= 0) {
      // Other ship is ahead and same size or bigger - slow down
      throttleAdjust -= avoidStrength * 10;
    } else if (aheadness < -0.3 && priorityDiff <= 0) {
      // Other ship is behind and same size or smaller - speed up slightly
      throttleAdjust += avoidStrength * 5;
    }
  }
  
  return { steer: clamp(steerAdjust, -0.25, 0.25), throttle: clamp(throttleAdjust, -15, 10) };
}

// ═══════════════════════════════════════════════════════════════════════════
// RUDDER SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
export function applyRudder(ship, desiredTurn, dt) {
  const targetRudder = clamp(desiredTurn, -MAX_RUDDER_ANGLE, MAX_RUDDER_ANGLE);
  
  // Very slow rudder movement - takes time to move from one direction to other
  const rudderSpeed = 0.4; // Radians per second - takes ~1.3s for full rudder swing
  const diff = targetRudder - (ship.rudderAngle || 0);
  const maxChange = rudderSpeed * dt;
  
  if (Math.abs(diff) > 0.01) {
    ship.rudderAngle = (ship.rudderAngle || 0) + clamp(diff, -maxChange, maxChange);
  } else if (Math.abs(targetRudder) < 0.02) {
    // Slowly return to center when no input
    const returnSpeed = RUDDER_RETURN_RATE * dt;
    if (Math.abs(ship.rudderAngle || 0) < returnSpeed) {
      ship.rudderAngle = 0;
    } else {
      ship.rudderAngle = (ship.rudderAngle || 0) - Math.sign(ship.rudderAngle) * returnSpeed;
    }
  }
  
  ship.rudderAngle = clamp(ship.rudderAngle, -MAX_RUDDER_ANGLE, MAX_RUDDER_ANGLE);
  
  const turnFraction = Math.abs(ship.rudderAngle) / MAX_RUDDER_ANGLE;
  const targetTurnRate = ship.kind.turnRate * turnFraction * Math.sign(ship.rudderAngle);
  
  if (ship.angularVel === undefined || isNaN(ship.angularVel)) {
    ship.angularVel = 0;
  }
  
  // Very smooth angular velocity changes with high inertia
  const angularDiff = targetTurnRate - ship.angularVel;
  const maxAngularChange = ship.kind.turnRate * dt * 0.8;
  ship.angularVel += clamp(angularDiff * ANGULAR_ACCEL * dt, -maxAngularChange, maxAngularChange);
  ship.angularVel *= ANGULAR_INERTIA;
  
  ship.heading += ship.angularVel * dt;
  
  if (isNaN(ship.rudderAngle) || ship.rudderAngle === undefined) {
    ship.rudderAngle = 0;
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// STEERING
// ═══════════════════════════════════════════════════════════════════════════

// Check immediate land danger and return emergency steering if needed
function checkLandDanger(ship, state) {
  if (!ship || !state || state.mapId === undefined) {
    return { emergency: false };
  }
  const m = mapById(state.mapId);
  if (!m || !m.land || m.land.length === 0) {
    return { emergency: false };
  }
  const dangerPad = ship.kind.radius + 150; // Larger safety margin
  const speed = Math.hypot(ship.vx || 0, ship.vy || 0);
  
  // Check current position first - are we already too close?
  for (const c of m.land) {
    const dx = ship.x - c.x, dy = ship.y - c.y;
    const d = Math.hypot(dx, dy);
    const criticalDist = c.r + ship.kind.radius + 50;
    
    if (d < criticalDist) {
      // CRITICAL: Already inside danger zone - hard turn away
      const awayAngle = Math.atan2(dy, dx);
      return { emergency: true, critical: true, angle: awayAngle, island: c, urgency: 3.0 };
    }
  }
  
  // Look ahead at multiple time steps - longer look-ahead for faster ships
  // Urgency decreases smoothly with distance/time
  const lookAheadTimes = [0.8, 1.5, 2.5, 4.0, 6.0];
  
  for (const lookAhead of lookAheadTimes) {
    const futureX = ship.x + ship.vx * lookAhead;
    const futureY = ship.y + ship.vy * lookAhead;
    
    for (const c of m.land) {
      const dx = futureX - c.x, dy = futureY - c.y;
      const d = Math.hypot(dx, dy);
      const dangerDist = c.r + dangerPad;
      
      if (d < dangerDist) {
        // Calculate urgency based on how soon we'll hit AND how close we are to the danger zone
        // Closer = more urgent, further = gentler correction
        const timeUrgency = Math.max(0.1, 1.0 - (lookAhead / 6.0)); // 1.0 at 0s, 0.1 at 6s
        const distUrgency = Math.max(0.2, 1.0 - (d / dangerDist)); // Higher when closer to island
        const urgency = timeUrgency * distUrgency * 2.0; // Scale factor
        
        // Steer perpendicular to island - choose side based on current heading
        const toIsland = Math.atan2(c.y - ship.y, c.x - ship.x);
        const headingToIsland = normAngle(toIsland - ship.heading);
        
        // Turn away from the island - if island is on our right, turn left and vice versa
        const turnDir = headingToIsland > 0 ? -1 : 1;
        const escapeAngle = normAngle(ship.heading + turnDir * Math.PI * 0.5);
        
        return { emergency: true, critical: false, angle: escapeAngle, island: c, urgency, lookAhead };
      }
    }
  }
  
  // Also check if our path crosses any island
  const pathDist = speed * 8; // Look 8 seconds ahead along path
  const pathEndX = ship.x + Math.cos(ship.heading) * pathDist;
  const pathEndY = ship.y + Math.sin(ship.heading) * pathDist;
  
  for (const c of m.land) {
    const margin = c.r + dangerPad;
    // Find closest point on line segment to island center
    const vx = pathEndX - ship.x, vy = pathEndY - ship.y;
    const vv = vx*vx + vy*vy;
    if (vv < 1e-6) continue;
    
    const t = clamp(((c.x - ship.x)*vx + (c.y - ship.y)*vy) / vv, 0, 1);
    const cx = ship.x + vx*t, cy = ship.y + vy*t;
    const dx = cx - c.x, dy = cy - c.y;
    const d = Math.hypot(dx, dy);
    
    if (d < margin) {
      // Gentler urgency for path-based detection (further ahead)
      const pathUrgency = Math.max(0.15, 0.5 * (1.0 - t)); // Lower urgency for distant path crossings
      
      const toIsland = Math.atan2(c.y - ship.y, c.x - ship.x);
      const headingToIsland = normAngle(toIsland - ship.heading);
      const turnDir = headingToIsland > 0 ? -1 : 1;
      const escapeAngle = normAngle(ship.heading + turnDir * Math.PI * 0.4);
      
      return { emergency: true, critical: false, angle: escapeAngle, island: c, urgency: pathUrgency, lookAhead: t * 8 };
    }
  }
  
  return { emergency: false };
}

export function steerToPoint(ship, tx, ty, dt, speedMax, state) {
  const allShips = state.player.concat(state.enemy);
  const friendlyShips = ship.team === 'P' ? state.player : state.enemy;
  
  // FIRST PRIORITY: Check for immediate land danger
  const landDanger = checkLandDanger(ship, state);
  
  if (landDanger.emergency) {
    // Land avoidance takes absolute priority
    const steerNeeded = normAngle(landDanger.angle - ship.heading);
    
    if (landDanger.critical) {
      applyRudder(ship, steerNeeded * 3.0, dt);
      ship.vx *= 0.92;
      ship.vy *= 0.92;
    } else {
      const urgencyMult = landDanger.urgency;
      applyRudder(ship, steerNeeded * urgencyMult, dt);
      if (landDanger.urgency > 1.5) {
        ship.vx *= 0.96;
        ship.vy *= 0.96;
      }
    }
    
    const sp = Math.hypot(ship.vx, ship.vy);
    const want = speedMax * (landDanger.critical ? 0.3 : 0.5);
    const accel = (sp < want) ? ship.kind.accel * 0.5 : -ship.kind.accel * 0.6;
    ship.vx += Math.cos(ship.heading) * accel * dt;
    ship.vy += Math.sin(ship.heading) * accel * dt;
    
    return Math.sqrt(dist2(ship.x, ship.y, tx, ty));
  }
  
  // Plan route around islands
  const safe = avoidLandTarget(ship, tx, ty, state);
  let targetX = safe.x;
  let targetY = safe.y;
  
  // For escorts (DD/TB), plan path around other ships
  if (ship.kind.type === 'DD' || ship.kind.type === 'TB') {
    const shipPath = planPathAroundShips(ship, targetX, targetY, friendlyShips, state);
    if (shipPath.length > 0) {
      // Use first waypoint as immediate target
      targetX = shipPath[0].x;
      targetY = shipPath[0].y;
      // Store path for visualization
      ship.avoidancePath = shipPath;
    } else {
      ship.avoidancePath = null;
    }
  }
  
  const desired = angleTo(ship.x, ship.y, targetX, targetY);
  let headingDiff = normAngle(desired - ship.heading);
  
  // Add lightweight collision avoidance for immediate threats
  const avoidance = calculateAvoidanceSteering(ship, friendlyShips);
  headingDiff = headingDiff + avoidance.steer;
  
  applyRudder(ship, headingDiff, dt);
  
  const d = Math.sqrt(dist2(ship.x, ship.y, tx, ty));
  let want = (d > 260) ? (speedMax * 0.88) : (speedMax * 0.30);
  
  // Apply throttle adjustment from collision avoidance
  want = want * (1 + avoidance.throttle / 100);
  
  const sp = Math.hypot(ship.vx, ship.vy);
  const accel = (sp < want) ? ship.kind.accel * 0.70 : -ship.kind.accel * 0.45;
  
  ship.vx += Math.cos(ship.heading) * accel * dt;
  ship.vy += Math.sin(ship.heading) * accel * dt;
  
  return d;
}

// ═══════════════════════════════════════════════════════════════════════════
// THROTTLE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
export function updateAIThrottle(ship, targetThrottle, dt) {
  if (isNaN(ship.throttle) || ship.throttle === undefined) {
    ship.throttle = 50;
  }
  const throttleDiff = targetThrottle - ship.throttle;
  const maxChange = THROTTLE_CHANGE_RATE * dt;
  if (Math.abs(throttleDiff) <= maxChange) {
    ship.throttle = targetThrottle;
  } else {
    ship.throttle += Math.sign(throttleDiff) * maxChange;
  }
  ship.throttle = clamp(ship.throttle, 0, 100);
}

export function calculateAITargetThrottle(ship, distanceToTarget, isInFormation, hasEnemy) {
  const FORMATION_THROTTLE = 50;        // Cruise speed when in position
  const FORMATION_CRUISE = 75;          // Normal cruise when moving with formation
  const CATCHUP_THROTTLE = 100;         // Full speed to catch up to formation
  const PURSUIT_THROTTLE = 85;
  const PATROL_THROTTLE = 60;
  const CLOSE_COMBAT_THROTTLE = 70;
  const FORMATION_CLOSE_DIST = 120;     // Distance at which we're "in position"
  const FORMATION_FAR_DIST = 300;       // Distance at which we need to catch up
  
  if (isInFormation && !hasEnemy) {
    // Throttle based on distance to formation position
    if (distanceToTarget !== undefined) {
      if (distanceToTarget > FORMATION_FAR_DIST) {
        return CATCHUP_THROTTLE; // Far from position - full speed
      } else if (distanceToTarget > FORMATION_CLOSE_DIST) {
        // Interpolate between cruise and catchup throttle
        const t = (distanceToTarget - FORMATION_CLOSE_DIST) / (FORMATION_FAR_DIST - FORMATION_CLOSE_DIST);
        return FORMATION_CRUISE + t * (CATCHUP_THROTTLE - FORMATION_CRUISE);
      }
    }
    return FORMATION_THROTTLE;
  }
  
  if (hasEnemy) {
    const gunRange = ship.kind.gunRange || RADAR_RANGE * 0.5;
    if (distanceToTarget > gunRange * 1.2) {
      return PURSUIT_THROTTLE;
    } else if (distanceToTarget > gunRange * 0.5) {
      return CLOSE_COMBAT_THROTTLE;
    } else {
      return CLOSE_COMBAT_THROTTLE - 10;
    }
  }
  
  if (distanceToTarget !== undefined && distanceToTarget < 150) {
    return FORMATION_THROTTLE;
  }
  
  return PATROL_THROTTLE;
}


// ═══════════════════════════════════════════════════════════════════════════
// AI HELPERS
// ═══════════════════════════════════════════════════════════════════════════
export function aliveShips(arr) { return arr.filter(s => s.alive); }

export function teamHasContact(team, state) {
  return (team === 'P') ? state.enemy.some(e => e.alive && e.detP) : state.player.some(p => p.alive && p.detE);
}

export function pickTargetDetectable(fromShip, candidates) {
  let best = null, bestD2 = Infinity;
  for (const t of candidates) {
    if (!t.alive) continue;
    if (!canSee(fromShip.team, t)) continue;
    const d2 = dist2(fromShip.x, fromShip.y, t.x, t.y);
    if (d2 < bestD2) { bestD2 = d2; best = t; }
  }
  return best;
}

export function avoidHostileBatteries(ship, tx, ty, state) {
  if (!ship || !ship.alive) return { x: tx, y: ty };
  const hostile = state.batteries.filter(b => b.alive && b.team !== ship.team);
  if (!hostile.length) return { x: tx, y: ty };
  let x = tx, y = ty;
  const danger = BATTERY.gunRange * 0.92;
  for (const b of hostile) {
    const dx = x - b.x, dy = y - b.y;
    const d = Math.hypot(dx, dy);
    if (d < danger) {
      const a = (d > 1e-3) ? Math.atan2(dy, dx) : rand(0, TAU);
      x = b.x + Math.cos(a) * danger;
      y = b.y + Math.sin(a) * danger;
    }
  }
  return { x: clamp(x, 0, WORLD.w), y: clamp(y, 0, WORLD.h) };
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLISION HANDLING - Predictive avoidance with speed adjustment
// ═══════════════════════════════════════════════════════════════════════════
export function applyCollisionAvoidance(ship, allShips, dt) {
  if (!ship || !ship.alive) return;
  
  const myPriority = getShipPriority(ship);
  const friendlyShips = allShips.filter(s => s && s.alive && s.team === ship.team && s !== ship);
  
  for (const other of friendlyShips) {
    const otherPriority = getShipPriority(other);
    const dx = other.x - ship.x;
    const dy = other.y - ship.y;
    const currentDist = Math.hypot(dx, dy);
    const safeDistance = ship.kind.radius + other.kind.radius + 50;
    
    // Skip if too far
    if (currentDist > safeDistance * 3) continue;
    
    // Check predicted positions
    const myFuture = predictPosition(ship, 1.5);
    const otherFuture = predictPosition(other, 1.5);
    const futureDist = Math.hypot(myFuture.x - otherFuture.x, myFuture.y - otherFuture.y);
    
    // Calculate urgency
    const currentUrgency = Math.max(0, 1 - (currentDist / (safeDistance * 2)));
    const futureUrgency = Math.max(0, 1 - (futureDist / (safeDistance * 2)));
    const urgency = Math.max(currentUrgency, futureUrgency);
    
    if (urgency < 0.2) continue;
    
    // Priority-based avoidance strength
    const priorityDiff = otherPriority - myPriority;
    let avoidStrength = urgency;
    
    if (priorityDiff > 0) {
      // Other is bigger - we avoid more
      avoidStrength *= (1 + priorityDiff * 0.4);
    } else if (priorityDiff === 0) {
      // Same size - gentle mutual avoidance
      avoidStrength *= 0.25;
    } else {
      // We're bigger - minimal
      avoidStrength *= 0.1;
    }
    
    // Steer away
    const toOther = Math.atan2(dy, dx);
    const relBearing = normAngle(toOther - ship.heading);
    const steerDir = relBearing > 0 ? -1 : 1;
    
    const steerAmount = steerDir * avoidStrength * 0.15;
    ship.rudderAngle = clamp((ship.rudderAngle || 0) + steerAmount, -MAX_RUDDER_ANGLE, MAX_RUDDER_ANGLE);
    
    // Speed adjustment based on relative position
    const aheadness = Math.cos(relBearing);
    if (aheadness > 0.2 && priorityDiff >= 0 && urgency > 0.4) {
      // Other ahead and bigger/same - slow down
      ship.vx *= (1 - avoidStrength * 0.02);
      ship.vy *= (1 - avoidStrength * 0.02);
    }
  }
}

export function separationTeam(arr, dt, state) {
  const n = arr.length;
  const allShips = state.player.concat(state.enemy);
  
  for (let i = 0; i < n; i++) {
    const a = arr[i];
    if (!a || !a.alive) continue;
    if (a.team === 'P' && state.player.indexOf(a) === state.selected) continue;
    applyCollisionAvoidance(a, allShips, dt);
  }
  
  for (let i = 0; i < n; i++) {
    const a = arr[i];
    if (!a || !a.alive) continue;
    for (let j = i + 1; j < n; j++) {
      const b = arr[j];
      if (!b || !b.alive) continue;
      const dx = a.x - b.x, dy = a.y - b.y;
      const d2 = dx*dx + dy*dy;
      const collisionDist = (a.kind.radius + b.kind.radius);
      
      if (d2 <= 1e-6) continue;
      const d = Math.sqrt(d2);
      
      if (d < collisionDist) {
        if (!a.flooding) {
          a.flooding = true;
        }
        if (!b.flooding) {
          b.flooding = true;
        }
        const collisionSpeed = Math.hypot(a.vx - b.vx, a.vy - b.vy);
        const dmg = collisionSpeed * 0.15;
        a.hp -= dmg;
        b.hp -= dmg;
      }
    }
  }
}

export function checkShipCollisions(dt, state, showMsg) {
  for (const p of state.player) {
    if (!p || !p.alive) continue;
    for (const e of state.enemy) {
      if (!e || !e.alive) continue;
      const dx = p.x - e.x, dy = p.y - e.y;
      const d2 = dx*dx + dy*dy;
      const collisionDist = (p.kind.radius + e.kind.radius);
      
      if (d2 <= 1e-6) continue;
      const d = Math.sqrt(d2);
      
      if (d < collisionDist) {
        if (!p.flooding) {
          p.flooding = true;
          if (showMsg) showMsg('Collision with enemy! Ship flooding!');
        }
        if (!e.flooding) {
          e.flooding = true;
        }
        const collisionSpeed = Math.hypot(p.vx - e.vx, p.vy - e.vy);
        const dmg = collisionSpeed * 0.2;
        p.hp -= dmg;
        e.hp -= dmg;
      }
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// CAPITAL AUTOPILOT
// ═══════════════════════════════════════════════════════════════════════════
export function capitalAutoPilot(ship, dt, state, showMsg) {
  if (!ship || !ship.alive) return;
  if (ship.team !== 'P') return;
  
  const CAPITAL_COMBAT_THROTTLE = 75;
  const CAPITAL_PATROL_THROTTLE = 75;  // Cruise at 75% when following trajectory
  const CAPITAL_CRUISE_THROTTLE = 75;
  
  const leader = pickCapitalLeader(state.player);
  if (leader && leader.alive && leader !== ship) {
    // Not the commander - follow formation
    const fp = formationPoint(leader, ship, (x, y, pad) => inLand(x, y, pad, state));
    let tgt = { x: clamp(fp.x, 0, WORLD.w), y: clamp(fp.y, 0, WORLD.h) };
    
    // Track target waypoint for visualization
    ship.targetWaypoint = { x: tgt.x, y: tgt.y };
    
    // Calculate distance to formation position
    const dForm = Math.sqrt(dist2(ship.x, ship.y, tgt.x, tgt.y));
    
    // Track lock state
    if (!ship.escortLocked) ship.escortLocked = false;
    
    const targets = aliveShips(state.enemy);
    const best = pickTargetDetectable(ship, targets);
    const hasEnemy = !!best;
    
    // Check if we should lock to commander's heading/speed
    // Only lock when inside radius AND already locked, or when very close
    const shouldLock = ship.escortLocked ? (dForm <= ESCORT_LOCK_RADIUS) : (dForm <= ESCORT_LOCK_RADIUS * 0.7);
    
    if (shouldLock && !hasEnemy) {
      // Lock in - directly copy commander's heading and match ACTUAL SPEED
      ship.escortLocked = true;
      
      // Directly match commander's heading (smooth transition)
      const headingDiff = normAngle(leader.heading - ship.heading);
      if (Math.abs(headingDiff) > 0.02) {
        ship.heading += headingDiff * 0.1; // Smooth heading lock
      } else {
        ship.heading = leader.heading; // Snap when close
      }
      ship.heading = normAngle(ship.heading);
      
      // Match commander's ACTUAL SPEED (velocity magnitude), not throttle percentage
      // This ensures destroyers move at same speed as capitals regardless of their max speed
      const leaderSpeed = Math.hypot(leader.vx || 0, leader.vy || 0);
      
      // Calculate target velocity at leader's speed but in ship's heading direction
      const targetVx = Math.cos(ship.heading) * leaderSpeed;
      const targetVy = Math.sin(ship.heading) * leaderSpeed;
      
      // Blend toward target velocity
      ship.vx = ship.vx * 0.9 + targetVx * 0.1;
      ship.vy = ship.vy * 0.9 + targetVy * 0.1;
      
      // Small position correction to stay in formation
      if (dForm > 20) {
        const toTarget = angleTo(ship.x, ship.y, tgt.x, tgt.y);
        const correctionStrength = Math.min(0.5, dForm / 200);
        ship.vx += Math.cos(toTarget) * correctionStrength;
        ship.vy += Math.sin(toTarget) * correctionStrength;
      }
      
      // Set throttle to approximate the leader's speed for this ship type
      // This is just for display - actual speed is controlled by velocity matching above
      ship.throttle = clamp((leaderSpeed / ship.kind.maxSpeed) * 100, 0, 100);
      ship.rudderAngle = leader.rudderAngle || 0;
      
    } else if (dForm > ESCORT_LOCK_RADIUS && ship.escortLocked) {
      // Unlock ONLY when leaving the circle radius (not before)
      ship.escortLocked = false;
      steerToPoint(ship, tgt.x, tgt.y, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
      
      // Throttle based on distance
      if (dForm > 300) {
        updateAIThrottle(ship, 100, dt);
      } else if (dForm > 150) {
        updateAIThrottle(ship, CAPITAL_CRUISE_THROTTLE, dt);
      } else {
        updateAIThrottle(ship, leader.throttle || CAPITAL_PATROL_THROTTLE, dt);
      }
    } else if (!ship.escortLocked) {
      // Not locked yet - steer toward position
      steerToPoint(ship, tgt.x, tgt.y, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
      
      // Throttle based on distance
      if (dForm > 300) {
        updateAIThrottle(ship, 100, dt);
      } else if (dForm > 150) {
        updateAIThrottle(ship, CAPITAL_CRUISE_THROTTLE, dt);
      } else {
        updateAIThrottle(ship, leader.throttle || CAPITAL_PATROL_THROTTLE, dt);
      }
    }
    
    if (hasEnemy) {
      ship.escortLocked = false;
      steerToPoint(ship, tgt.x, tgt.y, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
      updateAIThrottle(ship, CAPITAL_COMBAT_THROTTLE, dt);
    }
    
    turretStep(ship, dt, ship.heading);
    return;
  }
  
  // This ship IS the commander
  const targets = aliveShips(state.enemy);
  const enemyCapitals = targets.filter(e => e.alive && (e.kind.type === 'BB' || e.kind.type === 'CV') && canSee(ship.team, e));
  const anyEnemyVisible = targets.some(e => canSee(ship.team, e));
  
  // Initialize route state if needed
  if (!ship.routeState) ship.routeState = 'patrol';
  
  // Check if we need to plan engagement route (only once when enemy first spotted)
  if (anyEnemyVisible && ship.routeState === 'patrol') {
    // Enemy spotted! Plan engagement route toward enemy position
    const visibleEnemy = targets.find(e => canSee(ship.team, e));
    if (visibleEnemy) {
      const gunRange = ship.kind.gunRange || RADAR_RANGE * 0.6;
      ship.plannedPath = planEngagementRoute(ship, visibleEnemy.x, visibleEnemy.y, gunRange, state);
      ship.routeState = 'engaging';
      if (ship.plannedPath.length > 0) {
        ship.ai.wpX = ship.plannedPath[0].x;
        ship.ai.wpY = ship.plannedPath[0].y;
        ship.ai.wpUntil = state.time + 30; // Long duration - don't replan
      }
    }
  }
  
  // If engaging and enemy capital in gun range, do combat maneuvers
  if (enemyCapitals.length > 0 && ship.routeState === 'engaging') {
    const targetCapital = enemyCapitals[0];
    const d = Math.sqrt(dist2(ship.x, ship.y, targetCapital.x, targetCapital.y));
    const gunRange = ship.kind.gunRange || RADAR_RANGE * 0.6;
    
    if (d <= gunRange * 1.1) {
      // In gun range - orbit to stay in range but not head-on
      const dir = ship.ai.strafe || 1;
      const orbitR = gunRange * 0.8;
      const relA = angleTo(targetCapital.x, targetCapital.y, ship.x, ship.y);
      const theta = relA + dir * 0.8;
      const orbitX = clamp(targetCapital.x + Math.cos(theta) * orbitR, 200, WORLD.w - 200);
      const orbitY = clamp(targetCapital.y + Math.sin(theta) * orbitR, 200, WORLD.h - 200);
      ship.plannedPath = [{ x: orbitX, y: orbitY }];
      
      const adj = avoidLandTarget(ship, orbitX, orbitY, state);
      updateAIThrottle(ship, 65, dt);
      steerToPoint(ship, adj.x, adj.y, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
      turretStep(ship, dt, ship.heading);
      return;
    }
  }
  
  // Follow planned path (either patrol or engagement route)
  // Progress through waypoints
  if (ship.plannedPath && ship.plannedPath.length > 0) {
    if (dist2(ship.x, ship.y, ship.ai.wpX, ship.ai.wpY) < 180*180) {
      ship.plannedPath.shift();
      if (ship.plannedPath.length > 0) {
        ship.ai.wpX = ship.plannedPath[0].x;
        ship.ai.wpY = ship.plannedPath[0].y;
      }
    }
  }
  
  // Plan initial patrol route if none exists
  if (!ship.plannedPath || ship.plannedPath.length === 0) {
    // Plan a patrol route toward center/enemy side of map
    const patrolX = ship.team === 'P' ? WORLD.w * 0.6 : WORLD.w * 0.4;
    const patrolY = rand(WORLD.h * 0.3, WORLD.h * 0.7);
    ship.plannedPath = planCommanderRoute(ship, state, patrolX, patrolY);
    if (ship.plannedPath.length > 0) {
      ship.ai.wpX = ship.plannedPath[0].x;
      ship.ai.wpY = ship.plannedPath[0].y;
    } else {
      const safe = avoidLandTarget(ship, patrolX, patrolY, state);
      ship.ai.wpX = safe.x;
      ship.ai.wpY = safe.y;
      ship.plannedPath = [{ x: safe.x, y: safe.y }];
    }
    ship.ai.wpUntil = state.time + rand(15.0, 25.0);
  }
  
  // If reached end of path, plan new patrol route
  if (ship.plannedPath.length === 0 && ship.routeState === 'patrol') {
    const patrolX = rand(WORLD.w * 0.3, WORLD.w * 0.7);
    const patrolY = rand(WORLD.h * 0.3, WORLD.h * 0.7);
    ship.plannedPath = planCommanderRoute(ship, state, patrolX, patrolY);
    if (ship.plannedPath.length > 0) {
      ship.ai.wpX = ship.plannedPath[0].x;
      ship.ai.wpY = ship.plannedPath[0].y;
    }
  }
  
  const throttle = ship.routeState === 'engaging' ? CAPITAL_COMBAT_THROTTLE : CAPITAL_PATROL_THROTTLE;
  updateAIThrottle(ship, throttle, dt);
  steerToPoint(ship, ship.ai.wpX, ship.ai.wpY, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
  turretStep(ship, dt, ship.heading);
}

// ═══════════════════════════════════════════════════════════════════════════
// ENEMY AI
// ═══════════════════════════════════════════════════════════════════════════
export function aiStep(ship, dt, state, diff, showMsg, autoSupportLaunch) {
  if (!ship.alive) return;
  if (autoSupportLaunch) autoSupportLaunch(ship, dt, state, showMsg);
  
  const lvl = state.level;
  const df = diff();
  const enemies = aliveShips(state.player);
  if (enemies.length === 0) return;
  
  const best = pickTargetDetectable(ship, enemies);
  const leader = pickCapitalLeader(state.enemy);
  
  // Non-commander ships follow formation
  if (leader && leader.alive && leader !== ship) {
    const fp = formationPoint(leader, ship, (x, y, pad) => inLand(x, y, pad, state));
    let tgt = { x: clamp(fp.x, 0, WORLD.w), y: clamp(fp.y, 0, WORLD.h) };
    tgt = avoidHostileBatteries(ship, tgt.x, tgt.y, state);
    
    // Track target waypoint for visualization
    ship.targetWaypoint = { x: tgt.x, y: tgt.y };
    
    // Calculate distance to formation position
    const dForm = Math.sqrt(dist2(ship.x, ship.y, tgt.x, tgt.y));
    
    // Track lock state
    if (!ship.escortLocked) ship.escortLocked = false;
    
    const hasEnemy = !!best;
    
    // Check if we should lock to commander's heading/speed
    // Only lock when inside radius AND already locked, or when very close
    const shouldLockEnemy = ship.escortLocked ? (dForm <= ESCORT_LOCK_RADIUS) : (dForm <= ESCORT_LOCK_RADIUS * 0.7);
    
    if (shouldLockEnemy && !hasEnemy) {
      // Lock in - directly copy commander's heading and match ACTUAL SPEED
      ship.escortLocked = true;
      
      // Directly match commander's heading (smooth transition)
      const headingDiff = normAngle(leader.heading - ship.heading);
      if (Math.abs(headingDiff) > 0.02) {
        ship.heading += headingDiff * 0.1;
      } else {
        ship.heading = leader.heading;
      }
      ship.heading = normAngle(ship.heading);
      
      // Match commander's ACTUAL SPEED (velocity magnitude), not throttle percentage
      const leaderSpeed = Math.hypot(leader.vx || 0, leader.vy || 0);
      
      // Calculate target velocity at leader's speed but in ship's heading direction
      const targetVx = Math.cos(ship.heading) * leaderSpeed;
      const targetVy = Math.sin(ship.heading) * leaderSpeed;
      
      // Blend toward target velocity
      ship.vx = ship.vx * 0.9 + targetVx * 0.1;
      ship.vy = ship.vy * 0.9 + targetVy * 0.1;
      
      // Small position correction
      if (dForm > 20) {
        const toTarget = angleTo(ship.x, ship.y, tgt.x, tgt.y);
        const correctionStrength = Math.min(0.5, dForm / 200);
        ship.vx += Math.cos(toTarget) * correctionStrength;
        ship.vy += Math.sin(toTarget) * correctionStrength;
      }
      
      // Set throttle to approximate the leader's speed for this ship type
      ship.throttle = clamp((leaderSpeed / ship.kind.maxSpeed) * 100, 0, 100);
      ship.rudderAngle = leader.rudderAngle || 0;
      
    } else if (dForm > ESCORT_LOCK_RADIUS && ship.escortLocked) {
      // Unlock ONLY when leaving the circle radius
      ship.escortLocked = false;
      steerToPoint(ship, tgt.x, tgt.y, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
      
      // Throttle based on distance
      if (dForm > 300) {
        updateAIThrottle(ship, 100, dt);
      } else if (dForm > 150) {
        updateAIThrottle(ship, 75, dt);
      } else {
        updateAIThrottle(ship, leader.throttle || 55, dt);
      }
    } else if (!ship.escortLocked) {
      // Not locked yet - steer toward position
      steerToPoint(ship, tgt.x, tgt.y, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
      
      // Throttle based on distance
      if (dForm > 300) {
        updateAIThrottle(ship, 100, dt);
      } else if (dForm > 150) {
        updateAIThrottle(ship, 75, dt);
      } else {
        updateAIThrottle(ship, leader.throttle || 55, dt);
      }
    }
    
    if (hasEnemy) {
      ship.escortLocked = false;
      steerToPoint(ship, tgt.x, tgt.y, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
      updateAIThrottle(ship, 75, dt);
    }
    
    if (best) {
      const d = Math.sqrt(dist2(ship.x, ship.y, best.x, best.y));
      const tLead = (ship.kind.shellSpeed > 0) ? clamp(d / ship.kind.shellSpeed, 0, 2.5) : 0;
      const aimX = best.x + best.vx * tLead * 0.70;
      const aimY = best.y + best.vy * tLead * 0.70;
      const aimA = angleTo(ship.x, ship.y, aimX, aimY);
      turretStep(ship, dt, aimA);
      if (ship.kind.gunRange > 0 && d <= ship.kind.gunRange) {
        const accuracy = clamp((0.14 + 0.06*lvl) * df.aiAccMult, 0, 0.70);
        const aligned = Math.abs(normAngle(ship.turret - aimA)) < 0.33;
        if (aligned) {
          const distFactor = clamp(d / RADAR_RANGE, 0.65, 1.1);
          const err = lerp(120, 28, accuracy) * distFactor;
          const tx = clamp(aimX + rand(-err, err), 0, WORLD.w);
          const ty = clamp(aimY + rand(-err, err), 0, WORLD.w);
          tryFireAtPoint(ship, tx, ty, accuracy * 0.75, state, null, (s, x, y) => shotSpotting(s, x, y, state));
        }
      }
      if (ship.missileAmmo > 0 && ship.missileAmmoMax > 0 && ship.kind.missileReload > 0 && d <= RADAR_RANGE && d >= RADAR_RANGE * 0.45 && Math.random() < (0.0045 + 0.0010*lvl) * df.aiAggroMult) {
        tryMissile(ship, state, null);
      }
    } else {
      turretStep(ship, dt, ship.heading);
    }
    if (ship.onFire && ship.extCd <= 0 && Math.random() < 0.55 * dt) tryExtinguish(ship, true, null);
    if (ship.kind.smokeCooldown > 0 && ship.smokeCd <= 0 && ship.hp < ship.kind.hp * 0.50) {
      const hpRatio = ship.hp / ship.kind.hp;
      const smokeChance = (hpRatio < 0.25) ? 0.8 : ((hpRatio < 0.35) ? 0.4 : 0.15);
      if (Math.random() < smokeChance * dt) trySmoke(ship, state, null);
    }
    return;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // COMMANDER BEHAVIOR - Route planning with state machine
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Initialize route state if needed
  if (!ship.routeState) ship.routeState = 'patrol';
  
  const anyEnemyVisible = enemies.some(e => canSee(ship.team, e));
  const enemyCapitals = enemies.filter(e => e.alive && (e.kind.type === 'BB' || e.kind.type === 'CV') && canSee(ship.team, e));
  
  // Check if we need to plan engagement route (only once when enemy first spotted)
  if (anyEnemyVisible && ship.routeState === 'patrol') {
    const visibleEnemy = enemies.find(e => canSee(ship.team, e));
    if (visibleEnemy) {
      const gunRange = ship.kind.gunRange || RADAR_RANGE * 0.6;
      ship.plannedPath = planEngagementRoute(ship, visibleEnemy.x, visibleEnemy.y, gunRange, state);
      ship.routeState = 'engaging';
      if (ship.plannedPath.length > 0) {
        ship.ai.wpX = ship.plannedPath[0].x;
        ship.ai.wpY = ship.plannedPath[0].y;
        ship.ai.wpUntil = state.time + 30;
      }
    }
  }
  
  // If engaging and enemy capital in gun range, do combat maneuvers
  if (enemyCapitals.length > 0 && ship.routeState === 'engaging') {
    const targetCapital = enemyCapitals[0];
    const d = Math.sqrt(dist2(ship.x, ship.y, targetCapital.x, targetCapital.y));
    const gunRange = ship.kind.gunRange || RADAR_RANGE * 0.6;
    
    if (d <= gunRange * 1.1) {
      // In gun range - orbit to stay in range but not head-on
      const dir = ship.ai.strafe || 1;
      const orbitR = gunRange * 0.8;
      const relA = angleTo(targetCapital.x, targetCapital.y, ship.x, ship.y);
      const theta = relA + dir * 0.8;
      const orbitX = clamp(targetCapital.x + Math.cos(theta) * orbitR, 200, WORLD.w - 200);
      const orbitY = clamp(targetCapital.y + Math.sin(theta) * orbitR, 200, WORLD.h - 200);
      ship.plannedPath = [{ x: orbitX, y: orbitY }];
      
      const adj = avoidLandTarget(ship, orbitX, orbitY, state);
      updateAIThrottle(ship, 65, dt);
      steerToPoint(ship, adj.x, adj.y, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
      
      // Fire at target
      const tLead = (ship.kind.shellSpeed > 0) ? clamp(d / ship.kind.shellSpeed, 0, 2.5) : 0;
      const aimX = targetCapital.x + targetCapital.vx * tLead * 0.70;
      const aimY = targetCapital.y + targetCapital.vy * tLead * 0.70;
      const aimA = angleTo(ship.x, ship.y, aimX, aimY);
      turretStep(ship, dt, aimA);
      
      if (ship.kind.gunRange > 0 && d <= ship.kind.gunRange) {
        const accuracy = clamp((0.14 + 0.06*lvl) * df.aiAccMult, 0, 0.70);
        const aligned = Math.abs(normAngle(ship.turret - aimA)) < 0.33;
        if (aligned) {
          const distFactor = clamp(d / RADAR_RANGE, 0.65, 1.1);
          const err = lerp(120, 28, accuracy) * distFactor;
          const fx = clamp(aimX + rand(-err, err), 0, WORLD.w);
          const fy = clamp(aimY + rand(-err, err), 0, WORLD.h);
          tryFireAtPoint(ship, fx, fy, accuracy * 0.75, state, null, (s, x, y) => shotSpotting(s, x, y, state));
        }
      }
      return;
    }
  }
  
  // Follow planned path (either patrol or engagement route)
  if (ship.plannedPath && ship.plannedPath.length > 0) {
    if (dist2(ship.x, ship.y, ship.ai.wpX, ship.ai.wpY) < 180*180) {
      ship.plannedPath.shift();
      if (ship.plannedPath.length > 0) {
        ship.ai.wpX = ship.plannedPath[0].x;
        ship.ai.wpY = ship.plannedPath[0].y;
      }
    }
  }
  
  // Plan initial patrol route if none exists
  if (!ship.plannedPath || ship.plannedPath.length === 0) {
    // Plan a patrol route toward center/enemy side of map
    const patrolX = ship.team === 'E' ? WORLD.w * 0.4 : WORLD.w * 0.6;
    const patrolY = rand(WORLD.h * 0.3, WORLD.h * 0.7);
    ship.plannedPath = planCommanderRoute(ship, state, patrolX, patrolY);
    if (ship.plannedPath.length > 0) {
      ship.ai.wpX = ship.plannedPath[0].x;
      ship.ai.wpY = ship.plannedPath[0].y;
    } else {
      const safe = avoidLandTarget(ship, patrolX, patrolY, state);
      ship.ai.wpX = safe.x;
      ship.ai.wpY = safe.y;
      ship.plannedPath = [{ x: safe.x, y: safe.y }];
    }
    ship.ai.wpUntil = state.time + rand(15.0, 25.0);
  }
  
  // If reached end of path and still patrolling, plan new patrol route
  if (ship.plannedPath.length === 0 && ship.routeState === 'patrol') {
    const patrolX = rand(WORLD.w * 0.3, WORLD.w * 0.7);
    const patrolY = rand(WORLD.h * 0.3, WORLD.h * 0.7);
    ship.plannedPath = planCommanderRoute(ship, state, patrolX, patrolY);
    if (ship.plannedPath.length > 0) {
      ship.ai.wpX = ship.plannedPath[0].x;
      ship.ai.wpY = ship.plannedPath[0].y;
    }
  }
  
  const throttle = ship.routeState === 'engaging' ? 75 : 55;
  updateAIThrottle(ship, throttle, dt);
  
  const adj = avoidHostileBatteries(ship, ship.ai.wpX, ship.ai.wpY, state);
  steerToPoint(ship, adj.x, adj.y, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
  turretStep(ship, dt, ship.heading);
  
  if (ship.onFire && ship.extCd <= 0 && Math.random() < 0.55 * dt) tryExtinguish(ship, true, null);
  if (ship.kind.smokeCooldown > 0 && ship.smokeCd <= 0 && ship.hp < ship.kind.hp * 0.50) {
    const hpRatio = ship.hp / ship.kind.hp;
    const smokeChance = (hpRatio < 0.25) ? 0.8 : ((hpRatio < 0.35) ? 0.4 : 0.15);
    if (Math.random() < smokeChance * dt) trySmoke(ship, state, null);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYER AI (for spectator mode) - Same as enemy AI but targets enemies
// ═══════════════════════════════════════════════════════════════════════════
export function aiStepPlayer(ship, dt, state, diff, showMsg, autoSupportLaunch) {
  if (!ship.alive) return;
  if (autoSupportLaunch) autoSupportLaunch(ship, dt, state, showMsg);
  
  const lvl = state.level;
  const df = diff();
  const enemies = aliveShips(state.enemy);
  if (enemies.length === 0) return;
  
  const best = pickTargetDetectable(ship, enemies);
  const leader = pickCapitalLeader(state.player);
  
  // Non-commander ships follow formation
  if (leader && leader.alive && leader !== ship) {
    const fp = formationPoint(leader, ship, (x, y, pad) => inLand(x, y, pad, state));
    let tgt = { x: clamp(fp.x, 0, WORLD.w), y: clamp(fp.y, 0, WORLD.h) };
    tgt = avoidHostileBatteries(ship, tgt.x, tgt.y, state);
    
    // Track target waypoint for visualization
    ship.targetWaypoint = { x: tgt.x, y: tgt.y };
    
    // Calculate distance to formation position
    const dForm = Math.sqrt(dist2(ship.x, ship.y, tgt.x, tgt.y));
    
    // Track lock state
    if (!ship.escortLocked) ship.escortLocked = false;
    
    const hasEnemy = !!best;
    
    // Check if we should lock to commander's heading/speed
    // Only lock when inside radius AND already locked, or when very close
    const shouldLockPlayer = ship.escortLocked ? (dForm <= ESCORT_LOCK_RADIUS) : (dForm <= ESCORT_LOCK_RADIUS * 0.7);
    
    if (shouldLockPlayer && !hasEnemy) {
      // Lock in - directly copy commander's heading and match ACTUAL SPEED
      ship.escortLocked = true;
      
      // Directly match commander's heading (smooth transition)
      const headingDiff = normAngle(leader.heading - ship.heading);
      if (Math.abs(headingDiff) > 0.02) {
        ship.heading += headingDiff * 0.1;
      } else {
        ship.heading = leader.heading;
      }
      ship.heading = normAngle(ship.heading);
      
      // Match commander's ACTUAL SPEED (velocity magnitude), not throttle percentage
      const leaderSpeed = Math.hypot(leader.vx || 0, leader.vy || 0);
      
      // Calculate target velocity at leader's speed but in ship's heading direction
      const targetVx = Math.cos(ship.heading) * leaderSpeed;
      const targetVy = Math.sin(ship.heading) * leaderSpeed;
      
      // Blend toward target velocity
      ship.vx = ship.vx * 0.9 + targetVx * 0.1;
      ship.vy = ship.vy * 0.9 + targetVy * 0.1;
      
      // Small position correction
      if (dForm > 20) {
        const toTarget = angleTo(ship.x, ship.y, tgt.x, tgt.y);
        const correctionStrength = Math.min(0.5, dForm / 200);
        ship.vx += Math.cos(toTarget) * correctionStrength;
        ship.vy += Math.sin(toTarget) * correctionStrength;
      }
      
      // Set throttle to approximate the leader's speed for this ship type
      ship.throttle = clamp((leaderSpeed / ship.kind.maxSpeed) * 100, 0, 100);
      ship.rudderAngle = leader.rudderAngle || 0;
      
    } else if (dForm > ESCORT_LOCK_RADIUS && ship.escortLocked) {
      // Unlock ONLY when leaving the circle radius
      ship.escortLocked = false;
      steerToPoint(ship, tgt.x, tgt.y, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
      
      // Throttle based on distance
      if (dForm > 300) {
        updateAIThrottle(ship, 100, dt);
      } else if (dForm > 150) {
        updateAIThrottle(ship, 75, dt);
      } else {
        updateAIThrottle(ship, leader.throttle || 55, dt);
      }
    } else if (!ship.escortLocked) {
      // Not locked yet - steer toward position
      steerToPoint(ship, tgt.x, tgt.y, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
      
      // Throttle based on distance
      if (dForm > 300) {
        updateAIThrottle(ship, 100, dt);
      } else if (dForm > 150) {
        updateAIThrottle(ship, 75, dt);
      } else {
        updateAIThrottle(ship, leader.throttle || 55, dt);
      }
    }
    
    if (hasEnemy) {
      ship.escortLocked = false;
      steerToPoint(ship, tgt.x, tgt.y, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
      updateAIThrottle(ship, 75, dt);
    }
    
    if (best) {
      const d = Math.sqrt(dist2(ship.x, ship.y, best.x, best.y));
      const tLead = (ship.kind.shellSpeed > 0) ? clamp(d / ship.kind.shellSpeed, 0, 2.5) : 0;
      const aimX = best.x + best.vx * tLead * 0.70;
      const aimY = best.y + best.vy * tLead * 0.70;
      const aimA = angleTo(ship.x, ship.y, aimX, aimY);
      turretStep(ship, dt, aimA);
      if (ship.kind.gunRange > 0 && d <= ship.kind.gunRange) {
        const accuracy = clamp((0.14 + 0.06*lvl) * df.aiAccMult, 0, 0.70);
        const aligned = Math.abs(normAngle(ship.turret - aimA)) < 0.33;
        if (aligned) {
          const distFactor = clamp(d / RADAR_RANGE, 0.65, 1.1);
          const err = lerp(120, 28, accuracy) * distFactor;
          const tx = clamp(aimX + rand(-err, err), 0, WORLD.w);
          const ty = clamp(aimY + rand(-err, err), 0, WORLD.h);
          tryFireAtPoint(ship, tx, ty, accuracy * 0.75, state, null, (s, x, y) => shotSpotting(s, x, y, state));
        }
      }
      if (ship.missileAmmo > 0 && ship.missileAmmoMax > 0 && ship.kind.missileReload > 0 && d <= RADAR_RANGE && d >= RADAR_RANGE * 0.45 && Math.random() < (0.0045 + 0.0010*lvl) * df.aiAggroMult) {
        tryMissile(ship, state, null);
      }
    } else {
      turretStep(ship, dt, ship.heading);
    }
    if (ship.onFire && ship.extCd <= 0 && Math.random() < 0.55 * dt) tryExtinguish(ship, true, null);
    if (ship.kind.smokeCooldown > 0 && ship.smokeCd <= 0 && ship.hp < ship.kind.hp * 0.50) {
      const hpRatio = ship.hp / ship.kind.hp;
      const smokeChance = (hpRatio < 0.25) ? 0.8 : ((hpRatio < 0.35) ? 0.4 : 0.15);
      if (Math.random() < smokeChance * dt) trySmoke(ship, state, null);
    }
    return;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // COMMANDER BEHAVIOR - Route planning with state machine
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Initialize route state if needed
  if (!ship.routeState) ship.routeState = 'patrol';
  
  const anyEnemyVisible = enemies.some(e => canSee(ship.team, e));
  const enemyCapitals = enemies.filter(e => e.alive && (e.kind.type === 'BB' || e.kind.type === 'CV') && canSee(ship.team, e));
  
  // Check if we need to plan engagement route (only once when enemy first spotted)
  if (anyEnemyVisible && ship.routeState === 'patrol') {
    const visibleEnemy = enemies.find(e => canSee(ship.team, e));
    if (visibleEnemy) {
      const gunRange = ship.kind.gunRange || RADAR_RANGE * 0.6;
      ship.plannedPath = planEngagementRoute(ship, visibleEnemy.x, visibleEnemy.y, gunRange, state);
      ship.routeState = 'engaging';
      if (ship.plannedPath.length > 0) {
        ship.ai.wpX = ship.plannedPath[0].x;
        ship.ai.wpY = ship.plannedPath[0].y;
        ship.ai.wpUntil = state.time + 30;
      }
    }
  }
  
  // If engaging and enemy capital in gun range, do combat maneuvers
  if (enemyCapitals.length > 0 && ship.routeState === 'engaging') {
    const targetCapital = enemyCapitals[0];
    const d = Math.sqrt(dist2(ship.x, ship.y, targetCapital.x, targetCapital.y));
    const gunRange = ship.kind.gunRange || RADAR_RANGE * 0.6;
    
    if (d <= gunRange * 1.1) {
      // In gun range - orbit to stay in range but not head-on
      const dir = ship.ai.strafe || 1;
      const orbitR = gunRange * 0.8;
      const relA = angleTo(targetCapital.x, targetCapital.y, ship.x, ship.y);
      const theta = relA + dir * 0.8;
      const orbitX = clamp(targetCapital.x + Math.cos(theta) * orbitR, 200, WORLD.w - 200);
      const orbitY = clamp(targetCapital.y + Math.sin(theta) * orbitR, 200, WORLD.h - 200);
      ship.plannedPath = [{ x: orbitX, y: orbitY }];
      
      const adj = avoidLandTarget(ship, orbitX, orbitY, state);
      updateAIThrottle(ship, 65, dt);
      steerToPoint(ship, adj.x, adj.y, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
      
      // Fire at target
      const tLead = (ship.kind.shellSpeed > 0) ? clamp(d / ship.kind.shellSpeed, 0, 2.5) : 0;
      const aimX = targetCapital.x + targetCapital.vx * tLead * 0.70;
      const aimY = targetCapital.y + targetCapital.vy * tLead * 0.70;
      const aimA = angleTo(ship.x, ship.y, aimX, aimY);
      turretStep(ship, dt, aimA);
      
      if (ship.kind.gunRange > 0 && d <= ship.kind.gunRange) {
        const accuracy = clamp((0.14 + 0.06*lvl) * df.aiAccMult, 0, 0.70);
        const aligned = Math.abs(normAngle(ship.turret - aimA)) < 0.33;
        if (aligned) {
          const distFactor = clamp(d / RADAR_RANGE, 0.65, 1.1);
          const err = lerp(120, 28, accuracy) * distFactor;
          const fx = clamp(aimX + rand(-err, err), 0, WORLD.w);
          const fy = clamp(aimY + rand(-err, err), 0, WORLD.h);
          tryFireAtPoint(ship, fx, fy, accuracy * 0.75, state, null, (s, x, y) => shotSpotting(s, x, y, state));
        }
      }
      return;
    }
  }
  
  // Follow planned path (either patrol or engagement route)
  if (ship.plannedPath && ship.plannedPath.length > 0) {
    if (dist2(ship.x, ship.y, ship.ai.wpX, ship.ai.wpY) < 180*180) {
      ship.plannedPath.shift();
      if (ship.plannedPath.length > 0) {
        ship.ai.wpX = ship.plannedPath[0].x;
        ship.ai.wpY = ship.plannedPath[0].y;
      }
    }
  }
  
  // Plan initial patrol route if none exists
  if (!ship.plannedPath || ship.plannedPath.length === 0) {
    const patrolX = ship.team === 'P' ? WORLD.w * 0.6 : WORLD.w * 0.4;
    const patrolY = rand(WORLD.h * 0.3, WORLD.h * 0.7);
    ship.plannedPath = planCommanderRoute(ship, state, patrolX, patrolY);
    if (ship.plannedPath.length > 0) {
      ship.ai.wpX = ship.plannedPath[0].x;
      ship.ai.wpY = ship.plannedPath[0].y;
    } else {
      const safe = avoidLandTarget(ship, patrolX, patrolY, state);
      ship.ai.wpX = safe.x;
      ship.ai.wpY = safe.y;
      ship.plannedPath = [{ x: safe.x, y: safe.y }];
    }
    ship.ai.wpUntil = state.time + rand(15.0, 25.0);
  }
  
  // If reached end of path and still patrolling, plan new patrol route
  if (ship.plannedPath.length === 0 && ship.routeState === 'patrol') {
    const patrolX = rand(WORLD.w * 0.3, WORLD.w * 0.7);
    const patrolY = rand(WORLD.h * 0.3, WORLD.h * 0.7);
    ship.plannedPath = planCommanderRoute(ship, state, patrolX, patrolY);
    if (ship.plannedPath.length > 0) {
      ship.ai.wpX = ship.plannedPath[0].x;
      ship.ai.wpY = ship.plannedPath[0].y;
    }
  }
  
  const throttle = ship.routeState === 'engaging' ? 75 : 55;
  updateAIThrottle(ship, throttle, dt);
  
  const adj = avoidHostileBatteries(ship, ship.ai.wpX, ship.ai.wpY, state);
  steerToPoint(ship, adj.x, adj.y, dt, ship.kind.maxSpeed * (ship.throttle / 100), state);
  turretStep(ship, dt, ship.heading);
  
  if (ship.onFire && ship.extCd <= 0 && Math.random() < 0.55 * dt) tryExtinguish(ship, true, null);
  if (ship.kind.smokeCooldown > 0 && ship.smokeCd <= 0 && ship.hp < ship.kind.hp * 0.50) {
    const hpRatio = ship.hp / ship.kind.hp;
    const smokeChance = (hpRatio < 0.25) ? 0.8 : ((hpRatio < 0.35) ? 0.4 : 0.15);
    if (Math.random() < smokeChance * dt) trySmoke(ship, state, null);
  }
}
