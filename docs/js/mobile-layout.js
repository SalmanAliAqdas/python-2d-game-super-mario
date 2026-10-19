// Presentation only: the canvas backing size, camera and game physics stay unchanged.
export function initMobileLayout(onMenuOpen) {
  const menu = document.querySelector('#mobileMenuButton');
  const actions = document.querySelector('#gameActions');
  const fullscreen = document.querySelector('#fullscreenButton');
  const status = document.querySelector('#fullscreenStatus');
  const mobile = matchMedia('(pointer: coarse) and (max-width: 1100px), (max-width: 620px)');

  function closeMenu(restoreFocus = false) {
    document.body.classList.remove('mobile-menu-open');
    menu.setAttribute('aria-expanded', 'false');
    if (restoreFocus) menu.focus({ preventScroll: true });
  }
  menu.addEventListener('click', () => {
    if (menu.getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
    onMenuOpen();
    document.body.classList.add('mobile-menu-open');
    menu.setAttribute('aria-expanded', 'true');
  });
  actions.addEventListener('click', event => {
    if (event.target.closest('#levelsButton, #restartButton, #helpButton, #pauseButton')) closeMenu();
  });
  document.addEventListener('pointerdown', event => {
    if (!actions.contains(event.target) && !menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.code === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
      event.preventDefault(); closeMenu(true);
    }
  });
  mobile.addEventListener('change', () => closeMenu());

  function updateFullscreen() {
    const supported = Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);
    fullscreen.disabled = !supported;
    fullscreen.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
    if (!supported) status.textContent = 'Fullscreen is unavailable here. Landscape view works without it.';
  }
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.fullscreenEnabled && document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
      status.textContent = '';
    } catch {
      status.textContent = 'Fullscreen could not open. You can keep playing in landscape view.';
    }
    updateFullscreen();
  });
  document.addEventListener('fullscreenchange', updateFullscreen);
  updateFullscreen();
}
