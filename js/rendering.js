// ═══════════════════════════════════════════════════════════════════════════
// RENDERING MODULE - All canvas drawing functions
// ═══════════════════════════════════════════════════════════════════════════

import { 
  TAU, VIEW, WORLD, FX, RADAR_RANGE, MAX_RUDDER_ANGLE, mapById, ESCORT_LOCK_RADIUS 
} from './config.js';
import { clamp, lerp, dist2 } from './utils.js';

// Texture patterns
let WATER_TEX = { pattern: null };
let LAND = { pattern: null };
let WATER = { t: 0 };

// ═══════════════════════════════════════════════════════════════════════════
// TEXTURE GENERATION
// ═══════════════════════════════════════════════════════════════════════════
export function makeDetailedWaterPattern(ctx) {
  const oc = document.createElement('canvas');
  oc.width = oc.height = 256;
  const o = oc.getContext('2d');
  const grad = o.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, 'rgba(8,60,120,0.4)');
  grad.addColorStop(0.5, 'rgba(15,90,150,0.35)');
  grad.addColorStop(1, 'rgba(5,50,100,0.4)');
  o.fillStyle = grad;
  o.fillRect(0, 0, 256, 256);
  const img = o.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 20;
    img.data[i+0] = clamp(img.data[i+0] + n, 0, 255);
    img.data[i+1] = clamp(img.data[i+1] + n * 1.2, 0, 255);
    img.data[i+2] = clamp(img.data[i+2] + n * 0.8, 0, 255);
  }
  o.putImageData(img, 0, 0);
  return ctx.createPattern(oc, 'repeat');
}

export function makeDetailedLandPattern(ctx) {
  const oc = document.createElement('canvas');
  oc.width = oc.height = 128;
  const o = oc.getContext('2d');
  o.fillStyle = 'rgb(45,95,55)';
  o.fillRect(0, 0, 128, 128);
  const img = o.getImageData(0, 0, 128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const px = (i/4) % 128;
    const py = Math.floor((i/4) / 128);
    const n1 = Math.sin(px * 0.15) * Math.cos(py * 0.12) * 15;
    const n2 = (Math.random() - 0.5) * 25;
    img.data[i+0] = clamp(img.data[i+0] + n1 + n2 * 0.6, 20, 80);
    img.data[i+1] = clamp(img.data[i+1] + n1 * 1.3 + n2, 60, 140);
    img.data[i+2] = clamp(img.data[i+2] + n1 * 0.5 + n2 * 0.4, 30, 90);
    img.data[i+3] = 180 + Math.random() * 75;
  }
  o.putImageData(img, 0, 0);
  return ctx.createPattern(oc, 'repeat');
}

export function initPatterns(ctx) {
  WATER_TEX.pattern = makeDetailedWaterPattern(ctx);
  LAND.pattern = makeDetailedLandPattern(ctx);
}

export function updateWaterTime(dt) {
  WATER.t += dt;
}

export function getWaterTime() {
  return WATER.t;
}


