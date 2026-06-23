<script lang="ts">
	// Master output oscilloscope — draws the playback waveform from the player's
	// AnalyserNode. (A first scope; per-channel FT2 scopes would need the worklet
	// to expose per-channel PCM.)
	import { readScope, SCOPE_SIZE } from '$lib/player.svelte';

	let canvas: HTMLCanvasElement | null = $state(null);

	$effect(() => {
		const el = canvas;
		if (!el) return;
		const ctx = el.getContext('2d');
		if (!ctx) return;
		const g2: CanvasRenderingContext2D = ctx;

		let w = 0;
		let h = 0;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const ro = new ResizeObserver(() => {
			const r = el.getBoundingClientRect();
			w = r.width;
			h = r.height;
			el.width = Math.max(1, Math.round(w * dpr));
			el.height = Math.max(1, Math.round(h * dpr));
			g2.setTransform(dpr, 0, 0, dpr, 0, 0);
		});
		ro.observe(el);

		const buf = new Uint8Array(SCOPE_SIZE);
		let raf = 0;
		function frame() {
			if (w > 0 && h > 0) {
				g2.fillStyle = '#08080f';
				g2.fillRect(0, 0, w, h);
				const mid = h / 2;
				g2.strokeStyle = '#2a2a3a';
				g2.lineWidth = 1;
				g2.beginPath();
				g2.moveTo(0, mid);
				g2.lineTo(w, mid);
				g2.stroke();

				if (readScope(buf)) {
					g2.strokeStyle = '#f0a02a'; // halo accent
					g2.lineWidth = 1.5;
					g2.beginPath();
					// Draw one screen-width slice of the waveform.
					const step = buf.length / w;
					for (let px = 0; px < w; px++) {
						const v = buf[Math.floor(px * step)] / 128 - 1; // -1..1
						const y = mid - v * (mid * 0.9);
						if (px === 0) g2.moveTo(px, y);
						else g2.lineTo(px, y);
					}
					g2.stroke();
				}
			}
			raf = requestAnimationFrame(frame);
		}
		raf = requestAnimationFrame(frame);

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
		};
	});
</script>

<canvas bind:this={canvas}></canvas>

<style>
	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
