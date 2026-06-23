<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource/press-start-2p'; // retro display (brand, FT2 titles)
	import '@fontsource/vt323'; // retro monospace (pattern grid, readouts)

	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

{@render children()}

<style>
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
		/* retro faces for the player surface (self-hosted, OFL) */
		--font-retro: 'Press Start 2P', ui-monospace, monospace;
		--font-mono-retro: 'VT323', ui-monospace, monospace;
		font-family: 'Inter Variable', 'Inter', system-ui, sans-serif;
	}

	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font-size: 14px;
		-webkit-font-smoothing: antialiased;
	}

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
