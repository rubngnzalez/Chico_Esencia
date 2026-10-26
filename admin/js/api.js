// Utilidades comunes del panel: formato, avisos, modales y vista previa.
// (Adaptado de servidor/panel/js/api.js: la capa de red vive ahora en js/bd.js.)

export { subirImagen, urlImagen } from './bd.js';

export function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function euro(valor) {
  return (Number(valor) || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}

export function fechaCorta(iso) {
  if (!iso) return '—';
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime())
    ? '—'
    : fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fechaHora(iso) {
  if (!iso) return '—';
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime())
    ? '—'
    : fecha.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function slugificar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

export function debounce(funcion, ms = 250) {
  let temporizador = null;
  return (...argumentos) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => funcion(...argumentos), ms);
  };
}

export function toast(mensaje, tipo = 'ok', accion = null) {
  const contenedor = document.getElementById('contenedor-toasts');
  const elemento = document.createElement('div');
  elemento.className = `toast toast-${tipo}`;
  const texto = document.createElement('span');
  texto.textContent = mensaje;
  elemento.appendChild(texto);
  if (accion && accion.texto) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = accion.texto;
    boton.addEventListener('click', () => accion.alPulsar());
    elemento.appendChild(boton);
  }
  contenedor.appendChild(elemento);
  requestAnimationFrame(() => elemento.classList.add('visible'));
  setTimeout(() => {
    elemento.classList.remove('visible');
    setTimeout(() => elemento.remove(), 350);
  }, tipo === 'error' ? 7000 : 4500);
  return elemento;
}

export function abrirModal(titulo, cuerpoHtml, ancho = '') {
  const contenedor = document.getElementById('contenedor-modales');
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" ${ancho ? `style="max-width:${ancho}"` : ''}>
      <header class="modal-cabecera">
        <h3>${escapar(titulo)}</h3>
        <button class="modal-cerrar" type="button" aria-label="Cerrar">×</button>
      </header>
      <div class="modal-cuerpo">${cuerpoHtml}</div>
    </div>`;
  contenedor.appendChild(fondo);
  requestAnimationFrame(() => fondo.classList.add('visible'));
  const alPulsar = (evento) => { if (evento.key === 'Escape') cerrar(); };
  const cerrar = () => {
    fondo.classList.remove('visible');
    document.removeEventListener('keydown', alPulsar);
    setTimeout(() => fondo.remove(), 200);
  };
  fondo.addEventListener('click', (evento) => { if (evento.target === fondo) cerrar(); });
  fondo.querySelector('.modal-cerrar').addEventListener('click', cerrar);
  document.addEventListener('keydown', alPulsar);
  return { fondo, cuerpo: fondo.querySelector('.modal-cuerpo'), cerrar };
}

export function confirmar(titulo, mensaje, textoBoton = 'Eliminar') {
  return new Promise((resolver) => {
    const { cerrar, cuerpo } = abrirModal(
      titulo,
      `<p class="confirmar-texto">${escapar(mensaje)}</p>
       <div class="modal-acciones">
         <button type="button" class="boton boton-fantasma" data-opcion="no">Cancelar</button>
         <button type="button" class="boton boton-peligro" data-opcion="si">${escapar(textoBoton)}</button>
       </div>`,
      '26rem'
    );
    cuerpo.querySelector('[data-opcion="no"]').addEventListener('click', () => { cerrar(); resolver(false); });
    cuerpo.querySelector('[data-opcion="si"]').addEventListener('click', () => { cerrar(); resolver(true); });
  });
}

export function leerArchivoBase64(archivo) {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result));
    lector.onerror = () => rechazar(new Error(`No se pudo leer «${archivo.name}».`));
    lector.readAsDataURL(archivo);
  });
}

export function abrirVistaPrevia(titulo, html) {
  const documento = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vista previa — ${escapar(titulo)}</title><style>
  body { margin:0; background:#f3eee2; color:#2b332c; font-family: Georgia, 'Times New Roman', serif; line-height:1.7; }
  .marco { max-width: 46rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
  .marca { font-family: 'Segoe UI', sans-serif; letter-spacing:.4em; text-transform:uppercase; font-size:.7rem; color:#c9a45f; text-align:center; margin:0 0 2rem; }
  h1 { font-weight:500; color:#16261b; text-align:center; font-size:2rem; }
  h2, h3 { color:#16261b; font-weight:500; }
  img { max-width:100%; height:auto; }
  blockquote { border-left:3px solid #c9a45f; margin:1.5rem 0; padding:.5rem 1.2rem; font-style:italic; }
  a { color:#8a6d3b; }
</style></head><body><div class="marco">
<p class="marca">SHADDAI · Esencia de Umbral · Vista previa</p>
<h1>${escapar(titulo)}</h1>
${html}
</div></body></html>`;
  const url = URL.createObjectURL(new Blob([documento], { type: 'text/html' }));
  const ventana = window.open(url, '_blank');
  if (!ventana) toast('El navegador bloqueó la pestaña de vista previa. Permite las ventanas emergentes.', 'error');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function campoEstrellas(valorInicial = 0) {
  const elemento = document.createElement('div');
  elemento.className = 'estrellas-entrada';
  let actual = Math.min(5, Math.max(0, Number(valorInicial) || 0));
  for (let i = 1; i <= 5; i++) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = '★';
    boton.setAttribute('aria-label', `${i} ${i === 1 ? 'estrella' : 'estrellas'}`);
    boton.addEventListener('click', () => { actual = i; pintar(); });
    elemento.appendChild(boton);
  }
  const pintar = () => {
    elemento.querySelectorAll('button').forEach((b, indice) => b.classList.toggle('marcada', indice < actual));
  };
  pintar();
  return { elemento, valor: () => actual };
}

export function estrellasVisual(n) {
  const numero = Math.min(5, Math.max(0, Number(n) || 0));
  return `<span class="estrellas" aria-label="${numero} de 5 estrellas">${'★'.repeat(numero)}<span class="apagadas">${'★'.repeat(5 - numero)}</span></span>`;
}

const COLORES_ESTADO = {
  borrador: 'gris', programado: 'oro', publicado: 'verde',
  pendiente: 'oro', pagado: 'verde', enviado: 'azul', entregado: 'verde', cancelado: 'rojo',
  enviada: 'verde', pendienteEnvio: 'oro',
};

export function badgeEstado(estado, texto) {
  return `<span class="badge badge-${COLORES_ESTADO[estado] || 'gris'}">${escapar(texto || estado)}</span>`;
}

export function aIso(valorLocal) {
  if (!valorLocal) return null;
  const fecha = new Date(valorLocal);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

export function aLocal(iso) {
  if (!iso) return '';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  const rellenar = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${rellenar(fecha.getMonth() + 1)}-${rellenar(fecha.getDate())}T${rellenar(fecha.getHours())}:${rellenar(fecha.getMinutes())}`;
}

export function etiquetaVacia(texto) {
  return `<p class="estado-vacio">${escapar(texto)}</p>`;
}

// Descarga en cliente de un archivo .eml (bandeja de salida sin envío real)
export function descargarEml(nombre, eml) {
  const blob = new Blob([eml || ''], { type: 'message/rfc822' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
