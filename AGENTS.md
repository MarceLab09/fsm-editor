# AGENTS.md — guía para agentes de IA en este repositorio

Este proyecto (FSM Editor) se ha desarrollado con asistencia de un agente de
codificación de IA (Claude Code) en sesiones iterativas. Este archivo resume
las convenciones que debe seguir cualquier agente que trabaje en el repo.

## Qué es esto

Editor visual de máquinas de estado finitas (Moore/Mealy) que exporta a
Verilog-2001 y a un bloque de Icestudio (`.ice`). App web estática: HTML +
CSS + JavaScript clásico (sin módulos, sin framework, sin paso de
compilación), para poder abrirse con doble clic (`file://`) o servirse tal
cual.

## Reglas de código

- JavaScript "clásico": `<script>` normales (no `type="module"`), IIFE con
  `(function (global) { ... }(window))`, cada archivo expone un único
  objeto global (`FSM`, `VERILOG`, `ICE`, `VIMPORT`, `PHYS`, `EDITOR`,
  `I18N`, `PLUGIN`). No se añaden dependencias de runtime; Playwright es la única
  dependencia y es solo de desarrollo (pruebas).
- El repo es, además, un **plugin externo de Icestudio**: `manifest.json` +
  `icon.svg` en la raíz. La carpeta instalada debe llamarse igual que el `id`
  del manifiesto (`fsm-editor`), porque Icestudio abre
  `<plugins>/<id>/index.html`. Todo lo específico del plugin vive en
  `js/plugin.js` y queda inerte fuera de Icestudio: nada puede romper el modo
  `file://`.
- Sin paso de build: cualquier cambio debe poder probarse abriendo
  `index.html` directamente.
- Cache-busting manual: los `<script src="js/x.js?v=N">` de `index.html`
  llevan un número de versión; súbelo cuando cambies JS/CSS para que el
  navegador no sirva una copia en caché.

## Pruebas

```
npm install
npm test           # core + UI (node --test)
npm run test:core  # modelo/Verilog/.ice/import, sin navegador
npm run test:ui    # Playwright (Edge si está instalado; si no, Chromium)
```

Cualquier cambio de comportamiento debe venir acompañado de una prueba que
lo cubra, y la suite completa debe quedar en verde antes de dar un cambio
por terminado. CI (`.github/workflows/ci.yml`) corre la misma suite en
Linux en cada push/PR a `main`.

## Flujo de git

- Commits locales libres; **nunca hacer `git push` sin que el usuario lo
  pida explícitamente**.
- Nunca incluir los prompts/mensajes del usuario en mensajes de commit ni
  en archivos que se vayan a subir — solo describir el cambio técnico.
- Mensajes de commit en español, describiendo qué cambió y por qué,
  terminados con la línea de coautoría del agente.

## Dónde está cada cosa

Ver la sección **Estructura** de `README.md` para el mapa de archivos
(`js/model.js`, `js/verilog.js`, `js/icestudio.js`, `js/vimport.js`,
`js/physics.js`, `js/editor.js`, `js/app.js`, `js/i18n.js`) y el resto de
secciones del README para el comportamiento esperado de cada parte de la
interfaz (barra, lienzo, consola, tabla de transición, idioma, ayuda,
exportación/importación).
