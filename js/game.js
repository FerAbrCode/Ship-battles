// ═══════════════════════════════════════════════════════════════════════════
// GAME MODULE - Main game state, loop, and initialization
// ═══════════════════════════════════════════════════════════════════════════

import * as Config from './config.js';
import { clamp, lerp, dist2, rand } from './utils.js';
import { 
  mkShip, mkBattery, formationSpawns, setFormation, 
  pickCapitalLeader, formationPoint, generateEscortFormation,
  assignEscortPositions 
} from './entities.js';
import { 
  trySmoke, tryMissile, tryExtinguish, tryFireAtPoint, 
  updateDetections, statusStep, shellsStep, missilesStep, 
  smokesStep, fxStep, turretStep, revealToTeam, canSee, shotSpotting 
} from './combat.js';
import { 
  inLand, avoidLandTarget, steerToPoint, aiStep, capitalAutoPilot,
  separationTeam, checkShipCollisions, aliveShips, teamHasContact,
  pickTargetDetectable, updateAIThrottle, calculateAITargetThrottle,
  aiStepPlayer
} from './ai.js';
import { 
  initPatterns, updateWaterTime, draw, minimapToWorld, RADAR_BOUNDS 
} from './rendering.js';
import { 
  keys, mouse, initInput, playerControl 
} from './input.js';

// ═══════════════════════════════════════════════════════════════════════════
// GAME STATE
// ═══════════════════════════════════════════════════════════════════════════
export const state = {
  started: false, menuOpen: true, diffKey: 'med', mapId: 0, playerClass: 'dd',
  shotsFired: false, level: 1, selected: 0, time: 0, camX: 0, camY: 0,
  player: [], enemy: [], shells: [], missiles: [], smokes: [], fx: [],
  dolphins: [], aircraft: [], bullets: [], batteries: [],
  recons: [], ended: false,
  WORLD_W: Config.WORLD.w, WORLD_H: Config.WORLD.h,
  spectatorMode: false, // Spectator mode - no fog, all bots
  spectatorFreeCamera: false, // True = WASD free camera, False = follow ship
  spectatorTarget: 0, // Index of ship to follow (cycles through all ships)
  spectatorTeam: 'P', // Which team's ships to cycle through ('P' or 'E')
  minimapViewing: false, // True when holding mouse on minimap
  minimapViewX: 0, minimapViewY: 0, // World coords to view when minimap clicked
  gameSpeed: 1, // Game speed multiplier (1, 2, 4)
};

let ui = null;
let ctx = null;

export function diff() { return Config.DIFFS[state.diffKey] || Config.DIFFS.med; }

export function setDifficulty(key) {
  state.diffKey = key;
  if (ui) {
    ui.diffEasy.classList.toggle('sel', key === 'easy');
    ui.diffMed.classList.toggle('sel', key === 'med');
    ui.diffHard.classList.toggle('sel', key === 'hard');
  }
}

export function setMap(id) {
  state.mapId = id|0;
  if (ui) {
    ui.map0.classList.toggle('sel', state.mapId === 0);
    ui.map1.classList.toggle('sel', state.mapId === 1);
    ui.map2.classList.toggle('sel', state.mapId === 2);
  }
}

export function setPlayerClass(key) {
  state.playerClass = key;
  if (ui) {
    ui.classDD.classList.toggle('sel', key === 'dd');
    ui.classBB.classList.toggle('sel', key === 'bb');
    ui.classTB.classList.toggle('sel', key === 'tb');
    ui.classCV.classList.toggle('sel', key === 'cv');
  }
}

function syncMenuButton() { 
  if (ui) ui.startBtn.textContent = state.started ? 'Resume' : 'Start'; 
}

export function showMenu() {
  state.menuOpen = true;
  syncMenuButton();
  if (ui) {
    ui.menu.style.display = 'grid';
    ui.canvas.style.pointerEvents = 'none';
    // Show leave battle button if game is in progress
    if (ui.leaveBattleBtn) {
      ui.leaveBattleBtn.style.display = state.started ? 'inline-block' : 'none';
    }
  }
}

export function hideMenu() {
  state.menuOpen = false;
  if (ui) {
    ui.menu.style.display = 'none';
    ui.canvas.style.pointerEvents = 'auto';
  }
}

export function toggleMenu() { 
  if (state.menuOpen) hideMenu(); else showMenu(); 
}

export function showMsg(text, ms = 1600) {
  if (!ui) return;
  ui.msg.textContent = text;
  ui.msg.style.display = 'block';
  clearTimeout(showMsg._t);
  showMsg._t = setTimeout(() => ui.msg.style.display = 'none', ms);
}

function withinWorld(obj, radius) {
  obj.x = clamp(obj.x, radius, Config.WORLD.w - radius);
  obj.y = clamp(obj.y, radius, Config.WORLD.h - radius);
}


// ═══════════════════════════════════════════════════════════════════════════
// RECON & AIRCRAFT - Single Sortie System (2 planes per launch, 30s fuel)
// ═══════════════════════════════════════════════════════════════════════════
const AIRCRAFT_FUEL_TIME = 30.0; // 30 seconds of fuel

function isInGreyZone(x, y, team) {
  const allies = (team === 'P') ? state.player : state.enemy;
  for (const s of allies) {
    if (!s || !s.alive) continue;
    if (dist2(x, y, s.x, s.y) <= Config.RADAR_RANGE * Config.RADAR_RANGE) return false;
  }
  const AIRCRAFT_VISION = Config.RADAR_RANGE * 1.2;
  for (const a of state.aircraft) {
    if (!a || a.team !== team || a.ttl <= 0 || a.hp <= 0) continue;
    if (dist2(x, y, a.x, a.y) <= AIRCRAFT_VISION * AIRCRAFT_VISION) return false;
  }
  for (const r of (state.recons || [])) {
    if (!r || r.team !== team) continue;
    if (dist2(x, y, r.x, r.y) <= Config.RECON.vision * Config.RECON.vision) return false;
  }
  for (const b of state.batteries) {
    if (!b || !b.alive || b.team !== team) continue;
    const range = b.kind.gunRange || Config.RADAR_RANGE;
    if (dist2(x, y, b.x, b.y) <= range * range) return false;
  }
  return true;
}

function reconPickWaypoint(team = 'P', preferredQuadrant = -1) {
  for (let i = 0; i < 30; i++) {
    let x, y;
    if (preferredQuadrant >= 0) {
      const qx = preferredQuadrant % 2;
      const qy = Math.floor(preferredQuadrant / 2);
      x = rand(Config.WORLD.w * qx * 0.5 + 100, Config.WORLD.w * (qx + 1) * 0.5 - 100);
      y = rand(Config.WORLD.h * qy * 0.5 + 100, Config.WORLD.h * (qy + 1) * 0.5 - 100);
    } else {
      x = rand(220, Config.WORLD.w - 220);
      y = rand(220, Config.WORLD.h - 220);
    }
    if (!inLand(x, y, 36, state) && isInGreyZone(x, y, team)) {
      return { x, y };
    }
  }
  for (let i = 0; i < 12; i++) {
    const x = rand(220, Config.WORLD.w - 220);
    const y = rand(220, Config.WORLD.h - 220);
    if (!inLand(x, y, 36, state)) return { x, y };
  }
  return { x: rand(220, Config.WORLD.w - 220), y: rand(220, Config.WORLD.h - 220) };
}

