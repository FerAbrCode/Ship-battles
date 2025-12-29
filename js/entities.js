// ═══════════════════════════════════════════════════════════════════════════
// ENTITIES MODULE - Ship and battery creation, formation logic
// ═══════════════════════════════════════════════════════════════════════════

import { 
  DD, BB, CV, TB, BATTERY, WORLD, 
  SPAWN_SEP, SPAWN_SIDE, FORM_SEP, FORM_SIDE 
} from './config.js';
import { clamp, rand, dist2 } from './utils.js';

// Create a new ship entity
export function mkShip(team, kind, x, y, heading, tag) {
  const ammoMax = (kind.missileAmmoMax != null) ? kind.missileAmmoMax : (kind.type === 'TB' ? 4 : (kind.type === 'DD' ? 2 : 0));
  return {
    team, kind, tag, x, y, vx: 0, vy: 0, heading, turret: heading,
    hp: kind.hp, alive: true, gunCd: 0, smokeCd: 0, missileCd: 0, airCd: 0,
    missileAmmoMax: ammoMax, missileAmmo: ammoMax, extCd: 0,
    onFire: false, fireDps: kind.hp * 0.050,
    flooding: false, floodDps: kind.hp * 0.020, fireUntil: 0,
    detP: false, detE: false, blinkUntilP: 0, blinkUntilE: 0, trail: [],
    ai: { strafe: Math.random() < 0.5 ? -1 : 1, think: 0, wpX: x, wpY: y, wpUntil: 0 },
    formKey: 'lineAhead', formRank: 0, formF: 0, formR: 0,
    throttle: 50,
    currentSpeed: 0,  // Actual speed (follows throttle with inertia)
    rudderAngle: 0,
    angularVel: 0,
    isCommander: false,  // Commander ship flag
    plannedPath: [],     // Array of {x, y} waypoints for path visualization
    routeState: 'patrol', // 'patrol' | 'engaging' - tracks if route was replanned for enemy
    escortPosition: null, // Assigned escort position index (for DD/TB)
    targetWaypoint: null, // Current target waypoint {x, y} for trajectory visualization
  };
}

// Create a coastal battery
export function mkBattery(team, x, y, heading) {
  return {
    team, kind: BATTERY, tag: 'US Coastal Battery',
    x, y, vx: 0, vy: 0, heading, turret: heading,
    hp: BATTERY.hp, alive: true, gunCd: rand(0, BATTERY.gunReload * 0.8),
    detP: false, detE: false, blinkUntilP: 0, blinkUntilE: 0,
    lastSeenP: null, lastSeenE: null,
  };
}

// Calculate formation offsets
export function formationOffsets(formKey, count, forSpawn = false) {
  const sep = forSpawn ? SPAWN_SEP : FORM_SEP;
  const side = forSpawn ? SPAWN_SIDE : FORM_SIDE;
  const out = [];
  const n = Math.max(1, count|0);
  for (let i = 0; i < n; i++) {
    if (i === 0) { out.push([0,0]); continue; }
    if (formKey === 'screen') {
      const row = Math.ceil(i/2);
      const lr = (i % 2 === 1) ? -1 : 1;
      out.push([-row*sep, lr*side]);
    } else {
      out.push([-i*sep, 0]);
    }
  }
  return out;
}

// Generate spawn positions for a formation
export function formationSpawns(anchor, formKey, count) {
  const x0 = anchor[0], y0 = anchor[1], a0 = anchor[2];
  const offs = formationOffsets(formKey, count, true);
  const out = [];
  const ca = Math.cos(a0), sa = Math.sin(a0);
  const nx = -sa, ny = ca;
  for (let i = 0; i < count; i++) {
    const f = offs[i][0], r = offs[i][1];
    const x = x0 + ca*f + nx*r;
    const y = y0 + sa*f + ny*r;
    out.push([x, y, a0]);
  }
  return out;
}

