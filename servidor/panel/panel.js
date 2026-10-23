// Shell del panel: sesión, navegación entre secciones, permisos por rol y contador de la bandeja.
import { pedir, toast } from './js/api.js';

const vistaLogin = document.getElementById('vista-login');
const vistaCambio = document.getElementById('vista-cambio');
const vistaPanel = document.getElementById('vista-panel');
const formularioLogin = document.getElementById('formulario-login');
const avisoLogin = document.getElementById('login-aviso');
const formularioCambio = document.getElementById('formulario-cambio');
const avisoCambio = document.getElementById('cambio-aviso');
const tituloSeccion = document.getElementById('titulo-seccion');
const contenidoSeccion = document.getElementById('contenido-seccion');
const menuLateral = document.getElementById('menu-lateral');
const lateral = document.getElementById('lateral');
const botonMenu = document.getElementById('boton-menu');
const botonSalir = document.getElementById('boton-salir');
const usuarioNombre = document.getElementById('usuario-nombre');
const usuarioRol = document.getElementById('usuario-rol');
const contadorBandeja = document.getElementById('contador-bandeja');

const TODOS = ['admin', 'editor', 'lector'];
const SOLO_GESTION = ['admin', 'editor'];

const SECCIONES = {
  panel: { titulo: 'Panel', mod: './js/secciones/panel.js', roles: TODOS },
  productos: { titulo: 'Productos', mod: './js/secciones/productos.js', roles: TODOS },
  categorias: { titulo: 'Categorías', mod: './js/secciones/categorias.js', roles: SOLO_GESTION },
  ofertas: { titulo: 'Ofertas', mod: './js/secciones/ofertas.js', roles: SOLO_GESTION },
  testimonios: { titulo: 'Testimonios', mod: './js/secciones/testimonios.js', roles: SOLO_GESTION },
  blog: { titulo: 'Blog · El Umbral', mod: './js/secciones/blog.js', roles: TODOS },
  email: { titulo: 'Email marketing', mod: './js/secciones/email.js', roles: SOLO_GESTION },
  bandeja: { titulo: 'Bandeja de entrada', mod: './js/secciones/bandeja.js', roles: TODOS },
  pedidos: { titulo: 'Pedidos', mod: './js/secciones/pedidos.js', roles: TODOS },
  ajustes: { titulo: 'Ajustes', mod: './js/secciones/ajustes.js', roles: ['admin'] },
  usuarios: { titulo: 'Usuarios', mod: './js/secciones/usuarios.js', roles: ['admin'] },
  manual: { titulo: 'Manual del panel', mod: './js/secciones/manual.js', roles: TODOS },
};

const ROLES_VISUAL = { admin: 'Administración', editor: 'Edición', lector: 'Lectura' };

let usuarioActual = null;
let seccionActual = 'panel';
const modulosCargados = new Map();

function mostrarVista(vista) {
  vistaLogin.hidden = vista !== 'login';
  vistaCambio.hidden = vista !== 'cambio';
  vistaPanel.hidden = vista !== 'panel';
}

function aplicarPermisos() {
  if (!usuarioActual) return;
  const rol = usuarioActual.rol;
  menuLateral.querySelectorAll('.menu-item').forEach((boton) => {
    const seccion = SECCIONES[boton.dataset.seccion];
    boton.hidden = !seccion || !seccion.roles.includes(rol);
  });
}

function entrar(usuario) {
  usuarioActual = usuario;
  usuarioNombre.textContent = usuario.nombre || usuario.email;
  usuarioRol.textContent = `${ROLES_VISUAL[usuario.rol] || usuario.rol} · ${usuario.email}`;
  aplicarPermisos();
  mostrarVista('panel');
  refrescarContador();
  irASeccion('panel');
}

async function refrescarContador() {
  if (!usuarioActual || vistaPanel.hidden) return;
  try {
    const datos = await pedir('/api/mensajes?estado=noleidos');
    const total = Number(datos.totalNoLeidos) || 0;
    contadorBandeja.hidden = total === 0;
    contadorBandeja.textContent = total > 99 ? '99+' : String(total);
  } catch {
    contadorBandeja.hidden = true;
  }
}