// Launch a single recon sortie (2 planes that split up)
function tryLaunchReconSortie(ship, silent = false) {
  if (!ship || !ship.alive) return;
  if (ship.kind.type !== 'CV') {
    if (!silent && ship.team === 'P') showMsg('Recon sorties only on Carriers');
    return;
  }
  
  // Count active sorties from this carrier
  const MAX_SORTIES = 4;
  const activeRecons = (state.recons || []).filter(r => r && r.homeShip === ship).length;
  const activeFighters = state.aircraft.filter(a => a && a.homeShip === ship && a.ttl > 0 && a.hp > 0).length;
  const activeSorties = Math.ceil(activeRecons / 2) + Math.ceil(activeFighters / 2);
  
  if (activeSorties >= MAX_SORTIES) {
    if (!silent && ship.team === 'P') showMsg(`Max sorties airborne (${MAX_SORTIES})`);
    return;
  }
  
  // Short cooldown between launches (not blocking all sorties)
  if (ship.airCd > 0) {
    if (!silent && ship.team === 'P') showMsg(`Launch deck busy ${ship.airCd.toFixed(1)}s`);
    return;
  }
  
  if (!state.recons) state.recons = [];
  const team = ship.team;
  const sortieIndex = state.time; // Unique sortie ID
  
  // Launch 2 recon planes that split up to different quadrants
  const quads = [rand(0, 1) < 0.5 ? 0 : 1, rand(0, 1) < 0.5 ? 2 : 3];
  
  for (let i = 0; i < 2; i++) {
    const spreadAngle = Math.PI * 0.35;
    const launchAngle = ship.heading + (i === 0 ? -spreadAngle : spreadAngle);
    const wp = reconPickWaypoint(team, quads[i]);
    
    const r = {
      team, x: ship.x, y: ship.y, a: launchAngle,
      vx: Math.cos(launchAngle) * Config.RECON.speed, 
      vy: Math.sin(launchAngle) * Config.RECON.speed,
      homeShip: ship, homeX: ship.x, homeY: ship.y,
      ttl: AIRCRAFT_FUEL_TIME, mode: 'patrol', 
      wpX: wp.x, wpY: wp.y, wpUntil: state.time + rand(3.8, 6.2),
      spotted: new Set(),
      sortieIndex: sortieIndex,
      planeIndex: i,
      preferredQuadrant: quads[i],
    };
    state.recons.push(r);
  }
  
  ship.airCd = 3.0; // Short cooldown between launches
  if (!silent && team === 'P') showMsg(`Recon sortie launched (${activeSorties + 1}/${MAX_SORTIES})`);
}

// Launch a single fighter sortie (2 planes that fly together)
function tryLaunchFighterSortie(ship, silent = false) {
  if (!ship || !ship.alive) return;
  if (ship.kind.type !== 'CV') {
    if (!silent && ship.team === 'P') showMsg('Fighter sorties only on Carriers');
    return;
  }
  
  // Count active sorties from this carrier
  const MAX_SORTIES = 4;
  const activeRecons = (state.recons || []).filter(r => r && r.homeShip === ship).length;
  const activeFighters = state.aircraft.filter(a => a && a.homeShip === ship && a.ttl > 0 && a.hp > 0).length;
  const activeSorties = Math.ceil(activeRecons / 2) + Math.ceil(activeFighters / 2);
  
  if (activeSorties >= MAX_SORTIES) {
    if (!silent && ship.team === 'P') showMsg(`Max sorties airborne (${MAX_SORTIES})`);
    return;
  }
  
  // Short cooldown between launches
  if (ship.airCd > 0) {
    if (!silent && ship.team === 'P') showMsg(`Launch deck busy ${ship.airCd.toFixed(1)}s`);
    return;
  }
  
  const team = ship.team;
  const a = ship.heading;
  const nx = -Math.sin(a), ny = Math.cos(a);
  const baseX = ship.x + Math.cos(a) * (ship.kind.radius + 12);
  const baseY = ship.y + Math.sin(a) * (ship.kind.radius + 12);
  const sortieIndex = state.time;
  
  const patrolDist = rand(300, 500);
  const wpX = clamp(ship.x + Math.cos(a) * patrolDist, 100, Config.WORLD.w - 100);
  const wpY = clamp(ship.y + Math.sin(a) * patrolDist, 100, Config.WORLD.h - 100);
  
  const fighters = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const fighter = {
      team, hp: Config.FIGHTER.hp,
      x: baseX + nx * side * 12, y: baseY + ny * side * 12, a,
      vx: Math.cos(a) * Config.FIGHTER.speed, vy: Math.sin(a) * Config.FIGHTER.speed,
      ttl: AIRCRAFT_FUEL_TIME, mode: 'patrol', 
      homeShip: ship, homeX: ship.x, homeY: ship.y,
      wpX: wpX + nx * side * 30, wpY: wpY + ny * side * 30,
      wpUntil: state.time + rand(2.5, 4.0), 
      gunCd: rand(0, Config.FIGHTER.fireEvery),
      sortieIndex: sortieIndex,
      wingman: null,
      planeIndex: i,
    };
    fighters.push(fighter);
    state.aircraft.push(fighter);
  }
  
  // Link wingmen
  fighters[0].wingman = fighters[1];
  fighters[1].wingman = fighters[0];
  
  ship.airCd = 3.0; // Short cooldown between launches
  if (!silent && team === 'P') showMsg(`Fighter sortie launched (${activeSorties + 1}/${MAX_SORTIES})`);
}

// Legacy recon function for BB ships
function tryRecon(ship, silent = false) {
  if (!ship || !ship.alive) return;
  if (ship.kind.type !== 'BB' && ship.kind.type !== 'CV') {
    if (!silent && ship.team === 'P') showMsg('Recon plane only available on Battleships/Carriers');
    return;
  }
  if (!('reconCd' in ship)) ship.reconCd = 0;
  if (!state.recons) state.recons = [];
  
  // For CV, use sortie system
  if (ship.kind.type === 'CV') {
    tryLaunchReconSortie(ship, silent);
    return;
  }
  
  // BB gets single recon plane
  for (const r of state.recons) {
    if (r && r.homeShip === ship) {
      if (!silent && ship.team === 'P') showMsg('Recon plane already airborne');
      return;
    }
  }
  if (ship.reconCd > 0) {
    if (!silent && ship.team === 'P') showMsg(`Recon rearming ${ship.reconCd.toFixed(1)}s`);
    return;
  }
  
  const team = ship.team;
  const wp = reconPickWaypoint(team);
  
  const r = {
    team, x: ship.x, y: ship.y, a: ship.heading,
    vx: Math.cos(ship.heading) * Config.RECON.speed, 
    vy: Math.sin(ship.heading) * Config.RECON.speed,
    homeShip: ship, homeX: ship.x, homeY: ship.y,
    ttl: AIRCRAFT_FUEL_TIME, mode: 'patrol', 
    wpX: wp.x, wpY: wp.y, wpUntil: state.time + rand(3.8, 6.2),
    spotted: new Set(),
    planeIndex: 0,
  };
  state.recons.push(r);
  
  ship.reconCd = Config.RECON.cooldown;
  if (!silent && team === 'P') showMsg('Recon plane launched');
}