// Pick the commander ship - BB commands, CV is protected center
// If current commander dies, next biggest ship takes over
export function pickCapitalLeader(arr) {
  const alive = arr.filter(s => s && s.alive);
  if (!alive.length) return null;
  
  // Check if current commander is still alive
  const currentCommander = alive.find(s => s.isCommander);
  if (currentCommander) return currentCommander;
  
  // Commander died - assign new one based on priority: BB > CV > DD > TB
  const priority = ['BB', 'CV', 'DD', 'TB'];
  for (const type of priority) {
    const candidate = alive.find(s => s.kind.type === type);
    if (candidate) {
      // Clear old commander flags and set new one
      for (const s of arr) {
        if (s) s.isCommander = false;
      }
      candidate.isCommander = true;
      candidate.plannedPath = []; // Reset path for new commander
      candidate.routeState = 'patrol'; // Reset route state so new commander plans fresh route
      return candidate;
    }
  }
  
  // Fallback to first alive
  alive[0].isCommander = true;
  alive[0].routeState = 'patrol';
  return alive[0];
}


// Define escort positions around the formation
// Priority: front (0-5), front-sides (6-9), back-sides (10+)
function getEscortPositions(numPositions, sep) {
  const positions = [];
  const outerRingRadius = sep * 4.0; // Larger radius for better screening
  
  // Front positions (highest priority) - 6 positions in front arc
  const frontCount = Math.min(6, numPositions);
  for (let i = 0; i < frontCount; i++) {
    const angle = (i / Math.max(1, frontCount - 1) - 0.5) * Math.PI * 0.7; // -63 to +63 degrees
    positions.push({
      priority: i,
      angle: angle,
      formF: Math.cos(angle) * outerRingRadius,
      formR: Math.sin(angle) * outerRingRadius,
      zone: 'front'
    });
  }
  
  // Front-side positions (medium priority) - 4 positions
  const frontSideCount = Math.min(4, Math.max(0, numPositions - frontCount));
  for (let i = 0; i < frontSideCount; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const idx = Math.floor(i / 2);
    const angle = side * (Math.PI * 0.45 + idx * 0.25); // ~80-95 degrees
    positions.push({
      priority: frontCount + i,
      angle: angle,
      formF: Math.cos(angle) * outerRingRadius * 0.9,
      formR: Math.sin(angle) * outerRingRadius * 0.9,
      zone: 'front-side'
    });
  }
  
  // Back-side positions (lowest priority) - remaining positions
  const backSideCount = Math.max(0, numPositions - frontCount - frontSideCount);
  for (let i = 0; i < backSideCount; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const idx = Math.floor(i / 2);
    const angle = side * (Math.PI * 0.7 + idx * 0.2); // ~126-150 degrees
    positions.push({
      priority: frontCount + frontSideCount + i,
      angle: angle,
      formF: Math.cos(angle) * outerRingRadius * 0.85,
      formR: Math.sin(angle) * outerRingRadius * 0.85,
      zone: 'back-side'
    });
  }
  
  return positions;
}

// Assign escort positions based on proximity to capitals
export function assignEscortPositions(teamArr) {
  const sep = FORM_SEP;
  
  // Find capitals (CV and BB)
  const capitals = teamArr.filter(s => s.kind.type === 'CV' || s.kind.type === 'BB');
  const escorts = teamArr.filter(s => s.kind.type === 'DD' || s.kind.type === 'TB');
  
  if (capitals.length === 0 || escorts.length === 0) return;
  
  // Get center of capitals
  let centerX = 0, centerY = 0;
  for (const c of capitals) {
    centerX += c.x;
    centerY += c.y;
  }
  centerX /= capitals.length;
  centerY /= capitals.length;
  
  // Get available positions
  const positions = getEscortPositions(escorts.length, sep);
  
  // Sort escorts by distance to center (closest get front positions)
  const escortsByDist = escorts.slice().sort((a, b) => {
    const da = (a.x - centerX) * (a.x - centerX) + (a.y - centerY) * (a.y - centerY);
    const db = (b.x - centerX) * (b.x - centerX) + (b.y - centerY) * (b.y - centerY);
    return da - db;
  });
  
  // Assign positions
  for (let i = 0; i < escortsByDist.length; i++) {
    const ship = escortsByDist[i];
    const pos = positions[i];
    if (pos) {
      ship.escortPosition = i;
      ship.formF = pos.formF;
      ship.formR = pos.formR;
    }
  }
}

