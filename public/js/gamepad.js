/**
 * Generyczna obsługa pada — wykrywanie podłączenia i zdarzeń "wciśnięcia"
 * przycisków (edge-triggered: callback woła się raz przy przejściu
 * puszczony -> wciśnięty, nie w kółko podczas trzymania).
 *
 * Celowo bez zależności od konkretnej logiki aplikacji — mapowanie
 * przycisk -> akcja robi wywołujący (patrz js/config.js).
 */

export function createGamepadWatcher({ onButtonDown, onConnectionChange } = {}) {
  let rafId = null;
  const prevButtonStates = new Map(); // padIndex -> bool[]
  let connectedIndexes = new Set();

  function poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const nowConnected = new Set();

    for (const gp of pads) {
      if (!gp) continue;
      nowConnected.add(gp.index);

      let prev = prevButtonStates.get(gp.index);
      if (!prev) {
        prev = gp.buttons.map(() => false);
        prevButtonStates.set(gp.index, prev);
      }

      gp.buttons.forEach((btn, i) => {
        if (btn.pressed && !prev[i]) {
          onButtonDown?.(i, gp.index);
        }
        prev[i] = btn.pressed;
      });
    }

    for (const idx of connectedIndexes) {
      if (!nowConnected.has(idx)) prevButtonStates.delete(idx);
    }

    const changed =
      nowConnected.size !== connectedIndexes.size ||
      [...nowConnected].some((i) => !connectedIndexes.has(i));

    if (changed) {
      connectedIndexes = nowConnected;
      onConnectionChange?.(connectedIndexes.size > 0, connectedIndexes.size);
    }

    rafId = requestAnimationFrame(poll);
  }

  return {
    start() {
      if (rafId) return;
      rafId = requestAnimationFrame(poll);
    },
    stop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      prevButtonStates.clear();
      connectedIndexes = new Set();
    },
  };
}

/**
 * Zapasowe sterowanie z klawiatury — przydatne przy testowaniu na
 * desktopie bez podłączonego pada. Spacja = capture, Enter = playback.
 */
export function createKeyboardFallback({ onCapture, onPlayback } = {}) {
  function handleKeydown(e) {
    if (e.repeat) return;
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    if (e.code === 'Space') {
      e.preventDefault();
      onCapture?.();
    } else if (e.code === 'Enter') {
      e.preventDefault();
      onPlayback?.();
    }
  }

  return {
    start() { window.addEventListener('keydown', handleKeydown); },
    stop() { window.removeEventListener('keydown', handleKeydown); },
  };
}