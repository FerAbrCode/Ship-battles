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
        if (s) {
          s.isCommander = false;
          // Update escortTarget to new commander for all ships
          if (s !== candidate && s.alive) {
            s.escortTarget = candidate;
            s.escortLocked = false; // Unlock so they can reposition
            s.timeInPosition = 0;
          }
        }
      }
      candidate.isCommander = true;
      candidate.plannedPath = []; // Reset path for new commander
      candidate.routeState = 'patrol'; // Reset route state so new commander plans fresh route
      candidate.escortTarget = null; // Commander doesn't follow anyone
      
      // Reassign formation positions relative to new commander
      reassignFormationPositions(arr, candidate);
      
      return candidate;
    }
  }
  
  // Fallback to first alive
  alive[0].isCommander = true;
  alive[0].routeState = 'patrol';
  return alive[0];
}

// Reassign all formation positions when commander changes
function reassignFormationPositions(teamArr, newCommander) {
  const sep = FORM_SEP;
  
  // Get alive ships by type
  const capitals = teamArr.filter(s => s && s.alive && (s.kind.type === 'BB' || s.kind.type === 'CV'));
  const escorts = teamArr.filter(s => s && s.alive && (s.kind.type === 'DD' || s.kind.type === 'TB'));
  
  // Assign capital positions (line behind commander)
  const capitalPositions = getCapitalPositions(capitals.length, sep);
  let capIdx = 0;
  for (const s of capitals) {
    if (s === newCommander) {
      s.formF = 0;
      s.formR = 0;
    } else {
      capIdx++;
      if (capIdx < capitalPositions.length) {
        s.formF = capitalPositions[capIdx].formF;
        s.formR = capitalPositions[capIdx].formR;
      }
    }
    s.escortTarget = s === newCommander ? null : newCommander;
  }
  
  // Assign SIDE escort positions distributed among capitals
  const escortPositions = getSideEscortPositions(escorts.length, capitals.length, sep);
  for (let i = 0; i < escorts.length; i++) {
    const s = escorts[i];
    const pos = escortPositions[i];
    if (pos) {
      s.escortPosition = i;
      s.formF = pos.formF;
      s.formR = pos.formR;
      const capitalIdx = Math.min(pos.capitalIndex, capitals.length - 1);
      s.escortTarget = capitals[capitalIdx];
    }
  }
}


// Generate SIDE escort positions for each capital
// Each capital gets escorts on its PORT and STARBOARD sides
function getSideEscortPositions(numEscorts, numCapitals, sep) {
  const positions = [];
  const sideDistance = sep * 1.0; // Distance to the side of capital
  
  const capCount = Math.max(1, numCapitals);
  const escortsPerCapital = Math.max(2, Math.ceil(numEscorts / capCount));
  
  for (let i = 0; i < numEscorts; i++) {
    const capitalIndex = Math.min(Math.floor(i / escortsPerCapital), capCount - 1);
    const posInGroup = i - (capitalIndex * escortsPerCapital);
    
    // Alternate left and right sides
    const isRightSide = posInGroup % 2 === 1;
    const layerOut = Math.floor(posInGroup / 2);
    
    // formF = slightly behind capital, formR = side offset
    const formF = -sep * 0.2 - (layerOut * sep * 0.4);
    const formR = (sideDistance + layerOut * sep * 0.6) * (isRightSide ? 1 : -1);
    
    positions.push({
      priority: i,
      capitalIndex: capitalIndex,
      formF: formF,
      formR: formR,
      isRightSide: isRightSide,
      zone: 'side-escort'
    });
  }
  
  return positions;
}

// Get capital positions - line formation behind commander
function getCapitalPositions(numCapitals, sep) {
  const positions = [];
  const capitalSpacing = sep * 2.0;
  
  for (let i = 0; i < numCapitals; i++) {
    positions.push({
      priority: i,
      formF: -i * capitalSpacing,
      formR: 0,
      isCommander: i === 0
    });
  }
  
  return positions;
}

// Assign SIDE escort positions - each capital gets escorts on left and right
export function assignEscortPositions(teamArr) {
  const sep = FORM_SEP;
  
  const capitals = teamArr.filter(s => s.kind.type === 'CV' || s.kind.type === 'BB');
  const escorts = teamArr.filter(s => s.kind.type === 'DD' || s.kind.type === 'TB');
  
  if (capitals.length === 0 || escorts.length === 0) return;
  
  const positions = getSideEscortPositions(escorts.length, capitals.length, sep);
  
  // Sort escorts by distance to first capital
  const escortsByDist = escorts.slice().sort((a, b) => {
    const da = (a.x - capitals[0].x) ** 2 + (a.y - capitals[0].y) ** 2;
    const db = (b.x - capitals[0].x) ** 2 + (b.y - capitals[0].y) ** 2;
    return da - db;
  });
  
  for (let i = 0; i < escortsByDist.length; i++) {
    const ship = escortsByDist[i];
    const pos = positions[i];
    if (pos) {
      ship.escortPosition = i;
      ship.formF = pos.formF;
      ship.formR = pos.formR;
      const capitalIdx = Math.min(pos.capitalIndex, capitals.length - 1);
      ship.escortTarget = capitals[capitalIdx];
    }
  }
}

