"use strict";

// Public starter data. Real names and schedules must never be committed here.
window.TOKI_DATA = {
  dates: Array.from({length:6},(_,i)=>`2026-10-0${i+3}`),
  people: Array.from({length:16},(_,i)=>`メンバー${i+1}`),
  availability: Array.from({length:16},()=>Array(6).fill(""))
};

// Optional private data is loaded only on this device, never on a hosted site.
window.TOKI_DATA_READY = new Promise(resolve => {
  const isLocal = location.protocol === "file:" || ["localhost","127.0.0.1","[::1]"].includes(location.hostname);
  if (!isLocal || window.TokiShared?.enabled) { resolve(); return; }
  const script = document.createElement("script");
  script.src = "data.local.js";
  script.onload = () => resolve();
  script.onerror = () => resolve();
  document.head.append(script);
});