// Reassign escort positions when ships are sunk
export function reassignEscortPositions(teamArr) {
  const escorts = teamArr.filter(s => s.alive && (s.kind.type === 'DD' || s.kind.type === 'TB'));
  const capitals = teamArr.filter(s => s.alive && (s.kind.type === 'CV' || s.kind.type === 'BB'));
  
  if (capitals.length === 0 || escorts.length === 0) return;
  
  const sep = FORM_SEP;
  const positions = getEscortPositions(escorts.length, sep);
  
  // Reassign based on current escort position (maintain relative order)
  const sortedEscorts = escorts.slice().sort((a, b) => {
    const posA = a.escortPosition ?? 999;
    const posB = b.escortPosition ?? 999;
    return posA - posB;
  });
  
  for (let i = 0; i < sortedEscorts.length; i++) {
    const ship = sortedEscorts[i];
    const pos = positions[i];
    if (pos) {
      ship.escortPosition = i;
      ship.formF = pos.formF;
      ship.formR = pos.formR;
    }
  }
}

// Set formation positions for a team - Circular Carrier Task Group Formation
// CV in center, BB in inner ring, DD/TB in outer ring (screening in FRONT)
export function setFormation(teamArr, formKey) {
  const sep = FORM_SEP;
  
  // Separate ships by type
  const cv = teamArr.filter(s => s.kind.type === 'CV');
  const bb = teamArr.filter(s => s.kind.type === 'BB');
  const escorts = teamArr.filter(s => s.kind.type === 'DD' || s.kind.type === 'TB');
  
  // Determine commander - BB if available, otherwise CV
  const commander = bb[0] || cv[0] || teamArr[0];
  if (commander) {
    commander.isCommander = true;
  }
  
  // CV is the center of the formation (protected asset)
  const center = cv[0] || bb[0] || teamArr[0];
  if (!center) return;
  
  // Position CV at center
  for (let i = 0; i < cv.length; i++) {
    const s = cv[i];
    s.formKey = formKey;
    s.formF = 0;
    s.formR = 0;
    s.escortTarget = commander !== s ? commander : null;
  }
  
  // Inner ring - BB positioned around CV (close protection)
  const innerRingRadius = sep * 1.5;
  for (let i = 0; i < bb.length; i++) {
    const s = bb[i];
    s.formKey = formKey;
    if (s === commander) {
      // Commander BB at front
      s.formF = innerRingRadius;
      s.formR = 0;
      s.escortTarget = null;
    } else {
      const angle = ((i - 1) / Math.max(1, bb.length - 1)) * Math.PI - Math.PI * 0.5;
      s.formF = Math.cos(angle) * innerRingRadius;
      s.formR = Math.sin(angle) * innerRingRadius;
      s.escortTarget = cv[0] || commander;
    }
  }
  
  // Assign escort positions using the new system
  const positions = getEscortPositions(escorts.length, sep);
  
  for (let i = 0; i < escorts.length; i++) {
    const s = escorts[i];
    const pos = positions[i];
    s.formKey = formKey;
    s.escortPosition = i;
    s.formF = pos.formF;
    s.formR = pos.formR;
    s.escortTarget = center;
  }
}

