// ═══════════════════════════════════════════════════════════════════════════
// COMBAT MODULE - Weapons, damage, detection, and status effects
// ═══════════════════════════════════════════════════════════════════════════

import { 
  MISSILE, FX, RADAR_RANGE, RADAR_R2, BLINK_SECS, DET_STICKY, 
  SHOT_SPOT_RANGE, SHOT_SPOT_R2, SMOKE_DEPLOY_TIME, SMOKE_DURATION 
} from './config.js';
import { clamp, lerp, dist2, rand, normAngle } from './utils.js';
import { reassignEscortPositions } from './entities.js';

// ═══════════════════════════════════════════════════════════════════════════
// SMOKE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
export function smokeAt(x, y, team, kind, state) {
  state.smokes.push({ 
    x, y, team, 
    born: state.time, 
    deployUntil: state.time + SMOKE_DEPLOY_TIME,
    until: state.time + SMOKE_DEPLOY_TIME + SMOKE_DURATION,
    radius: kind.smokeRadius,
    deploying: true
  });
}

export function trySmoke(ship, state, showMsg) {
  if (!ship || !ship.alive) return;
  if (!ship.kind.smokeCooldown || ship.kind.smokeCooldown <= 0) { 
    if (ship.team === 'P' && showMsg) showMsg('No smoke'); 
    return; 
  }
  if (ship.smokeCd > 0) { 
    if (showMsg) showMsg('Smoke reloading...'); 
    return; 
  }
  ship.smokeCd = ship.kind.smokeCooldown;
  ship.deployingSmoke = true;
  ship.smokeDeployStart = state.time;
  ship.smokeDeployEnd = state.time + SMOKE_DEPLOY_TIME;
  smokeAt(ship.x, ship.y, ship.team, ship.kind, state);
  if (showMsg) showMsg('Deploying smoke...');
}

export function updateSmokeDeployment(ship, dt, state, showMsg) {
  if (!ship.deployingSmoke) return;
  if (state.time >= ship.smokeDeployEnd) {
    ship.deployingSmoke = false;
    if (ship.team === 'P' && showMsg) showMsg('Smoke screen complete');
    return;
  }
  if (Math.random() < 2.5 * dt) {
    state.smokes.push({
      x: ship.x + rand(-20, 20),
      y: ship.y + rand(-20, 20),
      team: ship.team,
      born: state.time,
      deployUntil: state.time,
      until: state.time + SMOKE_DURATION,
      radius: ship.kind.smokeRadius * 0.7,
      deploying: false
    });
  }
}

export function inSmoke(ship, state) {
  for (const s of state.smokes) {
    if (state.time > s.until) continue;
    let effectiveRadius = s.radius;
    if (s.deploying && state.time < s.deployUntil) {
      const deployProgress = (state.time - s.born) / SMOKE_DEPLOY_TIME;
      effectiveRadius = s.radius * deployProgress;
    }
    const r2 = effectiveRadius * effectiveRadius;
    if (dist2(ship.x, ship.y, s.x, s.y) <= r2) return true;
  }
  return false;
}


// ═══════════════════════════════════════════════════════════════════════════
// TURRET & SHELL SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
export function turretStep(ship, dt, targetAngle) {
  const maxTurretRate = 4.0;
  const delta = normAngle(targetAngle - ship.turret);
  ship.turret += clamp(delta, -maxTurretRate*dt, maxTurretRate*dt);
}

export function qbez(p0, p1, p2, t) {
  const u = 1 - t;
  return u*u*p0 + 2*u*t*p1 + t*t*p2;
}

export function shellPos(sh, t) {
  return { x: qbez(sh.sx, sh.cx, sh.ex, t), y: qbez(sh.sy, sh.cy, sh.ey, t) };
}