// Legacy function for compatibility
function tryLaunchFighters(ship, silent = false) {
  tryLaunchFighterSortie(ship, silent);
}

function reconStep(dt) {
  for (const s of state.player) { if (s && s.alive && s.reconCd > 0) s.reconCd = Math.max(0, s.reconCd - dt); }
  for (const s of state.enemy) { if (s && s.alive && s.reconCd > 0) s.reconCd = Math.max(0, s.reconCd - dt); }
  if (!state.recons || state.recons.length === 0) return;
  const next = [];
  for (const r of state.recons) {
    if (!r) continue;
    r.ttl -= dt;
    if (r.ttl <= 0 && r.mode !== 'return') r.mode = 'return';
    const targets = (r.team === 'P') ? state.enemy : state.player;
    for (const e of targets) {
      if (!e.alive) continue;
      if (dist2(r.x, r.y, e.x, e.y) <= Config.RECON_V2) { revealToTeam(e, r.team, state); r.spotted.add(e); }
    }
    const aliveTargets = targets.filter(e => e.alive);
    if (r.mode === 'patrol') {
      let allSpotted = aliveTargets.length > 0;
      for (const e of aliveTargets) { if (!r.spotted.has(e)) { allSpotted = false; break; } }
      if (allSpotted) r.mode = 'return';
    }
    const homeAlive = r.homeShip && r.homeShip.alive;
    const homeX = homeAlive ? r.homeShip.x : r.homeX;
    const homeY = homeAlive ? r.homeShip.y : r.homeY;
    if (r.mode === 'patrol') {
      if (state.time > r.wpUntil || dist2(r.x, r.y, r.wpX, r.wpY) < 140*140) {
        const wp = reconPickWaypoint(r.team, r.preferredQuadrant);
        r.wpX = wp.x; r.wpY = wp.y;
        r.wpUntil = state.time + rand(3.8, 6.2);
      }
      const desired = Math.atan2(r.wpY - r.y, r.wpX - r.x);
      const turn = clamp((desired - r.a + Math.PI * 3) % (Math.PI * 2) - Math.PI, -1, 1);
      r.a += turn * Config.RECON.turnRate * dt;
    } else {
      const desired = Math.atan2(homeY - r.y, homeX - r.x);
      const turn = clamp((desired - r.a + Math.PI * 3) % (Math.PI * 2) - Math.PI, -1, 1);
      r.a += turn * Config.RECON.turnRate * 1.05 * dt;
    }
    r.vx = Math.cos(r.a) * Config.RECON.speed;
    r.vy = Math.sin(r.a) * Config.RECON.speed;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    r.x = clamp(r.x, 0, Config.WORLD.w);
    r.y = clamp(r.y, 0, Config.WORLD.h);
    if (r.mode === 'return' && dist2(r.x, r.y, homeX, homeY) < 40*40) {
      if (r.team === 'P') showMsg('Recon plane landed');
      continue;
    }
    // Out of fuel and not home yet - crash
    if (r.ttl <= -5) {
      if (r.team === 'P') showMsg('Recon plane out of fuel!');
      continue;
    }
    next.push(r);
  }
  state.recons = next;
}


