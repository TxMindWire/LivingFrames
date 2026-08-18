import { CONFIG } from './config.js';

export async function startCamera(videoEl) {
	if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
		throw new Error('Ta przeglądarka nie obsługuje dostępu do kamery (getUserMedia).');
	}

	const stream = await navigator.mediaDevices.getUserMedia(CONFIG.CAMERA_CONSTRAINTS);
	videoEl.srcObject = stream;
	await videoEl.play();
	return stream;
}

export function stopCamera(stream) {
	if (!stream) return;
	stream.getTracks().forEach((track) => track.stop());
}

const captureCanvas = document.createElement('canvas');
const captureCtx = captureCanvas.getContext('2d', { alpha: false });

/**
 * Przechwytuje aktualną klatkę wideo i zwraca ją jako skompresowany Blob JPEG,
 * przeskalowaną do CONFIG.CAPTURE_WIDTH x CONFIG.CAPTURE_HEIGHT (z zachowaniem
 * kadrowania "cover", żeby pasowało proporcją do podglądu).
 */
export function captureFrameBlob(videoEl) {
	const targetW = CONFIG.CAPTURE_WIDTH;
	const targetH = CONFIG.CAPTURE_HEIGHT;

	captureCanvas.width = targetW;
	captureCanvas.height = targetH;

	const videoW = videoEl.videoWidth;
	const videoH = videoEl.videoHeight;

	if (!videoW || !videoH) {
		return Promise.reject(new Error('Strumień wideo nie jest jeszcze gotowy.'));
	}

	// Kadrowanie "cover": wytnij środkowy fragment wideo o proporcjach targetu,
	// żeby uniknąć rozciągnięcia obrazu.
	const videoRatio = videoW / videoH;
	const targetRatio = targetW / targetH;

	let sx, sy, sw, sh;
	if (videoRatio > targetRatio) {
		sh = videoH;
		sw = videoH * targetRatio;
		sx = (videoW - sw) / 2;
		sy = 0;
	} else {
		sw = videoW;
		sh = videoW / targetRatio;
		sx = 0;
		sy = (videoH - sh) / 2;
	}

	captureCtx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, targetW, targetH);

	return new Promise((resolve, reject) => {
		captureCanvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Nie udało się zakodować JPEG.'))),
			CONFIG.CAPTURE_IMAGE_TYPE,
			CONFIG.CAPTURE_IMAGE_QUALITY
		);
	});
}