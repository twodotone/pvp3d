/**
 * Central tuning constants. Keep gameplay/feel numbers here so they are easy
 * to find and balance as the combat system grows.
 */

export const WORLD = {
  /** Arena is a square of this many world units on a side. */
  arenaSize: 44,
  /** Half-extent characters are clamped within (a little inside the walls). */
  get playBound() {
    return WORLD.arenaSize / 2 - 2;
  },
};

export const NET = {
  /**
   * WebSocket relay server. Defaults to localhost for dev; set VITE_SERVER_URL
   * (e.g. wss://arena-relay.onrender.com) at build time for production.
   */
  serverUrl:
    (import.meta.env.VITE_SERVER_URL as string | undefined) ??
    "ws://localhost:8080",
  /** Local state broadcasts per second. */
  tickHz: 20,
};

/**
 * Soft-lock aiming. The aim direction (mouse-relative, or right-stick on mobile)
 * selects the best enemy inside a frontal cone; attacks then snap toward it.
 * A *soft* lock — sweeping the aim re-picks; nothing in the cone = free aim.
 */
export const SOFTLOCK = {
  /** Full cone width (deg) around the aim direction that can acquire a target. */
  coneDeg: 75,
  /** Max distance an enemy can be soft-locked. */
  range: 15,
  /** How much distance matters vs angle when scoring candidates (higher = nearer wins). */
  distWeight: 0.06,
  /** Score bonus (radians-equiv) for the currently-locked target, to avoid flicker. */
  stickiness: 0.3,
};

/** PvP spawn points by player slot (diagonal-opposite first, so 1v1 faces off). */
export const SPAWNS: [number, number][] = [
  [-10, -10],
  [10, 10],
  [10, -10],
  [-10, 10],
];

export const RENDER = {
  /**
   * Draw a fake round ground shadow under each character. Turn ON when the
   * sprites are SHADOWLESS; keep OFF while the art has baked-in shadows
   * (otherwise you get a doubled shadow).
   */
  blobShadow: false,
  blobShadowOpacity: 0.33,
};

export const CAMERA = {
  /** Orthographic "zoom": world units visible vertically. Smaller = closer. */
  viewHeight: 22,
  /** Closer zoom on phones/tablets — smaller screen wants to be near the action. */
  viewHeightMobile: 12,
  /** Direction the camera sits relative to its target (classic iso-ish). */
  offset: { x: 22, y: 18, z: 22 },
  near: 0.1,
  far: 200,
};

export const PLAYER = {
  /** Units / second while running. */
  moveSpeed: 7.5,
  /** How fast the facing angle eases toward the desired one (per second). */
  turnLerp: 18,
  /** World height of the character billboard (full 128px cell maps to this). */
  spriteHeight: 2.6,
  /** Collision radius used for arena-bound clamping. */
  radius: 0.5,

  roll: {
    speed: 13,
    duration: 0.5, // seconds; matches the Rolling animation length we play
    cooldown: 0.65,
  },

  attack: {
    /** Movement is locked for this fraction of the attack at the start. */
    moveLockSeconds: 0.35,
    /** Small forward lunge applied at the swing. */
    lungeSpeed: 4.5,
    lungeSeconds: 0.18,
  },
};

/**
 * Sprite sheet layout — uniform across every animation in this pack:
 * 8 rows (facing directions) x 15 columns (animation frames) of 128px cells.
 */
export const SHEET = {
  cols: 15,
  rows: 8,
  cellSize: 128,
};

/**
 * Direction rows in this pack rotate CLOCKWISE (in screen space) starting from
 * row 0 = East. Calibrated against on-screen behaviour:
 *   row0:E  row1:SE  row2:S  row3:SW  row4:W  row5:NW  row6:N  row7:NE
 *
 * `DIR.rows` indexes by compass slot (clockwise from up/North) and yields the
 * sheet row that depicts that facing:
 *   slot 0:N  1:NE  2:E  3:SE  4:S  5:SW  6:W  7:NW
 *
 * `DIR_ROW_OFFSET` is a live-tunable nudge (the [ and ] keys) for fine-rotation.
 */
export const DIR = {
  /** Sheet-row for each compass slot, clockwise from North. */
  rows: [6, 7, 0, 1, 2, 3, 4, 5] as const,
};

/**
 * Combat tuning. `activeFrame` is the spritesheet column at which a swing
 * registers its hit; `arcDeg` is the full cone width in front of the attacker
 * the hit can land within; `range` is in world units (plus target radius).
 */
export const COMBAT = {
  player: {
    maxHealth: 100,
    /** Invulnerability window granted by a roll (dodge). */
    rollIFrames: 0.45,
    block: {
      arcDeg: 150, // frontal cone a raised shield covers
      damageMul: 0, // 0 = fully negates frontal damage
      knockbackMul: 0.25,
    },
    /** Three-hit chain; click again during a swing to flow into the next. */
    combo: [
      { anim: "attack1", activeFrame: 6, damage: 10, range: 2.4, arcDeg: 120, knockback: 5 },
      { anim: "attack2", activeFrame: 6, damage: 12, range: 2.4, arcDeg: 120, knockback: 5 },
      { anim: "attack3", activeFrame: 7, damage: 22, range: 2.2, arcDeg: 110, knockback: 12 },
    ],
  },

  /** Ranged characters fire a single projectile per attack instead of a combo. */
  ranged: {
    activeFrame: 7, // attack frame at which the shot is released
    damage: 14,
    speed: 17, // world units / second
    lifetime: 1.8, // seconds before the shot despawns
    knockback: 4,
    radius: 0.35, // projectile collision radius
    muzzleForward: 0.6, // spawn this far in front of the shooter
    muzzleHeight: 1.2, // spawn height (chest)
  },
  dummy: {
    maxHealth: 70,
    radius: 0.55,
    /** Starts swinging when the player is within this distance (melee). */
    aggroRange: 2.8,
    /** Ranged dummies open fire from much further out. */
    rangedAggro: 11,
    attack: {
      anim: "attack1",
      activeFrame: 8, // later contact = clearer wind-up to react/block against
      damage: 12,
      range: 2.5,
      arcDeg: 110,
      knockback: 7,
      cooldown: 2.2, // more breathing room between swings
    },
    respawnDelay: 3,
  },
} as const;
