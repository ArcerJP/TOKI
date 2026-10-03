"use strict";
(() => {
  const installButton = document.getElementById('install-app');
  const updateButton = document.getElementById('update-app');
  const status = document.getElementById('pwa-status');
  let prompt, registration, reloadOnUpdate = false;
  const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); prompt = event;
    installButton.hidden = installed();
  });
  window.addEventListener('appinstalled', () => { prompt = null; installButton.hidden = true; });
  installButton.onclick = async () => {
    if (!prompt) return;
    const pending = prompt; prompt = null; installButton.hidden = true;
    await pending.prompt();
  };
  updateButton.onclick = () => {
    if (document.querySelector('dialog[open]') || document.body.classList.contains('dragging') || document.body.classList.contains('row-dragging') || document.getElementById('schedule-app').getAttribute('aria-busy') === 'true') {
      status.textContent = '編集や保存が終わってから更新してください。';
      status.hidden = false;
      return;
    }
    if (registration?.waiting) {
      reloadOnUpdate = true;
      registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});
    } else location.reload();
  };
  if (!('serviceWorker' in navigator) || !window.isSecureContext || location.protocol === 'file:') return;
  let controlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return; }
    if (reloadOnUpdate) location.reload();
    else if (registration?.active) updateButton.hidden = false;
  });
  window.addEventListener('load', async () => {
    try {
      registration = await navigator.serviceWorker.register('./sw.js', {scope:'./', updateViaCache:'none'});
      // First installation needs no reload. Existing tabs opt into a new version.
      const check = () => { if (registration.waiting && navigator.serviceWorker.controller) updateButton.hidden = false; };
      check();
      registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', check));
    } catch {
      status.textContent = 'オフライン用の準備ができませんでした。通信状態を確認して再読み込みしてください。';
      status.hidden = false;
    }
  });
})();
