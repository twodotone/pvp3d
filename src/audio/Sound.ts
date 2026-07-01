import type * as THREE from "three";
import type { Combatant } from "../combat/Combatant.ts";
import type { ProjectileType } from "../game/projectiles.ts";

/** Reduced from SkillEffect["kind"] to avoid a runtime import of skills. */
type SkillKind = "melee" | "projectile" | "dash" | "heal";

const MASTER_VOL = 0.6;
/**
 * A gentle master low-pass rolls the harsh top-end off everything, which is the
 * single biggest lever from "bright/arcadey" toward "warm/earthy/fantasy".
 */
const TONE_CUTOFF = 3200;
/** Beyond this many world units an event fades to its floor volume. */
const AUDIBLE_RANGE = 34;

/** Arrows twang; everything else is a magical zap, hued by element. */
const ARROW_TYPES = new Set<ProjectileType>(["Arrow", "FireArrow"]);
const SPELL_BASE: Partial<Record<ProjectileType, number>> = {
  FireSpell: 220,
  FireAoE: 200,
  IceSpell: 400,
  IceAoE: 380,
  DeathSpell: 180,
  DeathAoE: 170,
  ArcSpell: 320,
  SwordAoE: 260,
};

interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number;
  dur: number;
  gain: number;
  attack?: number;
  t0?: number;
}
interface NoiseOpts {
  type?: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
  dur: number;
  gain: number;
  attack?: number;
  t0?: number;
}

/**
 * Procedural combat audio. A sibling of the Feedback layer: combat events fire
 * into this singleton, which synthesizes short SFX with the Web Audio API — no
 * sample assets, no loading, tiny footprint. Every voice runs through a master
 * gain + compressor so stacked hits glue instead of clip. Sounds attenuate with
 * distance from the local player, so a fight across the arena reads quieter.
 */