async function irASeccion(clave) {
  const seccion = SECCIONES[clave];
  if (!seccion || (usuarioActual && !seccion.roles.includes(usuarioActual.rol))) {
    clave = 'panel';
  }
  seccionActual = clave;
  menuLateral.querySelectorAll('.menu-item').forEach((b) => b.classList.toggle('activo', b.dataset.seccion === clave));
  tituloSeccion.textContent = SECCIONES[clave].titulo;
  lateral.classList.remove('abierta');
  contenidoSeccion.innerHTML = '<p class="cargando">Cargando…</p>';
  try {
    if (!modulosCargados.has(clave)) {
      modulosCargados.set(clave, await import(SECCIONES[clave].mod));
    }
    contenidoSeccion.innerHTML = '';
    const contexto = { usuario: usuarioActual, irA: irASeccion, refrescarContador, seccionActual: () => seccionActual };
    await modulosCargados.get(clave).default(contenidoSeccion, contexto);
  } catch (error) {
    console.error(error);
    contenidoSeccion.innerHTML = `<p class="estado-vacio">No se pudo cargar la sección: ${error.message}</p>`;
  }
}

menuLateral.addEventListener('click', (evento) => {
  const boton = evento.target.closest('.menu-item');
  if (boton && !boton.hidden) irASeccion(boton.dataset.seccion);
});

botonMenu.addEventListener('click', () => lateral.classList.toggle('abierta'));
document.addEventListener('click', (evento) => {
  if (lateral.classList.contains('abierta') && !lateral.contains(evento.target) && !botonMenu.contains(evento.target)) {
    lateral.classList.remove('abierta');
  }
});

botonSalir.addEventListener('click', async () => {
  try {
    await pedir('/api/auth/logout', { method: 'POST' });
  } catch {}
  usuarioActual = null;
  contenidoSeccion.innerHTML = '';
  mostrarVista('login');
});

formularioLogin.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  avisoLogin.textContent = '';
  avisoLogin.classList.remove('ok');
  const boton = formularioLogin.querySelector('button');
  boton.disabled = true;
  try {
    const datos = await pedir('/api/auth/login', {
      method: 'POST',
      cuerpo: {
        email: document.getElementById('login-email').value,
        contrasena: document.getElementById('login-contrasena').value,
      },
    });
    formularioLogin.reset();
    if (datos.usuario && datos.usuario.debeCambiarContrasena) {
      mostrarVista('cambio');
    } else {
      entrar(datos.usuario);
    }
  } catch (error) {
    avisoLogin.textContent = error.message;
  } finally {
    boton.disabled = false;
  }
});

formularioCambio.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  avisoCambio.textContent = '';
  const nueva = document.getElementById('cambio-nueva').value;
  const repetir = document.getElementById('cambio-repetir').value;
  if (nueva !== repetir) {
    avisoCambio.textContent = 'Las dos contraseñas nuevas no coinciden.';
    return;
  }
  const boton = formularioCambio.querySelector('button');
  boton.disabled = true;
  try {
    await pedir('/api/auth/cambiar-contrasena', {
      method: 'POST',
      cuerpo: {
        contrasenaActual: document.getElementById('cambio-actual').value,
        contrasenaNueva: nueva,
      },
    });
    toast('Contraseña actualizada. Bienvenida al Umbral.');
    const sesion = await pedir('/api/auth/me');
    entrar(sesion.usuario);
  } catch (error) {
    avisoCambio.textContent = error.message;
  } finally {
    boton.disabled = false;
  }
});

window.addEventListener('shaddai:sesion-expirada', () => {
  usuarioActual = null;
  contenidoSeccion.innerHTML = '';
  mostrarVista('login');
  toast('Tu sesión ha caducado. Vuelve a iniciar sesión.', 'error');
});

window.addEventListener('shaddai:cambio-pendiente', () => {
  if (!vistaCambio.hidden) return;
  mostrarVista('cambio');
  toast('Debes cambiar tu contraseña temporal antes de continuar.', 'error');
});

setInterval(refrescarContador, 60 * 1000);

(async function iniciar() {
  try {
    const datos = await pedir('/api/auth/me');
    if (datos.usuario.debeCambiarContrasena) mostrarVista('cambio');
    else entrar(datos.usuario);
  } catch {
    mostrarVista('login');
  }
})();
