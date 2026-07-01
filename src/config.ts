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
    /** How long a stagger locks you out of control (short — was the full anim). */
    hurtDuration: 0.3,
    /** After a stagger, hits still hurt but can't re-stagger you for this long. */
    poiseWindow: 0.8,
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

/**
 * AI enemy tuning (see src/entities/Enemy.ts). These are base numbers; per-wave
 * DifficultyProfiles scale health/damage/speed/cooldown on top of them. Ranged
 * enemies fire with the shared COMBAT.ranged projectile params.
 */
export const ENEMY = {
  baseSpeed: 5.2, // units/sec before per-class speed + wave multipliers
  turnLerp: 10, // facing ease toward the target (per second)
  spawnIFrames: 0.4,
  cullSeconds: 1.6, // fallback despawn after death if the die anim never "finishes"
  /** Boids-style separation so a horde spreads instead of stacking on the player. */
  separationRadius: 1.7,
  separationStrength: 0.9,
  melee: {
    anim: "attack1",
    attackRange: 2.2, // stop + swing distance (plus the target's radius)
    activeFrame: 8, // frame the hit registers — clear wind-up before it
    arcDeg: 110,
    damage: 9,
    knockback: 7,
    cooldown: 1.2, // min seconds between swings
  },
  ranged: {
    anim: "attack1",
    // Behaviour: hold ground and shoot; only close in when too far, and take a
    // single short backstep (never a continuous backpedal) when crowded.
    comfortMax: 11, // beyond this, close the distance (running toward the target)
    personalSpace: 4.5, // if the target gets closer than this, take one backstep
    fireSlack: 1.5, // may fire a little beyond comfortMax
    cooldown: 1.9,
    backstepTime: 0.32, // duration of a committed backstep (turn-to-move, ~1.7u)
    backstepCd: 1.6, // min gap between backsteps, so they hold ground + fire
  },
} as const;

/**
 * Per-enemy-type personality, layered on the base AI + stats. Melee fields tune
 * reach/damage/wind-up/cadence + two signatures: `lunge*` (leap into range) and
 * `blockChance` (raise a shield between swings). `poiseWindow` is stagger
 * resistance (high = marches through hits). Ranged fields tune spacing + fire
 * rate. Anything omitted falls back to the ENEMY.melee / ENEMY.ranged defaults.
 */
export interface EnemyBehavior {
  poiseWindow?: number;
  // melee
  attackRange?: number;
  arcDeg?: number;
  damage?: number;
  knockback?: number;
  activeFrame?: number; // hit frame — higher = slower, more telegraphed
  cooldown?: number;
  lungeSpeed?: number; // >0: leaps toward the target to close the last gap
  lungeRange?: number; // triggers a lunge from within this distance
  blockChance?: number; // 0..1 chance to raise a guard after a swing
  // ranged
  comfortMax?: number;
  personalSpace?: number;
  fireCooldown?: number;
  backstepCd?: number;
}

export const ENEMY_BEHAVIORS: Record<string, EnemyBehavior> = {
  // Brute — slow, heavy, unshakeable. Big telegraphed clobber.
  "1Brute": { attackRange: 2.5, arcDeg: 120, damage: 16, knockback: 13, activeFrame: 10, cooldown: 1.9, poiseWindow: 1.7 },
  // Dark Knight — patient elite: solid hits, often guards between them.
  "3DarkKnight": { attackRange: 2.3, arcDeg: 100, damage: 13, knockback: 8, activeFrame: 8, cooldown: 1.4, poiseWindow: 0.9, blockChance: 0.4 },
  // Berserker — reckless: fast light hits, leaps in, but easy to stagger.
  "4Berserker": { attackRange: 2.2, arcDeg: 100, damage: 8, knockback: 5, activeFrame: 5, cooldown: 0.7, poiseWindow: 0.3, lungeSpeed: 13, lungeRange: 5.5 },
  // Warrior — measured footsoldier that sometimes raises a shield.
  "6Warrior": { attackRange: 2.2, arcDeg: 110, damage: 10, knockback: 7, activeFrame: 8, cooldown: 1.2, poiseWindow: 0.6, blockChance: 0.22 },
  // Archer — the standard bow (baseline ranged feel).
  "5Archer": { comfortMax: 11, personalSpace: 4.5, fireCooldown: 1.7, backstepCd: 1.5 },
  // Dark Archer — skittish, rapid fire, gives ground more readily.
  "7DarkArcher": { comfortMax: 10, personalSpace: 5, fireCooldown: 1.1, backstepCd: 1.1 },
  // Necromancer — keeps well back, slow heavy casts.
  "8Necromancer": { comfortMax: 13, personalSpace: 6, fireCooldown: 2.4, backstepCd: 2.0 },
  // Wizard — mid-range caster.
  "9Wizard": { comfortMax: 12, personalSpace: 5.5, fireCooldown: 2.0, backstepCd: 1.8 },
};

/**
 * Action economy: melee runs on STAMINA, casters/ranged on MANA (same mechanic,
 * different flavour). Attacks/skills/rolls cost it and it regenerates, so an
 * archer can't fire forever — this is the main anti-spam lever. Per-skill costs
 * live on each SkillDef (src/game/skills.ts).
 */
export const RESOURCE = {
  melee: {
    name: "stamina",
    color: "#5ad06a",
    max: 100,
    regen: 26, // per second
    regenDelay: 0.3, // pause before regen resumes after spending
    attackCost: 14, // per combo
    rollCost: 22,
  },
  ranged: {
    name: "mana",
    color: "#4aa8ff",
    max: 100,
    regen: 16,
    regenDelay: 0.5,
    attackCost: 24, // per shot — rations the archer
    rollCost: 22,
  },
} as const;
