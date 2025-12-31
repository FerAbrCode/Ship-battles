// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION MODULE - All game constants and definitions
// ═══════════════════════════════════════════════════════════════════════════

// Math constants
export const TAU = Math.PI * 2;

// World & View dimensions
export const MAP_SCALE = 2.8;  // Larger maps
export const WORLD = { w: Math.round(3200 * MAP_SCALE), h: Math.round(2200 * MAP_SCALE) };
export const VIEW = { w: 1000, h: 650 };

// Difficulty settings
export const DIFFS = {
  easy: { name: 'Easy', aiAccMult: 0.85, aiAggroMult: 0.75 },
  med:  { name: 'Medium', aiAccMult: 1.00, aiAggroMult: 1.00 },
  hard: { name: 'Hard', aiAccMult: 1.18, aiAggroMult: 1.18 },
};

// Map definitions
export const MAPS = [
  {
    id: 0, name: 'Midway (1942)',
    land: [
      { x: 1380*MAP_SCALE, y: 920*MAP_SCALE, r: 150*MAP_SCALE },
      { x: 1550*MAP_SCALE, y: 820*MAP_SCALE, r: 95*MAP_SCALE },
      { x: 1210*MAP_SCALE, y: 1040*MAP_SCALE, r: 110*MAP_SCALE },
      { x: 1700*MAP_SCALE, y: 1040*MAP_SCALE, r: 80*MAP_SCALE },
    ],
    pSpawn: [ [800*MAP_SCALE, 700*MAP_SCALE, 0.10] ],
    eSpawn: [ [WORLD.w-800*MAP_SCALE, WORLD.h-700*MAP_SCALE, Math.PI+0.10] ],
  },
  {
    id: 1, name: 'Guadalcanal (1942)',
    land: [
      { x: 900*MAP_SCALE, y: 780*MAP_SCALE, r: 260*MAP_SCALE },
      { x: 760*MAP_SCALE, y: 980*MAP_SCALE, r: 240*MAP_SCALE },
      { x: 640*MAP_SCALE, y: 1180*MAP_SCALE, r: 220*MAP_SCALE },
      { x: 520*MAP_SCALE, y: 1380*MAP_SCALE, r: 210*MAP_SCALE },
      { x: 1680*MAP_SCALE, y: 620*MAP_SCALE, r: 120*MAP_SCALE },
      { x: 1860*MAP_SCALE, y: 740*MAP_SCALE, r: 140*MAP_SCALE },
    ],
    pSpawn: [ [750*MAP_SCALE, 600*MAP_SCALE, 0.10] ],
    eSpawn: [ [WORLD.w-800*MAP_SCALE, WORLD.h-750*MAP_SCALE, Math.PI+0.10] ],
  },
  {
    id: 2, name: 'Leyte Gulf (1944)',
    land: [
      { x: 1180*MAP_SCALE, y: 520*MAP_SCALE, r: 160*MAP_SCALE },
      { x: 1320*MAP_SCALE, y: 720*MAP_SCALE, r: 180*MAP_SCALE },
      { x: 980*MAP_SCALE,  y: 760*MAP_SCALE, r: 140*MAP_SCALE },
      { x: 1640*MAP_SCALE, y: 980*MAP_SCALE, r: 210*MAP_SCALE },
      { x: 1360*MAP_SCALE, y: 1120*MAP_SCALE, r: 160*MAP_SCALE },
      { x: 980*MAP_SCALE,  y: 1200*MAP_SCALE, r: 150*MAP_SCALE },
    ],
    pSpawn: [ [700*MAP_SCALE, WORLD.h-800*MAP_SCALE, -0.10] ],
    eSpawn: [ [WORLD.w-750*MAP_SCALE, 750*MAP_SCALE, Math.PI-0.10] ],
  },
];

// Battle configurations
export const BATTLES = {
  0: { pName: 'Task Force 16', eName: 'Kido Butai', pForm: 'screen', eForm: 'lineAhead', pCount: 10, eCount: 10 },
  1: { pName: 'Task Force 67', eName: 'Tokyo Express', pForm: 'lineAhead', eForm: 'lineAhead', pCount: 8,  eCount: 8 },
  2: { pName: 'Taffy 3',      eName: 'Center Force', pForm: 'screen', eForm: 'lineAhead', pCount: 12, eCount: 12 },
};

// Formation spacing
export const SPAWN_SEP = 90 * MAP_SCALE;   // Tighter spawn spacing
export const SPAWN_SIDE = 70 * MAP_SCALE;
export const FORM_SEP = 45 * MAP_SCALE;    // Tighter formation
export const FORM_SIDE = 35 * MAP_SCALE;

// Physics constants
export const DRAG_DD = 0.9960;
export const DRAG_BB = 0.9970;
export const SHIP_SPEED_SCALE = 0.28;
export const THROTTLE_CHANGE_RATE = 45;  // Faster throttle response
export const SPEED_INERTIA = 0.92;       // How fast speed catches up to throttle (lower = faster)
export const REVERSE_SPEED_MULT = 0.5;   // Reverse is 50% of forward speed
export const SHIP_ACCEL_SCALE = 0.28;
export const SHELL_SPEED_SCALE = 0.55;
export const RELOAD_SCALE = 1.8;
export const MAX_RUDDER_ANGLE = Math.PI / 6;

