/* =========================================================================
 * app.js - Union de todo: barra de herramientas, panel de inspeccion,
 * validacion, previsualizacion y exportacion. Sin dependencias.
 * ========================================================================= */
(function () {
  'use strict';

  var AUTOSAVE_KEY = 'fsm-editor:autosave';
  var store = { m: null };
  function M() { return store.m; }

  /* --------------------------------------------------------------------- */
  /* Helpers DOM                                                           */
  /* --------------------------------------------------------------------- */
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function clearEl(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function $(id) { return document.getElementById(id); }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* --------------------------------------------------------------------- */
  /* Descargas                                                             */
  /* --------------------------------------------------------------------- */
  function download(filename, content, mime) {
    var blob = content instanceof Uint8Array
      ? new Blob([content], { type: mime || 'application/octet-stream' })
      : new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  function copyText(str) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(flashCopied, fallbackCopy.bind(null, str));
    } else {
      fallbackCopy(str);
    }
  }
  function fallbackCopy(str) {
    var ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = str;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); flashCopied(); } catch (e) {}
    ta.remove();
  }
  function flashCopied() {
    var b = $('btn-copy');
    if (!b) return;
    var old = b.textContent;
    b.textContent = 'Copiado';
    setTimeout(function () { b.textContent = old; }, 1200);
  }

  /* --------------------------------------------------------------------- */
  /* Persistencia                                                          */
  /* --------------------------------------------------------------------- */
  var autosave = debounce(function () {
    try { localStorage.setItem(AUTOSAVE_KEY, FSM.serialize(M())); } catch (e) {}
  }, 400);

  function loadMachine(machine, doFit) {
    store.m = machine;
    EDITOR.render();
    if (doFit) EDITOR.fit();
    EDITOR.setSelection(null);
    refreshAll();
    autosave();
  }

  /* --------------------------------------------------------------------- */
  /* Refrescos                                                             */
  /* --------------------------------------------------------------------- */
  var refreshDerived = debounce(function () {
    refreshVerilog();
    refreshProblems();
    autosave();
  }, 250);

  function refreshAll() {
    refreshModulePanel();
    refreshPortsPanel();
    refreshSelectionPanel();
    refreshProblems();
    refreshVerilog();
  }

  /* ---- panel del modulo ---- */
  function refreshModulePanel() {
    var m = M();
    $('mod-name').value = m.name;
    $('mod-clk').value = m.clock;
    $('mod-rst').value = m.reset;
    $('mod-rst-low').checked = m.resetActiveLow;
    $('mod-rst-sync').checked = m.resetSync;
    $('mod-enc').value = m.encoding;
  }

  function bindModulePanel() {
    function upd(prop, el, sanitize) {
      el.addEventListener('change', function () {
        var v = el.value.trim();
        M()[prop] = sanitize ? FSM.sanitizeIdentifier(v, M()[prop]) : v;
        el.value = M()[prop];
        refreshDerived();
      });
    }
    upd('name', $('mod-name'), true);
    upd('clock', $('mod-clk'), true);
    upd('reset', $('mod-rst'), true);
    $('mod-rst-low').addEventListener('change', function () { M().resetActiveLow = this.checked; refreshDerived(); });
    $('mod-rst-sync').addEventListener('change', function () { M().resetSync = this.checked; refreshDerived(); });
    $('mod-enc').addEventListener('change', function () { M().encoding = this.value; refreshDerived(); });
  }

  /* ---- panel de puertos ---- */
  function portRow(kind, p) {
    var m = M();
    var nameInp = h('input', {
      class: 'port-name', value: p.name, spellcheck: 'false',
      onchange: function () {
        var want = FSM.sanitizeIdentifier(this.value.trim(), p.name);
        var list = kind === 'input' ? m.inputs : m.outputs;
        var n = want, i = 1;
        while (list.some(function (o) { return o !== p && o.name === n; })) { n = want + i; i += 1; }
        if (kind === 'output') FSM.renameOutput(m, p, n);
        else p.name = n;
        refreshAll();
        refreshDerivedNow();
      }
    });
    var widthInp = h('input', {
      class: 'port-width', type: 'number', min: '1', value: p.width,
      onchange: function () { p.width = Math.max(1, parseInt(this.value, 10) || 1); this.value = p.width; refreshDerived(); }
    });
    var kids = [nameInp, h('span', { class: 'dim', text: '[' }), widthInp, h('span', { class: 'dim', text: ']' })];
    if (kind === 'output') {
      kids.push(h('input', {
        class: 'port-def', value: p.def, title: 'valor por defecto', spellcheck: 'false',
        onchange: function () { p.def = this.value.trim() || '0'; this.value = p.def; refreshDerived(); }
      }));
    }
    kids.push(h('button', {
      class: 'x', text: '×', title: 'eliminar',
      onclick: function () { FSM.deletePort(m, kind, p.id); refreshAll(); EDITOR.render(); refreshDerivedNow(); }
    }));
    return h('div', { class: 'port-row' }, kids);
  }

  function refreshPortsPanel() {
    var m = M();
    var inWrap = $('inputs-list'); clearEl(inWrap);
    m.inputs.forEach(function (p) { inWrap.appendChild(portRow('input', p)); });
    var outWrap = $('outputs-list'); clearEl(outWrap);
    m.outputs.forEach(function (p) { outWrap.appendChild(portRow('output', p)); });
  }

  /* ---- panel de seleccion ---- */
  function outputsEditor(map, container) {
    clearEl(container);
    var m = M();
    if (m.outputs.length === 0) {
      container.appendChild(h('p', { class: 'muted', text: 'No hay salidas declaradas.' }));
      return;
    }
    m.outputs.forEach(function (p) {
      var inp = h('input', {
        value: map[p.name] == null ? '' : map[p.name],
        placeholder: 'def: ' + p.def, spellcheck: 'false',
        onchange: function () {
          var v = this.value.trim();
          if (v === '') delete map[p.name];
          else map[p.name] = v;
          EDITOR.render();
          refreshDerived();
        }
      });
      container.appendChild(h('label', { class: 'io-field' }, [h('span', { text: p.name }), inp]));
    });
  }

  function refreshSelectionPanel() {
    var sel = EDITOR.getSelection();
    var m = M();
    var wrap = $('selection-panel');
    clearEl(wrap);

    var editBtn = $('btn-edit');
    if (editBtn) {
      editBtn.disabled = !sel;
      editBtn.textContent = sel && sel.kind === 'transition' ? 'Editar transición…' : 'Editar estado…';
      if (!sel) editBtn.textContent = 'Editar…';
    }

    if (!sel) {
      wrap.appendChild(h('p', { class: 'muted', text: 'Selecciona un estado o una transicion en el lienzo (luego «Editar…», Enter o doble clic).' }));
      return;
    }

    if (sel.kind === 'state') {
      var s = FSM.getState(m, sel.id);
      if (!s) return;
      wrap.appendChild(h('h3', { text: 'Estado' }));
      wrap.appendChild(h('label', { class: 'field' }, [
        h('span', { text: 'Nombre' }),
        h('input', {
          value: s.name, spellcheck: 'false',
          onchange: function () { s.name = FSM.sanitizeIdentifier(this.value.trim(), s.name); this.value = s.name; EDITOR.render(); refreshDerivedNow(); }
        })
      ]));
      var isInit = m.initial === s.id;
      wrap.appendChild(h('button', {
        class: 'wide' + (isInit ? ' active' : ''),
        text: isInit ? 'Es el estado inicial' : 'Marcar como estado inicial',
        onclick: function () { m.initial = s.id; EDITOR.render(); refreshSelectionPanel(); refreshDerivedNow(); }
      }));
      wrap.appendChild(h('h4', { text: 'Salidas en este estado (Moore)' }));
      var oc = h('div', { class: 'io-list' });
      wrap.appendChild(oc);
      outputsEditor(s.outputs, oc);
      wrap.appendChild(h('button', {
        class: 'wide danger', text: 'Eliminar estado',
        onclick: function () { FSM.deleteState(m, s.id); EDITOR.setSelection(null); EDITOR.render(); refreshAll(); refreshDerivedNow(); }
      }));
      return;
    }

    // transicion
    var t = FSM.getTransition(m, sel.id);
    if (!t) return;
    var from = FSM.getState(m, t.from), to = FSM.getState(m, t.to);
    var siblings = FSM.outgoing(m, t.from);
    var prio = siblings.indexOf(t) + 1;

    wrap.appendChild(h('h3', { text: 'Transicion' }));
    wrap.appendChild(h('p', { class: 'muted', text: (from ? from.name : '?') + '  →  ' + (to ? to.name : '?') }));

    wrap.appendChild(h('label', { class: 'field' }, [
      h('span', { text: 'Condicion  (vacio = else / por defecto)' }),
      h('input', {
        value: t.cond, placeholder: 'p.ej.  x && !ready', spellcheck: 'false',
        onchange: function () { t.cond = this.value.trim(); EDITOR.render(); refreshDerived(); }
      })
    ]));

    wrap.appendChild(h('div', { class: 'row' }, [
      h('span', { class: 'muted', text: 'Prioridad ' + prio + ' / ' + siblings.length }),
      h('button', { text: '↑', title: 'subir prioridad', onclick: function () { FSM.moveTransitionPriority(m, t.id, -1); refreshSelectionPanel(); refreshDerivedNow(); } }),
      h('button', { text: '↓', title: 'bajar prioridad', onclick: function () { FSM.moveTransitionPriority(m, t.id, 1); refreshSelectionPanel(); refreshDerivedNow(); } })
    ]));

    if (t.from === t.to) {
      wrap.appendChild(sliderField('Angulo del bucle', -180, 180, t.loopAngle, function (v) { t.loopAngle = v; EDITOR.render(); autosave(); }));
    } else {
      wrap.appendChild(sliderField('Curvatura', -180, 180, t.curve, function (v) { t.curve = v; EDITOR.render(); autosave(); }));
    }

    wrap.appendChild(h('button', {
      class: 'wide', text: 'Invertir sentido',
      onclick: function () { var a = t.from; t.from = t.to; t.to = a; EDITOR.render(); refreshSelectionPanel(); refreshDerivedNow(); }
    }));

    wrap.appendChild(h('h4', { text: 'Salidas en la transicion (Mealy)' }));
    var mc = h('div', { class: 'io-list' });
    wrap.appendChild(mc);
    outputsEditor(t.outputs, mc);

    wrap.appendChild(h('button', {
      class: 'wide danger', text: 'Eliminar transicion',
      onclick: function () { FSM.deleteTransition(m, t.id); EDITOR.setSelection(null); EDITOR.render(); refreshSelectionPanel(); refreshDerivedNow(); }
    }));
  }

  function sliderField(label, min, max, value, onInput) {
    var out = h('span', { class: 'dim', text: String(Math.round(value)) });
    var range = h('input', {
      type: 'range', min: min, max: max, value: value,
      oninput: function () { out.textContent = this.value; onInput(parseInt(this.value, 10)); }
    });
    return h('label', { class: 'field' }, [h('span', {}, [label + '  ', out]), range]);
  }

  /* --------------------------------------------------------------------- */
  /* Dialogos modales (crear / editar estado y transicion en el lienzo)    */
  /* --------------------------------------------------------------------- */
  function modal(title, rows, onAccept, opts) {
    opts = opts || {};
    var overlay = h('div', { class: 'modal-overlay' });
    var card = h('div', { class: 'modal-card', role: 'dialog', 'aria-label': title });
    card.appendChild(h('div', { class: 'modal-title', text: title }));
    var body = h('div', { class: 'modal-body' });
    rows.forEach(function (r) { body.appendChild(r.el); });
    card.appendChild(body);

    function close() {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
    }
    function accept() {
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i].validate && !rows[i].validate()) return;
      }
      onAccept();
      close();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Enter' && (e.target.tagName || '').toLowerCase() !== 'textarea') { e.preventDefault(); accept(); }
    }

    var footer = h('div', { class: 'modal-actions' });
    if (opts.onDelete) {
      footer.appendChild(h('button', {
        class: 'danger', text: opts.deleteLabel || 'Eliminar',
        onclick: function () { opts.onDelete(); close(); }
      }));
    }
    footer.appendChild(h('span', { class: 'spacer' }));
    footer.appendChild(h('button', { text: 'Cancelar', onclick: close }));
    footer.appendChild(h('button', { class: 'primary', text: 'Aceptar', onclick: accept }));
    card.appendChild(footer);

    overlay.appendChild(card);
    overlay.addEventListener('pointerdown', function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    window.addEventListener('keydown', onKey, true);

    var first = body.querySelector('input, select, textarea');
    if (first) { first.focus(); if (first.select) try { first.select(); } catch (e) {} }
    return { close: close, overlay: overlay };
  }

  function fieldRow(label, inputEl, hint) {
    return {
      el: h('label', { class: 'modal-row' }, [
        h('span', { class: 'modal-label', text: label }),
        inputEl,
        hint ? h('small', { text: hint }) : null
      ]),
      input: inputEl
    };
  }
  function checkRow(label, checked) {
    var cb = h('input', { type: 'checkbox' });
    cb.checked = !!checked;
    return { el: h('label', { class: 'modal-row check' }, [cb, h('span', { text: label })]), input: cb };
  }

  function openStateDialog(s, isNew) {
    var m = M();
    var nameI = h('input', { class: 'dlg-name', value: s.name, spellcheck: 'false' });
    var codeI = h('input', { class: 'dlg-code', type: 'number', min: '0', value: s.code == null ? '' : s.code, placeholder: 'auto' });
    var initC = checkRow('Estado inicial', m.initial === s.id);
    var outI = h('input', { class: 'dlg-outputs', value: FSM.formatOutputs(s.outputs), spellcheck: 'false', placeholder: 'y=1, z=0' });
    var radI = h('input', { class: 'dlg-radius', type: 'number', min: '16', value: s.radius == null ? '' : s.radius, placeholder: 'auto' });
    var dcC = checkRow('Valores no definidos → DC (x)', s.dcUndefined);

    modal(isNew ? 'Nuevo estado' : 'Estado', [
      fieldRow('Etiqueta', nameI),
      fieldRow('Número de estado', codeI, 'vacío = automático según la codificación'),
      initC,
      fieldRow('Salidas (Moore)', outI, '"nombre=valor" separadas por coma; "run" equivale a "run=1"'),
      fieldRow('Radio', radI, 'vacío = automático'),
      dcC
    ], function () {
      s.name = FSM.sanitizeIdentifier(nameI.value.trim(), s.name);
      var c = codeI.value.trim();
      s.code = c === '' ? null : Math.max(0, parseInt(c, 10) || 0);
      var rr = radI.value.trim();
      s.radius = rr === '' ? null : Math.max(16, parseInt(rr, 10) || 0);
      s.outputs = FSM.parseOutputs(outI.value);
      s.dcUndefined = dcC.input.checked;
      if (initC.input.checked) m.initial = s.id;
      EDITOR.render();
      refreshAll();
      refreshDerivedNow();
      EDITOR.setSelection({ kind: 'state', id: s.id });
    }, {
      deleteLabel: 'Eliminar estado',
      onDelete: function () {
        FSM.deleteState(m, s.id); EDITOR.setSelection(null); EDITOR.render(); refreshAll(); refreshDerivedNow();
      }
    });
  }

  function openTransitionDialog(t, isNew) {
    var m = M();
    var from = FSM.getState(m, t.from), to = FSM.getState(m, t.to);
    var isLoop = t.from === t.to;
    var condI = h('input', { class: 'dlg-cond', value: t.cond, spellcheck: 'false', placeholder: 'vacío = else / por defecto' });
    var outI = h('input', { class: 'dlg-outputs', value: FSM.formatOutputs(t.outputs), spellcheck: 'false', placeholder: 'q=1' });
    var siblings = FSM.outgoing(m, t.from);
    var prioI = h('input', { class: 'dlg-prio', type: 'number', min: '1', max: String(siblings.length), value: siblings.indexOf(t) + 1 });
    var curveI = h('input', { class: 'dlg-curve', type: 'number', value: Math.round(isLoop ? t.loopAngle : t.curve) });
    var dcC = checkRow('Valores no definidos → DC (x)', t.dcUndefined);

    modal(isNew ? 'Nueva transición' : 'Transición', [
      { el: h('p', { class: 'modal-row muted', text: (from ? from.name : '?') + '  →  ' + (to ? to.name : '?') }) },
      fieldRow('Condición', condI, 'expresión Verilog; vacío = transición por defecto'),
      fieldRow('Salidas (Mealy)', outI, '"nombre=valor" separadas por coma'),
      fieldRow('Prioridad', prioI, '1 = se evalúa primero'),
      fieldRow(isLoop ? 'Ángulo del bucle (°)' : 'Curvatura', curveI, 'también ajustable arrastrando el punto azul'),
      dcC
    ], function () {
      t.cond = condI.value.trim();
      t.outputs = FSM.parseOutputs(outI.value);
      t.dcUndefined = dcC.input.checked;
      if (isLoop) t.loopAngle = parseInt(curveI.value, 10) || 0;
      else t.curve = parseInt(curveI.value, 10) || 0;
      var cur = FSM.outgoing(m, t.from).indexOf(t) + 1;
      var want = Math.max(1, Math.min(siblings.length, parseInt(prioI.value, 10) || 1));
      var step = want > cur ? 1 : -1;
      for (var i = 0; i < Math.abs(want - cur); i += 1) FSM.moveTransitionPriority(m, t.id, step);
      EDITOR.render();
      refreshAll();
      refreshDerivedNow();
      EDITOR.setSelection({ kind: 'transition', id: t.id });
    }, {
      deleteLabel: 'Eliminar transición',
      onDelete: function () {
        FSM.deleteTransition(m, t.id); EDITOR.setSelection(null); EDITOR.render(); refreshAll(); refreshDerivedNow();
      }
    });
  }

  function openEditor(sel) {
    if (!sel) return;
    if (sel.kind === 'state') {
      var s = FSM.getState(M(), sel.id);
      if (s) openStateDialog(s, sel.isNew);
    } else {
      var t = FSM.getTransition(M(), sel.id);
      if (t) openTransitionDialog(t, sel.isNew);
    }
  }

  /* ---- validacion ---- */
  function refreshProblems() {
    var probs = FSM.validate(M());
    var ul = $('problems');
    clearEl(ul);
    var errs = probs.filter(function (p) { return p.level === 'error'; }).length;
    $('problem-count').textContent = probs.length
      ? (errs ? (errs + ' error(es)') : (probs.length + ' aviso(s)'))
      : 'sin problemas';
    $('problem-count').className = 'badge ' + (errs ? 'bad' : (probs.length ? 'warn' : 'ok'));
    if (!probs.length) {
      ul.appendChild(h('li', { class: 'ok', text: 'Todo correcto. El Verilog deberia sintetizar.' }));
      return;
    }
    probs.forEach(function (p) {
      ul.appendChild(h('li', {
        class: p.level,
        text: p.msg,
        onclick: p.ref ? function () { EDITOR.setSelection({ kind: p.ref.kind, id: p.ref.id }); } : null
      }));
    });
  }

  /* ---- verilog / ice ---- */
  function refreshVerilog() {
    var view = $('code-view').value;
    var code;
    try {
      if (view === 'module') code = VERILOG.generateModule(M());
      else if (view === 'body') code = VERILOG.generateBody(M());
      else code = ICE.iceText(M());
    } catch (e) {
      code = '// Error generando la salida:\n// ' + (e && e.message ? e.message : e);
    }
    $('code-out').textContent = code;
  }

  function refreshDerivedNow() {
    refreshVerilog();
    refreshProblems();
    autosave();
  }

  /* --------------------------------------------------------------------- */
  /* Menus desplegables (Archivo / Exportar)                               */
  /* --------------------------------------------------------------------- */
  function bindMenus() {
    var menus = Array.prototype.slice.call(document.querySelectorAll('.menu'));
    function closeAll() {
      menus.forEach(function (m) {
        m.querySelector('.menu-panel').hidden = true;
        m.querySelector('.menu-trigger').setAttribute('aria-expanded', 'false');
      });
    }
    menus.forEach(function (m) {
      var trigger = m.querySelector('.menu-trigger');
      var panel = m.querySelector('.menu-panel');
      trigger.addEventListener('click', function (evt) {
        evt.stopPropagation();
        var wasOpen = !panel.hidden;
        closeAll();
        if (!wasOpen) { panel.hidden = false; trigger.setAttribute('aria-expanded', 'true'); }
      });
      // un clic en cualquier accion del menu lo cierra (la accion ya se ejecuto
      // en su propio listener, registrado en bindToolbar)
      panel.addEventListener('click', function (evt) {
        if (evt.target.tagName === 'BUTTON') closeAll();
      });
    });
    document.addEventListener('click', closeAll);
    document.addEventListener('keydown', function (evt) { if (evt.key === 'Escape') closeAll(); });
    window.addEventListener('blur', closeAll);
  }

  /* --------------------------------------------------------------------- */
  /* Barra de herramientas                                                 */
  /* --------------------------------------------------------------------- */
  function bindToolbar() {
    $('btn-new').addEventListener('click', function () {
      if (!confirm('Empezar una maquina nueva? Se perdera lo actual (salvo que lo hayas guardado).')) return;
      var m = FSM.createMachine();
      FSM.createState(m, 240, 220, 'IDLE');
      loadMachine(m, true);
    });
    $('btn-demo').addEventListener('click', function () { loadMachine(FSM.demoMachine(), true); });
    $('btn-fit').addEventListener('click', function () { EDITOR.fit(); });
    $('btn-edit').addEventListener('click', function () { openEditor(EDITOR.getSelection()); });

    var modeButtons = {
      select: $('mode-select'),
      addState: $('mode-state'),
      addTransition: $('mode-transition')
    };
    Object.keys(modeButtons).forEach(function (mode) {
      modeButtons[mode].addEventListener('click', function () { EDITOR.setMode(mode); syncModeButtons(); });
    });
    window.__syncModeButtons = syncModeButtons;
    function syncModeButtons() {
      var cur = EDITOR.getMode();
      Object.keys(modeButtons).forEach(function (mode) {
        modeButtons[mode].classList.toggle('active', mode === cur);
      });
    }
    // mantiene los botones sincronizados si el modo cambia por teclado
    setInterval(syncModeButtons, 200);

    $('btn-add-input').addEventListener('click', function () {
      FSM.createPort(M(), 'input'); refreshPortsPanel(); refreshDerivedNow();
    });
    $('btn-add-output').addEventListener('click', function () {
      FSM.createPort(M(), 'output'); refreshPortsPanel(); refreshDerivedNow();
    });

    $('btn-save').addEventListener('click', function () {
      download(safe(M().name) + '.fsm', FSM.serialize(M()), 'application/json');
    });
    $('btn-load').addEventListener('click', function () { $('file-input').click(); });
    $('file-input').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          loadMachine(FSM.deserialize(String(rd.result)), true);
        } catch (e) {
          alert('No se pudo leer el archivo: ' + (e && e.message ? e.message : e));
        }
      };
      rd.readAsText(f);
      this.value = '';
    });

    $('btn-export-v').addEventListener('click', function () {
      download(safe(M().name) + '.v', VERILOG.generateModule(M()), 'text/plain');
    });
    $('btn-export-body').addEventListener('click', function () {
      download(safe(M().name) + '_body.v', VERILOG.generateBody(M()), 'text/plain');
    });
    $('btn-export-ice').addEventListener('click', function () {
      download(safe(M().name) + '.ice', ICE.iceText(M()), 'application/json');
    });

    $('code-view').addEventListener('change', refreshVerilog);
    $('btn-copy').addEventListener('click', function () { copyText($('code-out').textContent); });

    // pestanas del inspector
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (o) { o.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function (o) { o.classList.remove('active'); });
        tab.classList.add('active');
        $(tab.getAttribute('data-panel')).classList.add('active');
      });
    });
  }

  function safe(name) { return String(name || 'fsm').replace(/[^A-Za-z0-9_.-]/g, '_'); }

  /* --------------------------------------------------------------------- */
  /* Arranque                                                              */
  /* --------------------------------------------------------------------- */
  function boot() {
    EDITOR.init({
      svg: $('canvas'),
      getMachine: function () { return store.m; },
      onChange: function (info) {
        if (info && info.transient) { autosave(); return; }
        refreshSelectionPanel();
        refreshPortsPanel();
        refreshDerivedNow();
      },
      onSelect: function () { refreshSelectionPanel(); },
      onEdit: openEditor
    });

    bindModulePanel();
    bindToolbar();
    bindMenus();

    var restored = null;
    try {
      var saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) restored = FSM.deserialize(saved);
    } catch (e) { restored = null; }

    loadMachine(restored && restored.states.length ? restored : FSM.demoMachine(), true);
    EDITOR.setMode('select');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
