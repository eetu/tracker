<script lang="ts">
	// The Amiga Boing Ball — a spinning red/white checkered sphere bouncing on a
	// magenta grid. Two layers on one canvas: the grid is drawn crisp at full
	// resolution (thin 1px lines), while the ball is rendered into a small
	// offscreen buffer and composited on top nearest-neighbour, so it stays
	// chunky/pixelated. Used both as the scan loader and a playback visualizer.

	// `energy` (0..1) modulates the ball when used as a visualizer: it spins
	// faster and pulses bigger with the music. Only spin (incremental) and drawn
	// size react — the analytic position speeds stay fixed so the bounce never
	// jumps. Default 0 = idle.
	let { energy = 0 }: { energy?: number } = $props();

	let canvas: HTMLCanvasElement | null = $state(null);

	$effect(() => {
		const el = canvas;
		if (!el) return;
		const mainCtx = el.getContext('2d');
		if (!mainCtx) return;
		const off = document.createElement('canvas');
		const offCtx = off.getContext('2d');
		if (!offCtx) return;
		const main: CanvasRenderingContext2D = mainCtx;
		const og: CanvasRenderingContext2D = offCtx;

		const PIXEL = 4; // offscreen→screen upscale (ball chunkiness)
		const GRID = 24; // grid cell size in CSS px (crisp)
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		let W = 0; // CSS px (grid space)
		let H = 0;
		let oW = 0; // offscreen px (ball space)
		let oH = 0;

		const ro = new ResizeObserver(() => {
			const r = el.getBoundingClientRect();
			W = r.width;
			H = r.height;
			el.width = Math.max(1, Math.round(W * dpr));
			el.height = Math.max(1, Math.round(H * dpr));
			main.setTransform(dpr, 0, 0, dpr, 0, 0);
			oW = Math.max(1, Math.round(W / PIXEL));
			oH = Math.max(1, Math.round(H / PIXEL));
			off.width = oW;
			off.height = oH;
		});
		ro.observe(el);

		let spin = 0;
		let t0 = 0;
		let lastT = 0;
		const tilt = (16 * Math.PI) / 180;
		const H_SPEED = 0.14;
		const V_SPEED = 2.3;
		const SPIN_RATE = 1.7;

		function radius() {
			return Math.max(10, Math.min(60, Math.min(oW, oH) * 0.2));
		}

		// Crisp grid (full resolution), fixed square cells that tile.
		function grid() {
			main.fillStyle = '#2b2b3a';
			main.fillRect(0, 0, W, H);
			main.strokeStyle = '#b41eb4';
			main.lineWidth = 1;
			main.beginPath();
			for (let gx = 0; gx <= W; gx += GRID) {
				main.moveTo(gx + 0.5, 0);
				main.lineTo(gx + 0.5, H);
			}
			for (let gy = 0; gy <= H; gy += GRID) {
				main.moveTo(0, gy + 0.5);
				main.lineTo(W, gy + 0.5);
			}
			main.stroke();
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

		// Ball drawn into the offscreen (low-res) buffer.
		function ball(cx: number, cy: number, r: number) {
			og.beginPath();
			og.arc(cx, cy, r, 0, Math.PI * 2);
			const g = og.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
			g.addColorStop(0, '#ff4d4d');
			g.addColorStop(1, '#b00000');
			og.fillStyle = g;
			og.fill();

			const LAT = 8;
			const LON = 16;
			for (let i = 0; i < LAT; i++) {
				for (let j = 0; j < LON; j++) {
					if ((i + j) % 2 === 0) continue;
					const t0a = (Math.PI * i) / LAT;
					const t1 = (Math.PI * (i + 1)) / LAT;
					const p0 = (2 * Math.PI * j) / LON;
					const p1 = (2 * Math.PI * (j + 1)) / LON;
					const a = project(t0a, p0);
					const b = project(t1, p0);
					const c = project(t1, p1);
					const d = project(t0a, p1);
					if ((a.z + b.z + c.z + d.z) / 4 <= 0) continue;
					og.beginPath();
					og.moveTo(cx + a.x * r, cy + a.y * r);
					og.lineTo(cx + b.x * r, cy + b.y * r);
					og.lineTo(cx + c.x * r, cy + c.y * r);
					og.lineTo(cx + d.x * r, cy + d.y * r);
					og.closePath();
					og.fillStyle = '#f2f2f2';
					og.strokeStyle = '#f2f2f2';
					og.lineWidth = 1;
					og.fill();
					og.stroke();
				}
			}
			og.beginPath();
			og.arc(cx, cy, r, 0, Math.PI * 2);
			const rim = og.createRadialGradient(cx, cy, r * 0.6, cx, cy, r);
			rim.addColorStop(0, 'rgba(0,0,0,0)');
			rim.addColorStop(1, 'rgba(0,0,0,0.35)');
			og.fillStyle = rim;
			og.fill();
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

			if (oW > 0 && oH > 0) {
				const r = radius();
				const pad = 4;
				const left = r + pad;
				const right = oW - r - pad;
				const floor = oH - r - pad;
				const ceil = r + pad;

				const hp = t * H_SPEED;
				const f = hp - Math.floor(hp);
				const hx = f < 0.5 ? f * 2 : 2 - f * 2;
				const dir = f < 0.5 ? 1 : -1;
				const x = left + (right - left) * hx;

				const bounce = Math.abs(Math.sin(t * V_SPEED));
				const y = floor - (floor - ceil) * bounce;

				spin += SPIN_RATE * (0.6 + energy * 2) * dir * dt;
				const rDraw = r * (1 + energy * 0.15);

				// Grid layer (crisp, full-res).
				grid();

				// Ball layer (low-res offscreen, transparent), then composite up.
				og.clearRect(0, 0, oW, oH);
				const lift = (floor - y) / Math.max(1, floor - ceil);
				og.save();
				og.globalAlpha = 0.35 * (1 - lift * 0.6);
				og.fillStyle = '#000';
				og.beginPath();
				og.ellipse(
					x,
					floor + r * 0.85,
					rDraw * (1.1 - lift * 0.3),
					rDraw * 0.28,
					0,
					0,
					Math.PI * 2
				);
				og.fill();
				og.restore();
				ball(x, y, rDraw);

				main.imageSmoothingEnabled = false;
				main.drawImage(off, 0, 0, oW, oH, 0, 0, W, H);
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
