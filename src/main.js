/**
 * Punto de entrada. Crea el juego, arranca Three.js y maneja el loader.
 *
 * El loader vive en index.html (inline) porque tiene que pintarse ANTES de que
 * llegue este módulo. Aquí solo se le empuja el progreso y se cierra cuando el
 * juego está de verdad listo.
 */

import './styles/main.css';
import { GameApp } from './game.js';

const canvas = document.getElementById('scene');
const boot = window.__boot;

/**
 * Marca `html.ready` para que main.css revele la interfaz.
 *
 * Es la pieza que evita el destello de menú sin estilos: no se enseña nada
 * hasta que el CSS ya se aplicó de verdad.
 */
function revealUI() {
  document.documentElement.classList.add('ready');
}

function fatal(msg) {
  // Nunca dejamos al usuario con una pantalla en blanco: el loader se queda,
  // con el error escrito, en vez de desaparecer.
  boot?.fail(msg);
  const tip = document.getElementById('boot-tip');
  if (tip) {
    tip.textContent = 'Este juego necesita WebGL 2. Prueba con Chrome, Edge o '
      + 'Firefox actualizados y con la aceleración por hardware activada.';
    tip.style.color = 'rgba(255,255,255,.62)';
  }
}

try {
  const app = new GameApp(canvas, { boot });
  window.__game = app;

  app.boot()
    .then(() => {
      revealUI();
      // Un frame de respiro antes de cerrar: deja ver la barra al 100% y
      // evita que el menú aparezca a la vez que el loader se desvanece.
      setTimeout(() => boot?.done(), 380);
    })
    .catch((err) => {
      console.error(err);
      revealUI();
      fatal('No se pudo iniciar el motor 3D: ' + (err?.message || err));
    });

  window.addEventListener('beforeunload', () => app.destroy());

  // Red de seguridad: si algo tarda demasiado, se enseña la interfaz igual para
  // que el usuario no se quede mirando una barra para siempre.
  setTimeout(revealUI, 12000);
} catch (err) {
  console.error(err);
  revealUI();
  fatal('Error al crear el juego: ' + (err?.message || err));
}