class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private comp!: DynamicsCompressorNode;
  private noiseBuf!: AudioBuffer;
  private local: Combatant | null = null;
  private muted = false;

  /** Store the local player (for distance/own-vs-other) and arm gesture unlock. */
  init(local: Combatant): void {
    this.local = local;
    this.muted = localStorage.getItem("muted") === "1";
    const unlock = () => this.ensureCtx();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("touchstart", unlock);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem("muted", this.muted ? "1" : "0");
    if (this.master) this.master.gain.value = this.muted ? 0 : MASTER_VOL;
    if (!this.muted) this.ensureCtx();
    return this.muted;
  }
  get isMuted(): boolean {
    return this.muted;
  }

  // --- Events -----------------------------------------------------------

  /** A melee swing begins — a heavy low whumph (plays whether or not it lands). */
  swing(from: Combatant): void {
    if (!this.ready) return;
    const a = this.atten(from) * (0.9 + Math.random() * 0.2);
    this.noise({ type: "lowpass", f0: 700, f1: 170, q: 0.7, dur: 0.2, gain: 0.17 * a });
    this.tone({ type: "triangle", f0: 110, f1: 55, dur: 0.14, gain: 0.08 * a });
  }

  /** Impact landed on `target`. A meaty thock — deeper when it's you taking it. */
  hit(target: Combatant, damage: number): void {
    if (!this.ready) return;
    const a = this.atten(target);
    const taken = target === this.local;
    const d = Math.min(1, damage / 30);
    this.tone({ type: "sine", f0: 150 + d * 40, f1: 45, dur: 0.16, gain: 0.34 * a });
    this.noise({ type: "lowpass", f0: 900, f1: 170, q: 0.6, dur: 0.12, gain: (0.16 + d * 0.1) * a });
    if (taken) this.tone({ type: "triangle", f0: 90, f1: 40, dur: 0.2, gain: 0.24 * a });
  }

  /** A shield turned a hit — a dull, heavy metallic clank. */
  block(target: Combatant): void {
    if (!this.ready) return;
    const a = this.atten(target);
    const r = 0.94 + Math.random() * 0.12;
    // Two inharmonic partials (ratio ~1.35) read as struck metal without pinging.
    this.tone({ type: "triangle", f0: 1300 * r, f1: 880 * r, dur: 0.16, gain: 0.1 * a });
    this.tone({ type: "triangle", f0: 1750 * r, f1: 1200 * r, dur: 0.13, gain: 0.06 * a });
    this.noise({ type: "lowpass", f0: 2000, f1: 700, q: 0.8, dur: 0.05, gain: 0.09 * a });
  }

  /** A dodge roll — a soft, low earthy whoosh. */
  roll(from: Combatant): void {
    if (!this.ready) return;
    const a = this.atten(from);
    this.noise({ type: "lowpass", f0: 620, f1: 150, q: 0.8, dur: 0.3, gain: 0.14 * a });
  }

  /** A projectile was launched (local, enemy, or mirrored) — flavored by type. */
  shoot(type: ProjectileType, pos: THREE.Vector3): void {
    if (!this.ready) return;
    const a = this.attenPos(pos) * (0.95 + Math.random() * 0.1);
    if (ARROW_TYPES.has(type)) {
      // Low bow thwip + a dull string release, no airy zing.
      this.tone({ type: "triangle", f0: 520, f1: 170, dur: 0.15, gain: 0.16 * a });
      this.noise({ type: "lowpass", f0: 1100, f1: 400, q: 1, dur: 0.05, gain: 0.09 * a });
      return;
    }
    const base = SPELL_BASE[type] ?? 300;
    // Warm body + a low sub hum + a lowpassed whoosh — a conjured "whoomph".
    this.tone({ type: "triangle", f0: base * 1.6, f1: base * 0.6, dur: 0.24, gain: 0.13 * a });
    this.tone({ type: "sine", f0: base * 0.9, f1: base * 0.5, dur: 0.2, gain: 0.09 * a });
    this.noise({ type: "lowpass", f0: base * 2.2, f1: base * 0.8, q: 1, dur: 0.16, gain: 0.06 * a });
  }

  /** An equipped skill fired — the cue depends on the effect kind. */
  skill(kind: SkillKind, from: Combatant): void {
    if (!this.ready) return;
    const a = this.atten(from);
    const t0 = this.ctx!.currentTime;
    switch (kind) {
      case "heal": {
        // Warm rising arpeggio over a low drone — restorative, not chiptune.
        this.tone({ type: "sine", f0: 196, dur: 0.7, gain: 0.06 * a, attack: 0.04 });
        [392, 523, 659].forEach((f, i) =>
          this.tone({ type: "sine", f0: f, dur: 0.55, gain: 0.09 * a, attack: 0.03, t0: t0 + i * 0.07 }),
        );
        break;
      }
      case "dash":
        this.noise({ type: "lowpass", f0: 300, f1: 900, q: 0.8, dur: 0.24, gain: 0.15 * a });
        break;
      case "melee":
        this.noise({ type: "lowpass", f0: 900, f1: 220, q: 0.9, dur: 0.3, gain: 0.2 * a });
        this.tone({ type: "sine", f0: 120, f1: 50, dur: 0.24, gain: 0.2 * a });
        break;
      default: // projectile — a low charged swell under the launch sound
        [220, 330, 440].forEach((f, i) =>
          this.tone({ type: "triangle", f0: f, f1: f * 1.4, dur: 0.24, gain: 0.07 * a, t0: t0 + i * 0.04 }),
        );
    }
  }

  /** A fighter went down — a heavy body-drop thud that settles into the ground. */
  death(target: Combatant): void {
    if (!this.ready) return;
    const a = this.atten(target);
    const you = target === this.local;
    const t0 = this.ctx!.currentTime;
    // Main impact: a deep punchy thump (fast pitch drop, no ringing tail).
    this.tone({ type: "sine", f0: you ? 130 : 150, f1: 36, dur: 0.22, gain: 0.36 * a });
    this.noise({ type: "lowpass", f0: 480, f1: 100, q: 0.6, dur: 0.26, gain: 0.2 * a });
    // A softer settle a beat later — the body coming to rest.
    this.tone({ type: "sine", f0: 96, f1: 32, dur: 0.18, gain: 0.16 * a, t0: t0 + 0.12 });
    this.noise({ type: "lowpass", f0: 340, f1: 90, q: 0.6, dur: 0.2, gain: 0.1 * a, t0: t0 + 0.12 });
  }

  /** A fighter (re)spawned — a warm low swell of arrival (no bright jingle). */
  spawn(target: Combatant): void {
    if (!this.ready) return;
    const a = this.atten(target);
    const g = (target === this.local ? 0.13 : 0.09) * a;
    const t0 = this.ctx!.currentTime;
    // A rising low-passed swell — energy gathering as they materialize.
    this.noise({ type: "lowpass", f0: 200, f1: 820, q: 0.7, dur: 0.34, gain: 0.09 * a });
    // Warm tone rising a fifth and settling — a grounded "presence," not a chime.
    this.tone({ type: "sine", f0: 130, f1: 196, dur: 0.4, gain: g, attack: 0.04 });
    this.tone({ type: "triangle", f0: 196, f1: 262, dur: 0.34, gain: g * 0.6, attack: 0.03, t0: t0 + 0.05 });
  }

  // --- Synthesis --------------------------------------------------------

  private get ready(): boolean {
    return !!this.ctx && this.ctx.state === "running" && !this.muted;
  }

  private ensureCtx(): void {
    if (!this.ctx) {
      const AC =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_VOL;
      this.comp = this.ctx.createDynamicsCompressor();
      const tone = this.ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = TONE_CUTOFF;
      tone.Q.value = 0.4;
      this.master.connect(tone).connect(this.comp).connect(this.ctx.destination);

      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private atten(c: Combatant): number {
    return this.attenPos(c.position);
  }

  private attenPos(pos: THREE.Vector3): number {
    if (!this.local) return 1;
    const dx = pos.x - this.local.position.x;
    const dz = pos.z - this.local.position.z;
    const d = Math.hypot(dx, dz);
    return Math.max(0.18, 1 - (d / AUDIBLE_RANGE) * 0.85);
  }

  private env(g: GainNode, t0: number, peak: number, attack: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  private tone(o: ToneOpts): void {
    const ctx = this.ctx!;
    const t0 = o.t0 ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.dur);
    const g = ctx.createGain();
    this.env(g, t0, o.gain, o.attack ?? 0.004, o.dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  }

  private noise(o: NoiseOpts): void {
    const ctx = this.ctx!;
    const t0 = o.t0 ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = o.type ?? "bandpass";
    filt.frequency.setValueAtTime(o.f0, t0);
    if (o.f1 !== undefined) filt.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.dur);
    filt.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    this.env(g, t0, o.gain, o.attack ?? 0.002, o.dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + o.dur + 0.02);
  }
}

export const sound = new Sound();
