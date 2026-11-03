(() => {
  'use strict';

  /* ==========================================================================
     MERAKI / MAP SELECTOR — Tactical Engine & State Controller
     ========================================================================== */

  const maps = [
    {
      id: 'bermuda',
      name: 'Bermuda',
      colors: ['#0f3e2e', '#071f16'],
      image: 'assets/bermuda.webp',
      fallbackImage: 'assets/bermuda.jpg',
      badge: 'ZONE 01'
    },
    {
      id: 'purgatory',
      name: 'Purgatory',
      colors: ['#591d24', '#260a10'],
      image: 'assets/purgatory.webp',
      fallbackImage: 'assets/purgatory.jpg',
      badge: 'ZONE 02'
    },
    {
      id: 'kalahari',
      name: 'Kalahari',
      colors: ['#693c18', '#2e1808'],
      image: 'assets/kalahari.webp',
      fallbackImage: 'assets/kalahari.jpg',
      badge: 'ZONE 03'
    },
    {
      id: 'alpine',
      name: 'Alpine',
      colors: ['#182f42', '#0c1724'],
      image: 'assets/alpine-fallback.svg',
      fallbackImage: null,
      badge: 'ZONE 04 · RADAR'
    },
    {
      id: 'nexterra',
      name: 'Nexterra',
      colors: ['#1c3563', '#111d38'],
      image: 'assets/nexterra.webp',
      fallbackImage: 'assets/nexterra.png',
      badge: 'ZONE 05'
    },
    {
      id: 'solara',
      name: 'Solara',
      colors: ['#4b2447', '#210e20'],
      image: 'assets/solara.webp',
      fallbackImage: 'assets/solara.jpg',
      badge: 'ZONE 06'
    }
  ];

  // DOM Elements
  const $ = (id) => document.getElementById(id);
  const belt = $('belt');
  const button = $('draw');
  const nameOut = $('resultName');
  const label = $('resultLabel');
  const status = $('status');
  const lastDropNameEl = $('lastDropName');
  const lastDropInfo = $('lastDropInfo');
  const mapControls = $('mapControls');
  const reveal = $('reveal');
  const revealCard = $('revealCard');
  const revealName = $('revealName');
  const revealArt = $('revealArt');
  const revealClose = $('revealClose');
  const revealBackdrop = $('revealBackdrop');
  const marqueeTrack = $('marqueeTrack');
  const marqueeViewport = marqueeTrack ? marqueeTrack.parentElement : null;

  // Runtime State
  let busy = false;
  let audioContext = null;
  let currentMapName = null;
  let lastDropName = null;
  let revealTimer = null;
  let revealSequence = 0;
  let revealStageTimers = [];
  let previousActiveElement = null;

  const recent = [];
  let enabled = new Set(maps.map((m) => m.name));

  /* --------------------------------------------------------------------------
     1. Image Cache & Preloader Architecture
     -------------------------------------------------------------------------- */
  const imageCache = new Map();

  async function preloadImage(src, fallback) {
    if (!src) return null;
    if (imageCache.has(src)) return imageCache.get(src);

    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';

      const handleSuccess = () => {
        if (img.decode) {
          img.decode()
            .catch(() => {})
            .finally(() => {
              imageCache.set(src, img);
              resolve(img);
            });
        } else {
          imageCache.set(src, img);
          resolve(img);
        }
      };

      img.onload = handleSuccess;
      img.onerror = () => {
        if (fallback) {
          const fbImg = new Image();
          fbImg.decoding = 'async';
          fbImg.onload = () => {
            imageCache.set(src, fbImg);
            resolve(fbImg);
          };
          fbImg.onerror = () => {
            console.warn(`[MERAKI] Failed to load image asset: ${src}`);
            resolve(null);
          };
          fbImg.src = fallback;
        } else {
          console.warn(`[MERAKI] Failed to load image asset: ${src}`);
          resolve(null);
        }
      };

      img.src = src;
    });
  }

  function preloadActivePool() {
    maps.filter((m) => enabled.has(m.name)).forEach((m) => {
      preloadImage(m.image, m.fallbackImage);
    });
  }

  /* --------------------------------------------------------------------------
     2. Persistent Belt Tile Architecture (Prevents DOM Thrashing & Jitter)
     -------------------------------------------------------------------------- */
  let beltTile = null;
  let beltImg = null;
  let beltBadge = null;
  let beltName = null;

  function initBeltTile() {
    belt.replaceChildren();

    beltTile = document.createElement('div');
    beltTile.className = 'tile';

    beltImg = document.createElement('img');
    beltImg.className = 'map-art';
    beltImg.alt = '';
    beltImg.loading = 'eager';

    beltBadge = document.createElement('span');
    beltBadge.className = 'badge';

    beltName = document.createElement('span');
    beltName.className = 'name';

    beltTile.append(beltImg, beltBadge, beltName);
    belt.append(beltTile);
  }

  function renderTile(map) {
    if (!beltTile) initBeltTile();

    beltTile.style.setProperty('--c1', map.colors[0]);
    beltTile.style.setProperty('--c2', map.colors[1]);
    beltBadge.textContent = map.badge;
    beltName.textContent = map.name;

    if (map.image) {
      beltImg.style.display = 'block';
      beltImg.alt = `${map.name} battleground`;
      if (beltImg.getAttribute('src') !== map.image) {
        beltImg.src = map.image;
      }
    } else {
      beltImg.style.display = 'none';
      beltImg.removeAttribute('src');
    }
  }

  /* --------------------------------------------------------------------------
     3. Backward-Compatible Storage Management
     -------------------------------------------------------------------------- */
  function loadStorageState() {
    try {
      // 1. Map Pool migration
      let pool = JSON.parse(localStorage.getItem('meraki_map_pool') || 'null');
      if (!Array.isArray(pool)) {
        pool = JSON.parse(localStorage.getItem('dropzone-map-pool') || 'null');
        if (Array.isArray(pool)) {
          localStorage.setItem('meraki_map_pool', JSON.stringify(pool));
        }
      }
      if (Array.isArray(pool)) {
        const valid = pool.filter((n) => maps.some((m) => m.name === n));
        if (valid.length > 0) {
          enabled = new Set(valid);
        }
      }

      // 2. History migration
      let saved = JSON.parse(localStorage.getItem('meraki_map_history') || 'null');
      if (!Array.isArray(saved)) {
        saved = JSON.parse(localStorage.getItem('dropzone-map-history') || 'null');
        if (!Array.isArray(saved)) {
          const prior = JSON.parse(localStorage.getItem('dropzone-map-stats') || 'null');
          saved = prior?.recent || null;
        }
        if (Array.isArray(saved)) {
          localStorage.setItem('meraki_map_history', JSON.stringify(saved));
        }
      }
      if (Array.isArray(saved)) {
        recent.push(...saved.filter((n) => maps.some((m) => m.name === n)));
        currentMapName = recent[0] || null;
        lastDropName = currentMapName;
      }
    } catch (_) {
      // Gracefully handle private-browsing / disabled storage
    }
  }

  function persistPool() {
    try {
      const data = JSON.stringify([...enabled]);
      localStorage.setItem('meraki_map_pool', data);
      localStorage.setItem('dropzone-map-pool', data); // Legacy mirror
    } catch (_) {}
  }

  function persistDrop(map) {
    lastDropName = recent[0] || null;
    currentMapName = map.name;
    recent.unshift(map.name);
    try {
      const histData = JSON.stringify(recent);
      localStorage.setItem('meraki_map_history', histData);
      localStorage.setItem('meraki_last_map', map.name);
      localStorage.setItem('dropzone-map-history', histData); // Legacy mirror
      localStorage.setItem('dropzone-last-map', map.name);
    } catch (_) {}
    renderLastDrop();
    renderPool();
  }

  /* --------------------------------------------------------------------------
     4. Audio Synthesizer (Web Audio API)
     -------------------------------------------------------------------------- */
  function playSound(kind) {
    try {
      audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      const t = audioContext.currentTime;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(audioContext.destination);

      if (kind === 'spin') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(110, t);
        osc.frequency.exponentialRampToValueAtTime(540, t + 0.32);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(360, t);
        filter.frequency.exponentialRampToValueAtTime(1600, t + 0.32);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.18, t + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
        osc.start(t);
        osc.stop(t + 0.44);
      } else if (kind === 'tick') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(740, t);
        osc.frequency.exponentialRampToValueAtTime(320, t + 0.08);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1900, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.07, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        osc.start(t);
        osc.stop(t + 0.095);
      } else {
        // 'hit' lock-in tone
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(65, t + 0.35);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.28, t + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);
        osc.start(t);
        osc.stop(t + 0.54);

        const ch = audioContext.createOscillator();
        const cg = audioContext.createGain();
        ch.type = 'sine';
        ch.frequency.setValueAtTime(660, t);
        ch.frequency.setValueAtTime(880, t + 0.08);
        cg.gain.setValueAtTime(0.0001, t);
        cg.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        ch.connect(cg);
        cg.connect(audioContext.destination);
        ch.start(t);
        ch.stop(t + 0.42);
      }
    } catch (_) {}
  }

  /* --------------------------------------------------------------------------
     5. UI Renderers
     -------------------------------------------------------------------------- */
  function renderPool() {
    mapControls.replaceChildren();

    maps.forEach((map) => {
      const isIncluded = enabled.has(map.name);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'map-toggle';
      btn.textContent = map.name;
      btn.disabled = busy;
      btn.setAttribute('aria-pressed', String(isIncluded));
      btn.setAttribute('aria-label', `${map.name} ${isIncluded ? 'included in pool' : 'excluded from pool'}`);
      btn.dataset.current = String(map.name === currentMapName);

      btn.addEventListener('click', () => {
        if (busy) return;
        if (isIncluded) {
          enabled.delete(map.name);
        } else {
          enabled.add(map.name);
          preloadImage(map.image, map.fallbackImage);
        }

        persistPool();
        renderPool();

        const hasMaps = enabled.size > 0;
        button.disabled = busy || !hasMaps;
        status.textContent = hasMaps
          ? `${map.name} ${enabled.has(map.name) ? 'included in' : 'excluded from'} the pool.`
          : 'Active pool is empty. Enable at least one map to spin.';
      });

      mapControls.append(btn);
    });

    button.disabled = busy || enabled.size === 0;
  }

  function renderLastDrop() {
    lastDropNameEl.textContent = lastDropName || '—';
    lastDropInfo.classList.toggle('has-map', Boolean(currentMapName));
  }

  /* --------------------------------------------------------------------------
     6. Accessible Reveal Dialog Controller
     -------------------------------------------------------------------------- */
  function clearRevealStages() {
    for (const t of revealStageTimers) clearTimeout(t);
    revealStageTimers = [];
  }

  function closeReveal() {
    clearTimeout(revealTimer);
    clearRevealStages();
    revealSequence++;
    reveal.classList.remove('open', 'label-in', 'name-in', 'locked-in', 'settled');
    reveal.setAttribute('aria-hidden', 'true');

    // Restore focus to trigger button
    if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
      previousActiveElement.focus();
    } else {
      button.focus();
    }
  }

  function scheduleRevealStage(run, delay, className) {
    const timer = setTimeout(() => {
      if (run === revealSequence && reveal.classList.contains('open')) {
        reveal.classList.add(className);
      }
    }, delay);
    revealStageTimers.push(timer);
  }

  function openReveal(winner, reducedMotion) {
    previousActiveElement = document.activeElement;
    revealCard.style.setProperty('--c1', winner.colors[0]);
    revealCard.style.setProperty('--c2', winner.colors[1]);

    if (winner.image) {
      revealArt.style.display = 'block';
      revealArt.alt = `${winner.name} battleground`;
      revealArt.src = winner.image;
    } else {
      revealArt.style.display = 'none';
      revealArt.removeAttribute('src');
    }

    revealName.textContent = winner.name;
    clearRevealStages();
    const run = ++revealSequence;

    reveal.classList.remove('label-in', 'name-in', 'locked-in', 'settled');
    reveal.setAttribute('aria-hidden', 'false');
    reveal.classList.add('open');

    // Focus close button for accessible dialog compliance
    if (revealClose) {
      revealClose.focus();
    }

    if (reducedMotion) {
      reveal.classList.add('label-in', 'name-in', 'locked-in', 'settled');
    } else {
      scheduleRevealStage(run, 60, 'label-in');
      scheduleRevealStage(run, 240, 'name-in');
      scheduleRevealStage(run, 580, 'locked-in');
      scheduleRevealStage(run, 1100, 'settled');
    }

    revealTimer = setTimeout(closeReveal, 4800);
  }

  /* --------------------------------------------------------------------------
     7. Roulette Spin Controller
     -------------------------------------------------------------------------- */
  function draw() {
    if (busy || reveal.classList.contains('open')) return;

    if (!enabled.size) {
      status.textContent = 'Active pool is empty. Enable at least one map to spin.';
      button.disabled = true;
      return;
    }

    busy = true;
    renderPool();
    button.textContent = 'SELECTING…';
    label.textContent = 'DRAWING BATTLEGROUND';
    nameOut.textContent = '';
    status.textContent = 'Drawing a battleground from active pool...';

    const pool = maps.filter((m) => enabled.has(m.name));
    const winner = pool[Math.floor(Math.random() * pool.length)];
    const winnerIndex = pool.indexOf(winner);

    let count = 0;
    let stopped = false;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!reducedMotion) {
      playSound('spin');
      belt.classList.remove('land');
      belt.classList.add('roll');
    }

    const finish = () => {
      if (stopped) return;
      stopped = true;

      renderTile(winner);
      belt.classList.remove('roll');

      if (!reducedMotion) {
        belt.classList.add('land');
        playSound('hit');
      }

      if (beltTile) beltTile.classList.add('selected');
      nameOut.textContent = winner.name;
      label.textContent = 'SELECTED BATTLEGROUND';
      status.textContent = `${winner.name} selected as next battleground.`;

      persistDrop(winner);
      openReveal(winner, reducedMotion);

      busy = false;
      button.textContent = 'SPIN AGAIN';
      renderPool();
    };

    if (reducedMotion || pool.length === 1) {
      finish();
      return;
    }

    // Sequence of 12 stepping maps culminating in the selected winner
    const sequence = Array.from({ length: 12 }, (_, i) => pool[(winnerIndex + i + 1) % pool.length]);
    sequence.push(winner);

    let delay = 280;
    const tick = () => {
      if (stopped) return;
      const currentMap = sequence[count];
      renderTile(currentMap);
      playSound('tick');
      count++;

      if (count < sequence.length) {
        delay = Math.max(95, delay * 0.9);
        setTimeout(tick, delay);
      } else {
        finish();
      }
    };

    setTimeout(tick, 80);
  }

  /* --------------------------------------------------------------------------
     8. Marquee Engine (Interactive drag & background throttling)
     -------------------------------------------------------------------------- */
  function initMarquee() {
    if (!marqueeTrack || !marqueeViewport) return;

    let marqueeX = 0;
    let lastFrame = 0;
    let isDragging = false;
    let lastPointerX = 0;
    let lastPointerTime = 0;
    let marqueeVelocity = 80;
    let targetSkew = 0;
    let halfWidth = 0;
    let rafId = null;

    const measure = () => {
      halfWidth = marqueeTrack.scrollWidth / 2;
    };
    measure();
    window.addEventListener('resize', measure);

    marqueeViewport.addEventListener('pointerdown', (e) => {
      isDragging = true;
      lastPointerX = e.clientX;
      lastPointerTime = performance.now();
      marqueeViewport.setPointerCapture(e.pointerId);
    });

    marqueeViewport.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const now = performance.now();
      const dx = e.clientX - lastPointerX;
      const dt = Math.max((now - lastPointerTime) / 1000, 0.01);
      marqueeX += dx;
      marqueeVelocity = dx / dt;
      targetSkew = Math.max(-12, Math.min(12, -marqueeVelocity * 0.03));
      lastPointerX = e.clientX;
      lastPointerTime = now;
    });

    const endDrag = () => {
      isDragging = false;
      targetSkew = 0;
    };
    marqueeViewport.addEventListener('pointerup', endDrag);
    marqueeViewport.addEventListener('pointercancel', endDrag);

    function stepMarquee(now) {
      if (document.hidden) {
        rafId = null;
        return;
      }

      if (!lastFrame) lastFrame = now;
      const dt = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;

      if (!isDragging) {
        marqueeX -= 80 * dt;
      }
      if (halfWidth && marqueeX <= -halfWidth) {
        marqueeX += halfWidth;
      }

      const skew = targetSkew;
      const scale = 1 + Math.min(Math.abs(skew) * 0.005, 0.08);
      marqueeTrack.style.transform = `translate3d(${marqueeX}px, 0, 0) skewX(${skew}deg) scale(${scale})`;

      rafId = requestAnimationFrame(stepMarquee);
    }

    const startMarquee = () => {
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches && !rafId && !document.hidden) {
        lastFrame = 0;
        rafId = requestAnimationFrame(stepMarquee);
      }
    };

    const stopMarquee = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopMarquee();
      } else {
        startMarquee();
      }
    });

    startMarquee();
  }

  /* --------------------------------------------------------------------------
     9. Event Listeners & Keyboard Accessibility
     -------------------------------------------------------------------------- */
  function initEvents() {
    button.addEventListener('click', draw);

    if (revealClose) {
      revealClose.addEventListener('click', closeReveal);
    }
    if (revealBackdrop) {
      revealBackdrop.addEventListener('click', closeReveal);
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && reveal.classList.contains('open')) {
        closeReveal();
        return;
      }

      // Trap focus inside modal when open
      if (reveal.classList.contains('open') && e.key === 'Tab') {
        const focusable = reveal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
        return;
      }

      // Space or Enter on document triggers draw (if not on interactive control)
      if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat && !busy && !reveal.classList.contains('open')) {
        const tag = document.activeElement ? document.activeElement.tagName : '';
        if (!['BUTTON', 'INPUT', 'TEXTAREA', 'A'].includes(tag)) {
          e.preventDefault();
          draw();
        }
      }
    });
  }

  /* --------------------------------------------------------------------------
     10. Bootstrap Initialization
     -------------------------------------------------------------------------- */
  function init() {
    loadStorageState();
    initBeltTile();

    // Show initial active map on belt
    const initialMap = maps.find((m) => m.name === currentMapName) || maps[0];
    renderTile(initialMap);

    renderPool();
    renderLastDrop();
    preloadActivePool();
    initMarquee();
    initEvents();

    console.log('[MERAKI] Tactical Map Selector initialized.');
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
