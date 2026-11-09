/**
 * InputController – mapuje przyciski klawiatury i padów na komendy.
 *
 * Nazewnictwo przycisków (zwykłe stringi, numeracja od 1):
 *   Klawiatura:  KEYBOARD_A, KEYBOARD_1, KEYBOARD_SPACE, KEYBOARD_ARROW_LEFT, KEYBOARD_SHIFT_LEFT ...
 *                (nazwa = KeyboardEvent.code bez "Key"/"Digit", zapisana jako UPPER_SNAKE_CASE)
 *   Pad, przycisk: PAD_1_BUTTON_1, PAD_2_BUTTON_8 ...   (triggery analogowe też są przyciskami)
 *   Pad, gałka:    PAD_1_AXIS_1_NEGATIVE, PAD_1_AXIS_1_POSITIVE ...
 *                  (oś = dwa osobne "przyciski analogowe", każdy z wartością 0..1,
 *                   dzięki temu lewo/prawo mogą mieć różne komendy)
 *
 * Jeśli ten sam przycisk jest przypisany do kilku komend, wygrywa ta, która
 * w konfiguracji występuje najpóźniej.
 *
 * Przykład:
 *   const COMMANDS = { LEFT: 'IDZ_LEWO', RIGHT: 'IDZ_PRAWO', JUMP: 'SKACZ' };
 *   const input = new InputController({
 *     IDZ_LEWO:  ['PAD_1_AXIS_1_NEGATIVE', 'PAD_1_BUTTON_15', 'KEYBOARD_A', 'KEYBOARD_ARROW_LEFT'],
 *     IDZ_PRAWO: ['PAD_1_AXIS_1_POSITIVE', 'PAD_1_BUTTON_16', 'KEYBOARD_D', 'KEYBOARD_ARROW_RIGHT'],
 *     SKACZ:     ['PAD_1_BUTTON_1', 'KEYBOARD_SPACE'],
 *   });
 *   input.onButtonDown((command, value) => ...);
 *   input.onButtonUp((command, value) => ...);
 *   input.onButtonChange((command, value) => ...);
 *   input.onPadConnect((padNumber, gamepad) => ...);
 *   input.onPadDisconnect((padNumber, gamepad) => ...);
 */

const HAS_WINDOW = typeof window !== 'undefined';

const PAD_BUTTON_RE = /^PAD_(\d+)_BUTTON_(\d+)$/;
const PAD_AXIS_RE = /^PAD_(\d+)_AXIS_(\d+)_(NEGATIVE|POSITIVE)$/;

export default class InputController {
	/**
	 * @param {Object<string, string[]>} bindings  { KOMENDA: [PRZYCISK, ...] }
	 * @param {Object} [options]
	 * @param {number} [options.deadzone=0.15]  martwa strefa dla wartości analogowych (0..1)
	 * @param {EventTarget} [options.target=window]  cel nasłuchiwania zdarzeń klawiatury
	 * @param {boolean} [options.autoStart=true]
	 * @param {boolean} [options.preventDefault=false]  blokuje domyślną akcję przeglądarki
	 *        (np. przewijanie strzałkami/spacją), ale tylko dla klawiszy użytych w konfiguracji
	 */
	constructor(bindings, {
		deadzone = 0.15,
		target = HAS_WINDOW ? window : null,
		autoStart = true,
		preventDefault = false,
	} = {}) {
		this._deadzone = deadzone;
		this._target = target;
		this._preventDefault = preventDefault;
		this._listeners = {
			down: new Set(),
			up: new Set(),
			change: new Set(),
			padConnect: new Set(),
			padDisconnect: new Set(),
		};
		this._keyCache = new Map(); // KeyboardEvent.code -> nazwa przycisku (np. "KeyA" -> "KEYBOARD_A")
		this._running = false;
		this._rafId = null;

		this._onKeyDown = this._onKeyDown.bind(this);
		this._onKeyUp = this._onKeyUp.bind(this);
		this._onBlur = this._onBlur.bind(this);
		this._onGamepadConnected = this._onGamepadConnected.bind(this);
		this._onGamepadDisconnected = this._onGamepadDisconnected.bind(this);
		this._poll = this._poll.bind(this);

		this.setBindings(bindings);
		if (autoStart) this.start();
	}

	// ---------------------------------------------------------------- konfiguracja

