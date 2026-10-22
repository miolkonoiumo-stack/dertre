# 🌋 THE FLOOR IS LAVA

Juego 3D de supervivencia en arena, construido con **Three.js** y un **servidor autoritativo en Node.js + Socket.IO**. El piso empieza neutro: aparecen las zonas seguras y corre un contador de 5 segundos. Quien no llegue a una zona, explota.

## El ciclo

1. El piso arranca **neutro** (gris acero, sin zonas).
2. Aparecen las **zonas seguras** y empieza el contador de **5 segundos**.
3. Al llegar a 0, **explota quien no esté sobre una zona**. Quien sí está, sigue vivo.
4. Si quedan **N** jugadores, salen exactamente **N − 1** zonas nuevas.
5. Se repite hasta que queda **un solo superviviente**.

## Reglas

- **Una zona = un solo tile.** No hay zonas de varios tiles.
- **Capacidad 1 por zona:** dos jugadores no pueden compartir zona. Si llegan dos, se salva el que esté más cerca del centro del tile.
- **El piso no cambia a media ronda.** Las zonas que ves al empezar son exactamente las que deciden quién vive.
- Cada ronda las zonas se **reubican** y siempre son alcanzables a pie en esos 5 segundos.
- Si nadie llega a la única zona que queda, no sobrevive nadie (empate real).

## Características

- **Multijugador real y autoritativo:** el servidor manda. Cliente y servidor comparten `shared/constants.js` y `shared/sim.js`, así que la simulación es idéntica en ambos lados. Nada de "multijugador" simulado.
- **Bots con 5 niveles de dificultad**, ajustables desde el menú. Los bots solo usan información que también tiene un humano (posiciones y velocidades visibles).
- **Lobby con código de sala** de 5 caracteres.
- **Arena 3D** con Three.js: iluminación, explosiones, efectos de partículas, animación de caída.
- **Personajes con carácter propio:** cada jugador recibe una combinación única de color y tocado de cabeza (antenas, cuernos, gorra, gafas, orejas, aleta, aro, corona). Cabeza grande, cuerpo pequeño, extremidades cortas, contorno negro grueso, ojos que siguen la dirección de la carrera y parpadean, y squash & stretch al saltar y aterrizar. Todo procedural, sin ficheros de modelo.
- **Escenario de concurso:** el plató es un decorado de *game show* — plataforma de tiles biselados con tapa luminosa, marco de acero con barandilla de neón, torres de luz en las esquinas, gradas con público y un horizonte de crepúsculo con crestas volcánicas.
- **Audio sintetizado** (sin ficheros externos).
- **HUD en español:** ronda, tiempo, jugadores vivos, dificultad.

## Cómo correrlo

Requisitos: **Node.js 22+**.

```bash
npm install
```

Modo desarrollo (web + servidor a la vez):

```bash
npm run dev:all
```

Abre http://localhost:5173 — el servidor de juego escucha en el puerto `8787`.

Por separado, si prefieres:

```bash
npm run dev      # Vite en :5173 (hot reload)
npm run server   # servidor autoritativo en :8787
```

Build de producción:

```bash
npm run build
npm run preview
```

## Pruebas

```bash
npm run test:rules   # reglas del juego (30 tests)
npm test             # toda la suite
```

Además de los tests unitarios, el proyecto trae sondas de verificación en `tools/` que instrumentan el motor y el navegador de verdad (Playwright) para comprobar invariantes difíciles de testear de forma estática: conteo de zonas por ronda, que el piso no cambie a media ronda, que la resolución juzgue contra el piso que el jugador está viendo, etc.

## Arquitectura

```
shared/          ← código compartido cliente/servidor (la fuente de verdad)
  constants.js     constantes de simulación (tile, velocidades, tiempos)
  sim.js           física, generación de zonas, resolución de ronda
  game.js          máquina de estados de la partida (countdown → play → swap → result)
  bots.js          IA de los bots y los 5 perfiles de dificultad

server/          ← servidor autoritativo
  index.js         Express + Socket.IO
  rooms.js         gestión de salas, tick a 20 Hz

src/             ← cliente
  scene/           arena y mundo Three.js
  entities/        avatares
  effects/         partículas y explosiones
  audio/           sonido sintetizado
  input/           teclado y controles
  net/             sesión local (bots) y cliente de red
  ui/              HUD y menús
  game.js          orquestación de la partida

tests/           ← tests de reglas y smoke E2E contra el servidor real
tools/           ← sondas de verificación e instrumentación
```

## Concepto de diseño clave

La resolución de la ronda se hace **contra el piso que el jugador está viendo**. Si el motor juzgara contra el piso *siguiente*, la gente moriría parada sobre verde y el juego se sentiría roto. Todo lo que ves, es lo que te mata.

## Licencia

MIT
