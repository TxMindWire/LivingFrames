'use strict';

// Wersjonuj przy każdej zmianie plików statycznych, żeby wymusić
// odświeżenie cache u klientów.
const CACHE_NAME = 'klatka-v2';

const APP_SHELL = [
	'./',
	'./index.html',
	'./style.css',
	'./manifest.json',
	'./js/main.js',
	'./js/config.js',
	'./js/storage.js',
	'./js/camera.js',
	'./js/InputController.js',
	'./js/views/menu.js',
	'./js/views/editor.js',
	'./icons/icon.svg',
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then((cache) => cache.addAll(APP_SHELL))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
		).then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	event.respondWith(
		caches.match(request).then((cached) => {
			if (cached) return cached;
			return fetch(request)
				.then((response) => {
					const copy = response.clone();
					caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
					return response;
				})
				.catch(() => cached);
		})
	);
});