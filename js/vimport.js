/* =========================================================================
 * vimport.js - Importador de Verilog -> modelo FSM.
 * No es un parser de Verilog general: reconstruye el diagrama a partir de
 * la ESTRUCTURA exacta que genera verilog.js (3 bloques: registro de
 * estado / proximo estado / salidas, con un `case` por bloque y cadenas
 * if / else if por estado) -- la misma con la que suele escribirse una FSM
 * "a mano" siguiendo el estilo clasico de 3 procesos.
 * Solo lee el modulo completo (con `module ... endmodule`); el "cuerpo"
 * exportado para Icestudio no declara puertos y no se puede reconstruir.
 * Expone el objeto global `VIMPORT`.
 * ========================================================================= */
(function (global) {
  'use strict';

  function ParseError(msg) { this.message = msg; this.name = 'ParseError'; }
  ParseError.prototype = Object.create(Error.prototype);

  function stripComments(text) {
    return String(text).replace(/\r/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, '');
  }

  function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function parseWidthBracket(s) {
    var m = s && s.match(/\[\s*(\d+)\s*:\s*(\d+)\s*\]/);
    if (!m) return 1;
    return Math.abs(parseInt(m[1], 10) - parseInt(m[2], 10)) + 1;
  }

  function isDcValue(v) { return /^\d*'b[xX]+$/.test(String(v).trim()); }

  /* formatValue() (verilog.js) convierte "1" -> "1'b1" y "170" -> "8'd170";
     aqui se deshace esa conversion para los casos simples, asi el modelo
     reimportado queda tan legible como el que el usuario habria escrito.
     Los valores con base explicita que no vinieron de ahi (hex, binario de
     varios bits, expresiones) se dejan tal cual: formatValue() los respeta
     sin tocarlos, asi que el Verilog regenerado es identico de cualquier forma. */
  function humanizeValue(raw) {
    var v = String(raw).trim();
    var m = /^1'b([01])$/.exec(v);
    if (m) return m[1];
    m = /^\d+'d(\d+)$/.exec(v);
    if (m) return m[1];
    return v;
  }

  /* Separa una linea de sentencia en su condicion (si la tiene) y el resto,
     respetando parentesis anidados dentro de la condicion. */
  function extractParen(line, openIdx) {
    var depth = 0, i = openIdx;
    for (; i < line.length; i += 1) {
      if (line[i] === '(') depth += 1;
      else if (line[i] === ')') { depth -= 1; if (depth === 0) break; }
    }
    return { cond: line.slice(openIdx + 1, i).trim(), rest: line.slice(i + 1).trim() };
  }
  function splitStatementLine(raw) {
    var line = raw.trim();
    var m = /^else\s+if\s*\(/.exec(line);
    if (m) { var r = extractParen(line, m[0].length - 1); return { kind: 'elseif', cond: r.cond, rest: r.rest }; }
    m = /^if\s*\(/.exec(line);
    if (m) { var r2 = extractParen(line, m[0].length - 1); return { kind: 'if', cond: r2.cond, rest: r2.rest }; }
    if (/^else\b/.test(line)) return { kind: 'else', cond: '', rest: line.replace(/^else\s*/, '') };
    return { kind: 'plain', cond: '', rest: line };
  }

  /* case (REG) ... endcase -> items {label, lines[]}. Asume el formato de
     verilog.js: un item es "NOMBRE: begin" ... (una sentencia por linea)
     ... "end", o bien "default: <sentencia>;" en una sola linea. */
  function parseCaseItems(blockText) {
    var lines = blockText.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l.length; });
    var items = [];
    var i = 0;
    while (i < lines.length) {
      var mB = lines[i].match(/^([A-Za-z_]\w*)\s*:\s*begin$/);
      if (mB) {
        var body = [];
        i += 1;
        while (i < lines.length && lines[i] !== 'end') { body.push(lines[i]); i += 1; }
        i += 1; // consume el 'end' de cierre
        items.push({ label: mB[1], lines: body });
        continue;
      }
      var mD = lines[i].match(/^default\s*:\s*(.*)$/);
      if (mD) { items.push({ label: 'default', lines: [mD[1]] }); i += 1; continue; }
      i += 1;
    }
    return items;
  }

  function findCaseBlocks(text, reg) {
    var re = new RegExp('case\\s*\\(\\s*' + escapeReg(reg) + '\\s*\\)', 'g');
    var out = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      var bodyStart = m.index + m[0].length;
      var endIdx = text.indexOf('endcase', bodyStart);
      if (endIdx === -1) continue;
      out.push({ matchStart: m.index, bodyStart: bodyStart, body: text.slice(bodyStart, endIdx) });
    }
    return out;
  }

  function parseModule(rawText) {
    var text = stripComments(rawText);

    /* ---- cabecera del modulo y puertos ---- */
    var modM = text.match(/\bmodule\s+([A-Za-z_]\w*)\s*\(([\s\S]*?)\)\s*;/);
    if (!modM) {
      throw new ParseError('No se encontró "module ... ( ... );". Este importador lee el .v de ' +
        'módulo completo exportado por el editor (o con su misma estructura); si exportaste solo ' +
        'el "Cuerpo .v (Icestudio)", usa en su lugar "Verilog (.v) · módulo completo".');
    }
    var moduleName = modM[1];
    var ports = [];
    modM[2].split(',').forEach(function (raw) {
      var p = raw.trim();
      if (!p) return;
      var m = p.match(/^(input|output)\s+(?:wire|reg)?\s*(\[[^\]]*\]\s*)?([A-Za-z_]\w*)$/);
      if (!m) throw new ParseError('No se pudo interpretar la declaración de puerto: "' + p + '".');
      ports.push({ dir: m[1], width: parseWidthBracket(m[2]), name: m[3] });
    });

    /* ---- bloque 1: registro de estado (reloj, reset, estado inicial) ---- */
    var seqM = text.match(/always\s*@\s*\(\s*posedge\s+([A-Za-z_]\w*)\s*(?:or\s+(posedge|negedge)\s+([A-Za-z_]\w*)\s*)?\)\s*begin([\s\S]*?)\n\s*end\b/);
    if (!seqM) throw new ParseError('No se encontró el bloque secuencial "always @(posedge ...)" del registro de estado.');
    var clock = seqM[1];
    var resetSync = !seqM[2];
    var reset = seqM[3] || null;
    var ifM = seqM[4].match(/if\s*\(([^)]*)\)\s*([A-Za-z_]\w*)\s*<=\s*([A-Za-z_]\w*)\s*;/);
    if (!ifM) throw new ParseError('No se entendió el "if (reset) ... <= ...;" del registro de estado.');
    var resetCond = ifM[1].trim();
    var REG = ifM[2];
    var initName = ifM[3];
    var resetActiveLow = /^!\s*/.test(resetCond);
    if (!reset) reset = resetCond.replace(/^!\s*/, '').trim();

    /* ---- localparams de estado (orden = orden de aparicion) ---- */
    var lpM = text.match(/localparam\s*\[[^\]]*\]\s*([\s\S]*?);/);
    if (!lpM) throw new ParseError('No se encontró el bloque "localparam [ST_W-1:0] ESTADO = ...;" con los códigos de estado.');
    var stateNames = [];
    var stateCodes = {};
    var reEntry = /([A-Za-z_]\w*)\s*=\s*(\d+)'b([01]+)/g;
    var em;
    while ((em = reEntry.exec(lpM[1])) !== null) { stateNames.push(em[1]); stateCodes[em[1]] = parseInt(em[3], 2); }
    if (!stateNames.length) throw new ParseError('No se pudo leer ningún estado en el bloque de localparam.');

    /* ---- bloque 2 (y opcional 3): case (REG) ... endcase ---- */
    var cases = findCaseBlocks(text, REG);
    if (!cases.length) throw new ParseError('No se encontró "case (' + REG + ')" con la lógica de próximo estado.');
    var nextCase = cases[0];
    var outCase = cases[1] || null;

    var outputsByState = {};
    parseCaseItems(nextCase.body).forEach(function (item) {
      if (item.label === 'default') return;
      var chain = [];
      item.lines.forEach(function (ln) {
        var sp = splitStatementLine(ln);
        var mm = sp.rest.match(/^([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*;?$/);
        if (!mm) return;
        var cond = (sp.kind === 'if' || sp.kind === 'elseif') ? sp.cond : '';
        chain.push({ cond: cond, target: mm[2] });
      });
      outputsByState[item.label] = chain;
    });

    /* ---- valores por defecto + Moore/Mealy (bloque 3, si existe) ---- */
    var defaults = {}, mooreByState = {}, mealyByState = {};
    if (outCase) {
      var preStart = text.lastIndexOf('always', outCase.matchStart);
      var preamble = preStart === -1 ? '' : text.slice(preStart, outCase.matchStart);
      var reDef = /([A-Za-z_]\w*)\s*=\s*([^;]+);/g, dm;
      while ((dm = reDef.exec(preamble)) !== null) defaults[dm[1]] = humanizeValue(dm[2]);

      parseCaseItems(outCase.body).forEach(function (item) {
        if (item.label === 'default') return;
        var outputs = {}, dc = false, mealy = [];
        item.lines.forEach(function (ln) {
          var sp = splitStatementLine(ln);
          var isBlock = sp.kind === 'if' || sp.kind === 'elseif' || sp.kind === 'else' || /^begin\b/.test(sp.rest);
          if (isBlock) {
            var cond = (sp.kind === 'if' || sp.kind === 'elseif') ? sp.cond : '';
            var inner = sp.rest.replace(/^begin\s*/, '').replace(/\s*end;?$/, '');
            var assigns = {}, idc = false;
            inner.split(';').forEach(function (a) {
              a = a.trim();
              if (!a) return;
              var am = a.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
              if (!am) return;
              if (isDcValue(am[2])) idc = true; else assigns[am[1]] = humanizeValue(am[2]);
            });
            mealy.push({ cond: cond, outputs: assigns, dc: idc });
          } else {
            var mm = sp.rest.match(/^([A-Za-z_]\w*)\s*=\s*([^;]+);?$/);
            if (!mm) return;
            if (isDcValue(mm[2])) dc = true; else outputs[mm[1]] = humanizeValue(mm[2]);
          }
        });
        mooreByState[item.label] = { outputs: outputs, dc: dc };
        mealyByState[item.label] = mealy;
      });
    }

    /* ---- codificacion: intenta reconocer binaria / gray / one-hot ---- */
    var n = stateNames.length;
    var detected = null;
    ['binary', 'gray', 'onehot'].some(function (enc) {
      var ok = stateNames.every(function (name, i) { return VERILOG.stateCode(i, n, enc) === stateCodes[name]; });
      if (ok) { detected = enc; return true; }
      return false;
    });

    /* ---- ensambla el modelo (reusa los constructores de FSM) ---- */
    var m = FSM.createMachine();
    m.name = moduleName;
    m.clock = clock;
    m.reset = reset;
    m.resetActiveLow = resetActiveLow;
    m.resetSync = resetSync;
    m.encoding = detected || 'binary';
    m.states = []; m.transitions = []; m.inputs = []; m.outputs = []; m.initial = null;

    ports.forEach(function (p) {
      if (p.name === clock || p.name === reset) return;
      var port = FSM.createPort(m, p.dir === 'input' ? 'input' : 'output', p.name);
      port.width = p.width;
      if (p.dir === 'output') port.def = defaults[p.name] != null ? defaults[p.name] : '0';
    });

    var cx = 420, cy = 300, R = Math.max(160, 70 + n * 55);
    var idByName = {};
    stateNames.forEach(function (name, i) {
      var ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
      var st = FSM.createState(m, Math.round(cx + R * Math.cos(ang)), Math.round(cy + R * Math.sin(ang)), name);
      idByName[name] = st.id;
      if (!detected) st.code = stateCodes[name];
      var moore = mooreByState[name];
      if (moore) { st.outputs = moore.outputs; st.dcUndefined = moore.dc; }
    });
    m.initial = idByName[initName] || (m.states[0] && m.states[0].id) || null;

    stateNames.forEach(function (name) {
      var chain = outputsByState[name] || [];
      var mealyList = mealyByState[name] || [];
      var used = mealyList.map(function () { return false; });
      chain.forEach(function (edge) {
        var toId = idByName[edge.target];
        if (!toId) throw new ParseError('La transición de "' + name + '" apunta a un estado desconocido: "' + edge.target + '".');
        var tr = FSM.createTransition(m, idByName[name], toId, edge.cond);
        for (var i = 0; i < mealyList.length; i += 1) {
          if (!used[i] && mealyList[i].cond.trim() === edge.cond.trim()) {
            used[i] = true;
            tr.outputs = mealyList[i].outputs;
            tr.dcUndefined = mealyList[i].dc;
            break;
          }
        }
      });
    });

    return m;
  }

  global.VIMPORT = { parseModule: parseModule, ParseError: ParseError };
}(window));
