/* =========================================================================
 * editor.js - Lienzo visual SVG: dibujar estados y transiciones, moverlos,
 * hacer pan/zoom y seleccionar. Sin dependencias.
 * Expone el objeto global `EDITOR`.
 * ========================================================================= */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ARROW = 10;
  var GRID = 20;
  var DEFAULT_CURVE = 45;

  var state = {
    svg: null,
    viewport: null,
    layerEdges: null,
    layerNodes: null,
    layerTemp: null,
    getMachine: null,
    onChange: function () {},
    onSelect: function () {},
    view: { tx: 60, ty: 40, k: 1 },
    mode: 'select',                 // select | addState | addTransition
    selection: null,                // {kind:'state'|'transition', id}
    drag: null                      // estado interno del arrastre en curso
  };

  /* --------------------------------------------------------------------- */
  /* Utilidades DOM/geometria                                              */
  /* --------------------------------------------------------------------- */
  function el(tag, attrs, kids) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }
  function txt(str, attrs) {
    var t = el('text', attrs);
    t.textContent = str;
    return t;
  }
  function len(x, y) { return Math.sqrt(x * x + y * y); }
  function norm(x, y) { var l = len(x, y) || 1; return { x: x / l, y: y / l }; }

  /* Perpendicular a la recta A-B, pero fija para el PAR de estados (no para
     "hacia donde apunta" esta transicion en concreto). Si se calculara con
     B-A directamente, una transicion A->B y su reciproca B->A obtendrian
     perpendiculares opuestas, que al combinarse con el signo opuesto de
     `curve` que les da el modelo se CANCELAN -> las dos acaban curvando al
     mismo lado y las lineas se cruzan. Al fijar el lado por el par de ids
     (no por from/to) el signo de `curve` sí controla el lado, siempre. */
  function canonPerp(t, A, B) {
    var flip = t.from < t.to ? 1 : -1;
    return norm(-(B.y - A.y) * flip, (B.x - A.x) * flip);
  }

  function stateRadius(s) {
    if (s && s.radius != null && !isNaN(s.radius) && s.radius > 0) {
      return Math.max(16, Math.min(160, Number(s.radius)));
    }
    return Math.max(34, Math.min(74, 30 + String(s.name).length * 3.6));
  }

  function machine() { return state.getMachine(); }

  function worldPoint(evt) {
    var r = state.svg.getBoundingClientRect();
    var v = state.view;
    return {
      x: (evt.clientX - r.left - v.tx) / v.k,
      y: (evt.clientY - r.top - v.ty) / v.k
    };
  }

  var renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    var raf = global.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    raf(function () { renderScheduled = false; render(); });
  }

  function applyView() {
    var v = state.view;
    state.viewport.setAttribute('transform', 'translate(' + v.tx + ',' + v.ty + ') scale(' + v.k + ')');
  }

  /* --------------------------------------------------------------------- */
  /* Inicializacion                                                        */
  /* --------------------------------------------------------------------- */
  function init(opts) {
    state.svg = opts.svg;
    state.getMachine = opts.getMachine;
    state.onChange = opts.onChange || state.onChange;
    state.onSelect = opts.onSelect || state.onSelect;
    state.onEdit = opts.onEdit || function () {};   // doble clic -> abrir dialogo

    state.svg.innerHTML = '';
    var defs = el('defs');
    var pat = el('pattern', { id: 'grid', width: GRID, height: GRID, patternUnits: 'userSpaceOnUse' });
    pat.appendChild(el('path', { d: 'M ' + GRID + ' 0 L 0 0 0 ' + GRID, fill: 'none', stroke: 'rgba(120,130,150,.15)', 'stroke-width': 1 }));
    defs.appendChild(pat);
    state.svg.appendChild(defs);

    state.viewport = el('g', { id: 'viewport' });
    state.svg.appendChild(state.viewport);

    state.viewport.appendChild(el('rect', {
      x: -8000, y: -8000, width: 16000, height: 16000, fill: 'url(#grid)', class: 'grid-bg'
    }));
    state.layerEdges = el('g', { class: 'layer-edges' });
    state.layerNodes = el('g', { class: 'layer-nodes' });
    state.layerTemp = el('g', { class: 'layer-temp' });
    state.viewport.appendChild(state.layerEdges);
    state.viewport.appendChild(state.layerNodes);
    state.viewport.appendChild(state.layerTemp);

    applyView();
    wireEvents();
    render();
  }

  /* --------------------------------------------------------------------- */
  /* Render                                                                */
  /* --------------------------------------------------------------------- */
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function render() {
    var m = machine();
    if (!m) return;
    clear(state.layerEdges);
    clear(state.layerNodes);

    m.transitions.forEach(function (t) { drawEdge(m, t); });
    m.states.forEach(function (s) { drawNode(m, s); });
  }

  function outputsLabel(map) {
    var keys = Object.keys(map || {});
    if (!keys.length) return '';
    return keys.map(function (k) { return k + '=' + map[k]; }).join(', ');
  }

  function drawNode(m, s) {
    var r = stateRadius(s);
    var g = el('g', {
      class: 'state' + (isSelected('state', s.id) ? ' selected' : '') + (m.initial === s.id ? ' initial' : ''),
      transform: 'translate(' + s.x + ',' + s.y + ')',
      'data-id': s.id
    });

    if (m.initial === s.id) {
      // marca de estado inicial: un triangulito apuntando al borde del estado
      var xTip = -r - 2;
      g.appendChild(el('path', {
        class: 'init-head',
        d: 'M ' + xTip + ' 0 L ' + (xTip - 13) + ' -7 L ' + (xTip - 13) + ' 7 Z'
      }));
    }

    g.appendChild(el('circle', { class: 'body', r: r }));
    // "halo": anillo (fill:none + stroke grueso) en el borde. Solo la banda del
    // borde captura el puntero -> arrastrar desde ahi crea una transicion;
    // arrastrar desde el interior mueve el estado.
    g.appendChild(el('circle', { class: 'halo', r: r }));

    var mooreTxt = outputsLabel(s.outputs);
    g.appendChild(txt(s.name, { class: 'name', 'text-anchor': 'middle', y: mooreTxt ? -2 : 5 }));
    if (mooreTxt) g.appendChild(txt(mooreTxt, { class: 'moore', 'text-anchor': 'middle', y: 15 }));

    state.layerNodes.appendChild(g);
  }

  function edgeLabelText(m, t) {
    var cond = String(t.cond).trim();
    var base = cond === '' ? 'else' : cond;
    var outs = outputsLabel(t.outputs);
    return outs ? (base + ' / ' + outs) : base;
  }

  /* Geometria de una transicion: trazado, punta, angulo de la punta, posicion
     de la etiqueta y del tirador de curvatura. Todo en coordenadas de mundo. */
  function edgeGeom(m, t) {
    var A = FSM.getState(m, t.from);
    var B = FSM.getState(m, t.to);
    if (!A || !B) return null;
    var rA = stateRadius(A), rB = stateRadius(B);

    if (t.from === t.to) {
      var ang = (t.loopAngle == null ? -90 : t.loopAngle) * Math.PI / 180;
      var spread = 0.5;
      var sa = ang - spread, ea = ang + spread;
      var s0 = { x: A.x + rA * Math.cos(sa), y: A.y + rA * Math.sin(sa) };
      var e0 = { x: A.x + rA * Math.cos(ea), y: A.y + rA * Math.sin(ea) };
      var cd = rA * 2.7;
      var c1 = { x: A.x + cd * Math.cos(sa), y: A.y + cd * Math.sin(sa) };
      var c2 = { x: A.x + cd * Math.cos(ea), y: A.y + cd * Math.sin(ea) };
      return {
        loop: true, A: A, B: B,
        d: 'M ' + s0.x + ' ' + s0.y + ' C ' + c1.x + ' ' + c1.y + ' ' + c2.x + ' ' + c2.y + ' ' + e0.x + ' ' + e0.y,
        tip: e0,
        tipAngle: Math.atan2(e0.y - c2.y, e0.x - c2.x),
        labelPos: { x: A.x + (rA + cd) * 0.60 * Math.cos(ang), y: A.y + (rA + cd) * 0.60 * Math.sin(ang) },
        handle: { x: A.x + (rA + cd) * 0.74 * Math.cos(ang), y: A.y + (rA + cd) * 0.74 * Math.sin(ang) }
      };
    }

    var mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    var perp = canonPerp(t, A, B);
    var curve = t.curve || 0;
    var ctrl = { x: mid.x + perp.x * curve, y: mid.y + perp.y * curve };
    var dirA = norm(ctrl.x - A.x, ctrl.y - A.y);
    var dirB = norm(ctrl.x - B.x, ctrl.y - B.y);
    var start = { x: A.x + dirA.x * rA, y: A.y + dirA.y * rA };
    var tip = { x: B.x + dirB.x * rB, y: B.y + dirB.y * rB };
    var endCtl = { x: B.x + dirB.x * (rB + ARROW), y: B.y + dirB.y * (rB + ARROW) };
    var apex = {
      x: 0.25 * start.x + 0.5 * ctrl.x + 0.25 * endCtl.x,
      y: 0.25 * start.y + 0.5 * ctrl.y + 0.25 * endCtl.y
    };
    // etiqueta desplazada hacia fuera del arco para no solaparse con el tirador
    var side = curve >= 0 ? 1 : -1;
    return {
      loop: false, A: A, B: B, mid: mid, perp: perp,
      d: 'M ' + start.x + ' ' + start.y + ' Q ' + ctrl.x + ' ' + ctrl.y + ' ' + endCtl.x + ' ' + endCtl.y,
      tip: tip,
      tipAngle: Math.atan2(tip.y - ctrl.y, tip.x - ctrl.x),
      labelPos: { x: apex.x + perp.x * 16 * side, y: apex.y + perp.y * 16 * side },
      handle: apex
    };
  }

  function drawEdge(m, t) {
    var G = edgeGeom(m, t);
    if (!G) return;
    var d = G.d, tip = G.tip, tipAngle = G.tipAngle, labelPos = G.labelPos;
    var selected = isSelected('transition', t.id);

    var g = el('g', {
      class: 'edge' + (selected ? ' selected' : ''),
      'data-id': t.id
    });
    g.appendChild(el('path', { class: 'hit', d: d, fill: 'none' }));
    g.appendChild(el('path', { class: 'line', d: d, fill: 'none' }));

    var ax = tip.x, ay = tip.y;
    var a1 = tipAngle + Math.PI - 0.4;
    var a2 = tipAngle + Math.PI + 0.4;
    g.appendChild(el('path', {
      class: 'head',
      d: 'M ' + ax + ' ' + ay +
        ' L ' + (ax + ARROW * Math.cos(a1)) + ' ' + (ay + ARROW * Math.sin(a1)) +
        ' L ' + (ax + ARROW * Math.cos(a2)) + ' ' + (ay + ARROW * Math.sin(a2)) + ' Z'
    }));

    if (selected) {
      g.appendChild(el('circle', {
        class: 'curve-handle', r: 6, cx: G.handle.x, cy: G.handle.y,
        title: G.loop ? 'arrastra para girar el bucle' : 'arrastra para curvar'
      }));
    }

    var label = edgeLabelText(m, t);
    var tnode = txt(label, { class: 'edge-label', 'text-anchor': 'middle', x: labelPos.x, y: labelPos.y + 4 });
    var bg = el('rect', { class: 'edge-label-bg' });
    g.appendChild(bg);
    g.appendChild(tnode);
    state.layerEdges.appendChild(g);
    // dimensiona el fondo del texto una vez insertado
    try {
      var bb = tnode.getBBox();
      bg.setAttribute('x', bb.x - 4);
      bg.setAttribute('y', bb.y - 2);
      bg.setAttribute('width', bb.width + 8);
      bg.setAttribute('height', bb.height + 4);
    } catch (e) { /* getBBox puede fallar si el SVG no esta visible */ }
  }

  /* --------------------------------------------------------------------- */
  /* Seleccion                                                             */
  /* --------------------------------------------------------------------- */
  function isSelected(kind, id) {
    return state.selection && state.selection.kind === kind && state.selection.id === id;
  }
  function setSelection(sel) {
    state.selection = sel;
    render();
    state.onSelect(sel);
  }
  function getSelection() { return state.selection; }

  /* --------------------------------------------------------------------- */
  /* Modo                                                                  */
  /* --------------------------------------------------------------------- */
  function setMode(mode) {
    state.mode = mode;
    state.svg.setAttribute('data-mode', mode);
  }
  function getMode() { return state.mode; }

  /* --------------------------------------------------------------------- */
  /* Eventos                                                               */
  /* --------------------------------------------------------------------- */
  function ancestorWithClass(n, cls) {
    while (n && n !== state.svg) {
      if (n.classList && n.classList.contains(cls)) return n;
      n = n.parentNode;
    }
    return null;
  }
  function nodeElFromEvent(evt) {
    return ancestorWithClass(evt.target, 'state');
  }
  /* Con captura de puntero activa evt.target siempre es el <svg>; para saber
     sobre que estado esta el cursor hay que consultar por coordenadas. */
  function nodeElFromPoint(evt) {
    return ancestorWithClass(document.elementFromPoint(evt.clientX, evt.clientY), 'state');
  }
  function edgeElFromEvent(evt) {
    return ancestorWithClass(evt.target, 'edge');
  }

  function wireEvents() {
    var svg = state.svg;

    svg.addEventListener('pointerdown', function (evt) {
      if (evt.button !== 0) return;
      var m = machine();
      var nodeEl = nodeElFromEvent(evt);
      var edgeEl = edgeElFromEvent(evt);
      var wp = worldPoint(evt);

      // tirador de curvatura de una transicion seleccionada
      if (evt.target.classList && evt.target.classList.contains('curve-handle') && edgeEl) {
        var ct = FSM.getTransition(m, edgeEl.getAttribute('data-id'));
        if (ct) {
          state.drag = { type: ct.from === ct.to ? 'loop' : 'curve', id: ct.id };
          svg.setPointerCapture(evt.pointerId);
        }
        return;
      }

      // Deteccion manual de doble clic sobre estado/transicion: el render() que
      // dispara la seleccion sustituye los nodos del DOM, asi que el evento
      // nativo `dblclick` no llega. Con dos pointerdown sobre el mismo id en
      // menos de 450 ms abrimos el dialogo.
      var hitId = nodeEl ? nodeEl.getAttribute('data-id') : (edgeEl ? edgeEl.getAttribute('data-id') : null);
      if (hitId) {
        var nowT = Date.now();
        if (state._lastClick && state._lastClick.id === hitId && (nowT - state._lastClick.t) < 450) {
          state._lastClick = null;
          state.onEdit({ kind: nodeEl ? 'state' : 'transition', id: hitId });
          return;
        }
        state._lastClick = { id: hitId, t: nowT };
      } else {
        state._lastClick = null;
      }

      if (nodeEl) {
        var sid = nodeEl.getAttribute('data-id');
        setSelection({ kind: 'state', id: sid });
        // Crear transicion: en modo "+ Transicion", con Shift, o arrastrando
        // desde el borde exterior del estado (el anillo "halo").
        var onRim = evt.target.classList && evt.target.classList.contains('halo');
        var linking = (state.mode === 'addTransition') || evt.shiftKey || onRim;
        if (linking) {
          var line = el('path', { class: 'temp-link', d: '', fill: 'none' });
          state.layerTemp.appendChild(line);
          state.drag = { type: 'link', from: sid, line: line };
        } else {
          var st = FSM.getState(m, sid);
          state.drag = { type: 'move', id: sid, dx: wp.x - st.x, dy: wp.y - st.y, moved: false };
        }
        svg.setPointerCapture(evt.pointerId);
        return;
      }

      if (edgeEl) {
        setSelection({ kind: 'transition', id: edgeEl.getAttribute('data-id') });
        return;
      }

      // fondo
      if (state.mode === 'addState') {
        var ns = FSM.createState(m, wp.x, wp.y);
        setMode('select');
        commit();
        setSelection({ kind: 'state', id: ns.id });
        state.onEdit({ kind: 'state', id: ns.id, isNew: true });
        return;
      }
      setSelection(null);
      state.drag = {
        type: 'pan',
        sx: evt.clientX, sy: evt.clientY,
        tx: state.view.tx, ty: state.view.ty
      };
      svg.setPointerCapture(evt.pointerId);
    });

    svg.addEventListener('pointermove', function (evt) {
      var d = state.drag;
      if (!d) return;
      var wp = worldPoint(evt);
      if (d.type === 'pan') {
        state.view.tx = d.tx + (evt.clientX - d.sx);
        state.view.ty = d.ty + (evt.clientY - d.sy);
        applyView();
      } else if (d.type === 'move') {
        var st = FSM.getState(machine(), d.id);
        if (!st) return;
        var nx = wp.x - d.dx, ny = wp.y - d.dy;
        if (!evt.altKey) { nx = Math.round(nx / GRID) * GRID; ny = Math.round(ny / GRID) * GRID; }
        st.x = nx; st.y = ny;
        d.moved = true;
        scheduleRender();
        state.onChange({ transient: true });
      } else if (d.type === 'curve') {
        var tc = FSM.getTransition(machine(), d.id);
        var A = FSM.getState(machine(), tc.from), B = FSM.getState(machine(), tc.to);
        if (!tc || !A || !B) return;
        var mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        var pp = canonPerp(tc, A, B);
        // el tirador esta en el apice (comba/2): la comba es el doble del desvio
        tc.curve = Math.round(((wp.x - mx) * pp.x + (wp.y - my) * pp.y) * 2);
        d.moved = true;
        scheduleRender();
        state.onChange({ transient: true });
      } else if (d.type === 'loop') {
        var tl = FSM.getTransition(machine(), d.id);
        var S = FSM.getState(machine(), tl.from);
        if (!tl || !S) return;
        tl.loopAngle = Math.round(Math.atan2(wp.y - S.y, wp.x - S.x) * 180 / Math.PI);
        d.moved = true;
        scheduleRender();
        state.onChange({ transient: true });
      } else if (d.type === 'link') {
        var from = FSM.getState(machine(), d.from);
        d.line.setAttribute('d', 'M ' + from.x + ' ' + from.y + ' L ' + wp.x + ' ' + wp.y);
        highlightHover(nodeElFromPoint(evt));
      }
    });

    function endDrag(evt) {
      var d = state.drag;
      state.drag = null;
      try { state.svg.releasePointerCapture(evt.pointerId); } catch (e) {}
      if (!d) return;
      if ((d.type === 'move' || d.type === 'curve' || d.type === 'loop') && d.moved) commit();
      if (d.type === 'link') {
        clear(state.layerTemp);
        highlightHover(null);
        var hov = nodeElFromPoint(evt);
        if (hov) {
          var toId = hov.getAttribute('data-id');
          var tr = FSM.createTransition(machine(), d.from, toId, '');
          commit();
          setSelection({ kind: 'transition', id: tr.id });
          // abre el dialogo para poner la condicion recien creada
          state.onEdit({ kind: 'transition', id: tr.id, isNew: true });
        }
      }
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    svg.addEventListener('dblclick', function (evt) {
      var m = machine();
      // estado / transicion se gestionan en pointerdown (deteccion manual);
      // aqui solo queda el doble clic en el fondo -> nuevo estado.
      if (nodeElFromEvent(evt) || edgeElFromEvent(evt)) return;
      var wp = worldPoint(evt);
      var ns = FSM.createState(m, wp.x, wp.y);
      commit();
      setSelection({ kind: 'state', id: ns.id });
      state.onEdit({ kind: 'state', id: ns.id, isNew: true });
    });

    svg.addEventListener('wheel', function (evt) {
      evt.preventDefault();
      var r = state.svg.getBoundingClientRect();
      var px = evt.clientX - r.left, py = evt.clientY - r.top;
      var v = state.view;
      var factor = evt.deltaY < 0 ? 1.12 : 1 / 1.12;
      var nk = Math.max(0.2, Math.min(3, v.k * factor));
      // mantiene el punto bajo el cursor
      v.tx = px - (px - v.tx) * (nk / v.k);
      v.ty = py - (py - v.ty) * (nk / v.k);
      v.k = nk;
      applyView();
    }, { passive: false });

    window.addEventListener('keydown', function (evt) {
      var tag = (evt.target && evt.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (evt.key === 'Enter') {
        if (state.selection) { state.onEdit(state.selection); evt.preventDefault(); }
      } else if (evt.key === 'Delete' || evt.key === 'Backspace') {
        deleteSelection();
        evt.preventDefault();
      } else if (evt.key === 'Escape') {
        setMode('select');
        clear(state.layerTemp);
        state.drag = null;
        setSelection(null);
      } else if (evt.key === 's' || evt.key === 'S') {
        setMode('addState');
      } else if (evt.key === 't' || evt.key === 'T') {
        setMode('addTransition');
      } else if (evt.key === 'v' || evt.key === 'V') {
        setMode('select');
      }
    });
  }

  function highlightHover(nodeEl) {
    Array.prototype.forEach.call(state.layerNodes.querySelectorAll('.state.hover'), function (n) {
      n.classList.remove('hover');
    });
    if (nodeEl) nodeEl.classList.add('hover');
  }

  function deleteSelection() {
    var sel = state.selection;
    if (!sel) return;
    var m = machine();
    if (sel.kind === 'state') FSM.deleteState(m, sel.id);
    else FSM.deleteTransition(m, sel.id);
    setSelection(null);
    commit();
  }

  function commit() {
    render();
    state.onChange({ transient: false });
  }

  /* --------------------------------------------------------------------- */
  /* Encaje a la vista                                                     */
  /* --------------------------------------------------------------------- */
  function fit() {
    var m = machine();
    if (!m || !m.states.length) { state.view = { tx: 60, ty: 40, k: 1 }; applyView(); return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    m.states.forEach(function (s) {
      var r = stateRadius(s) + 30;
      // el triangulito de estado inicial sobresale ~16px por la izquierda
      var left = s.id === m.initial ? r + 22 : r;
      minX = Math.min(minX, s.x - left); minY = Math.min(minY, s.y - r);
      maxX = Math.max(maxX, s.x + r); maxY = Math.max(maxY, s.y + r);
    });
    var rect = state.svg.getBoundingClientRect();
    var kx = rect.width / (maxX - minX);
    var ky = rect.height / (maxY - minY);
    var k = Math.max(0.2, Math.min(1.6, Math.min(kx, ky)));
    state.view.k = k;
    state.view.tx = (rect.width - (maxX + minX) * k) / 2;
    state.view.ty = (rect.height - (maxY + minY) * k) / 2;
    applyView();
  }

  global.EDITOR = {
    init: init,
    render: render,
    setSelection: setSelection,
    getSelection: getSelection,
    setMode: setMode,
    getMode: getMode,
    deleteSelection: deleteSelection,
    fit: fit
  };
}(window));
