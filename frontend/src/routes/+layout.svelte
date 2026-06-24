<script lang="ts">
	import '@fontsource-variable/inter';

	import type { Snippet } from 'svelte';

	import { theme } from '$lib/theme.svelte';

	let { children }: { children: Snippet } = $props();

	// Resolve the chosen mode to an effective 'light'/'dark' and apply it as
	// data-theme on <html>. Only `auto` follows the system; it then re-resolves
	// live when the OS appearance flips.
	$effect(() => {
		const mode = theme.mode;
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const apply = () => {
			const eff = mode === 'auto' ? (mq.matches ? 'dark' : 'light') : mode;
			document.documentElement.dataset.theme = eff;
			const meta = document.querySelector('meta[name="theme-color"]');
			if (meta) meta.setAttribute('content', eff === 'light' ? '#f4f5f7' : '#0d0f12');
		};
		apply();
		if (mode === 'auto') {
			mq.addEventListener('change', apply);
			return () => mq.removeEventListener('change', apply);
		}
	});
</script>

{@render children()}

<style>
	/* Authentic Amiga system font (TopazPlus a1200, 8×16 bitmap) for the retro
	   surfaces — self-hosted, GPL Font Exception. github.com/rewtnull/amigafonts */
	@font-face {
		font-family: 'TopazPlus';
		src: url('/fonts/TopazPlus_a1200_v1.0.ttf') format('truetype');
		font-display: swap;
	}

	:global(:root) {
		/* Provisional palette — the pixel-perfect FastTracker 2 chrome (DOS
		   palette, beveled panels) lands with the player surface in a later
		   step; halo-design tokens will govern the outer chrome. */
		--bg: #0d0f12;
		--panel: #1a1d23;
		--panel-hi: #262b33;
		--border: #313742;
		--text: #d7dce3;
		--muted: #8b94a3;
		--accent: #f0a02a;
		--accent-dim: #7a5414;
		/* Player surface (pattern grid + scope overlay) — dark FT2 palette by
		   default; the light theme remaps these too (see below). */
		--surface: #0a0a14; /* deep pattern-grid bg */
		--surface-2: #10101c; /* centerline base / inset */
		--surface-bar: #16161f; /* overlay top bar */
		--surface-line: #1b1b2a; /* cell / row dividers */
		--surface-line-2: #2a2a3a; /* stronger dividers (bar/scope borders) */
		--surface-fg: #aeb6c2; /* default text */
		--surface-fg-beat: #c7cedb; /* every-4th-row text */
		--surface-fg-active: #ffffff; /* current row */
		--surface-fg-dim: #66708a; /* row numbers / sample index */
		--scope-bg: #08080f;
		--scope-grid: #2a2a3a;
		/* retro face for the player surface (Amiga Topaz; native size 16px). */
		--font-retro: 'TopazPlus', ui-monospace, monospace;
		--font-mono-retro: 'TopazPlus', ui-monospace, monospace;
		font-family: 'Inter Variable', 'Inter', system-ui, sans-serif;
	}

	/* Light theme — remaps every token, including the player surface, so all
	   components follow the theme. */
	:global(:root[data-theme='light']) {
		--bg: #f4f5f7;
		--panel: #ffffff;
		--panel-hi: #eceef1;
		--border: #d3d8e0;
		--text: #1b1e24;
		--muted: #5c6677;
		--accent: #b06f0a;
		--accent-dim: #fbe7c2;
		--surface: #ffffff;
		--surface-2: #eef0f3;
		--surface-bar: #eceef1;
		--surface-line: #e2e5ea;
		--surface-line-2: #d3d8e0;
		--surface-fg: #41495a;
		--surface-fg-beat: #1b1e24;
		--surface-fg-active: #000000;
		--surface-fg-dim: #9aa3b2;
		--scope-bg: #f0f2f5;
		--scope-grid: #d3d8e0;
	}

	:global(*) {
		box-sizing: border-box;
	}

	/* The app owns the viewport: header + scrolling <main> + fixed transport.
	   <main> is the scroll container (TanStack Virtual scrolls it), so the body
	   itself never scrolls — no phantom page scrollbar behind the player overlay. */
	:global(html),
	:global(body) {
		height: 100%;
	}
	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font-size: 14px;
		-webkit-font-smoothing: antialiased;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	/* SvelteKit mounts into a display:contents wrapper, so header/main/transport
	   become the body flex items directly. */

	:global(button) {
		font: inherit;
	}

	/* Lucide icons: square the caps/joins and thicken the stroke so they read as
	   blocky/retro alongside the pixel fonts (the default round strokes clash). */
	:global(button svg) {
		display: block;
		stroke-width: 2.5;
		stroke-linecap: square;
		stroke-linejoin: miter;
	}
</style>
