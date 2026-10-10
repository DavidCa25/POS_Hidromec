// Type definitions for wybix-mascot.esm.js / wybix-mascot.js (window.WybixMascot)

export type MascotState =
  | 'IDLE' | 'GREETING' | 'HAPPY' | 'SALE_SUCCESS' | 'THINKING' | 'WARNING'
  | 'ERROR' | 'OFFLINE' | 'TALKING' | 'CELEBRATION' | 'GOODBYE';

export type BubblePlacement = 'auto' | 'top' | 'top-right' | 'top-left' | 'left' | 'right';

export interface MascotOptions {
  /** 'auto' follows prefers-reduced-motion. Default 'auto'. */
  reducedMotion?: 'auto' | boolean;
  /** Ambient motion in IDLE (breathing, glances, micro-actions). Default 'full'. */
  idleMotion?: 'full' | 'calm' | 'off';
  /** Show the speech bubble. Default true. */
  bubble?: boolean;
  bubblePlacement?: BubblePlacement;
  /** Light outline so black strokes read on dark backgrounds. Default false. */
  halo?: boolean;
  /** Optional audio. Everything is off by default. */
  audio?: { sfx?: boolean; voice?: boolean; volume?: number };
  /** Announce messages to screen readers (aria-live="polite"). Default true. */
  announce?: boolean;
  /** Frame cap while idle / while reacting. Defaults 30 / 60. */
  idleFps?: number;
  maxFps?: number;
  /** Playback speed, e.g. 0.25 for review. Default 1. */
  timeScale?: number;
  /** Default copy per state; null disables the bubble for that state. */
  messages?: Partial<Record<MascotState, string | null>>;
  /** Extra confetti colour (e.g. your brand accent). */
  accent?: string;
  /** Characters per second for typing and mouth sync. Default 24. */
  speechRate?: number;
}

export interface ReactOptions {
  /** Bubble text. undefined = state default, null = no bubble. */
  message?: string | null;
  /** Override duration in seconds (transient states). */
  duration?: number;
}

export interface ReactResult {
  state: MascotState | string;
  status: 'done' | 'entered' | 'queued' | 'interrupted' | 'coalesced' | 'dropped' | 'destroyed' | 'unknown';
}

export interface MascotStats {
  frames: number; running: boolean; particles: number; reducedMotion: boolean;
  state: MascotState; base: MascotState; queue: MascotState[];
}

export interface Mascot {
  react(state: MascotState, options?: ReactOptions): Promise<ReactResult>;
  say(text: string, options?: Omit<ReactOptions, 'message'>): Promise<ReactResult>;
  clear(state?: MascotState): void;
  readonly state: MascotState;
  readonly base: MascotState;
  readonly states: MascotState[];
  on(event: 'state', fn: (e: { name: MascotState; prev: MascotState | null; base: MascotState }) => void): () => void;
  on(event: 'complete', fn: (e: { name: MascotState; status: ReactResult['status'] }) => void): () => void;
  on(event: 'message', fn: (e: { text: string; state: MascotState }) => void): () => void;
  setOptions(options: Partial<MascotOptions>): void;
  pause(): void;
  resume(): void;
  stats(): MascotStats;
  destroy(): void;
  readonly el: HTMLElement;
}

export function createMascot(container: HTMLElement, options?: MascotOptions): Mascot;

export type PosEventRule = (payload: any) =>
  | { state?: MascotState; message?: string | null; clear?: MascotState }
  | null;

export interface PosBridge {
  emit(type: string, payload?: Record<string, unknown>): Promise<ReactResult> | null;
  enable(): void;
  disable(): void;
  readonly rules: Record<string, PosEventRule>;
}

export function createPosBridge(mascot: Mascot, options?: {
  rules?: Record<string, PosEventRule>;
  cooldownMs?: number;
  isQuiet?: () => boolean;
}): PosBridge;

export const STATE_NAMES: MascotState[];
export const DEFAULT_RULES: Record<string, PosEventRule>;
