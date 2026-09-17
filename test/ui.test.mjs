import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(path.join(here, '..', 'index.html')).href;

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

async function launch() {
  try {
    return await chromium.launch({ channel: 'msedge' });
  } catch (e) {
    const fs = await import('node:fs');
    const exe = EDGE_PATHS.find((p) => fs.existsSync(p));
    if (!exe) throw e;
    return await chromium.launch({ executablePath: exe });
  }
}

/* Un browser para toda la suite. */
let browser;
test.before(async () => { browser = await launch(); });
test.after(async () => { await browser?.close(); });

async function openEditor() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(INDEX_URL);
  await page.waitForSelector('#canvas .layer-nodes .state');
  return { page, errors };
}

const nodeCount = (page) => page.locator('#canvas .layer-nodes .state').count();
const edgeCount = (page) => page.locator('#canvas .layer-edges .edge').count();
const centerOf = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
};
const acceptModal = (page) => page.locator('.modal-actions button', { hasText: 'Aceptar' }).click();
const dismissModal = async (page) => {
  if (await page.locator('.modal-overlay').count()) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal-overlay', { state: 'detached' });
  }
};
/* Punto (px de viewport) sobre el trazado de la i-esima transicion, robusto
   ante cualquier curvatura. */
const edgePoint = (page, i, frac = 0.5) => page.evaluate(([idx, f]) => {
  const p = document.querySelectorAll('#canvas .layer-edges .edge .line')[idx];
  const L = p.getTotalLength();
  const q = p.getPointAtLength(L * f);
  const m = p.getScreenCTM();
  return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f };
}, [i, frac]);

test('arranca con el ejemplo, sin errores de consola', async () => {
  const { page, errors } = await openEditor();
  assert.equal(await nodeCount(page), 4, '4 estados en el ejemplo');
  assert.equal(await edgeCount(page), 8, '8 transiciones en el ejemplo');
  assert.equal(await page.locator('#canvas .state.initial').count(), 1, 'un estado inicial marcado');
  assert.deepEqual(errors, []);
  await page.close();
});

test('no existe la exportacion de coleccion; si el resto', async () => {
  const { page } = await openEditor();
  assert.equal(await page.locator('#btn-export-zip').count(), 0);
  assert.equal(await page.locator('#btn-export-v').count(), 1);
  assert.equal(await page.locator('#btn-export-body').count(), 1);
  assert.equal(await page.locator('#btn-export-ice').count(), 1);
  await page.close();
});

test('boton "+ Estado" + clic crea un estado y abre su dialogo', async () => {
  const { page, errors } = await openEditor();
  const before = await nodeCount(page);
  await page.click('#mode-state');
  const c = await page.locator('#canvas').boundingBox();
  await page.mouse.click(c.x + 30, c.y + 30);
  await page.waitForSelector('.modal-overlay');
  assert.match(await page.locator('.modal-title').textContent(), /Nuevo estado/);
  await page.fill('.modal-card .dlg-name', 'PRESET');
  await acceptModal(page);
  await page.waitForSelector('.modal-overlay', { state: 'detached' });
  assert.equal(await nodeCount(page), before + 1);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#canvas .layer-nodes .state .name')].some((t) => t.textContent === 'PRESET'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('boton "Editar…" y tecla Enter abren el dialogo del elemento seleccionado', async () => {
  const { page, errors } = await openEditor();
  assert.equal(await page.locator('#btn-edit').isDisabled(), true, 'deshabilitado sin seleccion');

  // seleccionar un estado -> boton habilitado -> abre dialogo
  await page.locator('#canvas .layer-nodes .state .body').first().click();
  await page.waitForFunction(() => !document.getElementById('btn-edit').disabled);
  await page.click('#btn-edit');
  await page.waitForSelector('.modal-overlay');
  assert.match(await page.locator('.modal-title').textContent(), /Estado/);
  await dismissModal(page);

  // Enter (con el foco fuera de un campo) tambien abre
  await page.locator('#canvas .layer-nodes .state .body').first().click();
  await page.locator('#canvas').focus().catch(() => {});
  await page.keyboard.press('Enter');
  await page.waitForSelector('.modal-overlay');
  assert.match(await page.locator('.modal-title').textContent(), /Estado/);
  await dismissModal(page);

  assert.deepEqual(errors, []);
  await page.close();
});

