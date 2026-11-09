/**
 * Centralna konfiguracja aplikacji.
 * Wszystkie "magiczne liczby" (guziki pada, jakość zdjęć, timing) żyją tutaj.
 */

export const CONFIG = Object.freeze({
	// ---- Sterowanie padem ----
	// Numery przycisków wg mapowania "standard" Gamepad API.
	CONTROL_EDITOR: {
		CONTROL_SHUTTER: ['PAD_1_BUTTON_5', 'KEYBOARD_SPACE'],
		CONTROL_PLAY: ['PAD_1_BUTTON_1', 'KEYBOARD_ENTER'],
		CONTROL_BACK: ['PAD_1_BUTTON_3', 'KEYBOARD_ESCAPE'],
	},

	// ---- Podgląd klatek (odtwarzanie) ----
	PLAYBACK_INTERVAL_MS: 250,

	// ---- Zapis zdjęć ----
	CAPTURE_IMAGE_TYPE: 'image/jpeg',
	CAPTURE_IMAGE_QUALITY: 0.8,
	CAPTURE_WIDTH: 640,
	CAPTURE_HEIGHT: 480,

	// ---- Kamera ----
	CAMERA_CONSTRAINTS: {
		audio: false,
		video: {
			facingMode: { ideal: 'environment' },
			width: { ideal: 640 },
			height: { ideal: 480 },
		},
	},

	// ---- IndexedDB ----
	DB_NAME: 'klatka-db',
	DB_VERSION: 1,
	STORE_SERIES: 'series',
	STORE_FRAMES: 'frames',
});