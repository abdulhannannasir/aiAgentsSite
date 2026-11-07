/**
 * Rules for the cursor's neon trail. The trail is a chain of points, each easing toward the one ahead of it, so a
 * normal gesture leaves a short, smooth tail. A single huge pointer jump (a programmatic move, a refocused window,
 * a very laggy frame) would instead stretch that chain into a straight bright streak across the screen. These two
 * rules stop that without touching normal movement.
 */

/** One pointer event moving farther than this is a jump, not a gesture: snap the trail to the new spot. */
export const TRAIL_JUMP_PX = 320;

/** Trail segments up to this length are drawn at full strength (a fast flick stays below it)... */
export const TRAIL_FADE_START_PX = 110;

/** ...and segments this long or longer are not drawn at all, with a smooth fade in between. */
export const TRAIL_MAX_SEGMENT_PX = 260;

/** True when a pointer move of (dx, dy) in a single event should snap the trail instead of stretching it. */
export function isTrailJump(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > TRAIL_JUMP_PX;
}

/** Opacity multiplier (0..1) for a trail segment of the given length: 1 when short, 0 when stretched too far. */
export function segmentFade(length: number): number {
  if (!Number.isFinite(length) || length <= TRAIL_FADE_START_PX) return Number.isFinite(length) ? 1 : 0;
  if (length >= TRAIL_MAX_SEGMENT_PX) return 0;
  return 1 - (length - TRAIL_FADE_START_PX) / (TRAIL_MAX_SEGMENT_PX - TRAIL_FADE_START_PX);
}
