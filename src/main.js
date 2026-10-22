/**
 * Entry point. Creates the game shell, boots three.js and wires the loading
 * screen. Kept tiny on purpose — everything else is scoped modules.
 */

import './styles/main.css';
import { GameApp } from './game.js';

const canvas = document.getElementById('scene');

function fatal(msg) {
  const box = document.querySelector('.loader-box');
  if (!box) return;
  box.innerHTML = `
    <div class="loader-logo">THE FLOOR<span>IS LAVA</span></div>
    <p style="color:#ff6a5a;margin-top:18px;line-height:1.5">${msg}</p>
    <p style="color:#9aa3b8;font-size:13px;line-height:1.5">
      Este juego necesita WebGL 2. Prueba con Chrome, Edge o Firefox actualizados
      y activa la aceleración por hardware.
    </p>`;
}

try {
  const app = new GameApp(canvas);
  window.__game = app;
  app.boot().catch((err) => {
    console.error(err);
    fatal('No se pudo iniciar el motor 3D: ' + (err?.message || err));
  });
  window.addEventListener('beforeunload', () => app.destroy());
} catch (err) {
  console.error(err);
  fatal('Error al crear el juego: ' + (err?.message || err));
}