// ═══════════════════════════════════════════════════════════════════════════
// FIGHTERS - Fly together as wingmen, attack enemy aircraft, 30s fuel
// ═══════════════════════════════════════════════════════════════════════════
function airStep(dt) {
  for (const a of state.aircraft) {
    a.ttl -= dt;
    if (a.hp <= 0) a.ttl = 0;
    a.gunCd = Math.max(0, a.gunCd - dt);
    
    // Start returning when fuel is low (5s reserve for landing)
    if (a.ttl <= 5 && a.mode !== 'return') a.mode = 'return';
    
    const homeAlive = a.homeShip && a.homeShip.alive;
    const homeX = homeAlive ? a.homeShip.x : a.homeX;
    const homeY = homeAlive ? a.homeShip.y : a.homeY;
    
    // Reveal enemy ships in vision range
    const targetsForVision = (a.team === 'P') ? state.enemy : state.player;
    for (const s of targetsForVision) {
      if (!s.alive) continue;
      if (dist2(a.x, a.y, s.x, s.y) <= Config.FIGHTER_V2) revealToTeam(s, a.team, state);
    }
    
    // Find enemy aircraft (fighters or recons) to attack
    let tgt = null, bestD2 = Infinity;
    
    for (const o of state.aircraft) {
      if (!o || o.team === a.team) continue;
      if (o.ttl <= 0 || o.hp <= 0) continue;
      const d2 = dist2(a.x, a.y, o.x, o.y);
      if (d2 < bestD2) { bestD2 = d2; tgt = o; }
    }
    
    for (const r of (state.recons || [])) {
      if (!r || r.team === a.team) continue;
      const d2 = dist2(a.x, a.y, r.x, r.y);
      if (d2 < bestD2) { bestD2 = d2; tgt = r; }
    }
    
    // Only engage if not returning and target in range
    if (a.mode !== 'return' && tgt && bestD2 < 900*900) a.mode = 'attack';
    if (a.mode === 'attack' && (!tgt || bestD2 > 1200*1200)) a.mode = 'patrol';
    
    let desiredAngle = a.a;
    if (a.mode === 'patrol') {
      const wingman = a.wingman;
      const wingmanAlive = wingman && wingman.ttl > 0 && wingman.hp > 0;
      
      if (state.time > a.wpUntil || dist2(a.x, a.y, a.wpX, a.wpY) < 140*140) {
        if (wingmanAlive && a.planeIndex === 1) {
          const wpa = wingman.a + (Math.random() - 0.5) * 0.3;
          const wpd = rand(40, 80);
          a.wpX = clamp(wingman.x + Math.cos(wpa) * wpd, 0, Config.WORLD.w);
          a.wpY = clamp(wingman.y + Math.sin(wpa) * wpd, 0, Config.WORLD.h);
        } else {
          const wpa = rand(0, Config.TAU);
          const wpd = rand(260, 520);
          a.wpX = clamp(homeX + Math.cos(wpa) * wpd, 0, Config.WORLD.w);
          a.wpY = clamp(homeY + Math.sin(wpa) * wpd, 0, Config.WORLD.h);
        }
        a.wpUntil = state.time + rand(2.2, 3.8);
      }
      desiredAngle = Math.atan2(a.wpY - a.y, a.wpX - a.x);
      
    } else if (a.mode === 'attack' && tgt) {
      desiredAngle = Math.atan2(tgt.y - a.y, tgt.x - a.x);
      const d = Math.sqrt(bestD2);
      
      if (d <= Config.FIGHTER.gunRange && a.gunCd <= 0) {
        a.gunCd = Config.FIGHTER.fireEvery;
        const vx = Math.cos(a.a) * Config.FIGHTER.bulletSpeed;
        const vy = Math.sin(a.a) * Config.FIGHTER.bulletSpeed;
        state.bullets.push({ 
          kind: 'air', team: a.team, x: a.x, y: a.y, vx, vy, 
          ttl: 0.60, dmg: Config.FIGHTER.dmg 
        });
      }
      
      // Alert wingman
      const wingman = a.wingman;
      if (wingman && wingman.ttl > 0 && wingman.hp > 0 && wingman.mode === 'patrol') {
        wingman.mode = 'attack';
      }
      
    } else {
      // Return to carrier
      desiredAngle = Math.atan2(homeY - a.y, homeX - a.x);
    }
    
    const AIRCRAFT_TURN_RATE = 1.2;
    const angleDiff = ((desiredAngle - a.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const maxTurn = AIRCRAFT_TURN_RATE * dt;
    const turnAmount = clamp(angleDiff, -maxTurn, maxTurn) * 0.7;
    a.a += turnAmount;
    
    a.vx = Math.cos(a.a) * Config.FIGHTER.speed;
    a.vy = Math.sin(a.a) * Config.FIGHTER.speed;
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.x = clamp(a.x, 0, Config.WORLD.w);
    a.y = clamp(a.y, 0, Config.WORLD.h);
    
    // Land on carrier
    if (a.mode === 'return' && dist2(a.x, a.y, homeX, homeY) < 40*40) {
      if (a.team === 'P') showMsg('Fighter landed');
      a.ttl = -999;
    }
    
    // Out of fuel crash
    if (a.ttl <= -5) {
      if (a.team === 'P') showMsg('Fighter out of fuel!');
      a.ttl = -999;
    }
  }
  state.aircraft = state.aircraft.filter(a => a.ttl > -100 && a.hp > 0);
}

function bulletsStep(dt) {
  for (const b of state.bullets) {
    b.ttl -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.ttl > 0 && inLand(b.x, b.y, 2.5, state)) b.ttl = 0;
  }
  for (const b of state.bullets) {
    if (b.ttl <= 0) continue;
    if (b.kind !== 'air') continue;
    
    // Hit enemy fighters
    for (const t of state.aircraft) {
      if (!t || t.team === b.team) continue;
      if (t.ttl <= 0 || t.hp <= 0) continue;
      const r = (t.radius || Config.FIGHTER.radius) + 2.5;
      if (dist2(b.x, b.y, t.x, t.y) <= r*r) {
        b.ttl = 0;
        t.hp -= b.dmg;
        state.fx.push({ type: 'hit', x: b.x, y: b.y, until: state.time + Config.FX.hitTtl });
        if (t.hp <= 0) {
          t.ttl = 0;
          // Plane crash effect with emoji
          state.fx.push({ type: 'planeCrash', x: t.x, y: t.y, until: state.time + 1.5, vx: t.vx * 0.3, vy: t.vy * 0.3 + 50 });
          state.fx.push({ type: 'boom', x: t.x, y: t.y, until: state.time + Config.FX.boomTtl });
        }
        break;
      }
    }
    
    // Hit enemy recon planes
    if (b.ttl > 0) {
      for (const r of (state.recons || [])) {
        if (!r || r.team === b.team) continue;
        const hitR = 12;
        if (dist2(b.x, b.y, r.x, r.y) <= hitR*hitR) {
          b.ttl = 0;
          r.ttl = 0; // Recon destroyed
          // Plane crash effect with emoji
          state.fx.push({ type: 'planeCrash', x: r.x, y: r.y, until: state.time + 1.5, vx: r.vx * 0.3, vy: r.vy * 0.3 + 50 });
          state.fx.push({ type: 'boom', x: r.x, y: r.y, until: state.time + Config.FX.boomTtl });
          break;
        }
      }
    }
  }
  state.bullets = state.bullets.filter(b => b.ttl > 0 && b.x >= -120 && b.y >= -120 && b.x <= Config.WORLD.w + 120 && b.y <= Config.WORLD.h + 120);
}

// ═══════════════════════════════════════════════════════════════════════════
// BATTERIES
// ═══════════════════════════════════════════════════════════════════════════
function batteriesStep(dt) {
  for (const b of state.batteries) {
    if (!b.alive) continue;
    b.gunCd = Math.max(0, b.gunCd - dt);
    const targets = (b.team === 'P') ? state.enemy : state.player;
    let tgt = null, bestD2 = Infinity;
    for (const s of targets) {
      if (!s.alive) continue;
      if (!canSee(b.team, s)) continue;
      const d2 = dist2(b.x, b.y, s.x, s.y);
      if (d2 <= b.kind.gunRange*b.kind.gunRange && d2 < bestD2) { bestD2 = d2; tgt = s; }
    }
    if (tgt) {
      const desired = Math.atan2(tgt.y - b.y, tgt.x - b.x);
      turretStep(b, dt, desired);
      if (b.gunCd <= 0) {
        b.gunCd = b.kind.gunReload;
        const spread = 0.08;
        const salvo = b.kind.salvo || 1;
        for (let i = 0; i < salvo; i++) {
          tryFireAtPoint(b, tgt.x, tgt.y, spread, state, null, (s, x, y) => shotSpotting(s, x, y, state));
        }
      }
    }
  }
}

function autoSupportLaunch(ship, dt) {
  if (!ship || !ship.alive) return;
  if (ship.kind.type === 'CV') {
    if (ship.airCd > 0) return;
    
    // Count active sorties
    const MAX_SORTIES = 4;
    const activeRecons = (state.recons || []).filter(r => r && r.homeShip === ship).length;
    const activeFighters = state.aircraft.filter(a => a && a.homeShip === ship && a.ttl > 0 && a.hp > 0).length;
    const activeSorties = Math.ceil(activeRecons / 2) + Math.ceil(activeFighters / 2);
    
    if (activeSorties >= MAX_SORTIES) return;
    
    // Check for nearby enemy aircraft - ONLY launch fighters if enemy planes detected
    const enemyAircraft = state.aircraft.filter(a => a.team !== ship.team && a.ttl > 0 && a.hp > 0);
    const enemyRecons = (state.recons || []).filter(r => r && r.team !== ship.team);
    let enemyPlanesNearby = false;
    let nearestEnemyPlane = null;
    let nearestDist2 = Infinity;
    
    for (const ea of enemyAircraft.concat(enemyRecons)) {
      const d2 = dist2(ship.x, ship.y, ea.x, ea.y);
      if (d2 < 1200 * 1200) { // Detection range for enemy planes
        enemyPlanesNearby = true;
        if (d2 < nearestDist2) {
          nearestDist2 = d2;
          nearestEnemyPlane = ea;
        }
      }
    }
    
    // PRIORITY: Only launch fighters if enemy planes are detected
    if (enemyPlanesNearby && activeFighters < 6) {
      const p = 0.8 * dt;
      if (Math.random() < p) {
        tryLaunchFighterSortie(ship, true);
      }
      return; // Don't launch recons when under air attack
    }
    
    // No enemy planes - launch recons for scouting
    if (activeRecons < 4) {
      const p = 0.4 * dt;
      if (Math.random() < p) {
        tryLaunchReconSortie(ship, true);
      }
    }
    return;
  }
  if (ship.kind.type === 'BB') {
    if (!teamHasContact(ship.team, state)) {
      const p = 0.55 * dt;
      if (Math.random() < p) tryRecon(ship, true);
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// PHYSICS & WORLD
// ═══════════════════════════════════════════════════════════════════════════
function resolveShipLand(ship, dt) {
  const hit = inLand(ship.x, ship.y, ship.kind.radius, state);
  if (!hit) { ship.grounded = false; return; }
  const dx = ship.x - hit.x, dy = ship.y - hit.y;
  const d = Math.hypot(dx, dy) || 1;
  const want = hit.r + ship.kind.radius + 0.5;
  ship.x = hit.x + (dx / d) * want;
  ship.y = hit.y + (dy / d) * want;
  const nx = dx / d, ny = dy / d;
  const vn = ship.vx * nx + ship.vy * ny;
  if (vn < 0) {
    ship.vx -= vn * nx * 1.8;
    ship.vy -= vn * ny * 1.8;
    ship.vx *= 0.35;
    ship.vy *= 0.35;
  }
  ship.grounded = true;
  
  // Grounded ships take flooding damage (sinking effect)
  if (!ship.flooding) {
    ship.flooding = true;
    if (ship.team === 'P') showMsg('Grounded! Ship taking on water!');
  }
  // Extra damage while grounded
  ship.hp -= ship.kind.hp * 0.02 * (dt || 0.016);
  
  if (ship.team === 'P' && state.time > (ship.groundMsgUntil || 0)) {
    ship.groundMsgUntil = state.time + 2.5;
    showMsg('Ship grounded and sinking!');
  }
}

function trailStep(ship) {
  if (!ship.alive) return;
  const last = ship.trail.length ? ship.trail[ship.trail.length - 1] : null;
  const minD2 = 9;
  if (!last || dist2(last.x, last.y, ship.x, ship.y) > minD2) {
    ship.trail.push({ x: ship.x, y: ship.y, t: state.time });
    if (ship.trail.length > 120) ship.trail.shift();
  }
  while (ship.trail.length && state.time - ship.trail[0].t > 5.2) ship.trail.shift();
}

function physicsStep(ship, dt) {
  const drag = (ship.kind.type === 'BB') ? Config.DRAG_BB : Config.DRAG_DD;
  if (!ship.alive) { ship.vx *= drag; ship.vy *= drag; return; }
  
  // Calculate target speed from throttle (with reverse limit)
  const throttleAbs = Math.abs(ship.throttle || 0);
  const isReverse = (ship.throttle || 0) < 0;
  const maxSpeed = ship.kind.maxSpeed * (isReverse ? Config.REVERSE_SPEED_MULT : 1.0);
  const targetSpeed = (throttleAbs / 100) * maxSpeed;
  
  // Current speed follows target with inertia
  if (ship.currentSpeed === undefined) ship.currentSpeed = 0;
  const speedInertia = Config.SPEED_INERTIA || 0.92;
  ship.currentSpeed = ship.currentSpeed * speedInertia + targetSpeed * (1 - speedInertia);
  
  // Apply speed in heading direction
  const currentSp = Math.hypot(ship.vx, ship.vy);
  const direction = isReverse ? -1 : 1;
  
  // Smoothly adjust velocity toward target
  const targetVx = Math.cos(ship.heading) * ship.currentSpeed * direction;
  const targetVy = Math.sin(ship.heading) * ship.currentSpeed * direction;
  
  ship.vx = ship.vx * 0.9 + targetVx * 0.1;
  ship.vy = ship.vy * 0.9 + targetVy * 0.1;
  
  // Apply drag
  ship.vx *= Math.pow(drag, dt * 60);
  ship.vy *= Math.pow(drag, dt * 60);
  
  // Limit max speed
  const sp = Math.hypot(ship.vx, ship.vy);
  if (sp > ship.kind.maxSpeed) {
    const k = ship.kind.maxSpeed / sp;
    ship.vx *= k; ship.vy *= k;
  }
  
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  resolveShipLand(ship, dt);
  withinWorld(ship, ship.kind.radius);
  ship.gunCd = Math.max(0, ship.gunCd - dt);
  ship.smokeCd = Math.max(0, ship.smokeCd - dt);
  ship.extCd = Math.max(0, ship.extCd - dt);
  ship.airCd = Math.max(0, ship.airCd - dt);
  if (ship.missileAmmo >= ship.missileAmmoMax) {
    ship.missileCd = 0;
  } else {
    ship.missileCd = Math.max(0, ship.missileCd - dt);
    if (ship.missileCd <= 0) {
      ship.missileAmmo = Math.min(ship.missileAmmoMax, ship.missileAmmo + 1);
      ship.missileCd = (ship.missileAmmo < ship.missileAmmoMax) ? ship.kind.missileReload : 0;
    }
  }
  trailStep(ship);
}

function spawnCoastalBatteries(m) {
  state.batteries = [];
  const maxPerTeam = 7;
  const spawns = (m.pSpawn || []).concat(m.eSpawn || []).map(a => ({ x: a[0], y: a[1] }));
  const tooCloseToSpawn = (x, y) => {
    for (const s of spawns) { if (dist2(x, y, s.x, s.y) < 520*520) return true; }
    return false;
  };
  const tryPlace = (team, c, a) => {
    const r = Math.max(10, c.r - 10);
    const x = c.x + Math.cos(a) * r;
    const y = c.y + Math.sin(a) * r;
    if (!inLand(x, y, 1, state)) return false;
    if (tooCloseToSpawn(x, y)) return false;
    for (const b of state.batteries) { if (dist2(x, y, b.x, b.y) < 120*120) return false; }
    state.batteries.push(mkBattery(team, x, y, a));
    return true;
  };
  const placeTeam = (team) => {
    const wantLeft = (team === 'P');
    const land = m.land.slice().sort((a,b) => b.r - a.r);
    let placed = 0;
    for (const c of land) {
      if (placed >= maxPerTeam) break;
      if (wantLeft && c.x > Config.WORLD.w * 0.60) continue;
      if (!wantLeft && c.x < Config.WORLD.w * 0.40) continue;
      const attempts = (c.r > 180) ? 4 : 2;
      for (let k = 0; k < attempts && placed < maxPerTeam; k++) {
        const a = rand(0, Config.TAU);
        if (tryPlace(team, c, a)) placed++;
      }
    }
  };
  placeTeam('P');
}


// ═══════════════════════════════════════════════════════════════════════════
// WORLD RESET
// ═══════════════════════════════════════════════════════════════════════════
export function resetWorld(level) {
  state.level = level;
  state.ended = false;
  state.time = 0;
  state.shells.length = 0;
  state.missiles.length = 0;
  state.smokes.length = 0;
  state.fx.length = 0;
  state.aircraft.length = 0;
  state.bullets.length = 0;
  state.batteries.length = 0;
  state.recons.length = 0;
  state.selected = 0;

  const m = Config.mapById(state.mapId);
  const b = Config.battleByMap(state.mapId);
  const pCount = clamp(b.pCount|0, 4, 16);
  const eCount = clamp(b.eCount|0, 4, 16);

  const US = {
    DD: ['USS Fletcher','USS Johnston','USS Laffey','USS OBannon','USS Kidd','USS Radford','USS Buchanan','USS McCalla','USS Sims','USS Benson','USS Daly','USS Cushing','USS Hoel','USS Heermann'],
    BB: ['USS Iowa','USS South Dakota','USS Washington','USS North Carolina','USS Missouri'],
    CV: ['USS Enterprise','USS Yorktown','USS Hornet','USS Lexington','USS Saratoga'],
    TB: ['PT-109','PT-41','PT-59','PT-103','PT-105','PT-314'],
  };
  const IJN = {
    DD: ['IJN Kagerō','IJN Yukikaze','IJN Shigure','IJN Kuroshio','IJN Akigumo','IJN Hamakaze','IJN Isokaze','IJN Nowaki','IJN Tanikaze','IJN Shiratsuyu','IJN Asashio','IJN Michishio','IJN Urakaze','IJN Arashi'],
    BB: ['IJN Yamato','IJN Nagato','IJN Kongō','IJN Haruna','IJN Kirishima'],
    CV: ['IJN Akagi','IJN Kaga','IJN Sōryū','IJN Hiryū','IJN Shōkaku','IJN Zuikaku'],
    TB: ['Kaibōkan','Torpedo Boat','Patrol Boat'],
  };
  const pickName = (pool, kindKey, idx) => {
    const arr = pool[kindKey] || ['Ship'];
    return arr[idx % arr.length];
  };
  const playerKind = (state.playerClass === 'cv') ? Config.CV : ((state.playerClass === 'bb') ? Config.BB : (state.playerClass === 'tb' ? Config.TB : Config.DD));
  const planKinds = (side, count, firstKind) => {
    const out = [];
    if (firstKind) out.push(firstKind);
    const wantCV = (state.mapId === 0 || state.mapId === 2);
    const wantBB = true;
    const wantTB = (state.mapId === 2) ? 2 : 1;
    const pushIf = (kind) => { if (out.length < count && !out.includes(kind)) out.push(kind); };
    if (side === 'P') {
      if (wantCV) pushIf(Config.CV);
      if (wantBB) pushIf(Config.BB);
      for (let i = 0; i < wantTB; i++) { if (out.length < count) out.push(Config.TB); }
      while (out.length < count) out.push(Config.DD);
    } else {
      if (wantCV) out.push(Config.CV);
      if (wantBB && out.length < count) out.push(Config.BB);
      for (let i = 0; i < wantTB; i++) { if (out.length < count) out.push((level >= 2) ? Config.TB : Config.DD); }
      while (out.length < count) out.push(Config.DD);
    }
    return out.slice(0, count);
  };
  const pKinds = planKinds('P', pCount, playerKind);
  const eKinds = planKinds('E', eCount, null);

  const sortKinds = (kinds) => {
    const priority = { 'CV': 0, 'BB': 1, 'DD': 2, 'TB': 3 };
    return kinds.slice().sort((a, b) => (priority[a.type] || 4) - (priority[b.type] || 4));
  };
  
  const pKindsSorted = sortKinds(pKinds);
  const eKindsSorted = sortKinds(eKinds);

  const pSpawns = generateEscortFormation(m.pSpawn[0], pKindsSorted, b.pForm, m.land);
  const eSpawns = generateEscortFormation(m.eSpawn[0], eKindsSorted, b.eForm, m.land);

  state.player = [];
  for (let i = 0; i < pSpawns.length; i++) {
    const sp = pSpawns[i];
    const key = sp.kind.type;
    const tag = pickName(US, key, i);
    state.player.push(mkShip('P', sp.kind, sp.x, sp.y, sp.a, tag));
  }
  
  // Find the player's selected ship class and set it as selected
  state.selected = 0;
  for (let i = 0; i < state.player.length; i++) {
    if (state.player[i].kind.type === playerKind.type) {
      state.selected = i;
      break;
    }
  }
  
  state.enemy = [];
  for (let i = 0; i < eSpawns.length; i++) {
    const sp = eSpawns[i];
    const key = sp.kind.type;
    const tag = pickName(IJN, key, i);
    state.enemy.push(mkShip('E', sp.kind, sp.x, sp.y, sp.a, tag));
  }
  setFormation(state.player, b.pForm);
  setFormation(state.enemy, b.eForm);
  
  // Assign escort positions based on proximity to capitals
  assignEscortPositions(state.player);
  assignEscortPositions(state.enemy);
  
  spawnCoastalBatteries(m);
  state.camX = state.player[0].x - Config.VIEW.w/2;
  state.camY = state.player[0].y - Config.VIEW.h/2;
}

// ═══════════════════════════════════════════════════════════════════════════
// UI UPDATE
// ═══════════════════════════════════════════════════════════════════════════
function updateUI() {
  if (!ui) return;
  ui.level.textContent = String(state.level);
  ui.sel.textContent = String(state.selected + 1);
  const selShip = state.player[state.selected];
  if (selShip && selShip.kind.type === 'BB') {
    const airborne = state.recons && state.recons.some(r => r && r.homeShip === selShip);
    const cd = selShip.reconCd || 0;
    const rtxt = airborne ? 'Recon: Airborne' : (cd > 0 ? `Recon: ${cd.toFixed(1)}s` : 'Recon: Ready (T)');
    ui.stype.textContent = `${selShip.kind.type} | ${rtxt}`;
  } else if (selShip && selShip.kind.type === 'CV') {
    const atxt = selShip.airCd > 0 ? `Air: ${selShip.airCd.toFixed(1)}s` : 'Air: Ready (T)';
    ui.stype.textContent = `${selShip.kind.type} | ${atxt}`;
  } else {
    ui.stype.textContent = selShip ? selShip.kind.type : '-';
  }
  ui.hp.textContent = selShip ? `${Math.round(selShip.hp)} / ${selShip.kind.hp}` : '-';
  ui.throttle.textContent = selShip ? `${Math.round(selShip.throttle)}%` : '-';
  if (selShip) {
    const rudderDeg = Math.round((selShip.rudderAngle || 0) * 180 / Math.PI);
    const rudderDir = rudderDeg < 0 ? 'L' : (rudderDeg > 0 ? 'R' : '');
    ui.rudder.textContent = `${Math.abs(rudderDeg)}° ${rudderDir}`.trim();
  } else {
    ui.rudder.textContent = '-';
  }
  if (selShip) {
    ui.gun.textContent = (selShip.kind.gunRange > 0) ? (selShip.gunCd > 0 ? `Reload ${selShip.gunCd.toFixed(1)}s` : 'Ready') : '-';
    ui.smoke.textContent = (selShip.kind.smokeCooldown > 0) ? (selShip.smokeCd > 0 ? `Reload ${selShip.smokeCd.toFixed(1)}s` : 'Ready') : '-';
    if (!selShip.missileAmmoMax || selShip.missileAmmoMax <= 0 || selShip.kind.missileReload <= 0) {
      ui.missile.textContent = '-';
    } else if (selShip.missileAmmo >= selShip.missileAmmoMax) {
      ui.missile.textContent = `${selShip.missileAmmo}/${selShip.missileAmmoMax} Ready`;
    } else {
      ui.missile.textContent = `${selShip.missileAmmo}/${selShip.missileAmmoMax} +${selShip.missileCd.toFixed(1)}s`;
    }
  }
}

function endCheck() {
  const pAlive = aliveShips(state.player).length;
  const eAlive = aliveShips(state.enemy).length;
  if (!state.ended && pAlive === 0) { state.ended = true; showMsg('Defeat — press R to retry', 2200); }
  if (!state.ended && eAlive === 0) { state.ended = true; showMsg('Victory — click Next Level', 2200); }
}

export function restartLevel() { 
  if (!state.started) return; 
  resetWorld(state.level); 
  showMsg('Restarted'); 
}

export function nextLevel() {
  if (!state.started) return;
  if (!state.ended) { showMsg('Finish the battle first'); return; }
  resetWorld(Math.min(6, state.level + 1));
  showMsg('Level up');
}


// ═══════════════════════════════════════════════════════════════════════════
// MAIN GAME LOOP
// ═══════════════════════════════════════════════════════════════════════════
let last = performance.now();
const SPECTATOR_CAM_SPEED = 400;

function tick(now) {
  let dt = clamp((now - last) / 1000, 0, 0.033);
  last = now;
  
  // Apply game speed multiplier in spectator mode
  if (state.spectatorMode && state.gameSpeed > 1) {
    dt *= state.gameSpeed;
  }
  
  state.time += dt;
  updateWaterTime(dt);
  
  // Camera control
  if (state.minimapViewing) {
    // Viewing minimap location - snap camera there
    state.camX = lerp(state.camX, state.minimapViewX - Config.VIEW.w/2, 0.2);
    state.camY = lerp(state.camY, state.minimapViewY - Config.VIEW.h/2, 0.2);
  } else if (state.spectatorMode) {
    // Check if WASD is pressed - switch to free camera mode
    const wasdPressed = keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD');
    if (wasdPressed) {
      state.spectatorFreeCamera = true;
    }
    
    if (state.spectatorFreeCamera) {
      // Free camera mode: WASD moves camera
      if (keys.has('KeyW')) state.camY -= SPECTATOR_CAM_SPEED * dt;
      if (keys.has('KeyS')) state.camY += SPECTATOR_CAM_SPEED * dt;
      if (keys.has('KeyA')) state.camX -= SPECTATOR_CAM_SPEED * dt;
      if (keys.has('KeyD')) state.camX += SPECTATOR_CAM_SPEED * dt;
    } else {
      // Follow ship mode: camera follows spectatorTarget
      const allShips = state.player.concat(state.enemy);
      const target = allShips[state.spectatorTarget];
      if (target && target.alive) {
        state.camX = lerp(state.camX, target.x - Config.VIEW.w/2, 0.07);
        state.camY = lerp(state.camY, target.y - Config.VIEW.h/2, 0.07);
      }
    }
  } else {
    // Normal mode: follow selected ship
    const sel = state.player[state.selected];
    if (sel) {
      state.camX = lerp(state.camX, sel.x - Config.VIEW.w/2, 0.07);
      state.camY = lerp(state.camY, sel.y - Config.VIEW.h/2, 0.07);
    }
  }
  state.camX = clamp(state.camX, 0, Config.WORLD.w - Config.VIEW.w);
  state.camY = clamp(state.camY, 0, Config.WORLD.h - Config.VIEW.h);

  if (state.started && !state.ended) {
    reconStep(dt);
    airStep(dt);
    updateDetections(state);
    batteriesStep(dt);
    const ctrl = state.player[state.selected];
    const capital = pickCapitalLeader(state.player);
    
    // In spectator mode, all player ships are AI controlled (same as enemy AI)
    if (state.spectatorMode) {
      for (let i = 0; i < state.player.length; i++) {
        const s = state.player[i];
        if (!s.alive) continue;
        // Use full AI step for player ships in spectator mode (they fight like enemies)
        aiStepPlayer(s, dt, state, diff, showMsg, autoSupportLaunch);
      }
    } else {
      // Normal mode: player controls selected ship
      for (let i = 0; i < state.player.length; i++) {
        const s = state.player[i];
        if (!s.alive) continue;
        if (i === state.selected) {
          playerControl(s, dt, state);
        } else {
          autoSupportLaunch(s, dt);
          const lead = (capital && capital.alive) ? capital : (ctrl && ctrl.alive ? ctrl : state.player[0]);
          if (!lead || !lead.alive) continue;
          if (s === lead) {
            capitalAutoPilot(s, dt, state, showMsg);
          } else {
            const fp = formationPoint(lead, s, (x, y, pad) => inLand(x, y, pad, state));
            const fpX = clamp(fp.x, 0, Config.WORLD.w);
            const fpY = clamp(fp.y, 0, Config.WORLD.h);
            const distToFormation = Math.sqrt(dist2(s.x, s.y, fpX, fpY));
            
            // Match leader's throttle when close to formation position
            if (distToFormation < 150) {
              updateAIThrottle(s, fp.throttle || lead.throttle || 50, dt);
            } else {
              const targetThrottle = calculateAITargetThrottle(s, distToFormation, true, false);
              updateAIThrottle(s, targetThrottle, dt);
            }
            
            steerToPoint(s, fpX, fpY, dt, s.kind.maxSpeed * (s.throttle / 100), state);
            turretStep(s, dt, s.heading);
          }
        }
      }
    }
    for (const e of state.enemy) aiStep(e, dt, state, diff, showMsg, autoSupportLaunch);
    separationTeam(state.player, dt, state);
    separationTeam(state.enemy, dt, state);
    checkShipCollisions(dt, state, showMsg);
    for (const s of state.player) physicsStep(s, dt);
    for (const e of state.enemy) physicsStep(e, dt);
    shellsStep(dt, state);
    missilesStep(dt, state, (x, y, pad) => inLand(x, y, pad, state));
    bulletsStep(dt);
    statusStep(dt, state, showMsg);
    smokesStep(state);
    fxStep(state);
    endCheck();
  } else if (state.started) {
    reconStep(dt);
    airStep(dt);
    shellsStep(dt, state);
    missilesStep(dt, state, (x, y, pad) => inLand(x, y, pad, state));
    bulletsStep(dt);
    statusStep(dt, state, showMsg);
    smokesStep(state);
    fxStep(state);
  }

  updateUI();
  draw(ctx, state);
  requestAnimationFrame(tick);
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════
export function init(canvas, uiElements) {
  ctx = canvas.getContext('2d');
  ui = uiElements;
  ui.canvas = canvas;
  
  initPatterns(ctx);
  
  initInput(canvas, {
    onMouseDown: (e) => {
      if (!state.started || state.menuOpen || state.ended) return;
      
      // Check if clicking on minimap
      const worldPos = minimapToWorld(mouse.x, mouse.y);
      if (worldPos) {
        state.minimapViewing = true;
        state.minimapViewX = worldPos.x;
        state.minimapViewY = worldPos.y;
        return;
      }
      
      if (state.spectatorMode) return; // No firing in spectator mode
      const ship = state.player[state.selected];
      if (!ship || !ship.alive) return;
      const tx = state.camX + mouse.x;
      const ty = state.camY + mouse.y;
      tryFireAtPoint(ship, tx, ty, 0.85, state, showMsg, (s, x, y) => shotSpotting(s, x, y, state));
    },
    onMouseUp: (e) => {
      // Release minimap view
      state.minimapViewing = false;
    },
    onMouseMove: (e) => {
      // Update minimap view position while dragging
      if (state.minimapViewing) {
        const worldPos = minimapToWorld(mouse.x, mouse.y);
        if (worldPos) {
          state.minimapViewX = worldPos.x;
          state.minimapViewY = worldPos.y;
        }
      }
    },
    onKeyDown: (e) => {
      if (e.code === 'Escape' || e.code === 'KeyM') { toggleMenu(); return; }
      if (!state.started || state.menuOpen) return;
      
      if (e.code === 'Tab') {
        e.preventDefault();
        // Reset minimap viewing when Tab is pressed
        state.minimapViewing = false;
        
        if (state.spectatorMode) {
          // Spectator mode: Tab cycles through ALL ships (player + enemy)
          // Also switches back to follow mode from free camera
          state.spectatorFreeCamera = false;
          const allShips = state.player.concat(state.enemy);
          const n = allShips.length;
          const dir = e.shiftKey ? -1 : 1;
          for (let k = 1; k <= n; k++) {
            const j = (state.spectatorTarget + dir*k + n*10) % n;
            const s = allShips[j];
            if (s && s.alive) { 
              state.spectatorTarget = j;
              // Snap camera to new target immediately
              state.camX = s.x - Config.VIEW.w/2;
              state.camY = s.y - Config.VIEW.h/2;
              const teamName = j < state.player.length ? 'Allied' : 'Enemy';
              const shipName = s.tag || s.kind.type;
              showMsg(`Following: ${teamName} ${shipName}`, 1200);
              break; 
            }
          }
        } else {
          // Normal mode: Tab cycles through player ships
          const dir = e.shiftKey ? -1 : 1;
          const n = state.player.length;
          for (let k = 1; k <= n; k++) {
            const j = (state.selected + dir*k + n*10) % n;
            const s = state.player[j];
            if (s && s.alive) { 
              state.selected = j;
              // Snap camera to selected ship immediately
              state.camX = s.x - Config.VIEW.w/2;
              state.camY = s.y - Config.VIEW.h/2;
              break; 
            }
          }
        }
        return;
      }
      
      // In spectator mode, ignore most controls except Tab/Escape/WASD
      if (state.spectatorMode) return;
      
      if (e.code === 'Digit1') state.selected = 0;
      if (e.code === 'Digit2') state.selected = 1;
      if (e.code === 'Digit3') state.selected = 2;
      if (e.code === 'Digit4') state.selected = 3;
      if (e.code === 'KeyR') restartLevel();
      if (e.code === 'KeyE') trySmoke(state.player[state.selected], state, showMsg);
      if (e.code === 'KeyQ') tryMissile(state.player[state.selected], state, showMsg);
      if (e.code === 'KeyF') tryExtinguish(state.player[state.selected], false, showMsg);
      if (e.code === 'KeyT') {
        const s = state.player[state.selected];
        if (!s) return;
        if (s.kind.type === 'BB') tryRecon(s);
        else if (s.kind.type === 'CV') {
          if (e.shiftKey) tryLaunchReconSortie(s);
          else tryLaunchFighterSortie(s);
        }
      }
    }
  });
  
  ui.diffEasy.addEventListener('click', () => setDifficulty('easy'));
  ui.diffMed.addEventListener('click', () => setDifficulty('med'));
  ui.diffHard.addEventListener('click', () => setDifficulty('hard'));
  ui.classDD.addEventListener('click', () => setPlayerClass('dd'));
  ui.classBB.addEventListener('click', () => setPlayerClass('bb'));
  ui.classTB.addEventListener('click', () => setPlayerClass('tb'));
  ui.classCV.addEventListener('click', () => setPlayerClass('cv'));
  ui.map0.addEventListener('click', () => setMap(0));
  ui.map1.addEventListener('click', () => setMap(1));
  ui.map2.addEventListener('click', () => setMap(2));
  ui.spectatorBtn.addEventListener('click', () => {
    state.spectatorMode = true;
    state.spectatorFreeCamera = false; // Start following a ship
    state.spectatorTarget = 0; // Start with first player ship
    state.gameSpeed = 1; // Reset speed
    state.started = true;
    hideMenu();
    resetWorld(1);
    if (ui.leaveBtn) ui.leaveBtn.style.display = 'block';
    if (ui.speedBtn) {
      ui.speedBtn.style.display = 'block';
      ui.speedBtn.textContent = 'Speed: 1x';
    }
    showMsg('Spectator Mode — Tab: follow ships — WASD: free camera', 3000);
  });
  if (ui.speedBtn) {
    ui.speedBtn.addEventListener('click', () => {
      // Cycle through speeds: 1x -> 2x -> 4x -> 1x
      if (state.gameSpeed === 1) state.gameSpeed = 2;
      else if (state.gameSpeed === 2) state.gameSpeed = 4;
      else state.gameSpeed = 1;
      ui.speedBtn.textContent = `Speed: ${state.gameSpeed}x`;
    });
  }
  ui.startBtn.addEventListener('click', () => {
    if (!state.started) {
      state.spectatorMode = false;
      state.gameSpeed = 1;
      state.started = true;
      hideMenu();
      resetWorld(1);
      if (ui.leaveBtn) ui.leaveBtn.style.display = 'none';
      if (ui.speedBtn) ui.speedBtn.style.display = 'none';
      const b = Config.battleByMap(state.mapId);
      showMsg(`${Config.mapById(state.mapId).name} — ${diff().name} — ${Config.className(state.playerClass)} — ${b.pName} vs ${b.eName}`, 2800);
    } else {
      hideMenu();
    }
  });
  if (ui.leaveBtn) {
    ui.leaveBtn.addEventListener('click', () => {
      state.spectatorMode = false;
      state.spectatorFreeCamera = false;
      state.started = false;
      state.ended = false;
      state.gameSpeed = 1;
      ui.leaveBtn.style.display = 'none';
      if (ui.speedBtn) ui.speedBtn.style.display = 'none';
      showMenu();
    });
  }
  if (ui.leaveBattleBtn) {
    ui.leaveBattleBtn.addEventListener('click', () => {
      state.spectatorMode = false;
      state.spectatorFreeCamera = false;
      state.started = false;
      state.ended = false;
      state.gameSpeed = 1;
      if (ui.leaveBtn) ui.leaveBtn.style.display = 'none';
      if (ui.speedBtn) ui.speedBtn.style.display = 'none';
      ui.leaveBattleBtn.style.display = 'none';
      hideMenu();
      showMenu();
    });
  }
  ui.restart.addEventListener('click', restartLevel);
  ui.next.addEventListener('click', nextLevel);

  setDifficulty('med');
  setPlayerClass('dd');
  setMap(0);
  showMenu();
  requestAnimationFrame(tick);
}
