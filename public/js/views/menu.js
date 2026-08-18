/**
 * Widok głównego menu — lista serii + tworzenie nowej.
 */

import * as storage from '../storage.js';

// Object URL-e miniaturek trzeba zwalniać między renderami, inaczej wyciekają.
let activeThumbUrls = [];

function revokeThumbUrls() {
  activeThumbUrls.forEach((url) => URL.revokeObjectURL(url));
  activeThumbUrls = [];
}

export async function renderMenuView({ onCreate, onOpenSeries }) {
  revokeThumbUrls();

  const root = document.getElementById('menuView');
  root.innerHTML = menuTemplate();

  const listEl = root.querySelector('#seriesList');
  const emptyEl = root.querySelector('#seriesEmpty');
  const newBtn = root.querySelector('#newSeriesBtn');

  newBtn.addEventListener('click', () => onCreate());

  const seriesList = await storage.listSeries();

  if (seriesList.length === 0) {
    emptyEl.classList.remove('is-hidden');
    listEl.classList.add('is-hidden');
    return;
  }

  emptyEl.classList.add('is-hidden');
  listEl.classList.remove('is-hidden');

  // Jeden listener na kontener zamiast osobnego na każdą kartę — ID serii
  // czytane jest z atrybutu data-* w momencie kliknięcia, a nie z domknięcia
  // pętli. To całkowicie eliminuje ryzyko "złego" ID przy błędnie
  // działającej pętli / domknięciu w nietypowych silnikach przeglądarki.
  listEl.addEventListener('click', (event) => {
    const card = event.target.closest('.series-card');
    if (!card) return;
    const seriesId = card.dataset.seriesId;
    if (seriesId) onOpenSeries(seriesId);
  });

  for (const series of seriesList) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'series-card';
    card.dataset.seriesId = series.id;
    card.innerHTML = `
      <div class="series-thumb" data-thumb>
        <span class="series-thumb-placeholder">◈</span>
      </div>
      <div class="series-info">
        <div class="series-name">${escapeHtml(series.name)}</div>
        <div class="series-meta">${series.frameCount} ${pluralFrames(series.frameCount)} · ${formatDate(series.updatedAt)}</div>
      </div>
    `;
    listEl.appendChild(card);

    storage.getFirstFrame(series.id).then((frame) => {
      if (!frame) return;
      const thumbEl = card.querySelector('[data-thumb]');
      const url = URL.createObjectURL(frame.blob);
      activeThumbUrls.push(url);
      thumbEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      thumbEl.appendChild(img);
    });
  }
}

function pluralFrames(n) {
  if (n === 1) return 'klatka';
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'klatki';
  return 'klatek';
}

function formatDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function menuTemplate() {
  return `
    <div class="menu-header">
      <div class="brand">
        <span class="brand-mark">◈</span>
        <div class="brand-text">
          <h1>KLATKA</h1>
          <p class="subtitle">Film poklatkowy · sterowanie padem</p>
        </div>
      </div>
      <button id="newSeriesBtn" class="btn-primary" type="button">+ Nowa seria</button>
    </div>

    <div id="seriesEmpty" class="empty-state is-hidden">
      <div class="empty-visual">
        <svg viewBox="0 0 200 120" width="200" aria-hidden="true">
          <rect x="20" y="20" width="160" height="80" rx="10" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5"/>
          <circle cx="100" cy="60" r="22" fill="none" stroke="currentColor" stroke-width="2" opacity="0.6"/>
          <circle cx="100" cy="60" r="4" fill="currentColor"/>
        </svg>
      </div>
      <h2>Brak serii</h2>
      <p>Stwórz pierwszą serię i zacznij zbierać klatki do animacji.</p>
    </div>

    <div id="seriesList" class="series-list"></div>
  `;
}
