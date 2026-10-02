import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserModules, plain } from './helpers.mjs';

const { FSM, VERILOG, VIMPORT } = loadBrowserModules(['model.js', 'verilog.js', 'vimport.js']);

function roundTrip(m) {
  const original = VERILOG.generateModule(m);
  const reimported = VIMPORT.parseModule(original);
  const reexported = VERILOG.generateModule(reimported);
  return { original, reimported, reexported };
}

test('importar el .v del demo (detector 101) reproduce exactamente el mismo Verilog', () => {
  const { original, reexported } = roundTrip(FSM.demoMachine());
  assert.equal(reexported, original);
});

test('importar reconstruye nombre de modulo, reloj, reset, encoding e inputs/outputs', () => {
  const { reimported } = roundTrip(FSM.demoMachine());
  assert.equal(reimported.name, 'detector_101');
  assert.equal(reimported.clock, 'clk');
  assert.equal(reimported.reset, 'rst');
  assert.equal(reimported.resetActiveLow, false);
  assert.equal(reimported.resetSync, false);
  assert.equal(reimported.encoding, 'binary');
  assert.deepEqual(plain(reimported.inputs.map((p) => [p.name, p.width])), [['x', 1]]);
  assert.deepEqual(plain(reimported.outputs.map((p) => [p.name, p.width])), [['y', 1]]);
  assert.equal(reimported.states.length, 4);
  assert.equal(reimported.transitions.length, 8);
  assert.equal(FSM.getState(reimported, reimported.initial).name, 'S0');
});

test('Mealy + bus + gray + reset sincrono activo bajo: round-trip exacto', () => {
  const m = FSM.createMachine();
  m.name = 'ctrl';
  m.encoding = 'gray';
  m.resetSync = true;
  m.resetActiveLow = true;
  FSM.createPort(m, 'input', 'en');
  const data = FSM.createPort(m, 'input', 'data'); data.width = 8;
  const q = FSM.createPort(m, 'output', 'q'); q.width = 8; q.def = '0';
  FSM.createPort(m, 'output', 'busy');

  const A = FSM.createState(m, 0, 0, 'A');
  const B = FSM.createState(m, 200, 0, 'B');
  const C = FSM.createState(m, 400, 0, 'C');
  m.initial = A.id;
  B.outputs.busy = '1';
  const t1 = FSM.createTransition(m, A.id, B.id, 'en');
  t1.outputs.q = "8'hAA";
  FSM.createTransition(m, A.id, A.id, '');
  FSM.createTransition(m, B.id, C.id, "data == 8'd0");
  FSM.createTransition(m, B.id, B.id, '');
  FSM.createTransition(m, C.id, A.id, '');

  const { original, reimported, reexported } = roundTrip(m);
  assert.equal(reexported, original);
  assert.equal(reimported.encoding, 'gray');
  assert.equal(reimported.resetSync, true);
  assert.equal(reimported.resetActiveLow, true);
  assert.equal(FSM.getState(reimported, reimported.states.find((s) => s.name === 'B').id).outputs.busy, '1');
  const trAB = reimported.transitions.find((t) => FSM.getState(reimported, t.from).name === 'A' && t.cond === 'en');
  assert.equal(trAB.outputs.q, "8'hAA");
});

test('"valores no definidos a DC" (\'bx) se reinterpreta como dcUndefined', () => {
  const m = FSM.createMachine();
  FSM.createPort(m, 'output', 'a');
  const pb = FSM.createPort(m, 'output', 'b'); pb.width = 4;
  const S = FSM.createState(m, 0, 0, 'S');
  const T = FSM.createState(m, 1, 0, 'T');
  m.initial = S.id;
  S.outputs.a = '1';
  S.dcUndefined = true;
  FSM.createTransition(m, S.id, T.id, '');
  FSM.createTransition(m, T.id, S.id, '');

  const { original, reimported, reexported } = roundTrip(m);
  assert.equal(reexported, original);
  const rs = reimported.states.find((s) => s.name === 'S');
  assert.equal(rs.dcUndefined, true);
  assert.equal(rs.outputs.a, '1');
  assert.equal(rs.outputs.b, undefined);
});

test('numero de estado forzado (codificacion no reconocida): se preserva via s.code', () => {
  const m = FSM.createMachine();
  const a = FSM.createState(m, 0, 0, 'A');
  const b = FSM.createState(m, 1, 0, 'B');
  const c = FSM.createState(m, 2, 0, 'C');
  m.initial = a.id;
  a.code = 2; b.code = 0; c.code = 1;
  FSM.createTransition(m, a.id, b.id, '');
  FSM.createTransition(m, b.id, c.id, '');
  FSM.createTransition(m, c.id, a.id, '');

  const { original, reimported, reexported } = roundTrip(m);
  assert.equal(reexported, original);
  assert.equal(reimported.states.find((s) => s.name === 'A').code, 2);
  assert.equal(reimported.states.find((s) => s.name === 'B').code, 0);
  assert.equal(reimported.states.find((s) => s.name === 'C').code, 1);
});

test('one-hot se reconoce como encoding automatico (sin s.code forzado)', () => {
  const m = FSM.createMachine();
  m.encoding = 'onehot';
  const a = FSM.createState(m, 0, 0, 'A');
  const b = FSM.createState(m, 1, 0, 'B');
  m.initial = a.id;
  FSM.createTransition(m, a.id, b.id, '');
  FSM.createTransition(m, b.id, a.id, '');

  const { original, reimported, reexported } = roundTrip(m);
  assert.equal(reexported, original);
  assert.equal(reimported.encoding, 'onehot');
  reimported.states.forEach((s) => assert.equal(s.code, null));
});

test('el cuerpo .v (Icestudio) no se puede importar: error explicativo', () => {
  const body = VERILOG.generateBody(FSM.demoMachine());
  assert.throws(() => VIMPORT.parseModule(body), /módulo completo/);
});

test('Verilog irreconocible: error explicativo, no una excepcion generica', () => {
  assert.throws(() => VIMPORT.parseModule('module x(); endmodule'), VIMPORT.ParseError);
});
