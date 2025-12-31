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
// Escort positions are now at FORM_SEP * 2.5 + FORM_SEP * 1.5 from commander
// FORM_SEP = 45 * MAP_SCALE = 45 * 2.8 = 126, so outer escorts are ~500 units ahead
const ESCORT_FORMATION_RADIUS = 500; // How far escorts can be from commander
const COMMANDER_LAND_MARGIN = 200 + ESCORT_FORMATION_RADIUS; // Margin so escorts don't touch coast

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
  const margin = ship.kind.radius + 60; // Increased margin for better spacing
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

// Predict collision between two ships - looks 6 seconds ahead for early detection
// Uses CPA (Closest Point of Approach) to catch side collisions
export function predictCollision(ship, other, lookAhead = 6.0) {
  if (!ship || !other || !ship.alive || !other.alive) return null;
  if (ship === other) return null;
  
  const dx = other.x - ship.x;
  const dy = other.y - ship.y;
  const currentDist = Math.hypot(dx, dy);
  const collisionDist = ship.kind.radius + other.kind.radius + 40;
  
  // Already too close - emergency
  if (currentDist < collisionDist + 30) {
    return { 
      willCollide: true, 
      timeToCollision: 0, 
      otherShip: other,
      urgency: 1.0,
      dx, dy, currentDist
    };
  }
  
  // Find minimum distance over time (catches side collisions)
  let minDist = currentDist;
  let minTime = 0;
  
  // Check discrete time steps
  for (let t = 0.5; t <= lookAhead; t += 0.5) {
    const shipFutureX = ship.x + (ship.vx || 0) * t;
    const shipFutureY = ship.y + (ship.vy || 0) * t;
    const otherFutureX = other.x + (other.vx || 0) * t;
    const otherFutureY = other.y + (other.vy || 0) * t;
    
    const futureDist = Math.hypot(otherFutureX - shipFutureX, otherFutureY - shipFutureY);
    
    if (futureDist < minDist) {
      minDist = futureDist;
      minTime = t;
    }
  }
  
  // Also calculate exact CPA (Closest Point of Approach) for precision
  const relVx = (ship.vx || 0) - (other.vx || 0);
  const relVy = (ship.vy || 0) - (other.vy || 0);
  const relSpeed = Math.hypot(relVx, relVy);
  
  if (relSpeed > 0.5) {
    const tcpa = -(dx * relVx + dy * relVy) / (relSpeed * relSpeed);
    if (tcpa > 0 && tcpa < lookAhead) {
      const cpaX = ship.x + (ship.vx || 0) * tcpa;
      const cpaY = ship.y + (ship.vy || 0) * tcpa;
      const otherCpaX = other.x + (other.vx || 0) * tcpa;
      const otherCpaY = other.y + (other.vy || 0) * tcpa;
      const cpaDist = Math.hypot(otherCpaX - cpaX, otherCpaY - cpaY);
      
      if (cpaDist < minDist) {
        minDist = cpaDist;
        minTime = tcpa;
      }
    }
  }
  
  // Will they be too close?
  if (minDist < collisionDist + 60) {
    const urgency = clamp(1 - (minTime / lookAhead), 0.2, 1.0);
    return {
      willCollide: true,
      timeToCollision: minTime,
      otherShip: other,
      urgency,
      dx, dy, currentDist, futureDist: minDist
    };
  }
  
  return null;
}

// Check all potential collisions for a ship - 6 second lookahead
export function checkAllCollisions(ship, allShips, lookAhead = 6.0) {
  const collisions = [];
  
  for (const other of allShips) {
    if (!other || !other.alive || other === ship) continue;
    if (other.team !== ship.team) continue;
    
    const collision = predictCollision(ship, other, lookAhead);
    if (collision) {
      collisions.push(collision);
    }
  }
  
  collisions.sort((a, b) => b.urgency - a.urgency);
  return collisions;
}

