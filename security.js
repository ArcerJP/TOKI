"use strict";
// GitHub Pages cannot set frame-ancestors response headers. Keep the entire UI
// hidden when embedded, including sandboxed frames where scripts cannot execute.
// A header-level frame-ancestors 'none' should also be set if hosting permits it.
if(window.self===window.top)document.documentElement.setAttribute('data-toki-top-level','');