export function fireShellAtPoint(shooter, tx, ty, spread, dmg, state, shotSpotting) {
  const dx0 = tx - shooter.x;
  const dy0 = ty - shooter.y;
  const dist0 = Math.max(1, Math.hypot(dx0, dy0));
  const baseA = Math.atan2(dy0, dx0);
  const a = baseA + rand(-spread, spread);
  const ex = shooter.x + Math.cos(a) * dist0;
  const ey = shooter.y + Math.sin(a) * dist0;
  if (shotSpotting) shotSpotting(shooter, ex, ey, state);

  const sx = shooter.x + Math.cos(baseA) * (shooter.kind.radius + 10);
  const sy = shooter.y + Math.sin(baseA) * (shooter.kind.radius + 10);
  const mx = (sx + ex) * 0.5;
  const my = (sy + ey) * 0.5;
  const pdx = -(ey - sy);
  const pdy =  (ex - sx);
  const pl = Math.hypot(pdx, pdy) || 1;
  const arc = clamp(dist0 * 0.22, 90, 260) * (Math.random() < 0.5 ? -1 : 1);
  const cx = mx + (pdx / pl) * arc;
  const cy = my + (pdy / pl) * arc;
  const dist = Math.hypot(ex - sx, ey - sy);
  const tt = clamp(dist / shooter.kind.shellSpeed, 0.70, 4.6);
  const impactR = shooter.kind.type === 'BB' ? 20 : 16;
  state.shells.push({ team: shooter.team, sx, sy, cx, cy, ex, ey, x: sx, y: sy, t: 0, tt, dmg, impactR });
}

export function tryFireAtPoint(ship, tx, ty, accuracy, state, showMsg, shotSpotting) {
  if (!ship.alive) return;
  if (!ship.kind.gunRange || ship.kind.gunRange <= 0 || !ship.kind.shellDmg || ship.kind.shellDmg <= 0) { 
    if (ship.team === 'P' && showMsg) showMsg('No guns'); 
    return; 
  }
  if (ship.gunCd > 0) return;
  const d = Math.hypot(tx - ship.x, ty - ship.y);
  if (d > ship.kind.gunRange) { 
    if (showMsg) showMsg('Out of range'); 
    return; 
  }
  ship.gunCd = ship.kind.gunReload;
  const spread = lerp(0.10, 0.02, clamp(accuracy, 0, 1));
  const salvo = ship.kind.salvo || 1;
  if (salvo === 1) {
    fireShellAtPoint(ship, tx, ty, spread, ship.kind.shellDmg, state, shotSpotting);
  } else {
    const base = spread * 0.85;
    for (let i = 0; i < salvo; i++) fireShellAtPoint(ship, tx, ty, base, ship.kind.shellDmg, state, shotSpotting);
  }
}

export function tryMissile(ship, state, showMsg) {
  if (!ship || !ship.alive) return;
  if (!ship.missileAmmoMax || ship.missileAmmoMax <= 0 || !ship.kind.missileReload || ship.kind.missileReload <= 0) { 
    if (ship.team === 'P' && showMsg) showMsg('No torpedoes'); 
    return; 
  }
  if (ship.missileAmmo <= 0) { 
    if (showMsg) showMsg('No torpedoes loaded'); 
    return; 
  }
  ship.missileAmmo -= 1;
  if (ship.missileAmmo < ship.missileAmmoMax && ship.missileCd <= 0) ship.missileCd = ship.kind.missileReload;
  const a = ship.turret;
  const sx = ship.x + Math.cos(a) * (ship.kind.radius + 14);
  const sy = ship.y + Math.sin(a) * (ship.kind.radius + 14);
  const vx = Math.cos(a) * MISSILE.speed;
  const vy = Math.sin(a) * MISSILE.speed;
  state.missiles.push({ team: ship.team, x: sx, y: sy, vx, vy, a, ttl: MISSILE.ttl, dmg: MISSILE.dmg });
}

export function tryExtinguish(ship, silent, showMsg) {
  if (!ship || !ship.alive) return;
  if (!ship.onFire) { 
    if (!silent && ship.team === 'P' && showMsg) showMsg('No fire'); 
    return; 
  }
  if (ship.extCd > 0) { 
    if (!silent && ship.team === 'P' && showMsg) showMsg(`Extinguisher reloading ${ship.extCd.toFixed(1)}s`); 
    return; 
  }
  ship.onFire = false;
  ship.extCd = 10.0;
  if (!silent && ship.team === 'P' && showMsg) showMsg('Fire extinguished');
}