// ═══════════════════════════════════════════════════════════════════════════
// WATER RENDERING
// ═══════════════════════════════════════════════════════════════════════════
export function waterBackground(ctx) {
  const t = WATER.t;
  
  const g = ctx.createLinearGradient(0, 0, VIEW.w * 0.3, VIEW.h);
  g.addColorStop(0, 'rgb(12,65,130)');
  g.addColorStop(0.25, 'rgb(18,95,165)');
  g.addColorStop(0.5, 'rgb(25,120,180)');
  g.addColorStop(0.75, 'rgb(15,85,155)');
  g.addColorStop(1, 'rgb(8,55,115)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 12; i++) {
    const phase = t * 0.3 + i * 0.52;
    const x = (Math.sin(phase * 0.7 + i) * 0.5 + 0.5) * VIEW.w;
    const y = (Math.cos(phase * 0.5 + i * 1.3) * 0.5 + 0.5) * VIEW.h;
    const r = 80 + 60 * Math.sin(phase);
    const cg = ctx.createRadialGradient(x, y, 0, x, y, r);
    cg.addColorStop(0, 'rgba(100,200,220,0.3)');
    cg.addColorStop(0.5, 'rgba(60,160,200,0.15)');
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  ctx.restore();

  if (WATER_TEX.pattern) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.translate(((t * 12) % 256) - 256, ((t * 8) % 256) - 256);
    ctx.fillStyle = WATER_TEX.pattern;
    ctx.fillRect(0, 0, VIEW.w + 512, VIEW.h + 512);
    ctx.restore();
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const x = (Math.sin(t*0.12 + i*2.1) * 0.5 + 0.5) * VIEW.w;
    const y = (Math.cos(t*0.10 + i*1.7) * 0.5 + 0.5) * VIEW.h;
    const r = 180 + 100*Math.sin(t*0.18 + i);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(180,230,255,0.12)');
    rg.addColorStop(0.6, 'rgba(120,200,240,0.06)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1.2;
  for (let y = -30; y < VIEW.h + 30; y += 16) {
    const phase = t * 1.4 + y * 0.018;
    const isMain = y % 32 === 0;
    ctx.strokeStyle = isMain ? 'rgba(200,240,255,0.35)' : 'rgba(150,210,240,0.20)';
    ctx.beginPath();
    for (let x = -20; x <= VIEW.w + 20; x += 12) {
      const wob = Math.sin(phase + x * 0.015) * 3.5 + Math.sin(phase * 0.6 + x * 0.025) * 2;
      const yy = y + wob;
      if (x === -20) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = 'rgba(200,240,255,0.25)';
  ctx.lineWidth = 0.8;
  for (let i = -VIEW.h; i < VIEW.w + VIEW.h; i += 35) {
    const o = (t * 20) % 35;
    ctx.beginPath();
    ctx.moveTo(i - o, 0);
    ctx.lineTo(i - o + VIEW.h * 0.7, VIEW.h);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.15;
  for (let i = 0; i < 8; i++) {
    const seed = i * 137.5;
    const x = ((Math.sin(t * 0.08 + seed) + 1) * 0.5) * VIEW.w;
    const y = ((Math.cos(t * 0.06 + seed * 0.7) + 1) * 0.5) * VIEW.h;
    const size = 3 + Math.sin(t * 0.5 + i) * 2;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.arc(x, y, size, 0, TAU); ctx.fill();
  }
  ctx.restore();

  ctx.save();
  const vg = ctx.createRadialGradient(VIEW.w/2, VIEW.h/2, 150, VIEW.w/2, VIEW.h/2, Math.max(VIEW.w, VIEW.h)*0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.7, 'rgba(0,20,50,0.15)');
  vg.addColorStop(1, 'rgba(0,10,30,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.restore();
}


// ═══════════════════════════════════════════════════════════════════════════
// LAND RENDERING
// ═══════════════════════════════════════════════════════════════════════════
function islandR(c, a, extra) {
  const r0 = c.r + (extra || 0);
  const s1 = Math.sin(a * 3 + (c.x + c.y) * 0.0021);
  const s2 = Math.sin(a * 7 + (c.x - c.y) * 0.0017);
  const s3 = Math.sin(a * 11 + (c.x * 0.0013));
  const wob = 1 + 0.115 * s1 + 0.070 * s2 + 0.035 * s3;
  return Math.max(8, r0 * wob);
}

function islandPath(ctx, c, extra) {
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const r = islandR(c, a, extra);
    const x = c.x + Math.cos(a) * r;
    const y = c.y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function drawLand(ctx, camX, camY, state) {
  const m = mapById(state.mapId);
  ctx.save();
  ctx.translate(-camX, -camY);
  
  for (const c of m.land) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    const deepShallow = ctx.createRadialGradient(c.x, c.y, c.r * 0.8, c.x, c.y, c.r + 80);
    deepShallow.addColorStop(0, 'rgba(0,0,0,0)');
    deepShallow.addColorStop(0.3, 'rgba(40,180,190,0.15)');
    deepShallow.addColorStop(0.6, 'rgba(60,200,200,0.25)');
    deepShallow.addColorStop(1, 'rgba(80,210,210,0.35)');
    ctx.fillStyle = deepShallow;
    ctx.beginPath(); islandPath(ctx, c, 80); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.55;
    const shallow = ctx.createRadialGradient(c.x, c.y, c.r - 10, c.x, c.y, c.r + 50);
    shallow.addColorStop(0, 'rgba(0,0,0,0)');
    shallow.addColorStop(0.4, 'rgba(100,220,210,0.20)');
    shallow.addColorStop(0.7, 'rgba(120,230,220,0.30)');
    shallow.addColorStop(1, 'rgba(140,235,225,0.35)');
    ctx.fillStyle = shallow;
    ctx.beginPath(); islandPath(ctx, c, 50); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.7;
    const beach = ctx.createRadialGradient(c.x, c.y, c.r - 8, c.x, c.y, c.r + 20);
    beach.addColorStop(0, 'rgba(0,0,0,0)');
    beach.addColorStop(0.5, 'rgba(240,225,180,0.25)');
    beach.addColorStop(0.75, 'rgba(250,235,195,0.45)');
    beach.addColorStop(1, 'rgba(255,245,210,0.55)');
    ctx.fillStyle = beach;
    ctx.beginPath(); islandPath(ctx, c, 20); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath(); islandPath(ctx, c, 0); ctx.clip();
    
    ctx.globalAlpha = 1;
    const landBase = ctx.createRadialGradient(c.x - c.r*0.2, c.y - c.r*0.2, 0, c.x, c.y, c.r * 1.2);
    landBase.addColorStop(0, 'rgb(65,130,70)');
    landBase.addColorStop(0.5, 'rgb(50,110,55)');
    landBase.addColorStop(1, 'rgb(35,85,45)');
    ctx.fillStyle = landBase;
    ctx.fillRect(c.x - c.r - 20, c.y - c.r - 20, (c.r + 20) * 2, (c.r + 20) * 2);

    if (LAND.pattern) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = LAND.pattern;
      ctx.translate(c.x, c.y);
      ctx.rotate(0.15 + c.x * 0.001);
      ctx.fillRect(-c.r - 100, -c.r - 100, (c.r + 100) * 2, (c.r + 100) * 2);
      ctx.setTransform(1,0,0,1,-camX,-camY);
    }

    ctx.globalAlpha = 0.4;
    const hillShade = ctx.createRadialGradient(c.x - c.r*0.3, c.y - c.r*0.3, c.r*0.1, c.x + c.r*0.2, c.y + c.r*0.2, c.r*1.1);
    hillShade.addColorStop(0, 'rgba(180,220,160,0.35)');
    hillShade.addColorStop(0.4, 'rgba(100,160,90,0.15)');
    hillShade.addColorStop(0.7, 'rgba(40,80,40,0.20)');
    hillShade.addColorStop(1, 'rgba(20,50,25,0.30)');
    ctx.fillStyle = hillShade;
    ctx.fillRect(c.x - c.r - 20, c.y - c.r - 20, (c.r + 20) * 2, (c.r + 20) * 2);

    ctx.globalAlpha = 0.32;
    const treeCount = Math.floor(c.r / 18);
    for (let i = 0; i < treeCount; i++) {
      let u = Math.sin((c.x * 0.017) + (c.y * 0.023) + i * 1.77) * 43758.5453;
      u = u - Math.floor(u);
      let v = Math.sin((c.x * 0.031) - (c.y * 0.019) + i * 2.31) * 12345.678;
      v = v - Math.floor(v);
      const angle = u * TAU + c.x * 0.001;
      const dist = c.r * (0.22 + v * 0.55);
      const tx = c.x + Math.cos(angle) * dist;
      const ty = c.y + Math.sin(angle) * dist;
      const tr = 7 + (u * 6);
      ctx.fillStyle = 'rgba(25,70,30,0.42)';
      ctx.beginPath();
      ctx.moveTo(tx, ty - tr);
      ctx.lineTo(tx - tr*0.75, ty + tr*0.65);
      ctx.lineTo(tx + tr*0.75, ty + tr*0.65);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 12]);
    ctx.lineDashOffset = -state.time * 35;
    ctx.beginPath(); islandPath(ctx, c, 6); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = 'rgba(220,250,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 15]);
    ctx.lineDashOffset = -state.time * 25 + 10;
    ctx.beginPath(); islandPath(ctx, c, 12); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(8, 10);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); islandPath(ctx, c, 3); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = 'rgba(30,60,30,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath(); islandPath(ctx, c, 0); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}


// ═══════════════════════════════════════════════════════════════════════════
// SHIP RENDERING
// ═══════════════════════════════════════════════════════════════════════════
export function getShipScale(ship) {
  switch (ship.kind.type) {
    case 'CV': return 2.0;
    case 'BB': return 1.7;
    case 'DD': return 1.0;
    case 'TB': return 0.7;
    default: return 1.0;
  }
}

export function drawTrail(ctx, ship, camX, camY, state) {
  if (!ship.trail || ship.trail.length < 2) return;
  const scale = getShipScale(ship);
  ctx.save();
  ctx.translate(-camX, -camY);
  const baseAlpha = 0.26 + scale * 0.05;
  ctx.strokeStyle = ship.team === 'P' ? 'rgba(200,250,255,0.75)' : 'rgba(255,220,220,0.70)';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4 + scale * 3;
  for (let i = 1; i < ship.trail.length; i++) {
    const a = ship.trail[i-1];
    const b = ship.trail[i];
    const age = state.time - b.t;
    const alpha = baseAlpha * clamp(1 - age / 5.2, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

export function drawWake(ctx, ship, camX, camY) {
  if (!ship.alive) return;
  const sp = Math.hypot(ship.vx, ship.vy);
  const intensity = clamp(sp / ship.kind.maxSpeed, 0, 1);
  if (intensity < 0.06) return;
  
  const rudder = ship.rudderAngle || 0;
  const rudderNorm = rudder / MAX_RUDDER_ANGLE;
  const shipScale = getShipScale(ship);
  
  ctx.save();
  ctx.translate(ship.x - camX, ship.y - camY);
  ctx.rotate(ship.heading);
  ctx.globalAlpha = (0.14 + shipScale * 0.04) + (0.28 + shipScale * 0.04) * intensity;
  ctx.fillStyle = 'rgba(245,255,255,0.62)';
  const scale = shipScale * 1.1;
  
  ctx.beginPath();
  ctx.moveTo(-10*scale, 0);
  ctx.quadraticCurveTo(-35*scale, -14*scale, -78*scale, -26*scale);
  ctx.quadraticCurveTo(-52*scale, -8*scale, -92*scale, 0);
  ctx.quadraticCurveTo(-52*scale, 8*scale, -78*scale, 26*scale);
  ctx.quadraticCurveTo(-35*scale, 14*scale, -10*scale, 0);
  ctx.closePath();
  ctx.fill();
  
  if (Math.abs(rudder) > 0.02) {
    ctx.globalAlpha = 0.4 + 0.4 * Math.abs(rudderNorm);
    ctx.strokeStyle = rudder > 0 ? 'rgba(100,255,100,0.8)' : 'rgba(255,100,100,0.8)';
    ctx.lineWidth = 2 + scale;
    ctx.lineCap = 'round';
    
    const arrowLen = 25 * scale * Math.abs(rudderNorm);
    const bowX = 15 * scale;
    const turnY = rudderNorm * 20 * scale;
    
    ctx.beginPath();
    ctx.moveTo(bowX, 0);
    ctx.lineTo(bowX + arrowLen, turnY);
    ctx.stroke();
    
    const headLen = 8 * scale * Math.abs(rudderNorm);
    const headAngle = Math.atan2(turnY, arrowLen);
    ctx.beginPath();
    ctx.moveTo(bowX + arrowLen, turnY);
    ctx.lineTo(bowX + arrowLen - headLen * Math.cos(headAngle - 0.5), turnY - headLen * Math.sin(headAngle - 0.5));
    ctx.moveTo(bowX + arrowLen, turnY);
    ctx.lineTo(bowX + arrowLen - headLen * Math.cos(headAngle + 0.5), turnY - headLen * Math.sin(headAngle + 0.5));
    ctx.stroke();
  }
  
  ctx.restore();
}

export function drawShip(ctx, ship, camX, camY, selected, state) {
  const x = ship.x - camX, y = ship.y - camY;
  ctx.save();
  ctx.translate(x, y);
  let blink = false;
  if (ship.team === 'E') blink = ship.detP && (state.time < ship.blinkUntilP);
  const blinkGate = blink ? (Math.sin(state.time * 18) > 0 ? 1 : 0.12) : 1;
  
  const shipScale = getShipScale(ship);
  
  if (ship.kind.gunRange > 0) {
    ctx.save();
    ctx.rotate(ship.turret);
    ctx.globalAlpha = (ship.alive ? 1.0 : 0.35) * blinkGate;
    ctx.strokeStyle = 'rgba(255,255,255,0.34)';
    ctx.lineWidth = 2 + shipScale * 1.5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(25 * shipScale, 0); ctx.stroke();
    ctx.restore();
  }
  
  const fontSize = Math.round(18 * shipScale);
  ctx.font = `${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = (ship.alive ? 1.0 : 0.35) * blinkGate;
  ctx.fillText((ship.kind.type === 'BB' || ship.kind.type === 'CV') ? '🛳️' : (ship.kind.type === 'TB' ? '🛥️' : '🚢'), 0, 0);
  ctx.globalAlpha = 1;
  
  const tagOffset = -18 * shipScale - 8;
  ctx.font = '12px system-ui';
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.globalAlpha = blinkGate;
  ctx.fillText(ship.tag, 0, tagOffset);
  ctx.globalAlpha = 1;
  
  if (ship.alive) {
    let st = '';
    if (ship.onFire) st += '🔥';
    if (ship.flooding) st += '💧';
    if (st) {
      ctx.globalAlpha = 0.95 * blinkGate;
      const statusFontSize = Math.round(12 + shipScale * 3);
      ctx.font = `${statusFontSize}px "Segoe UI Emoji", "Apple Color Emoji", system-ui`;
      ctx.fillText(st, 0, tagOffset - 18);
      ctx.globalAlpha = 1;
    }
  }
  
  if (selected) {
    ctx.strokeStyle = 'rgba(255,255,255,0.38)';
    ctx.lineWidth = 2;
    const selRadius = 14 * shipScale + 5;
    ctx.beginPath(); ctx.arc(0, 0, selRadius, 0, TAU); ctx.stroke();
  }
  
  const hpW = 30 * shipScale + 10;
  const hpH = 5 + shipScale;
  const hpY = -14 * shipScale - 30; // Moved higher to avoid overlap with name
  ctx.translate(-hpW/2, hpY);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(0, 0, hpW, hpH);
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.fillRect(0, 0, hpW * (ship.hp / ship.kind.hp), hpH);
  ctx.restore();
}


// ═══════════════════════════════════════════════════════════════════════════
// PROJECTILE & EFFECT RENDERING
// ═══════════════════════════════════════════════════════════════════════════
export function drawShell(ctx, sh, camX, camY) {
  ctx.save();
  ctx.translate(sh.x - camX, sh.y - camY);
  ctx.fillStyle = (sh.team === 'P') ? 'rgba(215,245,255,0.95)' : 'rgba(255,215,215,0.95)';
  ctx.shadowColor = 'rgba(255,255,255,0.20)';
  ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, TAU); ctx.fill();
  ctx.restore();
}

export function drawMissile(ctx, m, camX, camY, state) {
  ctx.save();
  ctx.translate(m.x - camX, m.y - camY);
  ctx.rotate(m.a);
  ctx.save();
  ctx.globalAlpha = 0.62;
  ctx.strokeStyle = 'rgba(210,245,255,0.58)';
  ctx.lineWidth = 2.6;
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = -state.time * 40;
  ctx.beginPath(); ctx.moveTo(-88, 0); ctx.lineTo(-12, 0); ctx.stroke();
  ctx.restore();
  ctx.font = '18px "Segoe UI Emoji", "Apple Color Emoji", system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.95;
  ctx.fillText('🐟', 0, 0);
  ctx.restore();
}

export function drawSmoke(ctx, sm, camX, camY, state) {
  const t = clamp((sm.until - state.time) / (sm.until - sm.born), 0, 1);
  ctx.save();
  ctx.translate(sm.x - camX, sm.y - camY);
  ctx.globalAlpha = 0.60 * t;
  ctx.font = '22px "Segoe UI Emoji", "Apple Color Emoji", system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const wob = Math.sin(state.time*3.0) * 3;
  ctx.fillText('💨', -18 + wob, -8);
  ctx.fillText('💨',  16,  4 + wob*0.5);
  ctx.fillText('💨',   0,  18 - wob*0.4);
  ctx.fillText('💨',  20, -18);
  ctx.fillText('💨', -24,  18);
  ctx.restore();
}

export function drawFx(ctx, f, camX, camY, state) {
  if (f.type === 'planeCrash') {
    // Animated falling plane crash with emoji trail
    const elapsed = 1.5 - (f.until - state.time);
    const t = clamp((f.until - state.time) / 1.5, 0, 1);
    const x = f.x + (f.vx || 0) * elapsed - camX;
    const y = f.y + (f.vy || 0) * elapsed + elapsed * elapsed * 80 - camY;
    
    ctx.save();
    // Draw smoke/fire trail behind the plane
    for (let i = 0; i < 5; i++) {
      const trailT = elapsed - i * 0.08;
      if (trailT < 0) continue;
      const tx = f.x + (f.vx || 0) * trailT - camX;
      const ty = f.y + (f.vy || 0) * trailT + trailT * trailT * 80 - camY;
      ctx.globalAlpha = t * (0.7 - i * 0.12);
      ctx.font = `${16 - i * 2}px "Segoe UI Emoji", "Apple Color Emoji", system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(i % 2 === 0 ? '🔥' : '☁️', tx, ty);
    }
    
    // Draw the crashing plane
    ctx.translate(x, y);
    ctx.rotate(elapsed * 4); // Spinning faster
    ctx.globalAlpha = t;
    ctx.font = '18px "Segoe UI Emoji", "Apple Color Emoji", system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✈️', 0, 0);
    
    // Final explosion at end
    if (t < 0.2) {
      ctx.globalAlpha = (0.2 - t) * 5;
      ctx.font = '28px "Segoe UI Emoji", "Apple Color Emoji", system-ui';
      ctx.fillText('💥', 0, 0);
    }
    ctx.restore();
    return;
  }
  if (f.type === 'boom') {
    const t = clamp((f.until - state.time) / FX.boomTtl, 0, 1);
    ctx.save();
    ctx.translate(f.x - camX, f.y - camY);
    ctx.globalAlpha = 0.80 * t;
    ctx.font = `${Math.round(28 + (1-t)*12)}px "Segoe UI Emoji", "Apple Color Emoji", system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💥', 0, 0);
    ctx.restore();
    return;
  }
  const t = clamp((f.until - state.time) / (f.type === 'splash' ? FX.splashTtl : FX.hitTtl), 0, 1);
  ctx.save();
  ctx.translate(f.x - camX, f.y - camY);
  if (f.type === 'splash') {
    ctx.globalAlpha = 0.35 * t;
    ctx.strokeStyle = 'rgba(180,220,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, lerp(10, 40, 1-t), 0, TAU); ctx.stroke();
  } else {
    ctx.globalAlpha = 0.50 * t;
    ctx.fillStyle = 'rgba(255,240,190,0.9)';
    ctx.beginPath(); ctx.arc(0, 0, lerp(8, 18, 1-t), 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════
// AIRCRAFT & BATTERY RENDERING
// ═══════════════════════════════════════════════════════════════════════════
export function drawRecon(ctx, camX, camY, state) {
  const drawOne = (r) => {
    if (!r) return;
    // In normal mode, only show player recons or detected enemy recons
    if (!state.spectatorMode && r.team === 'E') {
      // Check if any player ship can see this recon
      let visible = false;
      for (const p of (state.player || [])) {
        if (!p || !p.alive) continue;
        if (dist2(r.x, r.y, p.x, p.y) <= RADAR_RANGE * RADAR_RANGE) {
          visible = true;
          break;
        }
      }
      if (!visible) return;
    }
    const x = r.x - camX, y = r.y - camY;
    if (x < -80 || y < -80 || x > VIEW.w + 80 || y > VIEW.h + 80) return;
    ctx.save();
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = (r.team === 'P') ? 'rgba(80,170,255,0.85)' : 'rgba(255,60,60,0.85)';
    ctx.beginPath(); ctx.arc(x, y, 18, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.85;
    if (r.team === 'P') {
      ctx.strokeStyle = 'rgba(80,170,255,0.85)';
      ctx.lineWidth = 3.0;
      ctx.beginPath(); ctx.arc(x, y, 18, 0, TAU); ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255,60,60,0.90)';
      ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.arc(x, y, 18, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.90)';
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(x, y, 14, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 0.95;
    ctx.font = '22px system-ui, Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 6;
    ctx.fillText('🛩️', x, y);
    ctx.restore();
  };
  if (!state.recons) return;
  for (const r of state.recons) drawOne(r);
}

export function drawAircraft(ctx, camX, camY, state) {
  for (const a of state.aircraft) {
    // In normal mode, only show player aircraft or detected enemy aircraft
    if (!state.spectatorMode && a.team === 'E') {
      let visible = false;
      for (const p of (state.player || [])) {
        if (!p || !p.alive) continue;
        if (dist2(a.x, a.y, p.x, p.y) <= RADAR_RANGE * RADAR_RANGE) {
          visible = true;
          break;
        }
      }
      if (!visible) continue;
    }
    const x = a.x - camX, y = a.y - camY;
    if (x < -60 || y < -60 || x > VIEW.w + 60 || y > VIEW.h + 60) continue;
    ctx.save();
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = (a.team === 'P') ? 'rgba(80,170,255,0.85)' : 'rgba(255,60,60,0.85)';
    ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.85;
    if (a.team === 'P') {
      ctx.strokeStyle = 'rgba(80,170,255,0.85)';
      ctx.lineWidth = 3.0;
      ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255,60,60,0.90)';
      ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.90)';
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(x, y, 12.5, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 0.95;
    ctx.font = '18px system-ui, Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 6;
    ctx.fillText('✈️', x, y);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

export function drawBullets(ctx, camX, camY, state) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of state.bullets) {
    const x = b.x - camX, y = b.y - camY;
    if (x < -40 || y < -40 || x > VIEW.w + 40 || y > VIEW.h + 40) continue;
    ctx.globalAlpha = 0.80;
    if (b.team === 'P') {
      ctx.fillStyle = 'rgba(120,200,255,0.95)';
      ctx.shadowColor = 'rgba(80,170,255,0.70)';
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.shadowColor = 'rgba(255,60,60,0.70)';
    }
    ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(x, y, 1.8, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

export function drawBatteries(ctx, camX, camY, state) {
  for (const b of state.batteries) {
    if (!b.alive) continue;
    if (!state.spectatorMode && b.team === 'E' && !b.detP) continue;
    const x = b.x - camX, y = b.y - camY;
    if (x < -60 || y < -60 || x > VIEW.w + 60 || y > VIEW.h + 60) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = 'rgba(18,18,18,0.72)';
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.85;
    if (b.team === 'P') {
      ctx.strokeStyle = 'rgba(80,170,255,0.85)';
      ctx.lineWidth = 2.8;
      ctx.beginPath(); ctx.arc(0, 0, 11.5, 0, TAU); ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255,60,60,0.90)';
      ctx.lineWidth = 3.0;
      ctx.beginPath(); ctx.arc(0, 0, 11.5, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.90)';
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(0, 0, 8.8, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = 'rgba(240,240,240,0.70)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(b.turret) * 16, Math.sin(b.turret) * 16);
    ctx.stroke();
    ctx.restore();
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// RADAR & UI RENDERING
// ═══════════════════════════════════════════════════════════════════════════
export function drawRadarSweepOverlay(ctx, camX, camY, state) {
  const sel = state.player[state.selected];
  if (!sel || !sel.alive) return;
  const x = sel.x - camX, y = sel.y - camY;
  const hasContact = state.enemy.some(e => e.alive && e.detP);
  if (hasContact) return;
  const a = state.time * 1.65;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 0.70;
  ctx.strokeStyle = 'rgba(90,255,140,0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, RADAR_RANGE, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = 'rgba(90,255,140,0.32)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * RADAR_RANGE, Math.sin(a) * RADAR_RANGE); ctx.stroke();
  ctx.restore();
}

// Radar/minimap bounds for click detection
export const RADAR_BOUNDS = { x: 16, y: 84, w: 150, h: 100 };

// Convert minimap click to world coordinates
export function minimapToWorld(mx, my) {
  const rx = RADAR_BOUNDS.x, ry = RADAR_BOUNDS.y, rw = RADAR_BOUNDS.w, rh = RADAR_BOUNDS.h;
  if (mx < rx || mx > rx + rw || my < ry || my > ry + rh) return null;
  const worldX = ((mx - rx) / rw) * WORLD.w;
  const worldY = ((my - ry) / rh) * WORLD.h;
  return { x: worldX, y: worldY };
}

export function drawRadar(ctx, state) {
  const rx = RADAR_BOUNDS.x, ry = RADAR_BOUNDS.y, rw = RADAR_BOUNDS.w, rh = RADAR_BOUNDS.h;
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.fillRect(rx, ry, rw, rh);
  ctx.strokeRect(rx, ry, rw, rh);
  const toR = (x, y) => ({ x: rx + (x / WORLD.w) * rw, y: ry + (y / WORLD.h) * rh });
  const rs = ((rw + rh) * 0.5) / ((WORLD.w + WORLD.h) * 0.5);
  const m = mapById(state.mapId);
  
  // In spectator mode, no fog of war - skip the grey overlay
  if (!state.spectatorMode) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = 'rgba(60,60,80,0.7)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.restore();
    
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (const p of state.player) {
      if (!p.alive) continue;
      const q = toR(p.x, p.y);
      const visionR = Math.max(3, RADAR_RANGE * rs);
      ctx.beginPath();
      ctx.arc(q.x, q.y, visionR, 0, TAU);
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fill();
    }
    // Coastal batteries clear fog of war based on their gun range
    for (const b of state.batteries) {
      if (!b.alive || b.team !== 'P') continue;
      const q = toR(b.x, b.y);
      const batteryVision = b.kind.gunRange || RADAR_RANGE;
      const visionR = Math.max(3, batteryVision * rs);
      ctx.beginPath();
      ctx.arc(q.x, q.y, visionR, 0, TAU);
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fill();
    }
    const AIRCRAFT_VISION = RADAR_RANGE * 1.2;
    for (const a of state.aircraft) {
      if (a.team !== 'P' || a.ttl <= 0 || a.hp <= 0) continue;
      const q = toR(a.x, a.y);
      const visionR = Math.max(2, AIRCRAFT_VISION * rs);
      ctx.beginPath();
      ctx.arc(q.x, q.y, visionR, 0, TAU);
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fill();
    }
    for (const r of (state.recons || [])) {
      if (!r || r.team !== 'P') continue;
      const q = toR(r.x, r.y);
      const visionR = Math.max(2, AIRCRAFT_VISION * rs);
      ctx.beginPath();
      ctx.arc(q.x, q.y, visionR, 0, TAU);
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fill();
    }
    ctx.restore();
  }
  
  // Draw islands clearly on minimap - always visible
  ctx.save();
  ctx.globalAlpha = 1.0;
  for (const c of m.land) {
    const q = toR(c.x, c.y);
    const r = Math.max(2, c.r * rs);
    // Dark green fill
    ctx.fillStyle = 'rgba(40,80,40,0.95)';
    ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, TAU); ctx.fill();
    // Light border
    ctx.strokeStyle = 'rgba(120,180,120,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, TAU); ctx.stroke();
  }
  ctx.restore();
  
  for (const p of state.player) {
    if (!p.alive) continue;
    const q = toR(p.x, p.y);
    ctx.fillStyle = p.kind.type === 'BB' ? 'rgba(200,250,255,0.95)' : (p.kind.type === 'CV' ? 'rgba(180,220,255,0.95)' : 'rgba(90,200,255,0.85)');
    ctx.fillRect(q.x-2, q.y-2, 4, 4);
  }
  // In spectator mode, show ALL enemy ships
  for (const e of state.enemy) {
    if (!e.alive) continue;
    if (!state.spectatorMode && !e.detP) continue;
    const q = toR(e.x, e.y);
    ctx.fillStyle = e.kind.type === 'BB' ? 'rgba(255,220,220,0.95)' : 'rgba(255,130,130,0.85)';
    ctx.fillRect(q.x-2, q.y-2, 4, 4);
  }
  for (const b of state.batteries) {
    if (!b.alive) continue;
    if (!state.spectatorMode && b.team === 'E' && !b.detP) continue;
    const q = toR(b.x, b.y);
    ctx.fillStyle = (b.team === 'P') ? 'rgba(170,210,255,0.90)' : 'rgba(255,200,200,0.90)';
    ctx.fillRect(q.x-2, q.y-2, 4, 4);
  }
  for (const a of state.aircraft) {
    if (a.ttl <= 0 || a.hp <= 0) continue;
    // In spectator mode, show all aircraft; otherwise only player aircraft
    if (!state.spectatorMode && a.team !== 'P') continue;
    const q = toR(a.x, a.y);
    ctx.fillStyle = (a.team === 'P') ? 'rgba(120,180,255,0.8)' : 'rgba(255,120,120,0.8)';
    ctx.beginPath(); ctx.arc(q.x, q.y, 2, 0, TAU); ctx.fill();
  }
  for (const r of (state.recons || [])) {
    if (!r) continue;
    // In spectator mode, show all recons; otherwise only player recons
    if (!state.spectatorMode && r.team !== 'P') continue;
    const q = toR(r.x, r.y);
    ctx.fillStyle = (r.team === 'P') ? 'rgba(100,200,255,0.8)' : 'rgba(255,150,150,0.8)';
    ctx.beginPath(); ctx.arc(q.x, q.y, 2, 0, TAU); ctx.fill();
  }
  
  // Draw commander's planned path on minimap
  for (const p of state.player) {
    if (!p.isCommander || !p.alive) continue;
    if (p.plannedPath && p.plannedPath.length > 0) {
      ctx.strokeStyle = 'rgba(255,255,100,0.8)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const start = toR(p.x, p.y);
      ctx.moveTo(start.x, start.y);
      for (const wp of p.plannedPath) {
        const pt = toR(wp.x, wp.y);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
      // Draw waypoint dots
      ctx.fillStyle = 'rgba(255,255,100,0.9)';
      for (const wp of p.plannedPath) {
        const pt = toR(wp.x, wp.y);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2, 0, TAU);
        ctx.fill();
      }
      ctx.setLineDash([]);
    }
  }
  
  // Draw enemy commander path in spectator mode
  if (state.spectatorMode) {
    for (const e of state.enemy) {
      if (!e.isCommander || !e.alive) continue;
      if (e.plannedPath && e.plannedPath.length > 0) {
        ctx.strokeStyle = 'rgba(255,150,150,0.8)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        const start = toR(e.x, e.y);
        ctx.moveTo(start.x, start.y);
        for (const wp of e.plannedPath) {
          const pt = toR(wp.x, wp.y);
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
  
  ctx.restore();
}

// Draw commander's planned path on main view
function drawCommanderPath(ctx, camX, camY, state) {
  for (const p of state.player) {
    if (!p.isCommander || !p.alive) continue;
    if (p.plannedPath && p.plannedPath.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,100,0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(p.x - camX, p.y - camY);
      for (const wp of p.plannedPath) {
        ctx.lineTo(wp.x - camX, wp.y - camY);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Draw waypoint markers
      ctx.fillStyle = 'rgba(255,255,100,0.5)';
      for (const wp of p.plannedPath) {
        ctx.beginPath();
        ctx.arc(wp.x - camX, wp.y - camY, 5, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  
  // Also draw for enemy commander in spectator mode
  if (state.spectatorMode) {
    for (const e of state.enemy) {
      if (!e.isCommander || !e.alive) continue;
      if (e.plannedPath && e.plannedPath.length > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,150,150,0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(e.x - camX, e.y - camY);
        for (const wp of e.plannedPath) {
          ctx.lineTo(wp.x - camX, wp.y - camY);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }
}

// Draw commander marker (star icon)
function drawCommanderMarker(ctx, ship, camX, camY) {
  if (!ship.isCommander || !ship.alive) return;
  const sx = ship.x - camX, sy = ship.y - camY;
  
  ctx.save();
  ctx.fillStyle = 'rgba(255,215,0,0.9)';
  ctx.font = '14px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('★', sx, sy - ship.kind.radius - 8);
  ctx.restore();
}

// Draw escort trajectories (DD/TB target waypoints) - for debugging
function drawEscortTrajectories(ctx, camX, camY, state) {
  if (!state.spectatorMode) return; // Only show in spectator mode
  
  const drawTrajectory = (ship, color, lockColor, avoidColor) => {
    if (!ship.alive) return;
    if (ship.kind.type !== 'DD' && ship.kind.type !== 'TB') return;
    if (!ship.targetWaypoint) return;
    
    const sx = ship.x - camX, sy = ship.y - camY;
    const tx = ship.targetWaypoint.x - camX, ty = ship.targetWaypoint.y - camY;
    
    ctx.save();
    
    // Draw avoidance path if exists (polyline around ships)
    if (ship.avoidancePath && ship.avoidancePath.length > 0) {
      ctx.strokeStyle = avoidColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      for (const wp of ship.avoidancePath) {
        ctx.lineTo(wp.x - camX, wp.y - camY);
      }
      ctx.lineTo(tx, ty);
      ctx.stroke();
      
      // Draw waypoint markers
      ctx.fillStyle = avoidColor;
      ctx.setLineDash([]);
      for (const wp of ship.avoidancePath) {
        ctx.beginPath();
        ctx.arc(wp.x - camX, wp.y - camY, 3, 0, TAU);
        ctx.fill();
      }
    }
    
    // Draw lock radius circle around target waypoint
    ctx.strokeStyle = lockColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(tx, ty, ESCORT_LOCK_RADIUS, 0, TAU);
    ctx.stroke();
    
    // Draw unlock radius (1.5x lock radius)
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.arc(tx, ty, ESCORT_LOCK_RADIUS * 1.5, 0, TAU);
    ctx.stroke();
    
    // Draw direct trajectory line (dimmer if avoidance path exists)
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.globalAlpha = ship.avoidancePath && ship.avoidancePath.length > 0 ? 0.3 : 0.6;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    
    // Draw target marker
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(tx, ty, 4, 0, TAU);
    ctx.fill();
    
    // Draw escort position number and lock status
    ctx.fillStyle = 'white';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.9;
    const lockStatus = ship.escortLocked ? '🔒' : '';
    const label = ship.escortPosition !== null && ship.escortPosition !== undefined 
      ? `E${ship.escortPosition}${lockStatus}` 
      : lockStatus;
    ctx.fillText(label, sx, sy - ship.kind.radius - 4);
    
    ctx.restore();
  };
  
  // Draw player escort trajectories (cyan, green lock, yellow avoidance)
  for (const p of state.player) {
    drawTrajectory(p, 'rgba(100,220,255,0.8)', 'rgba(100,255,100,0.6)', 'rgba(255,255,100,0.8)');
  }
  
  // Draw enemy escort trajectories (pink, orange lock, orange avoidance)
  for (const e of state.enemy) {
    drawTrajectory(e, 'rgba(255,150,180,0.8)', 'rgba(255,200,100,0.6)', 'rgba(255,180,100,0.8)');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN DRAW FUNCTION
// ═══════════════════════════════════════════════════════════════════════════
export function draw(ctx, state) {
  waterBackground(ctx);
  drawLand(ctx, state.camX, state.camY, state);
  drawCommanderPath(ctx, state.camX, state.camY, state);
  drawEscortTrajectories(ctx, state.camX, state.camY, state);
  drawBatteries(ctx, state.camX, state.camY, state);
  drawRadarSweepOverlay(ctx, state.camX, state.camY, state);
  for (const sm of state.smokes) drawSmoke(ctx, sm, state.camX, state.camY, state);
  for (const p of state.player) drawTrail(ctx, p, state.camX, state.camY, state);
  for (const e of state.enemy) { if (state.spectatorMode || e.detP) drawTrail(ctx, e, state.camX, state.camY, state); }
  for (const p of state.player) drawWake(ctx, p, state.camX, state.camY);
  for (const e of state.enemy) { if (state.spectatorMode || e.detP) drawWake(ctx, e, state.camX, state.camY); }
  
  // Draw ships with spectator target highlight
  const allShips = state.player.concat(state.enemy);
  for (let i = 0; i < state.player.length; i++) {
    const isSpectatorTarget = state.spectatorMode && !state.spectatorFreeCamera && state.spectatorTarget === i;
    const isSelected = (i === state.selected && !state.spectatorMode) || isSpectatorTarget;
    drawShip(ctx, state.player[i], state.camX, state.camY, isSelected, state);
    drawCommanderMarker(ctx, state.player[i], state.camX, state.camY);
  }
  for (let i = 0; i < state.enemy.length; i++) {
    const e = state.enemy[i];
    if (!state.spectatorMode && !e.detP) continue;
    const enemyIdx = state.player.length + i;
    const isSpectatorTarget = state.spectatorMode && !state.spectatorFreeCamera && state.spectatorTarget === enemyIdx;
    drawShip(ctx, e, state.camX, state.camY, isSpectatorTarget, state);
    if (state.spectatorMode) drawCommanderMarker(ctx, e, state.camX, state.camY);
  }
  
  drawRecon(ctx, state.camX, state.camY, state);
  drawAircraft(ctx, state.camX, state.camY, state);
  drawBullets(ctx, state.camX, state.camY, state);
  for (const sh of state.shells) drawShell(ctx, sh, state.camX, state.camY);
  for (const m of state.missiles) drawMissile(ctx, m, state.camX, state.camY, state);
  for (const f of state.fx) drawFx(ctx, f, state.camX, state.camY, state);
  drawRadar(ctx, state);
}
