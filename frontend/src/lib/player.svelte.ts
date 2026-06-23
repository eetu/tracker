// Reactive playback store wrapping the (vendored) chiptune3 libopenmpt engine.
// One AudioContext/worklet for the whole app, created lazily on the first play
// (inside a user gesture, so the browser allows audio). When a module's
// metadata arrives we both reflect it in the now-playing track and write it
// back to the backend cache (/api/meta) — so titles/durations fill in as you
// listen, keyed by content hash.

import { api, fileUrl, type Track } from './api';
import { ChiptuneJsPlayer } from './vendor/chiptune3.js';

type ProgressMsg = { pos?: number; order?: number; pattern?: number; row?: number };

/** Per-pattern data from the (patched) worklet: each row is one formatted
 *  cell-string per channel, e.g. "C-4 01 v64 A04". */
export type Pattern = { name: string; rows: string[][] };
export type Song = {
	channels?: string[];
	instruments?: string[];
	samples?: string[];
	patterns?: Pattern[];
};
// libopenmpt metadata keys are flattened onto the object, plus `song` + totals.
type Meta = {
	title?: string;
	type_long?: string;
	tracker?: string;
	dur?: number;
	totalOrders?: number;
	totalPatterns?: number;
	song?: Song;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let player: any = null;
let ready: Promise<void> | null = null;
let analyser: AnalyserNode | null = null;

/** Output-waveform sample count for the scope (power of two). */
export const SCOPE_SIZE = 2048;

/** Fill `buf` (length SCOPE_SIZE) with the current output waveform (0–255,
 *  128 = silence). Returns false until the audio graph exists. */
export function readScope(buf: Uint8Array<ArrayBuffer>): boolean {
	if (!analyser) return false;
	analyser.getByteTimeDomainData(buf);
	return true;
}

// Playback is a small state machine over one loaded module:
//   stopped: playing=false            (transport shows ▶; play restarts from top)
//   playing: playing=true, paused=false
//   paused:  playing=true, paused=true
// `current`/`song` persist through stop so the player view stays put; only
// opening another track replaces them.
export const playback = $state({
	current: null as Track | null,
	playing: false,
	paused: false,
	position: 0,
	duration: 0,
	order: 0,
	pattern: 0,
	row: 0,
	song: null as Song | null,
	samples: [] as string[],
	instruments: [] as string[],
	muted: false,
	error: null as string | null
});

function ensurePlayer(): Promise<void> {
	if (player) return ready as Promise<void>;
	// Synchronous `new AudioContext()` keeps us inside the click gesture.
	player = new ChiptuneJsPlayer({ repeatCount: 0 });
	// Tap the output for the scope. The gain node exists immediately (the
	// worklet connects to it once it's ready); the analyser just observes.
	const a: AnalyserNode = player.context.createAnalyser();
	a.fftSize = SCOPE_SIZE;
	player.gain.connect(a);
	analyser = a;
	ready = new Promise<void>((resolve) => player.onInitialized(() => resolve()));
	player.onProgress((d: ProgressMsg) => {
		playback.position = d.pos ?? 0;
		playback.order = d.order ?? 0;
		playback.pattern = d.pattern ?? 0;
		playback.row = d.row ?? 0;
	});
	player.onMetadata((meta: Meta) => {
		playback.duration = meta?.dur ?? 0;
		playback.song = meta?.song ?? null;
		playback.samples = meta?.song?.samples ?? [];
		playback.instruments = meta?.song?.instruments ?? [];
		if (playback.current) void saveMeta(playback.current, meta);
	});
	player.onEnded(() => {
		playback.playing = false;
	});
	player.onError((e: { type?: string }) => {
		playback.error = e?.type ?? 'playback error';
	});
	return ready as Promise<void>;
}

/** Load a track and play it from the start (audible unless muted). */
export async function playTrack(track: Track) {
	playback.error = null;
	playback.current = track;
	playback.playing = true;
	playback.paused = false;
	playback.position = 0;
	playback.duration = track.duration ?? 0;
	playback.song = null;
	playback.row = 0;
	playback.order = 0;
	playback.pattern = 0;
	const p = ensurePlayer();
	await p;
	try {
		await player.context.resume();
	} catch {
		/* already running */
	}
	player.setVol(playback.muted ? 0 : 1);
	player.load(fileUrl(track.hash));
}

/** The transport play/pause/restart button: from stopped → restart the current
 *  track from the top; otherwise toggle play ↔ pause in place. */
export function transportToggle() {
	if (!playback.current) return;
	if (!playback.playing) void playTrack(playback.current);
	else togglePause();
}

export function togglePause() {
	if (!player || !playback.current || !playback.playing) return;
	player.togglePause();
	playback.paused = !playback.paused;
}

/** Halt playback and reset to the start, but keep the module loaded and the
 *  player view open — the transport flips to ▶ (restart). */
export function stop() {
	if (!player) return;
	player.stop();
	playback.playing = false;
	playback.paused = false;
	playback.position = 0;
	playback.row = 0;
	playback.order = 0;
}

export function setMuted(m: boolean) {
	if (!player) return;
	player.setVol(m ? 0 : 1);
	playback.muted = m;
}

export function seekSeconds(sec: number) {
	if (!player || !playback.current) return;
	player.setPos(sec);
	playback.position = sec;
}

/** Reflect parsed metadata in the playing track and persist it (best effort). */
async function saveMeta(track: Track, meta: Meta) {
	const payload = {
		title: meta?.title || null,
		type_long: meta?.type_long || null,
		tracker: meta?.tracker || null,
		duration: meta?.dur ?? null,
		channels: meta?.song?.channels?.length ?? null,
		instruments: meta?.song?.instruments?.length ?? null,
		samples: meta?.song?.samples?.length ?? null,
		n_orders: meta?.totalOrders ?? null,
		n_patterns: meta?.totalPatterns ?? null
	};
	// Mutate the (proxied) track so the library list updates immediately.
	track.title = payload.title;
	track.type_long = payload.type_long;
	track.tracker = payload.tracker;
	track.duration = payload.duration;
	track.channels = payload.channels;
	track.instruments = payload.instruments;
	track.samples = payload.samples;
	try {
		await api.putMeta(track.hash, payload);
	} catch {
		/* best effort — enrichment is a cache, not critical */
	}
}

// Dev-only: on HMR this module re-evaluates and `playback`/`player` reset, but
// the old AudioContext graph keeps playing (orphaned, with no controls). Tear it
// down on dispose so a hot reload lands in a clean stopped state.
if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		try {
			player?.stop();
			player?.context?.close?.();
		} catch {
			/* nothing to tear down */
		}
	});
}