// ═══════════════════════════════════════════════════════════════════════════
// DAMAGE & STATUS
// ═══════════════════════════════════════════════════════════════════════════
export function sinkIfDead(ship, state) {
  if (ship.hp > 0 || !ship.alive) return;
  ship.alive = false;
  ship.hp = 0;
  state.fx.push({ type: 'splash', x: ship.x, y: ship.y, until: state.time + FX.splashTtl });
  
  // Reassign escort positions when a ship sinks
  if (ship.team === 'P') {
    reassignEscortPositions(state.player);
  } else {
    reassignEscortPositions(state.enemy);
  }
}

export function damageShip(ship, rawDmg, cause, state) {
  const reduced = rawDmg * (1 - ship.kind.armor);
  ship.hp -= reduced;
  ship.fireUntil = Math.max(ship.fireUntil, state.time + FX.fireTtl);
  state.fx.push({ type: 'hit', x: ship.x, y: ship.y, until: state.time + FX.hitTtl });
  if (cause === 'shell' && ship.alive && !ship.onFire && Math.random() < 0.30) ship.onFire = true;
  sinkIfDead(ship, state);
}

export function damageBattery(b, rawDmg, cause, state) {
  if (!b || !b.alive) return;
  const reduced = rawDmg * (1 - (b.kind.armor || 0));
  b.hp -= reduced;
  state.fx.push({ type: 'hit', x: b.x, y: b.y, until: state.time + FX.hitTtl });
  if (b.hp <= 0) {
    b.alive = false;
    b.hp = 0;
    state.fx.push({ type: 'boom', x: b.x, y: b.y, until: state.time + FX.boomTtl });
  }
}