// Collision avoidance constants
export const AVOIDANCE_RANGE = 80;        // Range to start considering avoidance (reduced)
export const PREDICTION_TIME = 2.0;       // 2 second prediction (reduced)
export const MAX_AVOIDANCE_FORCE = 0.15;  // Gentler avoidance
export const ESCORT_LOCK_RADIUS = 60;     // Smaller radius for lock position
export const RUDDER_RETURN_RATE = 0.3;    // Very slow return to center
export const ANGULAR_INERTIA = 0.995;     // Very high = extremely smooth turns
export const ANGULAR_ACCEL = 0.5;         // Very low = slow response
export const RUDDER_MOVE_RATE = 0.2;      // Very slow rudder movement


// Ship definitions
export const DD = {
  type: 'DD', radius: 14, hp: 130, armor: 0.06,
  maxSpeed: 115 * SHIP_SPEED_SCALE, accel: 70 * SHIP_ACCEL_SCALE, turnRate: 1.5,
  gunRange: 580, shellSpeed: 270 * SHELL_SPEED_SCALE, gunReload: 1.24 * RELOAD_SCALE, shellDmg: 20, salvo: 1,
  smokeCooldown: 12.0, smokeDuration: 5.0, smokeRadius: 160,
  missileReload: 10.0 * RELOAD_SCALE, missileAmmoMax: 2,
};

export const BB = {
  type: 'BB', radius: 22, hp: 340, armor: 0.16,
  maxSpeed: 65 * SHIP_SPEED_SCALE, accel: 34 * SHIP_ACCEL_SCALE, turnRate: 0.8,
  gunRange: 720, shellSpeed: 300 * SHELL_SPEED_SCALE, gunReload: 2.50 * RELOAD_SCALE, shellDmg: 26, salvo: 3,
  smokeCooldown: 0, smokeDuration: 0, smokeRadius: 0,
  missileReload: 0, missileAmmoMax: 0,
};

export const TB = {
  type: 'TB', radius: 12, hp: 60, armor: 0.03,
  maxSpeed: 130 * SHIP_SPEED_SCALE, accel: 90 * SHIP_ACCEL_SCALE, turnRate: 1.8,
  gunRange: 0, shellSpeed: 0, gunReload: 0, shellDmg: 0, salvo: 0,
  smokeCooldown: 0, smokeDuration: 0, smokeRadius: 0,
  missileReload: 10.0 * RELOAD_SCALE, missileAmmoMax: 4,
};

export const CV = {
  type: 'CV', radius: 26, hp: 360, armor: 0.12,
  maxSpeed: 58 * SHIP_SPEED_SCALE, accel: 28 * SHIP_ACCEL_SCALE, turnRate: 0.6,
  gunRange: 0, shellSpeed: 0, gunReload: 0, shellDmg: 0, salvo: 0,
  smokeCooldown: 0, smokeDuration: 0, smokeRadius: 0,
  missileReload: 0, missileAmmoMax: 0, airCooldown: 9.0 * RELOAD_SCALE,
};

export const BATTERY = {
  type: 'BAT', radius: 12, hp: 140, armor: 0.10,
  maxSpeed: 0, accel: 0, turnRate: 0,
  gunRange: 860, shellSpeed: 320 * SHELL_SPEED_SCALE, gunReload: 3.6 * RELOAD_SCALE, shellDmg: 18, salvo: 2,
};

// Projectile & effect constants
export const MISSILE = { speed: 75, dmg: 42, ttl: 11.0, turnRate: 1.0, radius: 6.0 };
export const FX = { splashTtl: 0.55, hitTtl: 0.35, fireTtl: 1.6, boomTtl: 0.55 };

// Detection constants
export const RADAR_RANGE = 0.46 * Math.min(VIEW.w, VIEW.h);
export const RADAR_R2 = RADAR_RANGE * RADAR_RANGE;
export const BLINK_SECS = 2.0;
export const DET_STICKY = 10.0;
export const SHOT_SPOT_RANGE = 170;
export const SHOT_SPOT_R2 = SHOT_SPOT_RANGE * SHOT_SPOT_RANGE;

// Smoke constants
export const SMOKE_DEPLOY_TIME = 3.0;
export const SMOKE_DURATION = 5.0;

// Recon plane constants
export const RECON = { speed: 180, turnRate: 1.5, vision: 540, ttl: 22.0, cooldown: 16.0 };
export const RECON_V2 = RECON.vision * RECON.vision;

// Fighter constants
export const FIGHTER = { speed: 255, vision: 390, ttl: 12.0, gunRange: 360, fireEvery: 0.16, bulletSpeed: 500, dmg: 7, hp: 20, radius: 9 };
export const FIGHTER_V2 = FIGHTER.vision * FIGHTER.vision;

// Helper functions
export function mapById(id) { return MAPS[Math.max(0, Math.min(MAPS.length-1, id|0))]; }
export function battleByMap(id) { 
  return BATTLES[id] || { pName: 'Allied Force', eName: 'Axis Force', pForm: 'lineAhead', eForm: 'lineAhead', pCount: 8, eCount: 8 }; 
}
export function className(key) { 
  return key === 'cv' ? 'Aircraft carrier' : (key === 'bb' ? 'Battleship' : (key === 'tb' ? 'Torpedo boat' : 'Destroyer')); 
}
