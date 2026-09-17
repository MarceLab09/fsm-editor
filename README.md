# FSM Editor

Editor visual de máquinas de estados en JavaScript puro (sin dependencias, sin
compilación). Dibuja estados y transiciones, muévelos, y exporta a **Verilog** o
a **Icestudio**.

## Uso

Abre `index.html` en un navegador (doble clic). No necesita servidor.

Si tu navegador bloquea las descargas desde `file://`, sirve la carpeta con
cualquier servidor estático, p. ej.:

```
python -m http.server 8000
```

y entra en `http://localhost:8000`.

## Controles del lienzo

| Acción | Cómo |
|---|---|
| Nuevo estado | doble clic en el fondo (abre el diálogo) o **+ Estado** + clic |
| Abrir el diálogo (menú) | **doble clic** en el estado/transición · o selecciónalo y pulsa **Enter** · o el botón **«Editar…»** de la barra |
| Editar estado | diálogo: etiqueta, número de estado, estado inicial, salidas (Moore), radio, «valores no definidos → DC» |
| Mover estado | arrastrarlo (con la rejilla; `Alt` = libre) |
| Nueva transición | **Shift + arrastrar** de un estado a otro, **o arrastrar desde el borde** del estado, o botón **+ Transición**. Al soltar se abre el diálogo de la transición |
| Auto-transición | arrastrar (con Shift o desde el borde) de un estado a sí mismo |
| Editar transición | **doble clic en la flecha** → diálogo: condición, salidas (Mealy), prioridad, curvatura, «valores no definidos → DC» |
| Curvar una transición | seleccionarla y **arrastrar el punto azul** de su vértice (el ángulo, en las auto-transiciones) |
| Seleccionar | clic |
| Borrar | tecla **Supr / Backspace** |
| Zoom | rueda del ratón |
| Pan | arrastrar el fondo |
| Ajustar vista | botón **Ajustar vista** |

Atajos de modo: `V` seleccionar · `S` añadir estado · `T` añadir transición · `Esc` cancelar / cerrar diálogo.

Los diálogos también están replicados en el panel lateral **Propiedades** (edición rápida sin modal).

Las transiciones se dibujan **siempre como arco** (nunca rectas); las recíprocas
(A→B y B→A) y las paralelas se abren en abanico a lados opuestos. Al mover un
estado, sus flechas lo siguen y mantienen la curvatura.

## Modelo

- **Entradas / salidas** con ancho de bus configurable.
- **Salidas Moore**: por estado. **Salidas Mealy**: por transición. En el diálogo
  se escriben como texto: `y=1, z=0` (un `run` suelto equivale a `run=1`).
- **Número de estado** opcional por estado: fuerza el código en la codificación
  elegida (vacío = automático). Se valida que quepa y que no se repita.
- **Valores no definidos → DC (`x`)**: por estado (o por transición), las salidas
  no asignadas ahí se emiten como `x` (don't-care) en vez de su valor por defecto.
- **Radio** opcional por estado (sólo estético).
- **Transición por defecto**: una transición con condición vacía actúa como
  `else` y debe ser la de **menor prioridad** (la última). El orden de prioridad
  se ajusta con las flechas ↑ / ↓ o el campo *Prioridad* del diálogo.
- **Reset**: asíncrono/síncrono y activo en alto/bajo.
- **Codificación**: binaria, Gray o one-hot.
- El panel **Validación** avisa de estados inalcanzables, nombres inválidos,
  condiciones con señales no declaradas, transiciones incondicionales mal
  colocadas, etc. Cada aviso es clicable y selecciona el elemento implicado.

El proyecto se guarda/carga como `.fsm.json` y además hay autoguardado en
`localStorage`.

## Exportación a Verilog

Estilo clásico de 3 bloques, **Verilog-2001**, sintetizable con `yosys`
(flujo `apio` / iCE40):

1. registro de estado (secuencial, con el reset elegido),
2. lógica de próximo estado (`always @(*)` + `case` + `if/else if` por prioridad),
3. lógica de salidas (Moore por estado + Mealy por transición, combinacional).

Dos variantes:

- **Verilog `.v`** — módulo completo (`module … endmodule`). Es lo que se
  importa en Icestudio con *«Importar bloque desde Verilog»*.
- **Cuerpo `.v`** — sólo el cuerpo (localparams, `reg`, `always`, `assign`), sin
  `module` ni redeclarar puertos. Para pegar dentro de un bloque **`basic.code`**
  de Icestudio.

## Exportación a Icestudio

- **`.ice`** — un archivo de bloque: un `basic.code` con el cuerpo Verilog ya
  conectado a bloques `basic.input` / `basic.output` (la entrada de reloj queda
  marcada como *clock*). Se abre o se añade como bloque en Icestudio.

### Notas de compatibilidad

- El esquema `.ice` apunta a **Icestudio 2.x**. Si alguna versión se queja de un
  campo, abre el bloque, vuelve a guardarlo dentro de Icestudio y listo; la
  parte estable (el Verilog del `basic.code` y sus puertos) no cambia.
- Alternativa 100 % robusta: crea un bloque `basic.code` a mano con los puertos
  `clk`, `rst`, entradas y salidas, y pega ahí la salida **«Cuerpo `.v`»**.
- Para iCE40 conviene **reset síncrono** (casilla en el panel del módulo); el
  reset asíncrono también sintetiza pero usa recursos de enrutado más limitados.
- Las salidas son **combinacionales** (Moore/Mealy puro). Si necesitas salidas
  registradas, añádeles un registro en Icestudio.

## Estructura

```
index.html
css/style.css
js/model.js        modelo de datos + validación (global FSM)
js/verilog.js      generador Verilog-2001 (global VERILOG)
js/icestudio.js    generador de archivo .ice (global ICE)
js/editor.js       lienzo SVG: dibujar, mover, pan/zoom, seleccionar (global EDITOR)
js/app.js          barra de herramientas, inspector, exportación
test/              pruebas (core en Node + UI con Playwright)
```

## Desarrollo / pruebas

La app en sí no necesita nada. Para ejecutar las pruebas:

```
npm install          # instala Playwright (el runner es el de Node)
npm test             # core + UI
npm run test:core    # solo el núcleo (modelo, Verilog, .ice) — rápido, sin navegador
npm run test:ui      # solo la UI (Playwright sobre Microsoft Edge)
npm run serve        # sirve la carpeta en http://localhost:8080
```

- **`test/core.test.mjs`** carga `js/model.js`, `js/verilog.js` y `js/icestudio.js`
  en un contexto `vm` y comprueba la codificación de estados, el Verilog generado
  (módulo completo y cuerpo), Mealy/Moore, buses, Gray, reset síncrono/asíncrono,
  número de estado forzado, «valores no definidos → DC», el parseo de salidas, la
  curvatura por defecto, la validación y la estructura del `.ice`.
- **`test/ui.test.mjs`** abre `index.html` en Edge (headless) y comprueba el
  arranque sin errores de consola, crear/mover estados (persistencia), crear
  transiciones arrastrando, los diálogos de estado y transición (doble clic),
  arrastrar el tirador de curvatura, y que la pestaña *Salida* refleja el modelo.

Requisitos: Node.js ≥ 20 y Microsoft Edge instalado.
