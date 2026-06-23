<script lang="ts">
	import {
		AlignCenter,
		AudioLines,
		Monitor,
		Moon,
		Pause,
		Pencil,
		Play,
		Repeat,
		Shuffle,
		SkipBack,
		SkipForward,
		Sun,
		Volume2,
		VolumeX,
		X
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	import { api, ApiError, fileUrl, type StatusResponse, type Track } from '$lib/api';
	import BoingBall from '$lib/BoingBall.svelte';
	import PatternView from '$lib/PatternView.svelte';
	import PatternViewScroll from '$lib/PatternViewScroll.svelte';
	import {
		parseModule,
		playback,
		playInOrder,
		playNext,
		playPrev,
		seekSeconds,
		setMuted,
		toggleRepeat,
		toggleShuffle,
		transportToggle
	} from '$lib/player.svelte';
	import Scope from '$lib/Scope.svelte';
	import { cycleTheme, theme } from '$lib/theme.svelte';

	type GroupKey = 'group' | 'artist' | 'ext';

	let showPattern = $state(false);
	let pvTab = $state<'pattern' | 'samples' | 'ball'>('pattern');
	// Pattern view style: 'locked' = fixed centerline + vertical VU; 'scroll' =
	// free-scrolling rows + header VU. Persisted across sessions.
	let patternMode = $state<'locked' | 'scroll'>(
		(typeof localStorage !== 'undefined' && localStorage.getItem('tracker:patternMode')) ===
			'scroll'
			? 'scroll'
			: 'locked'
	);
	function togglePatternMode() {
		patternMode = patternMode === 'locked' ? 'scroll' : 'locked';
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('tracker:patternMode', patternMode);
	}

	function fmtTime(sec: number): string {
		if (!sec || !isFinite(sec)) return '0:00';
		const m = Math.floor(sec / 60);
		const s = Math.floor(sec % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function hex2(n: number): string {
		return n.toString(16).toUpperCase().padStart(2, '0');
	}

	let tracks = $state<Track[]>([]);
	let status = $state<StatusResponse | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let rescanning = $state(false);

	let groupBy = $state<GroupKey>('group');
	let query = $state('');

	async function loadTracks() {
		tracks = await api.tracks();
	}
	async function refreshStatus() {
		status = await api.status();
	}

	// While a scan runs it holds the single DB connection, so poll only /status
	// (cheap, lock-free) — never /api/tracks, which would block until it ends.
	async function pollUntilIdle() {
		while (status?.scanning) {
			await new Promise((r) => setTimeout(r, 800));
			try {
				await refreshStatus();
			} catch {
				/* transient — keep polling */
			}
		}
		await loadTracks();
	}

	async function init() {
		loading = true;
		error = null;
		try {
			await refreshStatus();
			if (status?.scanning) await pollUntilIdle();
			else await loadTracks();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function rescan() {
		rescanning = true;
		error = null;
		// Poll for progress in parallel while the (synchronous) rescan runs.
		let done = false;
		const poller = (async () => {
			while (!done) {
				try {
					await refreshStatus();
				} catch {
					/* transient */
				}
				await new Promise((r) => setTimeout(r, 700));
			}
		})();
		try {
			await api.rescan();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			done = true;
			await poller;
			try {
				await refreshStatus();
				await loadTracks();
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			}
			rescanning = false;
		}
	}

	// ---- bulk metadata enrichment (parse every un-enriched module via WASM) ----
	let enriching = $state(false);
	let enrichDone = $state(0);
	let enrichTotal = $state(0);
	const unEnriched = $derived(tracks.filter((t) => !t.type_long).length);

	async function enrichAll() {
		const todo = tracks.filter((t) => !t.type_long);
		if (todo.length === 0) return;
		enrichTotal = todo.length;
		enrichDone = 0;
		enriching = true;
		try {
			for (const t of todo) {
				if (!enriching) break; // cancelled
				try {
					const buf = await (await fetch(fileUrl(t.hash))).arrayBuffer();
					const m = await parseModule(buf);
					if (m) {
						const payload = {
							title: m.title || null,
							type_long: m.type_long || null,
							tracker: m.tracker || null,
							duration: m.dur ?? null,
							channels: m.channels ?? null,
							instruments: m.instruments ?? null,
							samples: m.samples ?? null,
							n_orders: m.orders ?? null,
							n_patterns: m.patterns ?? null
						};
						await api.putMeta(t.hash, payload);
						t.title = payload.title;
						t.type_long = payload.type_long;
						t.tracker = payload.tracker;
						t.duration = payload.duration;
						t.channels = payload.channels;
						t.instruments = payload.instruments;
						t.samples = payload.samples;
					}
				} catch {
					/* skip this module, keep going */
				}
				enrichDone++;
			}
		} finally {
			enriching = false;
		}
	}

	onMount(init);

	const scanning = $derived((status?.scanning ?? false) || rescanning);
	const scanPct = $derived.by(() => {
		const total = status?.scan_total ?? 0;
		if (!total) return null;
		return Math.round((Math.min(status?.scan_processed ?? 0, total) / total) * 100);
	});

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return tracks;
		return tracks.filter((t) =>
			[t.path, t.title, t.filename, t.group, t.artist, t.type_long]
				.filter(Boolean)
				.some((v) => (v as string).toLowerCase().includes(q))
		);
	});

	function keyOf(t: Track): string {
		if (groupBy === 'group') return t.group || '(none)';
		if (groupBy === 'artist') return t.artist || '(unknown artist)';
		return t.ext.toUpperCase();
	}

	const groups = $derived.by(() => {
		const acc: Record<string, Track[]> = {};
		for (const t of filtered) {
			const k = keyOf(t);
			(acc[k] ??= []).push(t);
		}
		return Object.entries(acc).sort((a, b) =>
			a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })
		);
	});

	function subLabel(t: Track): string {
		if (groupBy === 'group') return t.artist ?? '—';
		if (groupBy === 'artist') return t.group;
		return t.artist ? `${t.group} · ${t.artist}` : t.group;
	}

	// Only render rows for open groups (≤12 groups → all open). With hundreds of
	// groups collapsed this keeps thousands of <li>/icons out of the DOM.
	const openGroups = new SvelteSet<string>();
	const expandAll = $derived(groups.length <= 12);
	function isOpen(name: string): boolean {
		return expandAll || openGroups.has(name);
	}

	// The visible order is the play queue, so next/prev/auto-advance follow what
	// you see (current grouping + filter).
	const flatTracks = $derived(groups.flatMap(([, items]) => items));
	// Loudest channel VU drives the Boing-ball visualizer energy.
	const vuEnergy = $derived(playback.vu.length ? Math.max(...playback.vu) : 0);
	const hasPrev = $derived(playback.queueIndex > 0);
	const hasNext = $derived(
		playback.queueIndex >= 0 &&
			(playback.shuffle ? playback.queueLength > 1 : playback.queueIndex + 1 < playback.queueLength)
	);

	// Tapping a track opens the player (pattern) view. A new track starts playing
	// from the top (in the visible order); the already-loaded track just reopens
	// the view without disturbing playback.
	function openTrack(t: Track) {
		if (playback.current?.path !== t.path) void playInOrder(flatTracks, t);
		showPattern = true;
	}

	function seekClick(e: MouseEvent) {
		if (!playback.duration) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
		seekSeconds(frac * playback.duration);
	}

	// Desktop shortcuts: space = play/pause, ←/→ = prev/next, esc = close view.
	// Ignored while typing in the filter or a rename field.
	function onKey(e: KeyboardEvent) {
		const el = e.target as HTMLElement | null;
		if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
		if (e.key === 'Escape' && showPattern) {
			showPattern = false;
			return;
		}
		if (!playback.current) return;
		if (e.key === ' ') {
			e.preventDefault();
			transportToggle();
		} else if (e.key === 'ArrowRight' && hasNext) {
			playNext();
		} else if (e.key === 'ArrowLeft' && hasPrev) {
			playPrev();
		}
	}

	// ---- inline rename / move ----
	let editingPath = $state<string | null>(null);
	let dGroup = $state('');
	let dArtist = $state('');
	let dFilename = $state('');
	let renameError = $state<string | null>(null);
	let saving = $state(false);

	function startEdit(t: Track) {
		editingPath = t.path;
		dGroup = t.group;
		dArtist = t.artist ?? '';
		dFilename = t.filename;
		renameError = null;
	}
	function cancelEdit() {
		editingPath = null;
		renameError = null;
	}

	async function saveEdit(t: Track) {
		saving = true;
		renameError = null;
		try {
			const res = await api.rename({
				from: t.path,
				group: dGroup,
				artist: dArtist.trim() || null,
				filename: dFilename
			});
			// Mutate in place: $state proxies the array, so the row re-groups.
			t.path = res.path;
			t.group = res.group;
			t.artist = res.artist;
			t.filename = res.filename;
			t.ext = res.ext;
			editingPath = null;
		} catch (e) {
			if (e instanceof ApiError && e.status === 409)
				renameError = 'A file with that name already exists there.';
			else if (e instanceof ApiError && e.status === 400)
				renameError = 'Invalid name — keep a module extension, no slashes.';
			else renameError = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	function onEditKey(e: KeyboardEvent, t: Track) {
		if (e.key === 'Enter') saveEdit(t);
		else if (e.key === 'Escape') cancelEdit();
	}
</script>

<svelte:window onkeydown={onKey} />

<header class="bar">
	<div class="brand">tracker</div>
	<button
		class="theme"
		onclick={cycleTheme}
		title={`theme: ${theme.mode} (click to change)`}
		aria-label={`theme: ${theme.mode}`}
	>
		{#if theme.mode === 'dark'}<Moon size={16} />{:else if theme.mode === 'light'}<Sun
				size={16}
			/>{:else}<Monitor size={16} />{/if}
	</button>
	<input
		class="filter"
		type="search"
		placeholder="filter…"
		bind:value={query}
		disabled={scanning}
	/>
	<label class="groupby">
		group by
		<select bind:value={groupBy} disabled={scanning}>
			<option value="group">group</option>
			<option value="artist">artist</option>
			<option value="ext">format</option>
		</select>
	</label>
	<button onclick={rescan} disabled={scanning}>{scanning ? 'scanning…' : 'rescan'}</button>
	{#if enriching}
		<button onclick={() => (enriching = false)}>cancel {enrichDone}/{enrichTotal}</button>
	{:else if unEnriched > 0}
		<button onclick={enrichAll} disabled={scanning} title="parse metadata for all modules">
			enrich {unEnriched}
		</button>
	{/if}
	<div class="count">
		{#if scanning}
			{#if (status?.scan_total ?? 0) > 0}
				{(status?.scan_processed ?? 0).toLocaleString()} / {(
					status?.scan_total ?? 0
				).toLocaleString()}
			{:else}
				{(status?.scan_processed ?? 0).toLocaleString()} modules
			{/if}
			{#if status?.scan_hashed}· {status.scan_hashed.toLocaleString()} hashed{/if}
		{:else if status}
			{filtered.length} / {tracks.length} modules · {groups.length}
			{groupBy === 'ext' ? 'formats' : groupBy === 'artist' ? 'artists' : 'groups'}
		{/if}
	</div>
</header>

{#if scanning}
	<div class="progress" class:indeterminate={scanPct === null}>
		<div class="progress-fill" style:width="{scanPct ?? 100}%"></div>
	</div>
{:else if enriching}
	<div class="progress">
		<div
			class="progress-fill"
			style:width="{enrichTotal ? (enrichDone / enrichTotal) * 100 : 0}%"
		></div>
	</div>
{/if}

<main>
	{#if scanning && tracks.length === 0}
		<div class="scan-panel">
			<div class="boing"><BoingBall /></div>
			<p>Scanning the collection…</p>
			<p class="scan-detail">
				{#if scanPct !== null}
					{scanPct}% — {(status?.scan_processed ?? 0).toLocaleString()} of {(
						status?.scan_total ?? 0
					).toLocaleString()} modules
				{:else if (status?.scan_processed ?? 0) > 0}
					{(status?.scan_processed ?? 0).toLocaleString()} modules indexed…
				{:else}
					starting…
				{/if}
			</p>
			<p class="scan-note">
				First run hashes every file (≈1 GB over the NAS); later scans are quick.
			</p>
		</div>
	{:else if loading}
		<p class="msg">loading library…</p>
	{:else if error}
		<p class="msg err">{error}</p>
	{:else if tracks.length === 0}
		<p class="msg">
			No modules indexed yet — try <button class="link" onclick={rescan}>rescan</button>.
		</p>
	{:else}
		{#each groups as [name, items] (name)}
			<details
				class="grp"
				open={expandAll}
				ontoggle={(e) => {
					if (e.currentTarget.open) openGroups.add(name);
					else openGroups.delete(name);
				}}
			>
				<summary>
					<span class="grp-name">{name}</span>
					<span class="grp-count">{items.length}</span>
				</summary>
				{#if isOpen(name)}
					<ul>
						{#each items as t (t.path)}
							<li
								class:editing={editingPath === t.path}
								class:current={playback.current?.path === t.path}
							>
								{#if editingPath === t.path}
									<span class="fmt">{t.ext}</span>
									<input class="edit-in" bind:value={dGroup} placeholder="group" />
									<input class="edit-in" bind:value={dArtist} placeholder="artist (optional)" />
									<input
										class="edit-in fname"
										bind:value={dFilename}
										placeholder="filename"
										onkeydown={(e) => onEditKey(e, t)}
									/>
									<button class="ok" onclick={() => saveEdit(t)} disabled={saving}>save</button>
									<button onclick={cancelEdit} disabled={saving}>cancel</button>
									{#if renameError}<span class="rename-err">{renameError}</span>{/if}
								{:else}
									<button class="play" aria-label="open" title="open" onclick={() => openTrack(t)}>
										{#if playback.current?.path === t.path && playback.playing && !playback.paused}
											<AudioLines size={15} />
										{:else}
											<Play size={15} />
										{/if}
									</button>
									<span class="fmt">{t.ext}</span>
									<button class="name" title={t.path} onclick={() => openTrack(t)}>
										{t.title || t.filename}
									</button>
									<span class="sub">{subLabel(t)}</span>
									{#if t.duration}<span class="dur">{fmtTime(t.duration)}</span>{/if}
									<button class="edit" title="rename / move" onclick={() => startEdit(t)}>
										<Pencil size={14} />
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</details>
		{/each}
	{/if}
</main>

{#if playback.current && showPattern}
	<div class="pattern-overlay">
		<div class="pv-bar">
			<span class="pv-title">{playback.current.title || playback.current.filename}</span>
			<div class="pv-tabs">
				<button class:on={pvTab === 'pattern'} onclick={() => (pvTab = 'pattern')}>pattern</button>
				<button class:on={pvTab === 'samples'} onclick={() => (pvTab = 'samples')}>samples</button>
				<button class:on={pvTab === 'ball'} onclick={() => (pvTab = 'ball')}>ball</button>
			</div>
			<!-- Always laid out so the close button never shifts between tabs; only
			     meaningful on the pattern tab, hidden (space reserved) elsewhere. -->
			<button
				class="t-btn"
				class:on={patternMode === 'locked'}
				onclick={togglePatternMode}
				aria-label="toggle pattern scroll mode"
				title={patternMode === 'locked' ? 'fixed centerline' : 'free scroll'}
				style:visibility={pvTab === 'pattern' ? 'visible' : 'hidden'}
				disabled={pvTab !== 'pattern'}
			>
				<AlignCenter size={16} />
			</button>
			<button
				class="pv-close"
				onclick={() => (showPattern = false)}
				aria-label="close pattern view"
			>
				<X size={16} />
			</button>
		</div>
		<div class="pv-wrap">
			{#if pvTab === 'pattern'}
				<div class="scope-strip"><Scope /></div>
				<div class="pfill">
					{#if patternMode === 'locked'}<PatternView />{:else}<PatternViewScroll />{/if}
				</div>
			{:else if pvTab === 'ball'}
				<div class="ball-view">
					<BoingBall energy={playback.playing && !playback.paused ? vuEnergy : 0} />
				</div>
			{:else}
				<div class="samples">
					{#if (playback.song?.instruments?.length ?? 0) > 0}
						<h4>Instruments</h4>
						<ol>
							{#each playback.song?.instruments ?? [] as name, i (i)}
								<li><span class="sx">{hex2(i + 1)}</span><span class="sn">{name || '—'}</span></li>
							{/each}
						</ol>
					{/if}
					<h4>Samples</h4>
					<ol>
						{#each playback.song?.samples ?? [] as name, i (i)}
							<li><span class="sx">{hex2(i + 1)}</span><span class="sn">{name || '—'}</span></li>
						{:else}
							<li class="none">no samples</li>
						{/each}
					</ol>
				</div>
			{/if}
		</div>
	</div>
{/if}

{#if playback.current}
	<div class="transport">
		<button class="seek" onclick={seekClick} aria-label="seek" title="seek">
			<div
				class="seek-fill"
				style:width="{playback.duration ? (playback.position / playback.duration) * 100 : 0}%"
			></div>
		</button>
		<div class="t-controls">
			<button class="t-btn" onclick={playPrev} disabled={!hasPrev} aria-label="previous">
				<SkipBack size={16} />
			</button>
			<button
				class="t-btn"
				onclick={transportToggle}
				aria-label={playback.playing && !playback.paused ? 'pause' : 'play'}
			>
				{#if playback.playing && !playback.paused}<Pause size={16} />{:else}<Play size={16} />{/if}
			</button>
			<button class="t-btn" onclick={playNext} disabled={!hasNext} aria-label="next">
				<SkipForward size={16} />
			</button>
			<button
				class="t-btn"
				class:on={playback.shuffle}
				onclick={toggleShuffle}
				aria-label="shuffle"
				title="shuffle"
			>
				<Shuffle size={16} />
			</button>
			<button
				class="t-btn"
				class:on={playback.repeat}
				onclick={toggleRepeat}
				aria-label="repeat"
				title="repeat (loop)"
			>
				<Repeat size={16} />
			</button>
			<button
				class="t-btn"
				onclick={() => setMuted(!playback.muted)}
				aria-label={playback.muted ? 'unmute' : 'mute'}
				title={playback.muted ? 'unmute' : 'mute'}
			>
				{#if playback.muted}<VolumeX size={16} />{:else}<Volume2 size={16} />{/if}
			</button>
			<button class="t-info" onclick={() => (showPattern = true)} title="open player view">
				<span class="t-title">{playback.current.title || playback.current.filename}</span>
				<span class="t-meta">
					{playback.current.group}{playback.current.artist ? ` · ${playback.current.artist}` : ''}
					{#if playback.error}· <span class="t-err">{playback.error}</span>{/if}
				</span>
			</button>
			<div class="t-time">
				{fmtTime(playback.position)}{#if playback.duration}
					/ {fmtTime(playback.duration)}{/if}
			</div>
			<div class="t-pos">
				ord <span class="num">{playback.order}</span> · pat
				<span class="num">{playback.pattern}</span> · row <span class="num">{playback.row}</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
	}
	.brand {
		font-family: var(--font-retro);
		font-size: 16px;
		color: var(--accent);
		text-transform: lowercase;
	}
	.theme {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 5px;
	}
	.filter {
		flex: 1;
		max-width: 320px;
		padding: 6px 10px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
	}
	.groupby {
		color: var(--muted);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	select,
	button {
		background: var(--panel-hi);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 5px 10px;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.count {
		margin-left: auto;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.progress {
		height: 3px;
		background: var(--panel-hi);
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.3s ease;
	}
	.progress.indeterminate .progress-fill {
		width: 35% !important;
		animation: slide 1.1s ease-in-out infinite;
	}
	@keyframes slide {
		0% {
			margin-left: -35%;
		}
		100% {
			margin-left: 100%;
		}
	}

	main {
		padding: 12px 14px 60px;
	}
	.msg {
		color: var(--muted);
		padding: 24px 0;
	}
	.msg.err {
		color: #e06c6c;
	}
	.link {
		padding: 2px 8px;
	}

	.scan-panel {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		color: var(--muted);
		padding: 16px;
	}
	.boing {
		width: 100%;
		max-width: 560px;
		height: min(60vh, 460px);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		margin-bottom: 16px;
	}
	.scan-panel p {
		margin: 6px 0;
	}
	.scan-detail {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.scan-note {
		font-size: 12px;
		opacity: 0.7;
	}

	.grp {
		border: 1px solid var(--border);
		border-radius: 6px;
		margin-bottom: 8px;
		background: var(--panel);
		overflow: hidden;
	}
	summary {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		cursor: pointer;
		user-select: none;
	}
	.grp-name {
		font-weight: 600;
	}
	.grp-count {
		margin-left: auto;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--border);
	}
	li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 5px 12px;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
	}
	li:last-child {
		border-bottom: none;
	}
	li.editing {
		background: var(--panel-hi);
		flex-wrap: wrap;
	}
	li.current {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		box-shadow: inset 2px 0 0 var(--accent);
	}
	li.current button.name {
		color: var(--accent);
		font-weight: 600;
	}
	.play {
		flex: 0 0 auto;
		width: 32px;
		padding: 4px 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--accent);
	}
	button.name {
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		padding: 0;
		text-align: left;
		color: var(--text);
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.edit {
		visibility: hidden;
		padding: 2px 8px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	li:hover .edit {
		visibility: visible;
	}
	.ok {
		border-color: var(--accent);
		color: var(--accent);
	}
	.edit-in {
		padding: 4px 8px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		min-width: 90px;
	}
	.edit-in.fname {
		flex: 1;
		min-width: 160px;
	}
	.rename-err {
		flex-basis: 100%;
		color: #e06c6c;
		font-size: 12px;
	}
	.fmt {
		flex: 0 0 auto;
		min-width: 44px;
		text-align: center;
		font-size: 11px;
		text-transform: uppercase;
		color: var(--accent);
		background: var(--accent-dim);
		border-radius: 3px;
		padding: 2px 6px;
		font-family: ui-monospace, monospace;
	}
	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		flex: 0 0 auto;
		color: var(--muted);
		max-width: 40%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dur {
		flex: 0 0 auto;
		color: var(--muted);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}

	.pattern-overlay {
		position: fixed;
		inset: 0;
		z-index: 4;
		display: flex;
		flex-direction: column;
		background: #0a0a14;
	}
	.pv-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 12px;
		background: #16161f;
		border-bottom: 1px solid #2a2a3a;
	}
	.pv-title {
		flex: 1;
		min-width: 0;
		font-family: var(--font-retro);
		font-size: 16px;
		color: var(--accent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pv-close {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	/* Reserve a fixed 2-digit slot per number so ord/pat/row don't shift the
	   layout as they tick between 1 and 2 digits (tabular-nums alone can't —
	   it only equalises within the same digit count). */
	.num {
		display: inline-block;
		min-width: 2ch;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.pv-tabs {
		display: flex;
		gap: 4px;
	}
	.pv-tabs button {
		padding: 4px 10px;
		font-size: 12px;
	}
	.pv-tabs button.on {
		color: var(--bg);
		background: var(--accent);
		border-color: var(--accent);
	}
	.samples {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 8px 12px;
		font-family: var(--font-mono-retro);
		font-size: 16px;
		-webkit-overflow-scrolling: touch;
	}
	.samples h4 {
		color: var(--accent);
		margin: 12px 0 6px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.samples ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.samples li {
		display: flex;
		gap: 10px;
		padding: 2px 0;
		border-bottom: 1px solid #1b1b2a;
	}
	.samples .sx {
		color: #66708a;
		flex: 0 0 auto;
		width: 24px;
	}
	.samples .sn {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.samples .none {
		color: var(--muted);
	}
	.pv-wrap {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		/* leave room for the transport bar floating over the bottom */
		padding-bottom: 52px;
	}
	.scope-strip {
		flex: 0 0 auto;
		height: 72px;
		border-bottom: 1px solid #2a2a3a;
	}
	.pfill {
		flex: 1;
		min-height: 0;
	}
	.ball-view {
		flex: 1;
		min-height: 0;
	}

	.transport {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 5;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border-top: 1px solid var(--border);
	}
	.seek {
		display: block;
		width: 100%;
		height: 8px;
		padding: 0;
		border: none;
		border-radius: 0;
		background: var(--panel-hi);
		cursor: pointer;
	}
	.seek-fill {
		height: 100%;
		background: var(--accent);
		pointer-events: none;
	}
	.t-controls {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 14px;
	}
	.t-btn {
		flex: 0 0 auto;
		min-width: 40px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--accent);
	}
	.t-btn.on {
		color: var(--bg);
		background: var(--accent);
		border-color: var(--accent);
	}
	.t-info {
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		padding: 0;
		text-align: left;
		cursor: pointer;
		color: inherit;
	}
	.t-title {
		display: block;
		font-family: var(--font-retro);
		font-size: 11px;
		color: var(--accent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.t-meta {
		display: block;
		font-family: var(--font-retro);
		font-size: 11px;
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.t-err {
		color: #e06c6c;
	}
	.t-time {
		flex: 0 0 auto;
		color: var(--muted);
		font-size: 16px;
		font-family: var(--font-mono-retro);
		font-variant-numeric: tabular-nums;
	}
	.t-pos {
		flex: 0 0 auto;
		color: var(--muted);
		font-size: 16px;
		font-family: var(--font-mono-retro);
		font-variant-numeric: tabular-nums;
	}

	/* Touch has no hover — always show the rename affordance there. */
	@media (hover: none) {
		.edit {
			visibility: visible;
		}
	}

	/* iPhone portrait (~375–430px): wrap the toolbar onto multiple rows, drop the
	   secondary line, stack the rename editor, and use bigger tap targets. */
	@media (max-width: 640px) {
		.bar {
			flex-wrap: wrap;
			gap: 8px;
			padding: 8px 10px;
		}
		.filter {
			order: 3;
			max-width: none;
			flex-basis: 100%;
		}
		.groupby {
			font-size: 12px;
		}
		.count {
			order: 4;
			flex-basis: 100%;
			margin-left: 0;
		}
		main {
			padding: 10px 8px 80px;
		}
		.sub {
			display: none;
		}
		li {
			gap: 8px;
		}
		.edit-in {
			flex-basis: 100%;
			min-width: 0;
		}
		button,
		select {
			padding: 8px 12px;
		}
		.edit {
			padding: 6px 10px;
		}
		.play {
			padding: 8px 0;
		}
		/* Order/pattern/row teaser doesn't fit next to the title on a phone. */
		.t-pos {
			display: none;
		}
		.t-controls {
			gap: 6px;
			padding: 8px 8px;
		}
		.t-btn {
			min-width: 34px;
		}
	}
</style>
