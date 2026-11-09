/**
 * Punkt wejścia aplikacji: prosty router dwuwidokowy (menu / edytor)
 * + inicjalizacja PWA (storage trwały, service worker).
 */

import * as storage from './storage.js';
import { renderMenuView } from './views/menu.js';
import { openEditorView } from './views/editor.js';

const menuViewEl = document.getElementById('menuView');
const editorViewEl = document.getElementById('editorView');

let editorCleanup = null;

async function showMenu() {
	if (editorCleanup) {
		editorCleanup();
		editorCleanup = null;
	}
	editorViewEl.classList.add('is-hidden');
	menuViewEl.classList.remove('is-hidden');
	await renderMenuView({ onCreate: handleCreateSeries, onOpenSeries: showEditor });
}

async function showEditor(seriesId) {
	menuViewEl.classList.add('is-hidden');
	editorViewEl.classList.remove('is-hidden');
	editorCleanup = await openEditorView(seriesId, { onBack: showMenu });
}

async function handleCreateSeries() {
	const series = await storage.createSeries();
	showEditor(series.id);
}

function registerServiceWorker() {
	if (!('serviceWorker' in navigator)) return;
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('sw.js').catch((err) => {
			console.warn('Rejestracja Service Workera nieudana:', err);
		});
	});
}

async function init() {
	await storage.requestPersistentStorage();
	registerServiceWorker();
	await showMenu();
}

init();
