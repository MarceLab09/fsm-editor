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

## Barra de herramientas

Dos menús desplegables agrupan lo que no se usa a cada clic:

- **Archivo ▾** — Nuevo, Cargar ejemplo, Guardar / Abrir máquina de estado (`.fsm`), **Importar desde Verilog (`.v`)**.
- **Exportar ▾** — Verilog `.v` (módulo completo), Cuerpo `.v` (Icestudio `basic.code`), `.ice`.

El resto (modo del ratón, **Deshacer / Rehacer**, **Editar…**, **Ajustar vista**,
**⌨ Atajos**) son botones sueltos, porque se usan todo el rato.

## Controles del lienzo

| Acción | Cómo |
|---|---|
| Nuevo estado | doble clic en el fondo (abre el diálogo) o **+ Estado** + clic |
| Abrir el diálogo (menú) | **doble clic** en el estado/transición · o selecciónalo y pulsa **Enter** · o el botón **«Editar…»** de la barra |
| Editar estado | diálogo: etiqueta, número de estado, estado inicial, salidas (Moore), radio, «valores no definidos → DC» |
| Mover estado | arrastrarlo (con la rejilla; `Alt` = libre) |
| Nueva transición | **Shift + arrastrar** de un estado a otro, **o arrastrar desde el borde** del estado, o botón **+ Transición**. Al soltar se abre el diálogo de la transición |
| Auto-transición | arrastrar (con Shift o desde el borde) de un estado a sí mismo |
| Editar transición | **doble clic en la flecha** → diálogo: condición, salidas (Mealy), prioridad, curvatura / ángulo del bucle (vacío = automático), «valores no definidos → DC» |
| Curvar una transición | **arrastrar la propia línea** (queda fijada a mano; en el panel, «Volver a curvatura automática») |
| Seleccionar | clic |
| Duplicar | **Ctrl+D** sobre el estado/transición seleccionado |
| Borrar | tecla **Supr / Backspace** |
| Deshacer / Rehacer | **Ctrl+Z** / **Ctrl+Y** (o Ctrl+Shift+Z) |
| Zoom | rueda del ratón |
| Pan | arrastrar el fondo |
| Ajustar vista | botón **Ajustar vista** |

Atajos de modo: `V` seleccionar · `S` añadir estado · `T` añadir transición · `Esc` cancelar / cerrar diálogo.
Atajos de documento: `Ctrl+S` guardar `.fsm` · `Ctrl+O` abrir `.fsm` · `Ctrl+N` máquina nueva · `?` ver todos los atajos
(también el botón **⌨ Atajos** de la barra).

Los diálogos también están replicados en el panel lateral **Propiedades** (edición rápida sin modal).

Deshacer/rehacer guarda snapshots completos del modelo (como el `.fsm`), no un
diff por campo — cualquier cambio "definitivo" (no los fotogramas de un
arrastre en curso) queda en la pila. Empezar una máquina nueva, cargar el
ejemplo, abrir un `.fsm` o importar un Verilog reinician el historial (son
documentos distintos).

### Transiciones: curvas «a lo Digital»