test('transiciones reciprocas curvan a lados opuestos (no se cruzan), incluso tras mover un estado', async () => {
  const { page, errors } = await openEditor();
  // demo: S10<->S101 es un par reciproco (transiciones #5 y #7, indices 4 y 6)
  const sideCheck = async () => page.evaluate(() => {
    const edges = document.querySelectorAll('#canvas .layer-edges .edge .line');
    const nodes = document.querySelectorAll('#canvas .layer-nodes .state');
    const pt = (el, frac) => { const L = el.getTotalLength(); return el.getPointAtLength(L * frac); };
    // el centro del estado es la traslacion del <g>, no el bbox local del
    // circulo (ese esta centrado en 0,0 dentro de su propio <g>)
    const center = (g) => {
      const m = g.getAttribute('transform').match(/translate\(([-\d.]+)[ ,]+([-\d.]+)\)/);
      return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    };
    const s10 = center(nodes[2]), s101 = center(nodes[3]);
    const apex1 = pt(edges[4], 0.5), apex2 = pt(edges[6], 0.5);
    const L = { x: s101.x - s10.x, y: s101.y - s10.y };
    const cross = (p) => L.x * (p.y - s10.y) - L.y * (p.x - s10.x);
    return { c1: cross(apex1), c2: cross(apex2) };
  });

  const before = await sideCheck();
  assert.ok(before.c1 * before.c2 < 0, 'deberian curvar a lados opuestos: ' + JSON.stringify(before));
  assert.ok(Math.abs(before.c1) > 5 && Math.abs(before.c2) > 5, 'deberian estar realmente curvadas, no rectas');

  // mueve S101 (como en el ejemplo del usuario) y repite la comprobacion
  const s101Body = page.locator('#canvas .layer-nodes .state').nth(3).locator('.body');
  const { x, y } = await centerOf(s101Body);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 150, y + 90, { steps: 10 });
  await page.mouse.up();

  const after = await sideCheck();
  assert.ok(after.c1 * after.c2 < 0, 'tras mover el estado deberian seguir en lados opuestos: ' + JSON.stringify(after));
  assert.ok(Math.abs(after.c1) > 5 && Math.abs(after.c2) > 5);
  assert.deepEqual(errors, []);
  await page.close();
});

test('menus "Archivo" y "Exportar": ocultos por defecto, se abren/cierran y ejecutan su accion', async () => {
  const { page, errors } = await openEditor();

  assert.equal(await page.locator('#menu-file-panel').isHidden(), true);
  assert.equal(await page.locator('#menu-export-panel').isHidden(), true);

  // abrir y cerrar con clic fuera
  await page.click('#menu-file-btn');
  assert.equal(await page.locator('#menu-file-panel').isHidden(), false);
  await page.click('#canvas', { position: { x: 5, y: 5 } });
  assert.equal(await page.locator('#menu-file-panel').isHidden(), true);

  // abrir "Archivo" y cargar el ejemplo -> carga Y cierra el menu
  await page.click('#menu-file-btn');
  await page.click('#btn-demo');
  await page.waitForFunction(() => document.querySelectorAll('#canvas .layer-nodes .state').length === 4);
  assert.equal(await page.locator('#menu-file-panel').isHidden(), true, 'el menu deberia cerrarse tras elegir una accion');

  // Escape tambien cierra
  await page.click('#menu-export-btn');
  assert.equal(await page.locator('#menu-export-panel').isHidden(), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#menu-export-panel').isHidden(), true);

  assert.deepEqual(errors, []);
  await page.close();
});

test('exportar/guardar desde los menus descargan con el nombre y extension correctos', async () => {
  const { page } = await openEditor();

  await page.click('#menu-export-btn');
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-v')]);
  assert.match(dl1.suggestedFilename(), /^detector_101\.v$/);

  await page.click('#menu-export-btn');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-ice')]);
  assert.match(dl2.suggestedFilename(), /^detector_101\.ice$/);

  // Guardar -> extension propia .fsm (no .fsm.json)
  await page.click('#menu-file-btn');
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('#btn-save')]);
  assert.match(dl3.suggestedFilename(), /^detector_101\.fsm$/);

  // Abrir sigue aceptando .fsm (y de paso .json por compatibilidad)
  assert.match(await page.locator('#file-input').getAttribute('accept'), /\.fsm\b/);
  await page.close();
});

