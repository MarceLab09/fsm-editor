/* =========================================================================
 * plugin.js - Integracion con Icestudio cuando el editor se abre como
 * plugin externo (Preferencias > Avanzado > External plugins).
 *
 * Icestudio abre index.html en una ventana NW.js propia (WaflePluginExtWindow)
 * y, al terminar de cargar, le inyecta BindingWafleEventBus.js e
 * IcestudioPlugin.js. Eso deja disponibles:
 *   - window.opener        -> la ventana principal de Icestudio
 *   - window.iceStudio.bus -> bus de eventos del host (llega DESPUES del load)
 *   - onIcestudioPluginLoaded() -> hook que el host invoca cuando la API
 *     ya esta lista
 *
 * Si no estamos dentro de Icestudio todo este modulo queda inerte y el
 * editor se comporta igual que abierto con doble clic (file://).
 *
 * Expone el objeto global `PLUGIN`.
 * ========================================================================= */
(function (global) {
  'use strict';

  var ready = false;
  var waiting = [];

  /* La ventana del host, o null si no estamos dentro de Icestudio. */
  function host() {
    try {
      var o = global.opener;
      return (o && o.iceStudio) ? o : null;
    } catch (e) {
      /* opener de otro origen: no es Icestudio */
      return null;
    }
  }

  function active() { return host() !== null; }

  /* El bus del host. Preferimos el objeto inyectado en NUESTRA ventana
     porque es el que reenvia al opener; si todavia no llego, usamos el del
     host directamente. */
  function bus() {
    var h = host();
    if (!h) return null;
    if (global.iceStudio && global.iceStudio.bus) return global.iceStudio.bus;
    return h.iceStudio.bus || null;
  }

  /* Ejecuta cb cuando la API del host este lista. Fuera de Icestudio no se
     llama nunca, que es justo lo que queremos. */
  function onReady(cb) {
    if (ready) { cb(); return; }
    waiting.push(cb);
  }

  /* Hook que invoca IcestudioPlugin.start() tras inyectar la API. */
  global.onIcestudioPluginLoaded = function () {
    ready = true;
    var pending = waiting;
    waiting = [];
    for (var i = 0; i < pending.length; i++) {
      try { pending[i](); } catch (e) { PLUGIN.notify(String(e), true); }
    }
  };

  function requireNode(mod) {
    try {
      if (typeof global.require === 'function') return global.require(mod);
    } catch (e) { /* sin Node: navegador normal */ }
    return null;
  }

  /* Guardar un archivo. Dentro de Icestudio hay Node, asi que abrimos el
     dialogo nativo "Guardar como" de NW.js en vez de disparar la descarga
     del navegador. Devuelve false si no puede encargarse, para que quien
     llama caiga en la descarga de siempre. */
  function saveFile(filename, content) {
    var fs = active() ? requireNode('fs') : null;
    if (!fs) return false;

    var input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('nwsaveas', filename);
    input.style.display = 'none';
    input.addEventListener('change', function () {
      var dest = input.value;
      if (input.parentNode) input.parentNode.removeChild(input);
      if (!dest) return;
      try {
        fs.writeFileSync(dest, content);
        PLUGIN.notify(dest);
      } catch (e) {
        PLUGIN.notify(String(e.message || e), true);
      }
    });
    document.body.appendChild(input);
    input.click();
    return true;
  }

  var PLUGIN = {
    active: active,
    ready: onReady,
    bus: bus,
    saveFile: saveFile,
    /* Sustituible por la app para mostrar el aviso donde corresponda. */
    notify: function (msg, isError) {
      if (isError) console.error('[fsm-editor]', msg);
      else console.log('[fsm-editor]', msg);
    }
  };

  global.PLUGIN = PLUGIN;
}(window));
