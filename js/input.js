// ═══════════════════════════════════════════════════════════════════════════
// INPUT MODULE - Keyboard and mouse event handling
// ═══════════════════════════════════════════════════════════════════════════

import { 
  VIEW, THROTTLE_CHANGE_RATE, MAX_RUDDER_ANGLE, 
  RUDDER_RETURN_RATE, ANGULAR_INERTIA, ANGULAR_ACCEL, RUDDER_MOVE_RATE 
} from './config.js';
import { clamp, angleTo } from './utils.js';
import { turretStep } from './combat.js';

// Input state
export const keys = new Set();
export const mouse = { x: VIEW.w/2, y: VIEW.h/2 };

// Initialize input handlers
export function initInput(canvas, callbacks) {
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
    mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
    if (callbacks.onMouseMove) callbacks.onMouseMove(e);
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (callbacks.onMouseDown) callbacks.onMouseDown(e);
  });
  
  canvas.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (callbacks.onMouseUp) callbacks.onMouseUp(e);
  });
  
  // Also handle mouseup outside canvas
  window.addEventListener('mouseup', (e) => {
    if (callbacks.onMouseUp) callbacks.onMouseUp(e);
  });

  window.addEventListener('keydown', (e) => {
    if (["Space"].includes(e.code)) e.preventDefault();
    if (e.code === 'Tab') e.preventDefault();
    keys.add(e.code);
    if (callbacks.onKeyDown) callbacks.onKeyDown(e);
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// THROTTLE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
export function updateThrottle(ship, dt) {
  if (keys.has('KeyW')) {
    ship.throttle = Math.min(100, ship.throttle + THROTTLE_CHANGE_RATE * dt);
  }
  if (keys.has('KeyS')) {
    ship.throttle = Math.max(-100, ship.throttle - THROTTLE_CHANGE_RATE * dt);
  }
  if (isNaN(ship.throttle) || ship.throttle === undefined) {
    ship.throttle = 50;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RUDDER SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
export function applyPlayerRudder(ship, steerInput, dt) {
  if (steerInput !== 0) {
    ship.rudderAngle = (ship.rudderAngle || 0) + steerInput * RUDDER_MOVE_RATE * dt;
  } else {
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
  
  const angularDiff = targetTurnRate - ship.angularVel;
  ship.angularVel += clamp(angularDiff * ANGULAR_ACCEL * dt, -ship.kind.turnRate * dt * 2, ship.kind.turnRate * dt * 2);
  ship.angularVel *= ANGULAR_INERTIA;
  
  ship.heading += ship.angularVel * dt;
  
  if (isNaN(ship.rudderAngle) || ship.rudderAngle === undefined) {
    ship.rudderAngle = 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYER CONTROL
// ═══════════════════════════════════════════════════════════════════════════
export function playerControl(ship, dt, state) {
  if (!ship.alive) return;
  
  updateThrottle(ship, dt);
  
  let steerInput = 0;
  if (keys.has('KeyA')) steerInput -= 1;
  if (keys.has('KeyD')) steerInput += 1;
  applyPlayerRudder(ship, steerInput, dt);
  
  // Speed is now handled by physicsStep with inertia
  // Just update turret aiming
  const aimWorldX = state.camX + mouse.x;
  const aimWorldY = state.camY + mouse.y;
  const aimA = angleTo(ship.x, ship.y, aimWorldX, aimWorldY);
  turretStep(ship, dt, aimA);
}