	/**
	 * Ustawia (lub podmienia) mapowanie. Aktywne komendy są najpierw puszczane
	 * (z wywołaniem onButtonUp), a potem obowiązuje już tylko nowa konfiguracja.
	 * Przycisk przypisany do kilku komend trafia do tej, która jest w konfiguracji najpóźniej.
	 */
	setBindings(bindings) {
		if (this._buttonValues) this._releaseAll(); // nie dotyczy pierwszego wywołania z konstruktora

		const buttonToCommand = new Map();
		for (const [command, buttons] of Object.entries(bindings)) {
			for (const button of buttons) buttonToCommand.set(button, command);
		}

		const commandButtons = new Map(Object.keys(bindings).map((command) => [command, []]));
		for (const [button, command] of buttonToCommand) commandButtons.get(command).push(button);

		this._buttonToCommand = buttonToCommand;
		this._commandButtons = commandButtons;
		this._buttonValues = new Map([...buttonToCommand.keys()].map((b) => [b, 0]));
		this._commandValues = new Map([...commandButtons.keys()].map((c) => [c, 0]));
		this._keyboardButtons = [...buttonToCommand.keys()].filter((b) => b.startsWith('KEYBOARD_'));
		this._padInputs = this._parsePadInputs(buttonToCommand.keys());

		this._updatePolling();
	}

	/**
	 * Wstępnie parsuje przyciski i osie padów, żeby pętla pollingu była tania.
	 * Pole `value` to ostatnia odczytana wartość – dzięki temu _setButton jest wołany tylko przy zmianie.
	 */
	_parsePadInputs(buttonNames) {
		const inputs = [];
		for (const name of buttonNames) {
			let m = PAD_BUTTON_RE.exec(name);
			if (m) {
				inputs.push({ name, pad: Number(m[1]) - 1, index: Number(m[2]) - 1, isAxis: false, sign: 1, value: 0 });
				continue;
			}
			m = PAD_AXIS_RE.exec(name);
			if (m) {
				inputs.push({
					name,
					pad: Number(m[1]) - 1,
					index: Number(m[2]) - 1,
					isAxis: true,
					sign: m[3] === 'NEGATIVE' ? -1 : 1,
					value: 0,
				});
			}
		}
		return inputs;
	}

	// ---------------------------------------------------------------- cykl życia

	start() {
		if (this._running) return;
		this._running = true;
		if (this._target) {
			this._target.addEventListener('keydown', this._onKeyDown);
			this._target.addEventListener('keyup', this._onKeyUp);
		}
		if (HAS_WINDOW) {
			window.addEventListener('blur', this._onBlur);
			window.addEventListener('gamepadconnected', this._onGamepadConnected);
			window.addEventListener('gamepaddisconnected', this._onGamepadDisconnected);
		}
		this._updatePolling();
	}

	stop() {
		if (!this._running) return;
		this._running = false;
		if (this._target) {
			this._target.removeEventListener('keydown', this._onKeyDown);
			this._target.removeEventListener('keyup', this._onKeyUp);
		}
		if (HAS_WINDOW) {
			window.removeEventListener('blur', this._onBlur);
			window.removeEventListener('gamepadconnected', this._onGamepadConnected);
			window.removeEventListener('gamepaddisconnected', this._onGamepadDisconnected);
		}
		this._updatePolling();
		this._releaseAll();
	}

	destroy() {
		// Najpierw czyścimy nasłuchy, żeby zatrzymanie nie wywoływało już callbacków (onButtonUp).
		for (const set of Object.values(this._listeners)) set.clear();
		this.stop();
	}

	// ---------------------------------------------------------------- callbacki

	/** callback(command, value, button) – komenda przeszła ze stanu 0 do aktywnego. Zwraca funkcję wypisującą. */
	onButtonDown(callback) { return this._subscribe('down', callback); }

	/** callback(command, value, button) – komenda wróciła do 0 (value === 0). */
	onButtonUp(callback) { return this._subscribe('up', callback); }

	/**
	 * callback(command, value, button) – każda zmiana wartości komendy (0..1).
	 * Wołany także przy wciśnięciu (po onButtonDown) i puszczeniu (przed onButtonUp).
	 */
	onButtonChange(callback) { return this._subscribe('change', callback); }

	/** callback(padNumber, gamepad) – pad podłączony (padNumber liczony od 1, jak w nazwach PAD_<n>_...). */
	onPadConnect(callback) { return this._subscribe('padConnect', callback); }

	/** callback(padNumber, gamepad) – pad odłączony. Jego przyciski są wtedy zerowane (zwykłe onButtonUp/onButtonChange). */
	onPadDisconnect(callback) { return this._subscribe('padDisconnect', callback); }

	_subscribe(type, callback) {
		this._listeners[type].add(callback);
		return () => this._listeners[type].delete(callback);
	}

	/** Wywołuje wszystkie callbacki danego typu. Błąd w jednym nie blokuje pozostałych ani pollingu. */
	_emit(type, ...args) {
		for (const callback of this._listeners[type]) {
			try {
				callback(...args);
			} catch (error) {
				console.error(`InputController: błąd w callbacku "${type}"`, error);
			}
		}
	}

	// ---------------------------------------------------------------- odczyt stanu