// Reassign escort positions when ships are sunk
export function reassignEscortPositions(teamArr) {
  const escorts = teamArr.filter(s => s.alive && (s.kind.type === 'DD' || s.kind.type === 'TB'));
  const capitals = teamArr.filter(s => s.alive && (s.kind.type === 'CV' || s.kind.type === 'BB'));
  
  if (escorts.length === 0) return;
  if (capitals.length === 0) return;
  
  const sep = FORM_SEP;
  const positions = getSideEscortPositions(escorts.length, capitals.length, sep);
  
  for (let i = 0; i < escorts.length; i++) {
    const ship = escorts[i];
    const pos = positions[i];
    if (pos) {
      ship.escortPosition = i;
      ship.formF = pos.formF;
      ship.formR = pos.formR;
      const capitalIdx = Math.min(pos.capitalIndex, capitals.length - 1);
      ship.escortTarget = capitals[capitalIdx];
    }
  }
}

// Set formation - capitals in line, SIDE escorts for each capital
export function setFormation(teamArr, formKey) {
  const sep = FORM_SEP;
  
  const cv = teamArr.filter(s => s.kind.type === 'CV');
  const bb = teamArr.filter(s => s.kind.type === 'BB');
  const escorts = teamArr.filter(s => s.kind.type === 'DD' || s.kind.type === 'TB');
  
  const capitals = [...bb, ...cv];
  
  const commander = capitals[0] || teamArr[0];
  if (!commander) return;
  
  for (const s of teamArr) {
    s.isCommander = false;
  }
  commander.isCommander = true;
  
  const capitalPositions = getCapitalPositions(capitals.length, sep);
  
  for (let i = 0; i < capitals.length; i++) {
    const s = capitals[i];
    const pos = capitalPositions[i];
    s.formKey = formKey;
    s.formF = pos.formF;
    s.formR = pos.formR;
    s.escortTarget = i === 0 ? null : commander;
    s.isCapitalLocked = i > 0;
  }
  
  // SIDE escort positions for each capital
  const escortPositions = getSideEscortPositions(escorts.length, capitals.length, sep);
  
  for (let i = 0; i < escorts.length; i++) {
    const s = escorts[i];
    const pos = escortPositions[i];
    s.formKey = formKey;
    s.escortPosition = i;
    s.formF = pos.formF;
    s.formR = pos.formR;
    // Assign to specific capital
    const capitalIdx = Math.min(pos.capitalIndex, capitals.length - 1);
    s.escortTarget = capitals[capitalIdx];
  }
}

// Calculate formation point for a ship relative to its assigned capital
// Escorts use their escortTarget (which can be any capital, not just commander)
export function formationPoint(leader, ship, inLand) {
  // Use the ship's escortTarget - this is the capital this escort is assigned to
  const assignedCapital = ship.escortTarget || leader;
  
  // Use assigned capital's heading for formation orientation
  const h = assignedCapital.heading;
  const ca = Math.cos(h), sa = Math.sin(h);
  const nx = -sa, ny = ca; // Perpendicular vector (right side)
  const f = ship.formF || 0, r = ship.formR || 0;
  
  // Position relative to assigned capital's current position
  // Add small velocity prediction so formation points move smoothly
  const predictTime = 0.3;
  const predictX = assignedCapital.x + (assignedCapital.vx || 0) * predictTime;
  const predictY = assignedCapital.y + (assignedCapital.vy || 0) * predictTime;
  
  // Calculate world position from formation offsets
  // f = forward offset (positive = ahead of commander)
  // r = right offset (positive = starboard of commander)
  let fx = predictX + ca * f + nx * r;
  let fy = predictY + sa * f + ny * r;
  
  // Push away from land if needed - shift sideways to avoid land
  if (inLand) {
    const landHit = inLand(fx, fy, ship.kind.radius + 60);
    if (landHit) {
      const dx = fx - landHit.x, dy = fy - landHit.y;
      const d = Math.hypot(dx, dy) || 1;
      const want = landHit.r + ship.kind.radius + 100;
      
      // Push directly away from land center
      fx = landHit.x + (dx / d) * want;
      fy = landHit.y + (dy / d) * want;
      
      // Also shift perpendicular to formation heading to slide around land
      const perpShift = 40;
      const shiftDir = r >= 0 ? 1 : -1; // Shift outward based on which side of formation
      fx += nx * perpShift * shiftDir;
      fy += ny * perpShift * shiftDir;
    }
  }
  
  return { 
    x: clamp(fx, 100, WORLD.w - 100), 
    y: clamp(fy, 100, WORLD.h - 100),
    heading: h,
    throttle: assignedCapital.throttle || 50,
    leaderVx: assignedCapital.vx || 0,
    leaderVy: assignedCapital.vy || 0
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
  
  const innerRingRadius = SPAWN_SEP * 2.2;  // BB ring - more spaced
  const outerRingRadius = SPAWN_SEP * 4.5;  // DD/TB ring - much more spaced
  
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