test('doble clic en el fondo crea un estado y abre su dialogo', async () => {
  const { page, errors } = await openEditor();
  const before = await nodeCount(page);
  const c = await page.locator('#canvas').boundingBox();
  await page.mouse.dblclick(c.x + 24, c.y + 24);            // esquina vacia tras "ajustar vista"
  await page.waitForFunction((n) => document.querySelectorAll('#canvas .layer-nodes .state').length === n, before + 1);
  assert.equal(await nodeCount(page), before + 1);
  await page.waitForSelector('.modal-overlay');
  assert.match(await page.locator('.modal-title').textContent(), /Nuevo estado/);
  await dismissModal(page);                                 // cancelar no borra el estado
  assert.equal(await nodeCount(page), before + 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('arrastrar un estado lo mueve y persiste', async () => {
  const { page } = await openEditor();
  const node = page.locator('#canvas .layer-nodes .state').first();
  const t0 = await node.getAttribute('transform');
  const { x, y } = await centerOf(node.locator('.body'));   // centro real del circulo
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 80, { steps: 12 });
  await page.mouse.up();
  const t1 = await node.getAttribute('transform');
  assert.notEqual(t0, t1, 'el transform del estado deberia cambiar');

  // el modelo se autoguarda (debounce 400ms) y refleja la nueva posicion
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('fsm-editor:autosave');
    if (!raw) return false;
    const s = JSON.parse(raw).states[0];
    return s && !(s.x === 200 && s.y === 280);
  }, null, { timeout: 3000 });
  const s0 = await page.evaluate(() => JSON.parse(localStorage.getItem('fsm-editor:autosave')).states[0]);
  assert.ok(s0.x !== 200 || s0.y !== 280, 'la posicion persistida deberia haber cambiado');
  await page.close();
});

test('shift + arrastrar entre estados crea una transicion', async () => {
  const { page, errors } = await openEditor();
  const before = await edgeCount(page);
  const nodes = page.locator('#canvas .layer-nodes .state');
  const a = await centerOf(nodes.nth(0));
  const b = await centerOf(nodes.nth(2));
  await page.mouse.move(a.x, a.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 });
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForFunction((n) => document.querySelectorAll('#canvas .layer-edges .edge').length === n, before + 1);
  assert.equal(await edgeCount(page), before + 1);
  // al soltar se abre el dialogo para poner la condicion
  await page.waitForSelector('.modal-overlay');
  assert.match(await page.locator('.modal-title').textContent(), /Nueva transici/);
  await dismissModal(page);
  assert.deepEqual(errors, []);
  await page.close();
});

