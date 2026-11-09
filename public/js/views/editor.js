/**
 * Widok edytora serii — podgląd z kamery, przechwytywanie klatek padem,
 * odtwarzanie zapisanej serii jako flipbook.
 */

import { CONFIG } from '../config.js';
import * as storage from '../storage.js';
import { startCamera, stopCamera, captureFrameBlob } from '../camera.js';
import InputController from '../InputController.js';


export async function openEditorView(seriesId, { onBack }) {

	const root = document.getElementById('editorView');
	root.innerHTML = editorTemplate();

	const videoEl = root.querySelector('#cameraVideo');
	const onionEl = root.querySelector('#onionOverlay');
	const playbackImg = root.querySelector('#playbackImg');
	const flashEl = root.querySelector('#captureFlash');
	const stripEl = root.querySelector('#frameStrip');
	const seriesNameEl = root.querySelector('#seriesName');
	const frameCounterEl = root.querySelector('#frameCounter');
	const backBtn = root.querySelector('#backBtn');
	const captureBtn = root.querySelector('#captureBtn');
	const playBtn = root.querySelector('#playBtn');
	const errorBanner = root.querySelector('#cameraError');
	const playbackBadge = root.querySelector('#playbackBadge');

	const inputController = new InputController(CONFIG.CONTROL_EDITOR);



	let stream = null;
	let frames = [];
	let stripUrls = [];
	let onionUrl = null;
	let isPlaying = false;
	let isCapturing = false;
	let stopPlayback = null;

	const series = await storage.getSeries(seriesId);
	seriesNameEl.textContent = series ? series.name : 'Seria';

	// ---------------------------------------------------------------------
	// Pasek miniaturek
	// ---------------------------------------------------------------------

	function revokeStripUrls() {
		stripUrls.forEach((url) => URL.revokeObjectURL(url));
		stripUrls = [];
	}

	function renderStrip() {
		revokeStripUrls();
		stripEl.innerHTML = '';
		for (const frame of frames) {
			const url = URL.createObjectURL(frame.blob);
			stripUrls.push(url);
			const img = document.createElement('img');
			img.src = url;
			img.className = 'frame-thumb';
			img.alt = `Klatka ${frame.order + 1}`;
			stripEl.appendChild(img);
		}
		stripEl.scrollLeft = stripEl.scrollWidth;
	}

	function updateCounter(value) {
		const n = value ?? frames.length;
		frameCounterEl.textContent = String(n).padStart(3, '0');
	}

	/**
	 * "Onion skin": nakładka ostatniej zapisanej klatki na żywym podglądzie
	 * kamery (opacity 10%), żeby łatwiej ustawić kolejny ruch obiektu
	 * dokładnie tam, gdzie powinien być względem poprzedniego ujęcia.
	 */
	function updateOnionOverlay() {
		if (onionUrl) {
			URL.revokeObjectURL(onionUrl);
			onionUrl = null;
		}

		if (frames.length === 0) {
			onionEl.removeAttribute('src');
			onionEl.classList.add('is-hidden');
			return;
		}

		const lastFrame = frames[frames.length - 1];
		onionUrl = URL.createObjectURL(lastFrame.blob);
		onionEl.src = onionUrl;
		onionEl.classList.remove('is-hidden');
	}

	async function refreshFrames() {
		frames = await storage.listFrames(seriesId);
		renderStrip();
		updateOnionOverlay();
		updateCounter();
		playBtn.disabled = frames.length === 0;
	}

	// ---------------------------------------------------------------------
	// Przechwytywanie klatki
	// ---------------------------------------------------------------------

	async function handleCapture() {
		if (isPlaying || isCapturing || !stream) return;
		isCapturing = true;
		try {
			const blob = await captureFrameBlob(videoEl);
			await storage.addFrame(seriesId, blob);
			flashCapture();
			await refreshFrames();
		} catch (err) {
			showError('Błąd zapisu klatki: ' + err.message);
		} finally {
			isCapturing = false;
		}
	}

	function flashCapture() {
		flashEl.classList.remove('flash-active');
		void flashEl.offsetWidth; // wymuś reflow, żeby animacja odpaliła się ponownie
		flashEl.classList.add('flash-active');
	}

	// ---------------------------------------------------------------------
	// Odtwarzanie (flipbook)
	// ---------------------------------------------------------------------

	async function handlePlaybackToggle() {
		if (isPlaying) {
			stopPlayback?.();
			return;
		}
		if (frames.length === 0) return;
		await playFrames();
	}

	function playFrames() {
		return new Promise((resolve) => {
			isPlaying = true;
			playbackBadge.classList.remove('is-hidden');
			videoEl.style.visibility = 'hidden';
			onionEl.style.visibility = 'hidden';
			playbackImg.style.visibility = 'visible';

			let index = 0;
			let stopped = false;
			let lastTs = performance.now();
			let localUrl = null;

			const showFrame = (i) => {
				if (localUrl) URL.revokeObjectURL(localUrl);
				localUrl = URL.createObjectURL(frames[i].blob);
				playbackImg.src = localUrl;
				updateCounter(i + 1);
			};

			const finish = () => {
				if (localUrl) URL.revokeObjectURL(localUrl);
				isPlaying = false;
				playbackBadge.classList.add('is-hidden');
				videoEl.style.visibility = 'visible';
				onionEl.style.visibility = 'visible';
				playbackImg.style.visibility = 'hidden';
				updateCounter();
				stopPlayback = null;
				resolve();
			};

			const step = (ts) => {
				if (stopped) return finish();
				if (ts - lastTs >= CONFIG.PLAYBACK_INTERVAL_MS) {
					lastTs = ts;
					index++;
					if (index >= frames.length) return finish();
					showFrame(index);
				}
				requestAnimationFrame(step);
			};

			showFrame(0);
			requestAnimationFrame(step);
			stopPlayback = () => { stopped = true; };
		});
	}

	// ---------------------------------------------------------------------
	// Błędy / pad / sprzątanie
	// ---------------------------------------------------------------------

	function showError(msg) {
		errorBanner.textContent = msg;
		errorBanner.classList.remove('is-hidden');
	}
	inputController.onButtonDown((action) => {
		switch(action) {
			case 'CONTROL_SHUTTER': 
				handleCapture();
			break;
			
			case 'CONTROL_PLAY': 
				handlePlaybackToggle();
			break;
			
			case 'CONTROL_BACK': 		
				cleanup();
				onBack();
			break;

		}
	});


	captureBtn.addEventListener('click', handleCapture);
	playBtn.addEventListener('click', handlePlaybackToggle);

	backBtn.addEventListener('click', () => {
		cleanup();
		onBack();
	});

	function cleanup() {
		inputController.stop();
		stopPlayback?.();
		stopCamera(stream);
		revokeStripUrls();
		if (onionUrl) {
			URL.revokeObjectURL(onionUrl);
			onionUrl = null;
		}
	}

	// ---------------------------------------------------------------------
	// Start
	// ---------------------------------------------------------------------

	try {
		stream = await startCamera(videoEl);
	} catch (err) {
		showError('Brak dostępu do kamery: ' + err.message);
	}

	//inputController.start();
	await refreshFrames();

	return cleanup;
}

