<script lang="ts">
	// The Amiga Boing Ball — a spinning red/white checkered sphere bouncing on a
	// magenta grid. Canvas 2D: the sphere is lat/long quads projected
	// orthographically over a red base disc (so there are no seam gaps), spun
	// about a tilted axis; it bounces wall-to-wall (reversing spin on contact)
	// and floor-to-ceiling under gravity. Used as the "worth-the-wait" loader
	// during the initial collection scan.

	// `energy` (0..1) modulates the ball when used as a playback visualizer: it
	// spins faster and pulses bigger with the music. Only spin (incremental) and
	// radius (size) react — the analytic position speeds stay fixed so the bounce
	// never jumps. Default 0 = idle (the scan loader).
	let { energy = 0 }: { energy?: number } = $props();

	let canvas: HTMLCanvasElement | null = $state(null);

	$effect(() => {
		const el = canvas;
		if (!el) return;
		const ctx = el.getContext('2d');
		if (!ctx) return;
		// Non-null alias so the nested render closures don't trip the null check
		// (TS doesn't carry the guard above into closures).
		const g2: CanvasRenderingContext2D = ctx;

		let w = 0;
		let h = 0;
		// Render into a small buffer and let CSS upscale it nearest-neighbour, so
		// everything comes out chunky/pixelated (authentic Amiga look).
		const PIXEL = 4;
		const ro = new ResizeObserver(() => {
			const r = el.getBoundingClientRect();
			w = Math.max(1, Math.round(r.width / PIXEL));
			h = Math.max(1, Math.round(r.height / PIXEL));
			el.width = w;
			el.height = h;
		});
		ro.observe(el);

		// Time-driven motion: position is an analytic function of elapsed time, so
		// it's perfectly periodic and never drifts or jumps (integrating velocity
		// + snapping at the floor accumulated phase error and clipped the ceiling).
		let spin = 0;
		let t0 = 0;
		let lastT = 0;
		const tilt = (16 * Math.PI) / 180;
		const H_SPEED = 0.14; // horizontal ping-pong cycles/sec (left→right→left)
		const V_SPEED = 2.3; // vertical bounce rate (rad/sec for |sin|)
		const SPIN_RATE = 1.7; // rad/sec

		function radius() {
			return Math.max(10, Math.min(60, Math.min(w, h) * 0.2));
		}

		function grid() {
			g2.fillStyle = '#2b2b3a';
			g2.fillRect(0, 0, w, h);
			g2.strokeStyle = '#b41eb4';
			g2.lineWidth = 1;
			const n = 14;
			g2.beginPath();
			for (let i = 0; i <= n; i++) {
				const gx = (i / n) * w;
				g2.moveTo(gx, 0);
				g2.lineTo(gx, h);
			}
			for (let j = 0; j <= n; j++) {
				const gy = (j / n) * h;
				g2.moveTo(0, gy);
				g2.lineTo(w, gy);
			}
			g2.stroke();
		}

		function project(theta: number, phi: number) {
			let px = Math.sin(theta) * Math.cos(phi);
			const py = Math.cos(theta);
			let pz = Math.sin(theta) * Math.sin(phi);
			const cs = Math.cos(spin);
			const sn = Math.sin(spin);
			const x2 = px * cs + pz * sn;
			pz = -px * sn + pz * cs;
			px = x2;
			return {
				x: px * Math.cos(tilt) - py * Math.sin(tilt),
				y: px * Math.sin(tilt) + py * Math.cos(tilt),
				z: pz
			};
		}

		function ball(cx: number, cy: number, r: number) {
			// red base disc + radial shading
			g2.beginPath();
			g2.arc(cx, cy, r, 0, Math.PI * 2);
			const g = g2.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
			g.addColorStop(0, '#ff4d4d');
			g.addColorStop(1, '#b00000');
			g2.fillStyle = g;
			g2.fill();

			const LAT = 8;
			const LON = 16;
			for (let i = 0; i < LAT; i++) {
				for (let j = 0; j < LON; j++) {
					if ((i + j) % 2 === 0) continue; // only the white squares over the red base
					const t0 = (Math.PI * i) / LAT;
					const t1 = (Math.PI * (i + 1)) / LAT;
					const p0 = (2 * Math.PI * j) / LON;
					const p1 = (2 * Math.PI * (j + 1)) / LON;
					const a = project(t0, p0);
					const b = project(t1, p0);
					const c = project(t1, p1);
					const d = project(t0, p1);
					if ((a.z + b.z + c.z + d.z) / 4 <= 0) continue; // back-facing
					g2.beginPath();
					g2.moveTo(cx + a.x * r, cy + a.y * r);
					g2.lineTo(cx + b.x * r, cy + b.y * r);
					g2.lineTo(cx + c.x * r, cy + c.y * r);
					g2.lineTo(cx + d.x * r, cy + d.y * r);
					g2.closePath();
					g2.fillStyle = '#f2f2f2';
					g2.strokeStyle = '#f2f2f2';
					g2.lineWidth = 1;
					g2.fill();
					g2.stroke();
				}
			}
			// rim darkening for roundness
			g2.beginPath();
			g2.arc(cx, cy, r, 0, Math.PI * 2);
			const rim = g2.createRadialGradient(cx, cy, r * 0.6, cx, cy, r);
			rim.addColorStop(0, 'rgba(0,0,0,0)');
			rim.addColorStop(1, 'rgba(0,0,0,0.35)');
			g2.fillStyle = rim;
			g2.fill();
		}

		let raf = 0;
		function frame(ts: number) {
			if (!t0) {
				t0 = ts;
				lastT = ts;
			}
			const t = (ts - t0) / 1000;
			const dt = Math.min(0.05, (ts - lastT) / 1000);
			lastT = ts;

			if (w > 0 && h > 0) {
				const r = radius();
				const pad = 8;
				const left = r + pad;
				const right = w - r - pad;
				const floor = h - r - pad;
				const ceil = r + pad;

				// Horizontal: triangle ping-pong (left→right→left), continuous and
				// periodic. `dir` is the current travel direction; the ball reverses
				// spin at each wall (the corner of the triangle), like the real demo.
				const hp = t * H_SPEED;
				const f = hp - Math.floor(hp); // 0..1
				const hx = f < 0.5 ? f * 2 : 2 - f * 2; // 0→1→0
				const dir = f < 0.5 ? 1 : -1;
				const x = left + (right - left) * hx;

				// Vertical: |sin| bounce — touches the floor periodically, smooth
				// arc to the top. No integration, so it can't drift.
				const bounce = Math.abs(Math.sin(t * V_SPEED));
				const y = floor - (floor - ceil) * bounce;

				// React to the music: spin faster + pulse bigger with energy. Bounds
				// stay on the base radius so the bounce path never jumps.
				spin += SPIN_RATE * (0.6 + energy * 2) * dir * dt;
				const rDraw = r * (1 + energy * 0.15);

				grid();
				// shadow on the floor, fading + shrinking as the ball rises
				const lift = (floor - y) / Math.max(1, floor - ceil);
				g2.save();
				g2.globalAlpha = 0.35 * (1 - lift * 0.6);
				g2.fillStyle = '#000';
				g2.beginPath();
				g2.ellipse(
					x,
					floor + r * 0.85,
					rDraw * (1.1 - lift * 0.3),
					rDraw * 0.28,
					0,
					0,
					Math.PI * 2
				);
				g2.fill();
				g2.restore();

				ball(x, y, rDraw);
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
		image-rendering: pixelated;
	}
</style>