	/** Aktualna wartość komendy 0..1 (maksimum ze wszystkich jej przycisków). */
	getValue(command) { return this._commandValues.get(command) ?? 0; }

	isPressed(command) { return this.getValue(command) > 0; }

	// ---------------------------------------------------------------- klawiatura

	static keyName(code) {
		return code
			.replace(/^(Key|Digit)/, '')
			.replace(/([a-z])([A-Z0-9])/g, '$1_$2')
			.toUpperCase();
	}

	/** Nazwa przycisku dla KeyboardEvent.code, z cache'em, bo regexy nie muszą liczyć się przy każdym zdarzeniu. */
	_keyButton(code) {
		let name = this._keyCache.get(code);
		if (name === undefined) {
			name = `KEYBOARD_${InputController.keyName(code)}`;
			this._keyCache.set(code, name);
		}
		return name;
	}

	_onKeyDown(e) {
		if (!e.code) return; // syntetyczne zdarzenia (np. autouzupełnianie) bywają bez code
		const button = this._keyButton(e.code);
		if (!this._buttonToCommand.has(button)) return;
		if (this._preventDefault) e.preventDefault();
		if (e.repeat) return;
		this._setButton(button, 1);
	}

	_onKeyUp(e) {
		if (!e.code) return;
		const button = this._keyButton(e.code);
		if (!this._buttonToCommand.has(button)) return;
		if (this._preventDefault) e.preventDefault();
		this._setButton(button, 0);
	}

	_onBlur() {
		// utrata fokusu = nie dostaniemy keyup, więc puszczamy klawisze ręcznie
		for (const button of this._keyboardButtons) this._setButton(button, 0);
	}

	// ---------------------------------------------------------------- pady

	_onGamepadConnected(e) {
		this._emit('padConnect', e.gamepad.index + 1, e.gamepad);
	}

	_onGamepadDisconnected(e) {
		// Zerujemy przyciski od razu, żeby komendy nie "zawisły" do następnej klatki pollingu.
		const pad = e.gamepad.index;
		for (const input of this._padInputs) {
			if (input.pad !== pad) continue;
			input.value = 0;
			this._setButton(input.name, 0);
		}
		this._emit('padDisconnect', pad + 1, e.gamepad);
	}

	/** Pętla pollingu jest potrzebna tylko wtedy, gdy klasa działa i w konfiguracji są przyciski padów. */
	_updatePolling() {
		const needed = this._running && this._padInputs.length > 0 && typeof requestAnimationFrame !== 'undefined';
		if (needed && this._rafId === null) {
			this._rafId = requestAnimationFrame(this._poll);
		} else if (!needed && this._rafId !== null) {
			cancelAnimationFrame(this._rafId);
			this._rafId = null;
		}
	}

	_getConnectedPads() {
		const all = navigator.getGamepads ? navigator.getGamepads() : [];
		return Array.from(all).filter((pad) => pad && pad.connected);
	}

	_poll() {
		if (!this._running) return;
		// Następną klatkę planujemy od razu, żeby wyjątek w dalszej części nie zatrzymał pollingu na stałe.
		this._rafId = requestAnimationFrame(this._poll);

		const pads = this._getConnectedPads();

		for (const input of this._padInputs) {
			const gamepad = pads[input.pad];
			let raw = 0;
			if (gamepad) {
				raw = input.isAxis
					? Math.max(0, (gamepad.axes[input.index] ?? 0) * input.sign)
					: gamepad.buttons[input.index]?.value ?? 0;
			}

			const value = this._applyDeadzone(raw);
			if (value === input.value) continue;
			input.value = value;
			this._setButton(input.name, value);
		}
	}

	_applyDeadzone(v) {
		if (v <= this._deadzone) return 0;
		return Math.min(1, (v - this._deadzone) / (1 - this._deadzone)); // przeskalowanie do 0..1
	}

	// ---------------------------------------------------------------- rdzeń

	_setButton(button, value) {
		const command = this._buttonToCommand.get(button);
		if (command === undefined) return;
		if (this._buttonValues.get(button) === value) return;

		this._buttonValues.set(button, value);

		// Wartość komendy = max z jej przycisków, więc puszczenie jednego z dwóch
		// wciśniętych przycisków nie kończy komendy.
		let next = 0;
		for (const b of this._commandButtons.get(command)) {
			next = Math.max(next, this._buttonValues.get(b));
		}

		const prev = this._commandValues.get(command);
		if (next === prev) return;
		this._commandValues.set(command, next);

		if (prev === 0 && next > 0) this._emit('down', command, next, button);
		this._emit('change', command, next, button);
		if (prev > 0 && next === 0) this._emit('up', command, 0, button);
	}

	_releaseAll() {
		for (const input of this._padInputs) input.value = 0; // zsynchronizowanie cache'a z pollingu
		for (const button of this._buttonValues.keys()) this._setButton(button, 0);
	}
}