// Calculate formation point for a ship relative to leader
// The formation point moves with the commander's velocity
export function formationPoint(leader, ship, inLand) {
  const capital = ship.escortTarget || leader;
  
  // Use leader's heading for formation orientation
  const h = capital.heading;
  const ca = Math.cos(h), sa = Math.sin(h);
  const nx = -sa, ny = ca;
  const f = ship.formF || 0, r = ship.formR || 0;
  
  // Position relative to capital's current position
  // Add velocity prediction so escort points move with the formation
  const speed = Math.hypot(capital.vx || 0, capital.vy || 0);
  const predictTime = 0.5; // Predict half second ahead
  const predictX = capital.x + (capital.vx || 0) * predictTime;
  const predictY = capital.y + (capital.vy || 0) * predictTime;
  
  let fx = predictX + ca * f + nx * r;
  let fy = predictY + sa * f + ny * r;
  
  if (inLand) {
    const landHit = inLand(fx, fy, ship.kind.radius + 30);
    if (landHit) {
      const dx = fx - landHit.x, dy = fy - landHit.y;
      const d = Math.hypot(dx, dy) || 1;
      const want = landHit.r + ship.kind.radius + 50;
      fx = landHit.x + (dx / d) * want;
      fy = landHit.y + (dy / d) * want;
    }
  }
  
  return { 
    x: clamp(fx, 0, WORLD.w), 
    y: clamp(fy, 0, WORLD.h),
    heading: h,  // Target heading to match leader
    throttle: capital.throttle || 50,  // Target throttle to match leader
    leaderVx: capital.vx || 0,  // Leader's velocity for matching
    leaderVy: capital.vy || 0
  };
}

// Generate escort formation spawns - Circular Carrier Task Group
export function generateEscortFormation(anchor, kinds, formKey, mapLand = []) {
  const x0 = anchor[0], y0 = anchor[1], a0 = anchor[2];
  const ca = Math.cos(a0), sa = Math.sin(a0);
  const nx = -sa, ny = ca;
  
  const spawns = [];
  const cv = kinds.filter(k => k.type === 'CV');
  const bb = kinds.filter(k => k.type === 'BB');
  const escorts = kinds.filter(k => k.type === 'DD' || k.type === 'TB');
  
  const innerRingRadius = SPAWN_SEP * 1.8;  // BB ring
  const outerRingRadius = SPAWN_SEP * 3.5;  // DD/TB ring
  
  // Helper to check if position is in land
  const isInLand = (x, y, radius) => {
    for (const c of mapLand) {
      const dx = x - c.x, dy = y - c.y;
      if (dx*dx + dy*dy <= (c.r + radius + 80) * (c.r + radius + 80)) {
        return c;
      }
    }
    return null;
  };
  
  // Helper to push spawn away from land
  const adjustForLand = (x, y, radius) => {
    let ax = x, ay = y;
    for (let i = 0; i < 5; i++) {
      const hit = isInLand(ax, ay, radius);
      if (!hit) break;
      const dx = ax - hit.x, dy = ay - hit.y;
      const d = Math.hypot(dx, dy) || 1;
      const want = hit.r + radius + 120;
      ax = hit.x + (dx / d) * want;
      ay = hit.y + (dy / d) * want;
    }
    return { x: clamp(ax, 100, WORLD.w - 100), y: clamp(ay, 100, WORLD.h - 100) };
  };
  
  // CV at center
  for (let i = 0; i < cv.length; i++) {
    const k = cv[i];
    let x = x0, y = y0;
    const adj = adjustForLand(x, y, k.radius);
    spawns.push({ x: adj.x, y: adj.y, a: a0, kind: k, isCapital: true });
  }
  
  // BB in inner ring (close protection)
  for (let i = 0; i < bb.length; i++) {
    const k = bb[i];
    const angle = a0 + (i / Math.max(1, bb.length)) * Math.PI * 2 - Math.PI * 0.25;
    let x = x0 + Math.cos(angle) * innerRingRadius;
    let y = y0 + Math.sin(angle) * innerRingRadius;
    const adj = adjustForLand(x, y, k.radius);
    spawns.push({ x: adj.x, y: adj.y, a: a0, kind: k, isCapital: true });
  }
  
  // DD/TB in outer ring (perimeter screen)
  for (let i = 0; i < escorts.length; i++) {
    const k = escorts[i];
    const angle = a0 + (i / Math.max(1, escorts.length)) * Math.PI * 2;
    let x = x0 + Math.cos(angle) * outerRingRadius;
    let y = y0 + Math.sin(angle) * outerRingRadius;
    const adj = adjustForLand(x, y, k.radius);
    spawns.push({ x: adj.x, y: adj.y, a: a0, kind: k, isCapital: false });
  }
  
  return spawns;
}
