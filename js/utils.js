// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES MODULE - Math helpers and common functions
// ═══════════════════════════════════════════════════════════════════════════

import { TAU } from './config.js';

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx*dx + dy*dy; };
export const len = (x, y) => Math.hypot(x, y);
export const normAngle = (a) => { a %= TAU; if (a < -Math.PI) a += TAU; if (a > Math.PI) a -= TAU; return a; };
export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
export const rand = (a, b) => a + Math.random() * (b - a);
