// Shell del panel sobre Supabase Auth: sesión, perfil con rol de la tabla
// usuarios, navegación entre secciones, permisos por rol y contador de la
// bandeja. (Adaptado de servidor/panel/panel.js: la capa de red es supabase-js.)
import { configurado, sb, perfilDe, mensajeError } from './js/bd.js';
import { toast, abrirModal } from './js/api.js';

const vistaConfig = document.getElementById('vista-config');
const vistaLogin = document.getElementById('vista-login');
const vistaPanel = document.getElementById('vista-panel');
const formularioLogin = document.getElementById('formulario-login');
const avisoLogin = document.getElementById('login-aviso');
const tituloSeccion = document.getElementById('titulo-seccion');
const contenidoSeccion = document.getElementById('contenido-seccion');
const menuLateral = document.getElementById('menu-lateral');
const lateral = document.getElementById('lateral');
const botonMenu = document.getElementById('boton-menu');
const botonSalir = document.getElementById('boton-salir');
const botonContrasena = document.getElementById('boton-contrasena');
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
  vistaConfig.hidden = vista !== 'config';
  vistaLogin.hidden = vista !== 'login';
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

function entrar(perfil) {
  usuarioActual = perfil;
  usuarioNombre.textContent = perfil.nombre || perfil.email;
  usuarioRol.textContent = `${ROLES_VISUAL[perfil.rol] || perfil.rol} · ${perfil.email}`;
  aplicarPermisos();
  mostrarVista('panel');
  refrescarContador();
  irASeccion('panel');
}

async function refrescarContador() {
  if (!usuarioActual || vistaPanel.hidden) return;
  try {
    const { count, error } = await sb()
      .from('mensajes')
      .select('id', { count: 'exact', head: true })
      .eq('leido', false)
      .eq('archivado', false);
    if (error) throw error;
    const total = Number(count) || 0;
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
    await sb().auth.signOut();
  } catch {}
  usuarioActual = null;
  contenidoSeccion.innerHTML = '';
  mostrarVista('login');
});

// Cambio de contraseña propio (Supabase Auth)
botonContrasena.addEventListener('click', () => {
  const { cerrar, cuerpo } = abrirModal('Cambiar mi contraseña', `
    <form id="formulario-contrasena" class="formulario">
      <label>Contraseña nueva (mínimo 8 caracteres)</label>
      <input name="contrasena" type="password" minlength="8" required>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
        <button type="submit" class="boton boton-primario">Guardar contraseña</button>
      </div>
    </form>`, '26rem');
  cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);
  cuerpo.querySelector('#formulario-contrasena').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const nueva = evento.target.elements.contrasena.value;
    const boton = evento.target.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
      const { error } = await sb().auth.updateUser({ password: nueva });
      if (error) throw new Error(mensajeError(error));
      toast('Contraseña actualizada.');
      cerrar();
    } catch (error) {
      toast(error.message, 'error');
      boton.disabled = false;
    }
  });
});

formularioLogin.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  avisoLogin.textContent = '';
  avisoLogin.classList.remove('ok');
  const boton = formularioLogin.querySelector('button');
  boton.disabled = true;
  try {
    const email = document.getElementById('login-email').value;
    const contrasena = document.getElementById('login-contrasena').value;
    const { data, error } = await sb().auth.signInWithPassword({ email, password: contrasena });
    if (error) throw new Error(error.message === 'Invalid login credentials'
      ? 'Correo o contraseña incorrectos.'
      : error.message);
    const perfil = await perfilDe(data.user.id);
    if (!perfil) {
      await sb().auth.signOut();
      throw new Error('Tu cuenta no tiene perfil en el panel. Pide a una administración que la active.');
    }
    if (perfil.activo === false) {
      await sb().auth.signOut();
      throw new Error('Tu cuenta está desactivada. Habla con la administración.');
    }
    formularioLogin.reset();
    entrar(perfil);
  } catch (error) {
    avisoLogin.textContent = error.message;
  } finally {
    boton.disabled = false;
  }
});

// Sesión recuperada al recargar + cierre de sesión desde otra pestaña
async function iniciar() {
  if (!configurado() || typeof window.supabase === 'undefined') {
    mostrarVista('config');
    return;
  }
  try {
    sb().auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT' && usuarioActual) {
        usuarioActual = null;
        contenidoSeccion.innerHTML = '';
        mostrarVista('login');
      }
    });
    const { data, error } = await sb().auth.getSession();
    if (error || !data?.session) {
      mostrarVista('login');
      return;
    }
    const perfil = await perfilDe(data.session.user.id);
    if (perfil && perfil.activo !== false) {
      entrar(perfil);
    } else {
      mostrarVista('login');
    }
  } catch (error) {
    console.error(error);
    mostrarVista('login');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}

setInterval(refrescarContador, 60 * 1000);
