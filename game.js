(() => {
  'use strict';

  const state = {
    deck: [],
    remaining: [],
    currentCard: null,
    scores: [0, 0],
    turnScore: 0,
    currentTeam: 0,
    timerSeconds: [60, 60],
    timed: true,
    mode: 'libre',
    cardCap: 30,
    cardsPlayed: 0,
    timerId: null,
    timeLeft: 0,
    audioCtx: null,
  };

  const $ = (id) => document.getElementById(id);
  const screens = {
    setup: $('screen-setup'),
    ready: $('screen-ready'),
    game: $('screen-game'),
    turnEnd: $('screen-turn-end'),
    over: $('screen-over'),
  };

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // ---------- CSV parsing ----------
  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const cards = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(',').map(s => s.trim());
      if (parts.length < 2) continue;
      cards.push({
        palabra: parts[0],
        tabues: parts.slice(1, 6).filter(Boolean),
      });
    }
    return cards;
  }

  async function loadDeck() {
    const res = await fetch('cards.csv');
    if (!res.ok) throw new Error('No pude cargar cards.csv');
    const text = await res.text();
    state.deck = parseCSV(text);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- Feedback ----------
  function beep(freq = 660, duration = 220) {
    try {
      if (!state.audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        state.audioCtx = new Ctx();
      }
      const ctx = state.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration / 1000);
    } catch (_) {}
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  // ---------- Setup screen ----------
  function initSetup() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.mode = btn.dataset.mode;
        $('cap-input-wrapper').hidden = state.mode !== 'cap';
      });
    });

    const endlessToggle = $('endless-toggle');
    const syncEndless = () => {
      state.timed = !endlessToggle.checked;
      $('timer-inputs-wrapper').hidden = !state.timed;
      $('endless-hint').hidden = state.timed;
    };
    endlessToggle.addEventListener('change', syncEndless);
    // Browsers may restore the checkbox on reload
    syncEndless();

    $('btn-start-match').addEventListener('click', () => {
      const t1 = clamp(parseInt($('timer-team-1').value, 10) || 60, 15, 300);
      const t2 = clamp(parseInt($('timer-team-2').value, 10) || 60, 15, 300);
      state.timerSeconds = [t1, t2];
      if (state.mode === 'cap') {
        state.cardCap = clamp(parseInt($('cap-cards').value, 10) || 30, 5, 500);
      }
      startMatch();
    });
  }

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function startMatch() {
    state.scores = [0, 0];
    state.currentTeam = 0;
    state.cardsPlayed = 0;
    state.remaining = shuffle(state.deck);
    goToReady();
  }

  // ---------- Ready screen ----------
  function goToReady() {
    const teamName = `Equipo ${state.currentTeam + 1}`;
    const nameEl = $('ready-team-name');
    nameEl.textContent = teamName;
    nameEl.className = state.currentTeam === 0 ? 'team-1' : 'team-2';
    $('ready-score-1').textContent = state.scores[0];
    $('ready-score-2').textContent = state.scores[1];
    showScreen('ready');
  }

  $('btn-start-turn').addEventListener('click', () => {
    // Unlock audio on user gesture
    if (!state.audioCtx) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        state.audioCtx = new Ctx();
      } catch (_) {}
    }
    startTurn();
  });

  // ---------- Turn (game) ----------
  function startTurn() {
    state.turnScore = 0;
    const teamLabel = `Equipo ${state.currentTeam + 1}`;
    $('team-label').textContent = teamLabel;
    $('team-label').className = state.currentTeam === 0 ? 'team-1' : 'team-2';
    $('team-dot').className = state.currentTeam === 0 ? 'dot' : 'dot team-2';
    $('turn-score').textContent = '0';
    $('btn-pass-turn').hidden = state.timed;
    showScreen('game');
    if (state.timed) {
      state.timeLeft = state.timerSeconds[state.currentTeam];
      updateTimerDisplay();
      startTimer();
    } else {
      stopTimer();
      $('timer').textContent = '∞';
      $('timer').classList.remove('warning');
    }
    drawCard();
  }

  function startTimer() {
    stopTimer();
    state.timerId = setInterval(() => {
      state.timeLeft--;
      updateTimerDisplay();
      if (state.timeLeft <= 0) {
        endTurn();
      }
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  }

  function updateTimerDisplay() {
    const m = Math.floor(state.timeLeft / 60);
    const s = state.timeLeft % 60;
    $('timer').textContent = `${m}:${s.toString().padStart(2, '0')}`;
    $('timer').classList.toggle('warning', state.timeLeft <= 10);
  }

  function drawCard() {
    if (state.remaining.length === 0) {
      // Deck agotado — terminar el turno anticipado
      endTurn(true);
      return;
    }
    state.currentCard = state.remaining.pop();
    $('card-word').textContent = state.currentCard.palabra;
    const list = $('card-taboos');
    list.innerHTML = '';
    state.currentCard.tabues.forEach(t => {
      const li = document.createElement('li');
      li.textContent = t;
      list.appendChild(li);
    });
    resetCardPosition();
  }

  function resetCardPosition() {
    const card = $('card');
    card.classList.remove('swipe-left', 'swipe-right', 'dragging');
    card.style.transform = '';
    card.style.opacity = '';
    $('card-stage').classList.remove('hint-left', 'hint-right');
  }

  function acceptCard() {
    state.turnScore++;
    state.cardsPlayed++;
    $('turn-score').textContent = state.turnScore;
    animateSwipe('left', () => {
      if (shouldEndOnCap()) return endTurn();
      drawCard();
    });
  }

  function discardCard() {
    state.cardsPlayed++;
    animateSwipe('right', () => {
      if (shouldEndOnCap()) return endTurn();
      drawCard();
    });
  }

  function shouldEndOnCap() {
    return state.mode === 'cap' && state.cardsPlayed >= state.cardCap;
  }

  function animateSwipe(direction, done) {
    const card = $('card');
    card.classList.add(direction === 'left' ? 'swipe-left' : 'swipe-right');
    setTimeout(done, 260);
  }

  function endTurn(deckEmpty = false) {
    stopTimer();
    beep(880, 300);
    vibrate([200, 80, 200]);

    // Adjust score BEFORE showing summary
    state.scores[state.currentTeam] += state.turnScore;

    $('end-team-name').textContent = `Equipo ${state.currentTeam + 1}`;
    $('end-team-name').className = state.currentTeam === 0 ? 'team-1' : 'team-2';
    $('end-turn-score').textContent = state.turnScore;
    $('end-turn-label').textContent = deckEmpty
      ? 'cartas (se agotó el mazo)'
      : 'cartas en este turno';
    $('end-score-1').textContent = state.scores[0];
    $('end-score-2').textContent = state.scores[1];

    // If deck empty or cap reached, force end match after summary
    const capReached = state.mode === 'cap' && state.cardsPlayed >= state.cardCap;
    $('btn-next-team').hidden = deckEmpty || capReached;

    showScreen('turnEnd');
  }

  $('btn-next-team').addEventListener('click', () => {
    state.currentTeam = 1 - state.currentTeam;
    goToReady();
  });

  $('btn-end-match').addEventListener('click', endMatch);

  function endMatch() {
    const [s1, s2] = state.scores;
    let label;
    if (s1 > s2) label = '🏆 Ganó el Equipo 1';
    else if (s2 > s1) label = '🏆 Ganó el Equipo 2';
    else label = 'Empate';
    $('winner-label').textContent = label;
    $('final-score-1').textContent = s1;
    $('final-score-2').textContent = s2;
    showScreen('over');
  }

  $('btn-new-match').addEventListener('click', () => {
    showScreen('setup');
  });

  // ---------- Buttons: manual accept/discard ----------
  $('btn-correct').addEventListener('click', acceptCard);
  $('btn-skip').addEventListener('click', discardCard);
  $('btn-pass-turn').addEventListener('click', () => endTurn());

  // ---------- Swipe gestures ----------
  const SWIPE_THRESHOLD = 90;
  const HINT_THRESHOLD = 30;

  let dragStartX = 0;
  let dragStartY = 0;
  let dragCurrentX = 0;
  let dragging = false;

  function onPointerDown(e) {
    if (!state.currentCard) return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragCurrentX = 0;
    const card = $('card');
    card.classList.add('dragging');
    card.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    // Ignore mostly-vertical drags (allow scrolling if we ever add it)
    if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dx) < 20) return;
    dragCurrentX = dx;
    const rotation = dx / 20;
    const card = $('card');
    card.style.transform = `translateX(${dx}px) rotate(${rotation}deg)`;
    const stage = $('card-stage');
    stage.classList.toggle('hint-left', dx < -HINT_THRESHOLD);
    stage.classList.toggle('hint-right', dx > HINT_THRESHOLD);
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    const card = $('card');
    card.classList.remove('dragging');
    try { card.releasePointerCapture(e.pointerId); } catch (_) {}
    if (dragCurrentX <= -SWIPE_THRESHOLD) {
      acceptCard();
    } else if (dragCurrentX >= SWIPE_THRESHOLD) {
      discardCard();
    } else {
      resetCardPosition();
    }
  }

  function initSwipe() {
    const card = $('card');
    card.addEventListener('pointerdown', onPointerDown);
    card.addEventListener('pointermove', onPointerMove);
    card.addEventListener('pointerup', onPointerUp);
    card.addEventListener('pointercancel', onPointerUp);
  }

  // ---------- Boot ----------
  async function boot() {
    initSetup();
    initSwipe();
    try {
      await loadDeck();
    } catch (err) {
      alert('Error cargando las cartas: ' + err.message + '\n\nAbrí el juego desde un servidor local (por ejemplo: python3 -m http.server).');
      return;
    }
  }

  boot();
})();