function editorTemplate() {
	return `
		<header class="editor-topbar">
		<button id="backBtn" class="btn-ghost" type="button">← Menu</button>
		<div class="editor-title">
			<h2 id="seriesName">—</h2>
		</div>
		</header>

		<div class="viewfinder">
		<video id="cameraVideo" autoplay playsinline muted></video>
		<img id="onionOverlay" class="onion-overlay is-hidden" alt="" aria-hidden="true" />
		<img id="playbackImg" alt="Podgląd odtwarzania" style="visibility:hidden" />

		<div class="reticle" aria-hidden="true">
			<span class="corner tl"></span>
			<span class="corner tr"></span>
			<span class="corner bl"></span>
			<span class="corner br"></span>
		</div>

		<span class="mono-readout frame-counter" id="frameCounter">000</span>
		<div id="captureFlash" class="capture-flash"></div>
		<div id="playbackBadge" class="playback-badge is-hidden">▶ ODTWARZANIE</div>
		<div id="cameraError" class="camera-error is-hidden"></div>
		</div>

		<div class="frame-strip-wrap">
		<div id="frameStrip" class="frame-strip"></div>
		</div>

		<div class="fab-row">
		<button id="captureBtn" class="fab fab-capture" type="button" aria-label="Zrób zdjęcie" title="Zrób zdjęcie (pad: przycisk ${CONFIG.GAMEPAD_BUTTON_CAPTURE})"></button>
		<button id="playBtn" class="fab fab-play" type="button" aria-label="Odtwórz serię" title="Odtwórz serię (pad: przycisk ${CONFIG.GAMEPAD_BUTTON_PLAYBACK})">▶</button>
		</div>
	`;
}
