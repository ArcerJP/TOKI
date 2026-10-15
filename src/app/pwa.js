"use strict";
(() => {
  const installButton = document.getElementById('install-app');
  const updateButton = document.getElementById('update-app');
  const status = document.getElementById('pwa-status');
  const updateButtons = [updateButton, document.getElementById('auth-update-app')].filter(Boolean);
  const statuses = [status, document.getElementById('auth-pwa-status')].filter(Boolean);
  const showUpdate = () => updateButtons.forEach(button => { button.hidden = false; });
  const showStatus = message => statuses.forEach(node => { node.textContent = message; node.hidden = false; });
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
  const update = () => {
    if (document.querySelector('dialog[open]') || document.body.classList.contains('dragging') || document.body.classList.contains('row-dragging') || document.getElementById('schedule-app').getAttribute('aria-busy') === 'true') {
      showStatus('編集や保存が終わってから更新してください。');
      return;
    }
    if (registration?.waiting) {
      reloadOnUpdate = true;
      registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});
    } else location.reload();
  };
  updateButtons.forEach(button => { button.onclick = update; });
  if (!('serviceWorker' in navigator) || !window.isSecureContext || location.protocol === 'file:') return;
  let controlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return; }
    if (reloadOnUpdate) location.reload();
    else if (registration?.active) showUpdate();
  });
  window.addEventListener('load', async () => {
    try {
      registration = await navigator.serviceWorker.register('./sw.js', {scope:'./', updateViaCache:'none'});
      // First installation needs no reload. Existing tabs opt into a new version.
      const check = () => { if (registration.waiting && navigator.serviceWorker.controller) showUpdate(); };
      check();
      registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', check));
    } catch {
      showStatus('オフライン用の準備ができませんでした。通信状態を確認して再読み込みしてください。');
    }
  });
})();