test('la pestana Salida muestra el Verilog y reacciona al modelo', async () => {
  const { page } = await openEditor();
  await page.getByText('Salida', { exact: true }).click();
  await page.waitForSelector('#panel-code.active');

  const codeModule = await page.locator('#code-out').textContent();
  assert.match(codeModule, /module detector_101 \(/);
  assert.match(codeModule, /endmodule/);

  await page.selectOption('#code-view', 'body');
  const codeBody = await page.locator('#code-out').textContent();
  assert.doesNotMatch(codeBody, /\bmodule\b/);
  assert.match(codeBody, /assign y = y_r;/);

  await page.selectOption('#code-view', 'ice');
  const iceText = await page.locator('#code-out').textContent();
  const ice = JSON.parse(iceText);
  assert.equal(ice.design.graph.blocks.filter((x) => x.type === 'basic.code').length, 1);
  await page.close();
});

test('cambiar el nombre del modulo se refleja en el Verilog', async () => {
  const { page } = await openEditor();
  await page.fill('#mod-name', 'mi_fsm');
  await page.locator('#mod-name').press('Tab');
  await page.getByText('Salida', { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#code-out').textContent.includes('module mi_fsm'));
  assert.match(await page.locator('#code-out').textContent(), /module mi_fsm \(/);
  await page.close();
});

test('anadir una entrada y usarla en una condicion', async () => {
  const { page, errors } = await openEditor();
  await page.click('#btn-add-input');
  const lastName = page.locator('#inputs-list .port-row .port-name').last();
  await lastName.fill('go');
  await lastName.press('Tab');

  // selecciona la primera transicion (clic sobre su trazado) y le pone una condicion
  const ep = await edgePoint(page, 0);
  await page.mouse.click(ep.x, ep.y);
  await page.waitForSelector('#selection-panel h3');
  const cond = page.locator('#selection-panel input:not([type=range])').first();
  await cond.fill('go && !x');
  await cond.press('Tab');

  await page.getByText('Salida', { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#code-out').textContent.includes('go && !x'));
  assert.match(await page.locator('#code-out').textContent(), /if \(go && !x\)/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('doble clic en un estado: dialogo con etiqueta y numero de estado', async () => {
  const { page, errors } = await openEditor();
  await page.locator('#canvas .layer-nodes .state .body').first().dblclick();
  await page.waitForSelector('.modal-overlay');
  assert.match(await page.locator('.modal-title').textContent(), /Estado/);

  await page.fill('.modal-card .dlg-name', 'ARRANQUE');
  await page.fill('.modal-card .dlg-code', '2');
  await acceptModal(page);
  await page.waitForSelector('.modal-overlay', { state: 'detached' });

  await page.waitForFunction(() =>
    [...document.querySelectorAll('#canvas .layer-nodes .state .name')].some((t) => t.textContent === 'ARRANQUE'));

  await page.getByText('Salida', { exact: true }).click();
  await page.waitForFunction(() => /ARRANQUE\s*=\s*2'b10/.test(document.querySelector('#code-out').textContent));
  assert.deepEqual(errors, []);
  await page.close();
});

test('doble clic en una transicion: dialogo de condicion', async () => {
  const { page, errors } = await openEditor();
  const ep = await edgePoint(page, 0, 0.3);
  await page.mouse.dblclick(ep.x, ep.y);
  await page.waitForSelector('.modal-overlay');
  assert.match(await page.locator('.modal-title').textContent(), /Transici/);
  assert.equal(await page.locator('.modal-card .dlg-cond').count(), 1);

  await page.fill('.modal-card .dlg-cond', 'x && ready');
  await acceptModal(page);
  await page.waitForSelector('.modal-overlay', { state: 'detached' });

  // alguna etiqueta de transicion muestra la nueva condicion
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#canvas .edge-label')].some((t) => t.textContent.includes('x && ready')));
  assert.deepEqual(errors, []);
  await page.close();
});

test('curvar una transicion arrastrando el tirador azul', async () => {
  const { page, errors } = await openEditor();
  const ep = await edgePoint(page, 0, 0.4);
  await page.mouse.click(ep.x, ep.y);                       // selecciona la transicion bajo el cursor
  const handle = page.locator('#canvas .layer-edges .edge.selected .curve-handle');
  await handle.waitFor();

  await page.waitForFunction(() => !!localStorage.getItem('fsm-editor:autosave'), null, { timeout: 3000 });
  const readCurves = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('fsm-editor:autosave')).transitions.map((t) => t.curve));
  const before = await readCurves();

  const c0 = await centerOf(handle);
  await page.mouse.move(c0.x, c0.y);
  await page.mouse.down();
  await page.mouse.move(c0.x + 70, c0.y + 70, { steps: 12 });
  await page.mouse.up();

  // la curvatura de la transicion seleccionada cambia y se autoguarda
  await page.waitForFunction((prev) => {
    const raw = localStorage.getItem('fsm-editor:autosave');
    if (!raw) return false;
    const now = JSON.parse(raw).transitions.map((t) => t.curve);
    return now.some((c, i) => c !== prev[i]);
  }, before, { timeout: 3000 });
  assert.deepEqual(errors, []);
  await page.close();
});