// Collision avoidance - detect early (6s), react strongly enough to avoid
// This runs for ALL ships, locked or not
// Smart collision avoidance - steer BEHIND ship in front, steer IN FRONT of ship behind
export function calculateAvoidanceSteering(ship, allShips) {
  let totalSteer = 0;
  ship.collisionPredicted = null;
  
  for (const other of allShips) {
    if (!other || !other.alive || other === ship) continue;
    if (other.team !== ship.team) continue;
    
    const dx = other.x - ship.x;
    const dy = other.y - ship.y;
    const dist = Math.hypot(dx, dy);
    const collisionDist = ship.kind.radius + other.kind.radius + 25;
    
    // Skip if too far
    if (dist > 200) continue;
    
    // Check if we'll get close
    let minFutureDist = dist;
    let collisionTime = 0;
    
    for (let t = 0.3; t <= 3.0; t += 0.3) {
      const futureX = ship.x + (ship.vx || 0) * t;
      const futureY = ship.y + (ship.vy || 0) * t;
      const otherFutureX = other.x + (other.vx || 0) * t;
      const otherFutureY = other.y + (other.vy || 0) * t;
      const futureDist = Math.hypot(otherFutureX - futureX, otherFutureY - futureY);
      
      if (futureDist < minFutureDist) {
        minFutureDist = futureDist;
        collisionTime = t;
      }
    }
    
    // Danger check
    const dangerouslyClose = dist < collisionDist + 40;
    const willCollide = minFutureDist < collisionDist + 30;
    
    if (!dangerouslyClose && !willCollide) continue;
    
    // Calculate urgency
    const urgency = clamp(1 - ((Math.min(dist, minFutureDist) - collisionDist) / 50), 0.3, 1.0);
    
    // Show alert
    ship.collisionPredicted = {
      x: (ship.x + other.x) / 2,
      y: (ship.y + other.y) / 2,
      time: collisionTime,
      urgency: urgency,
      withShip: other
    };
    
    // SMART STEERING: Check if other ship is in front or behind us
    const toOther = Math.atan2(dy, dx);
    const relAngle = normAngle(toOther - ship.heading);
    
    // Other ship is in front of us (within ±90 degrees of our heading)
    const otherInFront = Math.abs(relAngle) < Math.PI / 2;
    
    // Check other ship's direction relative to us
    const otherToUs = Math.atan2(-dy, -dx);
    const otherRelAngle = normAngle(otherToUs - other.heading);
    const weAreInFrontOfOther = Math.abs(otherRelAngle) < Math.PI / 2;
    
    let steerDir = 0;
    let steerStrength = 0.35;
    
    if (otherInFront && !weAreInFrontOfOther) {
      // Other is in front, we are behind -> steer BEHIND them (away from their path)
      // Steer to the side opposite of where they're going
      const otherMovingRight = Math.sin(normAngle(other.heading - ship.heading)) > 0;
      steerDir = otherMovingRight ? -1 : 1; // Go opposite of their turn
    } else if (!otherInFront && weAreInFrontOfOther) {
      // We are in front, other is behind -> steer IN FRONT (accelerate our turn)
      // Steer away from where they are
      steerDir = relAngle > 0 ? -1 : 1;
    } else {
      // Side by side or complex situation -> steer away from other ship
      steerDir = relAngle > 0 ? -1 : 1;
      
      // Use index to break ties deterministically
      const myIdx = ship.escortPosition ?? 0;
      const otherIdx = other.escortPosition ?? 0;
      if (myIdx !== otherIdx) {
        steerDir = myIdx < otherIdx ? 1 : -1;
      }
    }
    
    totalSteer += steerDir * steerStrength * urgency;
  }
  
  return { steer: clamp(totalSteer, -0.55, 0.55), throttle: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// RUDDER SYSTEM - Faster rudder response, AI accounts for inertia
// ═══════════════════════════════════════════════════════════════════════════
export function applyRudder(ship, desiredTurn, dt) {
  const targetRudder = clamp(desiredTurn, -MAX_RUDDER_ANGLE, MAX_RUDDER_ANGLE);
  
  // Faster rudder movement
  const rudderSpeed = 0.3; // Radians per second (~1.7s for full swing)
  const diff = targetRudder - (ship.rudderAngle || 0);
  const maxChange = rudderSpeed * dt;
  
  if (Math.abs(diff) > 0.01) {
    ship.rudderAngle = (ship.rudderAngle || 0) + clamp(diff, -maxChange, maxChange);
  } else if (Math.abs(targetRudder) < 0.02) {
    // Return to center when no input
    const returnSpeed = 0.2 * dt;
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
  
  // Lower inertia = faster response to rudder
  const angularDiff = targetTurnRate - ship.angularVel;
  const maxAngularChange = ship.kind.turnRate * dt * 0.8;
  ship.angularVel += clamp(angularDiff * 0.6 * dt, -maxAngularChange, maxAngularChange);
  ship.angularVel *= 0.98; // Lower inertia (was 0.995)
  
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
  
  const collisionDist = ship.kind.radius + 15; // Actual collision distance
  
  // Only check current position - are we about to hit?
  for (const c of m.land) {
    const dx = ship.x - c.x, dy = ship.y - c.y;
    const d = Math.hypot(dx, dy);
    
    if (d < c.r + collisionDist) {
      // Actually touching - emergency
      const awayAngle = Math.atan2(dy, dx);
      return { emergency: true, critical: true, angle: awayAngle, island: c, urgency: 1.0 };
    }
  }
  
  // Check 1.5 seconds ahead only
  const futureX = ship.x + ship.vx * 1.5;
  const futureY = ship.y + ship.vy * 1.5;
  
  for (const c of m.land) {
    const dx = futureX - c.x, dy = futureY - c.y;
    const d = Math.hypot(dx, dy);
    
    if (d < c.r + collisionDist + 30) {
      // Will hit soon - gentle correction
      const toIsland = Math.atan2(c.y - ship.y, c.x - ship.x);
      const headingToIsland = normAngle(toIsland - ship.heading);
      const turnDir = headingToIsland > 0 ? -1 : 1;
      const escapeAngle = normAngle(ship.heading + turnDir * Math.PI * 0.3);
      
      return { emergency: true, critical: false, angle: escapeAngle, island: c, urgency: 0.4, lookAhead: 1.5 };
    }
  }
  
  return { emergency: false };
}

export function steerToPoint(ship, tx, ty, dt, speedMax, state) {
  const friendlyShips = ship.team === 'P' ? state.player : state.enemy;
  
  // FIRST PRIORITY: Check for immediate land danger
  const landDanger = checkLandDanger(ship, state);
  
  if (landDanger.emergency) {
    // Land avoidance takes absolute priority
    const steerNeeded = normAngle(landDanger.angle - ship.heading);
    
    if (landDanger.critical) {
      applyRudder(ship, steerNeeded * 2.0, dt);
      ship.vx *= 0.95;
      ship.vy *= 0.95;
    } else {
      applyRudder(ship, steerNeeded * 0.5, dt);
    }
    
    const sp = Math.hypot(ship.vx, ship.vy);
    const want = speedMax * (landDanger.critical ? 0.4 : 0.6);
    const accel = (sp < want) ? ship.kind.accel * 0.5 : -ship.kind.accel * 0.4;
    ship.vx += Math.cos(ship.heading) * accel * dt;
    ship.vy += Math.sin(ship.heading) * accel * dt;
    
    return Math.sqrt(dist2(ship.x, ship.y, tx, ty));
  }
  
  // Plan route around islands
  const safe = avoidLandTarget(ship, tx, ty, state);
  let targetX = safe.x;
  let targetY = safe.y;
  
  const desired = angleTo(ship.x, ship.y, targetX, targetY);
  let headingDiff = normAngle(desired - ship.heading);
  
  // Collision avoidance for unlocked ships
  const avoidance = calculateAvoidanceSteering(ship, friendlyShips);
  
  // ACCOUNT FOR ANGULAR INERTIA - predict where we'll be pointing
  const angularVel = ship.angularVel || 0;
  const predictedHeadingChange = angularVel * 0.5;
  const adjustedHeadingDiff = headingDiff - predictedHeadingChange;
  
  // Reduce steering when already turning the right way
  let steerMult = 0.5;
  if (Math.sign(angularVel) === Math.sign(headingDiff) && Math.abs(angularVel) > 0.05) {
    steerMult = 0.25;
  }
  
  // If collision avoidance is active, apply it DIRECTLY (not reduced by steerMult)
  if (avoidance.steer !== 0) {
    applyRudder(ship, adjustedHeadingDiff * steerMult + avoidance.steer, dt);
  } else {
    applyRudder(ship, adjustedHeadingDiff * steerMult, dt);
  }
  
  const d = Math.sqrt(dist2(ship.x, ship.y, tx, ty));
  
  // Use the speedMax passed in - don't override with distance-based speed
  // The caller controls speed via throttle
  const want = speedMax;
  
  const sp = Math.hypot(ship.vx, ship.vy);
  const accel = (sp < want) ? ship.kind.accel * 0.8 : -ship.kind.accel * 0.5;
  
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
  // COMPLETELY DISABLED - no collision avoidance
  // Ships follow their formation paths without interference
  return;
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
  const CAPITAL_PATROL_THROTTLE = 70; // Slower so escorts can catch up at 100%
  const CAPITAL_CRUISE_THROTTLE = 70;
  
  const leader = pickCapitalLeader(state.player);
  if (leader && leader.alive && leader !== ship) {
    // Not the commander - follow formation (both capitals and escorts)
    const fp = formationPoint(leader, ship, (x, y, pad) => inLand(x, y, pad, state));
    let tgt = { x: clamp(fp.x, 0, WORLD.w), y: clamp(fp.y, 0, WORLD.h) };
    
    ship.targetWaypoint = { x: tgt.x, y: tgt.y };
    const dForm = Math.sqrt(dist2(ship.x, ship.y, tgt.x, tgt.y));
    
    // Initialize state
    if (ship.escortLocked === undefined) ship.escortLocked = false;
    if (ship.timeInPosition === undefined) ship.timeInPosition = 0;
    
    const targets = aliveShips(state.enemy);
    const best = pickTargetDetectable(ship, targets);
    const hasEnemy = !!best;
    
    const inRadius = dForm <= ESCORT_LOCK_RADIUS;
    const farOutside = dForm > ESCORT_LOCK_RADIUS * 3; // Only unlock if VERY far outside
    
    // Track time in position
    if (inRadius) {
      ship.timeInPosition += dt;
    } else if (!ship.escortLocked) {
      // Only reset timer if not locked
      ship.timeInPosition = 0;
    }
    
    // Lock/unlock logic - ONLY unlock when FAR outside circle (3x radius)
    // Enemy presence does NOT unlock - only distance matters
    if (ship.escortLocked && farOutside) {
      ship.escortLocked = false;
      ship.timeInPosition = 0;
    } else if (!ship.escortLocked && ship.timeInPosition >= 2.0) {
      ship.escortLocked = true;
    }
    
    if (ship.escortLocked) {
      // LOCKED - GRADUALLY match commander heading and speed
      ship.collisionPredicted = null;
      
      // Gradual heading match (not instant)
      const headingDiff = normAngle(leader.heading - ship.heading);
      ship.heading += headingDiff * 0.03 * dt * 60; // Gradual turn
      ship.heading = normAngle(ship.heading);
      
      // Gradual speed match
      const leaderSpeed = Math.hypot(leader.vx || 0, leader.vy || 0);
      const mySpeed = Math.hypot(ship.vx || 0, ship.vy || 0);
      const targetSpeed = leaderSpeed;
      const newSpeed = mySpeed + (targetSpeed - mySpeed) * 0.02 * dt * 60; // Gradual
      
      ship.vx = Math.cos(ship.heading) * newSpeed;
      ship.vy = Math.sin(ship.heading) * newSpeed;
      
      // Position correction to stay with formation
      if (dForm > 5) {
        const toTarget = angleTo(ship.x, ship.y, tgt.x, tgt.y);
        const correctionStrength = Math.min(dForm * 0.008, 0.3);
        ship.vx += Math.cos(toTarget) * correctionStrength;
        ship.vy += Math.sin(toTarget) * correctionStrength;
      }
      
      // COLLISION AVOIDANCE even when locked - use rudder for smooth dodge
      const avoidance = calculateAvoidanceSteering(ship, state.player);
      if (avoidance.steer !== 0) {
        applyRudder(ship, avoidance.steer, dt);
      } else {
        ship.rudderAngle = (ship.rudderAngle || 0) * 0.95;
      }
      
      ship.throttle = clamp((leaderSpeed / ship.kind.maxSpeed) * 100, 0, 100);
      
    } else {
      // NOT LOCKED - go to position at FULL SPEED
      // Capitals (CV/BB) need to catch up quickly
      const isCapital = ship.kind.type === 'CV' || ship.kind.type === 'BB';
      
      let approachSpeed, throttle;
      if (isCapital) {
        // Capitals: FULL SPEED when not in position, slow only when very close
        if (dForm > 100) {
          approachSpeed = ship.kind.maxSpeed;
          throttle = 100; // FULL SPEED
        } else if (dForm > 40) {
          approachSpeed = ship.kind.maxSpeed * 0.8;
          throttle = 80;
        } else {
          approachSpeed = ship.kind.maxSpeed * 0.5;
          throttle = 50;
        }
      } else {
        // Escorts: gradual slowdown
        approachSpeed = dForm < ESCORT_LOCK_RADIUS * 2 
          ? ship.kind.maxSpeed * Math.max(0.4, dForm / (ESCORT_LOCK_RADIUS * 2))
          : ship.kind.maxSpeed;
        throttle = dForm < ESCORT_LOCK_RADIUS * 2
          ? Math.max(40, (dForm / (ESCORT_LOCK_RADIUS * 2)) * 100)
          : 100;
      }
      
      steerToPoint(ship, tgt.x, tgt.y, dt, approachSpeed, state);
      updateAIThrottle(ship, throttle, dt);
    }
    
    // Combat behavior - steer toward enemy but DON'T unlock
    if (hasEnemy) {
      // Stay locked, just adjust aim for turrets
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
    
    // Desired combat distance - stay at 70-85% of gun range
    const minCombatDist = gunRange * 0.65;
    const idealCombatDist = gunRange * 0.75;
    const maxCombatDist = gunRange * 0.95;
    
    if (d <= gunRange * 1.2) {
      // In or near gun range - CIRCLE around enemy fleet while maintaining distance
      
      // Initialize strafe direction if not set
      if (!ship.ai.strafe) ship.ai.strafe = Math.random() > 0.5 ? 1 : -1;
      
      // Calculate orbit point - circle around enemy
      const relA = angleTo(targetCapital.x, targetCapital.y, ship.x, ship.y);
      
      // Determine orbit radius based on current distance
      let orbitR = idealCombatDist;
      let throttle = 70;
      
      if (d < minCombatDist) {
        // Too close - move outward while circling
        orbitR = idealCombatDist + 50;
        throttle = 80;
      } else if (d > maxCombatDist) {
        // Too far - move inward while circling
        orbitR = idealCombatDist - 30;
        throttle = 75;
      }
      
      // Circle around - advance angle in strafe direction
      const circleSpeed = 0.4; // How fast to circle (radians offset)
      const theta = relA + ship.ai.strafe * circleSpeed;
      
      const orbitX = clamp(targetCapital.x + Math.cos(theta) * orbitR, 200, WORLD.w - 200);
      const orbitY = clamp(targetCapital.y + Math.sin(theta) * orbitR, 200, WORLD.h - 200);
      
      // Occasionally change circle direction
      if (!ship.ai.strafeChangeTime) ship.ai.strafeChangeTime = state.time + rand(15, 30);
      if (state.time > ship.ai.strafeChangeTime) {
        ship.ai.strafe = -ship.ai.strafe;
        ship.ai.strafeChangeTime = state.time + rand(15, 30);
      }
      
      ship.plannedPath = [{ x: orbitX, y: orbitY }];
      
      const adj = avoidLandTarget(ship, orbitX, orbitY, state);
      updateAIThrottle(ship, throttle, dt);
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
  
  // Non-commander ships follow formation (both capitals and escorts)
  if (leader && leader.alive && leader !== ship) {
    const fp = formationPoint(leader, ship, (x, y, pad) => inLand(x, y, pad, state));
    let tgt = { x: clamp(fp.x, 0, WORLD.w), y: clamp(fp.y, 0, WORLD.h) };
    tgt = avoidHostileBatteries(ship, tgt.x, tgt.y, state);
    
    ship.targetWaypoint = { x: tgt.x, y: tgt.y };
    const dForm = Math.sqrt(dist2(ship.x, ship.y, tgt.x, tgt.y));
    
    if (ship.escortLocked === undefined) ship.escortLocked = false;
    if (ship.timeInPosition === undefined) ship.timeInPosition = 0;
    
    const hasEnemy = !!best;
    const inRadius = dForm <= ESCORT_LOCK_RADIUS;
    const farOutside = dForm > ESCORT_LOCK_RADIUS * 3;
    
    if (inRadius) {
      ship.timeInPosition += dt;
    } else if (!ship.escortLocked) {
      ship.timeInPosition = 0;
    }
    
    // Lock/unlock - ONLY unlock when FAR outside circle (3x radius)
    // Enemy presence does NOT unlock - only distance matters
    if (ship.escortLocked && farOutside) {
      ship.escortLocked = false;
      ship.timeInPosition = 0;
    } else if (!ship.escortLocked && ship.timeInPosition >= 2.0) {
      ship.escortLocked = true;
    }
    
    if (ship.escortLocked) {
      // LOCKED - GRADUALLY match commander heading and speed
      ship.collisionPredicted = null;
      
      // Gradual heading match
      const headingDiff = normAngle(leader.heading - ship.heading);
      ship.heading += headingDiff * 0.03 * dt * 60;
      ship.heading = normAngle(ship.heading);
      
      // Gradual speed match
      const leaderSpeed = Math.hypot(leader.vx || 0, leader.vy || 0);
      const mySpeed = Math.hypot(ship.vx || 0, ship.vy || 0);
      const targetSpeed = leaderSpeed;
      const newSpeed = mySpeed + (targetSpeed - mySpeed) * 0.02 * dt * 60;
      
      ship.vx = Math.cos(ship.heading) * newSpeed;
      ship.vy = Math.sin(ship.heading) * newSpeed;
      
      if (dForm > 5) {
        const toTarget = angleTo(ship.x, ship.y, tgt.x, tgt.y);
        const correctionStrength = Math.min(dForm * 0.008, 0.3);
        ship.vx += Math.cos(toTarget) * correctionStrength;
        ship.vy += Math.sin(toTarget) * correctionStrength;
      }
      
      // COLLISION AVOIDANCE even when locked - use rudder for smooth dodge
      const avoidance = calculateAvoidanceSteering(ship, state.enemy);
      if (avoidance.steer !== 0) {
        applyRudder(ship, avoidance.steer, dt);
      } else {
        ship.rudderAngle = (ship.rudderAngle || 0) * 0.95;
      }
      
      ship.throttle = clamp((leaderSpeed / ship.kind.maxSpeed) * 100, 0, 100);
    } else {
      // NOT LOCKED - go to position at FULL SPEED
      const isCapital = ship.kind.type === 'CV' || ship.kind.type === 'BB';
      
      let approachSpeed, throttle;
      if (isCapital) {
        // Capitals: FULL SPEED when not in position
        if (dForm > 100) {
          approachSpeed = ship.kind.maxSpeed;
          throttle = 100;
        } else if (dForm > 40) {
          approachSpeed = ship.kind.maxSpeed * 0.8;
          throttle = 80;
        } else {
          approachSpeed = ship.kind.maxSpeed * 0.5;
          throttle = 50;
        }
      } else {
        approachSpeed = dForm < ESCORT_LOCK_RADIUS * 2 
          ? ship.kind.maxSpeed * Math.max(0.4, dForm / (ESCORT_LOCK_RADIUS * 2))
          : ship.kind.maxSpeed;
        throttle = dForm < ESCORT_LOCK_RADIUS * 2
          ? Math.max(40, (dForm / (ESCORT_LOCK_RADIUS * 2)) * 100)
          : 100;
      }
      
      steerToPoint(ship, tgt.x, tgt.y, dt, approachSpeed, state);
      updateAIThrottle(ship, throttle, dt);
    }
    
    // Combat - DON'T unlock, just aim turrets
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
  
  const throttle = ship.routeState === 'engaging' ? 75 : 70; // 70% so escorts can catch up
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
  
  // Non-commander ships follow formation (both capitals and escorts)
  if (leader && leader.alive && leader !== ship) {
    const fp = formationPoint(leader, ship, (x, y, pad) => inLand(x, y, pad, state));
    let tgt = { x: clamp(fp.x, 0, WORLD.w), y: clamp(fp.y, 0, WORLD.h) };
    tgt = avoidHostileBatteries(ship, tgt.x, tgt.y, state);
    
    ship.targetWaypoint = { x: tgt.x, y: tgt.y };
    const dForm = Math.sqrt(dist2(ship.x, ship.y, tgt.x, tgt.y));
    
    if (ship.escortLocked === undefined) ship.escortLocked = false;
    if (ship.timeInPosition === undefined) ship.timeInPosition = 0;
    
    const inRadius = dForm <= ESCORT_LOCK_RADIUS;
    const farOutside = dForm > ESCORT_LOCK_RADIUS * 3;
    
    if (inRadius) {
      ship.timeInPosition += dt;
    } else if (!ship.escortLocked) {
      ship.timeInPosition = 0;
    }
    
    // Lock/unlock - ONLY unlock when FAR outside circle (3x radius)
    // Enemy presence does NOT unlock - only distance matters
    if (ship.escortLocked && farOutside) {
      ship.escortLocked = false;
      ship.timeInPosition = 0;
    } else if (!ship.escortLocked && ship.timeInPosition >= 2.0) {
      ship.escortLocked = true;
    }
    
    const hasEnemy = !!best;
    
    if (ship.escortLocked) {
      // LOCKED - GRADUALLY match commander heading and speed
      ship.collisionPredicted = null;
      
      // Gradual heading match
      const headingDiff = normAngle(leader.heading - ship.heading);
      ship.heading += headingDiff * 0.03 * dt * 60;
      ship.heading = normAngle(ship.heading);
      
      // Gradual speed match
      const leaderSpeed = Math.hypot(leader.vx || 0, leader.vy || 0);
      const mySpeed = Math.hypot(ship.vx || 0, ship.vy || 0);
      const targetSpeed = leaderSpeed;
      const newSpeed = mySpeed + (targetSpeed - mySpeed) * 0.02 * dt * 60;
      
      ship.vx = Math.cos(ship.heading) * newSpeed;
      ship.vy = Math.sin(ship.heading) * newSpeed;
      
      if (dForm > 5) {
        const toTarget = angleTo(ship.x, ship.y, tgt.x, tgt.y);
        const correctionStrength = Math.min(dForm * 0.008, 0.3);
        ship.vx += Math.cos(toTarget) * correctionStrength;
        ship.vy += Math.sin(toTarget) * correctionStrength;
      }
      
      // COLLISION AVOIDANCE even when locked - use rudder for smooth dodge
      const avoidance = calculateAvoidanceSteering(ship, state.player);
      if (avoidance.steer !== 0) {
        applyRudder(ship, avoidance.steer, dt);
      } else {
        ship.rudderAngle = (ship.rudderAngle || 0) * 0.95;
      }
      
      ship.throttle = clamp((leaderSpeed / ship.kind.maxSpeed) * 100, 0, 100);
    } else {
      // NOT LOCKED - go to position at FULL SPEED
      const isCapital = ship.kind.type === 'CV' || ship.kind.type === 'BB';
      
      let approachSpeed, throttle;
      if (isCapital) {
        // Capitals: FULL SPEED when not in position
        if (dForm > 100) {
          approachSpeed = ship.kind.maxSpeed;
          throttle = 100;
        } else if (dForm > 40) {
          approachSpeed = ship.kind.maxSpeed * 0.8;
          throttle = 80;
        } else {
          approachSpeed = ship.kind.maxSpeed * 0.5;
          throttle = 50;
        }
      } else {
        approachSpeed = dForm < ESCORT_LOCK_RADIUS * 2 
          ? ship.kind.maxSpeed * Math.max(0.4, dForm / (ESCORT_LOCK_RADIUS * 2))
          : ship.kind.maxSpeed;
        throttle = dForm < ESCORT_LOCK_RADIUS * 2
          ? Math.max(40, (dForm / (ESCORT_LOCK_RADIUS * 2)) * 100)
          : 100;
      }
      
      steerToPoint(ship, tgt.x, tgt.y, dt, approachSpeed, state);
      updateAIThrottle(ship, throttle, dt);
    }
    
    // Combat - DON'T unlock, just aim turrets
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
  
  const throttle = ship.routeState === 'engaging' ? 75 : 70; // 70% so escorts can catch up
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