El comportamiento está tomado del editor de máquinas de estado de
[Digital](https://github.com/hneemann/Digital/tree/master/src/main/java/de/neemann/digital/fsm)
(paquete `de.neemann.digital.fsm`):

- **Cada transición es un solo arco de circunferencia** (matemáticamente
  redondo, sin picos) que pasa por un **punto guía**. El punto guía solo se
  mueve por la mediatriz entre los dos estados, así que la curva se abre hacia
  un lado u otro; la etiqueta (condición) va en ese punto. Las flechas salen y
  llegan al borde de cada estado, en dirección al punto guía.
- **Física animada**: el punto guía es atraído al centro entre sus estados y
  **repelido** por los demás estados y por los puntos guía de las otras
  transiciones. Se integra con masa y rozamiento hasta asentarse, por eso las
  curvas se abren **hacia afuera** y se separan entre sí al mover estados,
  con animación.
- **Arrastrar la línea, o el punto azul que aparece sobre ella al
  seleccionarla,** mueve su punto guía y la **fija a mano** (la física ya no
  la toca). En el panel *Seleccion* o en el diálogo (campo vacío) vuelve a
  **automática**.
- Las auto-transiciones son un bucle cuyo ángulo automático apunta lejos de los
  estados vecinos y del triangulito de inicio.

Diferencias deliberadas con Digital (`js/physics.js`):

1. Digital no garantiza que las líneas no se crucen (lo arregla el usuario a
   mano). Aquí, cuando la física se asienta y quedan cruces, un buscador local
   fija otros valores de curvatura (otro lado o más abierta) para las
   transiciones implicadas y las curvas se acercan suavemente a ellos.
2. La atracción tiene una longitud natural (~22 px) para que una línea sola
   entre dos estados no quede recta.
3. Exige holgura entre curvas y estados y que la etiqueta no quede tapada.

**Fiabilidad medida** (80 disposiciones aleatorias de los 4 estados del ejemplo,
misma topología de transiciones): el **90 %** salen sin ningún cruce, ninguna
queda recta y ninguna atraviesa un estado; se asienta en bien menos de medio
segundo (una sola vez, al soltar el arrastre — no en cada fotograma).

Límite honesto: con una sola curva por transición hay disposiciones donde un
cruce es **inevitable** — y el ejemplo (*detector 101*) es justo una de ellas:
tiene 8 transiciones sobre 4 estados, incluida una pareja recíproca
(S10↔S101), y **da igual dónde se coloquen los 4 estados** (lo comprobé con 10
disposiciones distintas): siempre queda exactamente 1 cruce, por la misma
razón por la que un cuadrilátero convexo no puede dibujar sus dos diagonales
sin cruzarlas sin rodear por fuera. Ahí el buscador prefiere ese único cruce
antes que atravesar un estado o forzar una búsqueda mucho más lenta.

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

El proyecto se guarda/carga como **`.fsm`** (menú **Archivo**) y además hay
autoguardado en `localStorage`. La exportación a Verilog/Icestudio vive en el
menú **Exportar**.

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

### Importar desde Verilog

**Archivo ▾ → Importar desde Verilog (.v)** reconstruye el diagrama (estados,
transiciones, condiciones, salidas Moore/Mealy, reloj/reset, codificación...)
a partir de un archivo `.v`. No es un parser de Verilog general: lee la
**estructura exacta de 3 bloques** que exporta este editor (registro de
estado / próximo estado / salidas, con un `case` y cadenas `if`/`else if` por
estado) — la misma con la que suele escribirse una FSM "a mano" siguiendo el
estilo clásico. Reimportar un `.v` exportado por este editor reproduce,
reexportado, el **mismo texto byte a byte**.

Limitaciones a tener en cuenta:

- Solo el **módulo completo** (`module … endmodule`); el "Cuerpo `.v`" para
  Icestudio no declara puertos y no se puede reconstruir desde ahí.
- Las posiciones de los estados no existen en el Verilog: se colocan en
  círculo y la física los acomoda.
- Un `if`/`case` por línea, como lo genera este editor; Verilog escrito con
  otro formato (sentencias combinadas en una línea, bloques anidados) puede
  no reconocerse. El importador avisa con un mensaje explicando qué no pudo
  interpretar en vez de fallar en silencio.

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
js/vimport.js      importador: reconstruye el modelo a partir de un .v (global VIMPORT)
js/physics.js      curvas a lo Digital: arco, física de los puntos guía, deshacer cruces (global PHYS)
js/editor.js       lienzo SVG: dibujar, mover, pan/zoom, seleccionar (global EDITOR)
js/app.js          barra de herramientas, inspector, deshacer/rehacer, atajos, exportación
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