export function statusStep(dt, state, showMsg) {
  const all = state.player.concat(state.enemy);
  for (const s of all) {
    if (!s.alive) continue;
    if (s.onFire) {
      s.hp -= s.fireDps * dt;
      if (Math.random() < 0.8 * dt) s.fireUntil = Math.max(s.fireUntil, state.time + 0.25);
    }
    if (s.flooding) s.hp -= s.floodDps * dt;
    updateSmokeDeployment(s, dt, state, showMsg);
    sinkIfDead(s, state);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DETECTION & RADAR
// ═══════════════════════════════════════════════════════════════════════════
export function revealToTeam(ship, team, state) {
  if (!ship || !ship.alive) return;
  if (team === 'P') { 
    ship.lastSeenP = state.time; 
    ship.detP = true; 
    ship.blinkUntilP = state.time + BLINK_SECS; 
  } else { 
    ship.lastSeenE = state.time; 
    ship.detE = true; 
    ship.blinkUntilE = state.time + BLINK_SECS; 
  }
}

export function shotSpotting(shooter, impactX, impactY, state) {
  if (!shooter || shooter.team !== 'E' || !shooter.alive) return;
  for (const p of state.player) {
    if (!p.alive) continue;
    if (dist2(p.x, p.y, impactX, impactY) <= SHOT_SPOT_R2) { 
      revealToTeam(shooter, 'P', state); 
      break; 
    }
  }
}

export function canSee(team, targetShip) {
  return team === 'P' ? !!targetShip.detP : !!targetShip.detE;
}

export function updateDetections(state) {
  const batsP = state.batteries.filter(b => b.alive && b.team === 'P');
  const batsE = state.batteries.filter(b => b.alive && b.team === 'E');
  const shipsP = state.player.filter(s => s.alive);
  const shipsE = state.enemy.filter(s => s.alive);
  const targetsE = state.enemy.concat(state.batteries.filter(b => b.team === 'E'));
  const targetsP = state.player.concat(state.batteries.filter(b => b.team === 'P'));
  
  // Helper to get sensor range (batteries use gun range, ships use radar)
  const getSensorRange2 = (sensor) => {
    if (sensor.kind && sensor.kind.type === 'BAT') {
      const range = sensor.kind.gunRange || RADAR_RANGE;
      return range * range;
    }
    return RADAR_R2;
  };
  
  for (const t of targetsE) {
    const prev = !!t.detP;
    let now = false;
    if (t.alive) {
      // Check player ships
      for (const s of shipsP) {
        if (dist2(s.x, s.y, t.x, t.y) <= RADAR_R2) { now = true; break; }
      }
      // Check player batteries with their gun range
      if (!now) {
        for (const b of batsP) {
          const range2 = getSensorRange2(b);
          if (dist2(b.x, b.y, t.x, t.y) <= range2) { now = true; break; }
        }
      }
    }
    if (!t.alive) { t.detP = false; }
    else {
      if (now) t.lastSeenP = state.time;
      t.detP = (t.lastSeenP != null) && ((state.time - t.lastSeenP) <= DET_STICKY);
    }
    if (now && !prev) t.blinkUntilP = state.time + BLINK_SECS;
  }
  
  for (const t of targetsP) {
    const prev = !!t.detE;
    let now = false;
    if (t.alive) {
      // Check enemy ships
      for (const s of shipsE) {
        if (dist2(s.x, s.y, t.x, t.y) <= RADAR_R2) { now = true; break; }
      }
      // Check enemy batteries with their gun range
      if (!now) {
        for (const b of batsE) {
          const range2 = getSensorRange2(b);
          if (dist2(b.x, b.y, t.x, t.y) <= range2) { now = true; break; }
        }
      }
    }
    if (!t.alive) { t.detE = false; }
    else {
      if (now) t.lastSeenE = state.time;
      t.detE = (t.lastSeenE != null) && ((state.time - t.lastSeenE) <= DET_STICKY);
    }
    if (now && !prev) t.blinkUntilE = state.time + BLINK_SECS;
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// STEP FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════
export function shellsStep(dt, state) {
  for (const sh of state.shells) {
    sh.t += dt;
    const u = clamp(sh.t / sh.tt, 0, 1);
    const p = shellPos(sh, u);
    sh.x = p.x; sh.y = p.y;
  }
  for (const sh of state.shells) {
    if (sh.t < sh.tt) continue;
    state.fx.push({ type: 'boom', x: sh.ex, y: sh.ey, until: state.time + FX.boomTtl });
    const targets = (sh.team === 'P') ? state.enemy : state.player;
    const batTargets = (sh.team === 'P') ? state.batteries.filter(b => b.alive && b.team === 'E') : state.batteries.filter(b => b.alive && b.team === 'P');
    const r2 = sh.impactR * sh.impactR;
    for (const t of targets) {
      if (!t.alive) continue;
      if (dist2(sh.ex, sh.ey, t.x, t.y) <= r2) damageShip(t, sh.dmg, 'shell', state);
    }
    for (const b of batTargets) {
      if (dist2(sh.ex, sh.ey, b.x, b.y) <= r2) damageBattery(b, sh.dmg, 'shell', state);
    }
  }
  state.shells = state.shells.filter(sh => sh.t < sh.tt);
}

export function missilesStep(dt, state, inLand) {
  for (const m of state.missiles) {
    m.ttl -= dt;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.ttl > 0 && inLand(m.x, m.y, MISSILE.radius)) m.ttl = 0;
  }
  for (const m of state.missiles) {
    if (m.ttl <= 0) continue;
    const targets = (m.team === 'P') ? state.enemy : state.player;
    for (const t of targets) {
      if (!t.alive) continue;
      const r = t.kind.radius + MISSILE.radius;
      if (dist2(m.x, m.y, t.x, t.y) <= r*r) {
        m.ttl = 0;
        state.fx.push({ type: 'boom', x: m.x, y: m.y, until: state.time + FX.boomTtl });
        damageShip(t, m.dmg, 'torpedo', state);
        if (t.alive) t.flooding = true;
        break;
      }
    }
  }
  state.missiles = state.missiles.filter(m => m.ttl > 0 && m.x >= -140 && m.y >= -140 && m.x <= state.WORLD_W + 140 && m.y <= state.WORLD_H + 140);
}

export function smokesStep(state) { 
  state.smokes = state.smokes.filter(s => state.time <= s.until); 
}

export function fxStep(state) { 
  state.fx = state.fx.filter(f => state.time <= f.until); 
}
