/**
 * The cursor's neon trail is a chain of points. The head sits on the pointer and every other point follows the one
 * ahead of it. Following by a fixed fraction of the remaining distance (the first version) makes the gap between
 * neighbours grow with pointer speed, so a brisk sweep drew a glowing line hundreds of pixels long, and a single
 * huge jump drew a streak across the whole screen.
 *
 * Instead each point eases toward its neighbour and is then held within a short, fixed distance of it. The tail
 * length is therefore bounded by construction (points x gap), whatever the speed, a jump or the refresh rate, and
 * it still gets longer when you move faster, up to that cap.
 */

/** The farthest a trail point may sit from the one ahead of it. With 20 points the tail is at most ~19 x this. */
export const TRAIL_MAX_GAP_PX = 7;

/**
 * How quickly a point closes in on its neighbour, per second. 28 matches the old "0.38 of the distance per frame"
 * at 60 Hz, but as a rate over time it feels the same at 60, 120 or 144 Hz.
 */
export const TRAIL_FOLLOW_RATE = 28;

export interface TrailPoint { x: number; y: number }

/**
 * Moves `p` toward its neighbour `ahead` for a frame of `dtSeconds`, then keeps it within TRAIL_MAX_GAP_PX of that
 * neighbour. Mutates `p` (this runs in an animation loop, so it allocates nothing). A zero, negative or invalid
 * time step moves nothing but still enforces the gap, so a chain can never be left stretched.
 */
export function followTrailPoint(p: TrailPoint, ahead: TrailPoint, dtSeconds: number): void {
  const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? Math.min(dtSeconds, 0.05) : 0;
  const k = 1 - Math.exp(-TRAIL_FOLLOW_RATE * dt);
  p.x += (ahead.x - p.x) * k;
  p.y += (ahead.y - p.y) * k;
  const dx = p.x - ahead.x;
  const dy = p.y - ahead.y;
  const gap = Math.hypot(dx, dy);
  if (gap > TRAIL_MAX_GAP_PX) {
    const s = TRAIL_MAX_GAP_PX / gap;
    p.x = ahead.x + dx * s;
    p.y = ahead.y + dy * s;
  }
}
