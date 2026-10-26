// Usuarios (solo admin): lista de perfiles, rol, activación y nombre.
// El ALTA de usuarios nuevos se hace en Supabase: dashboard → Authentication
// → Users → Add user (el trigger les asigna rol «lector»); desde aquí el
// admin puede promoverlos a editor o admin.
import { sb, asegurar, mensajeError } from '../bd.js';
import { escapar, fechaHora, toast, abrirModal, etiquetaVacia } from '../api.js';

const ROLES = ['admin', 'editor', 'lector'];
const ETIQUETA_ROL = { admin: 'Administración', editor: 'Edición', lector: 'Lectura' };

export default async function (contenedor, contexto) {
  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">admin: todo · editor: catálogo, blog y correos · lector: solo lectura y bandeja.
      Dar de alta cuentas nuevas: <strong>Supabase → Authentication → Users → Add user</strong> (quedan como lector; promuévelas aquí).</p>
    </div>
    <div id="zona-usuarios" class="zona-tabla"><p class="cargando">Cargando usuarios…</p></div>`;

  const zona = contenedor.querySelector('#zona-usuarios');
  let usuarios = [];

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando usuarios…</p>';
    try {
      usuarios = (await asegurar(sb().from('usuarios').select('id, nombre, email, rol, activo, creado_en').order('creado_en'))) || [];
      pintar();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar los usuarios: ${error.message}`);
    }
  }

  function pintar() {
    zona.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Alta</th><th>Activo</th><th class="alineado-derecha">Acciones</th></tr></thead>
        <tbody>
          ${usuarios.map((u) => {
            const soyYo = u.id === contexto.usuario.id;
            return `
          <tr data-id="${escapar(u.id)}">
            <td><strong>${escapar(u.nombre || '(sin nombre)')}</strong>${soyYo ? ' <span class="chip">tú</span>' : ''}</td>
            <td class="texto-suave">${escapar(u.email)}</td>
            <td><span class="chip chip-oro">${escapar(ETIQUETA_ROL[u.rol] || u.rol)}</span></td>
            <td class="texto-suave">${u.creado_en ? fechaHora(u.creado_en) : '—'}</td>
            <td><label class="interruptor"><input type="checkbox" data-accion="activo" ${u.activo !== false ? 'checked' : ''}><span class="interruptor-pista"></span></label></td>
            <td class="alineado-derecha">
              <button class="boton boton-fantasma boton-pequeno" data-accion="editar" type="button">Editar</button>
            </td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  zona.addEventListener('change', async (evento) => {
    const interruptor = evento.target.closest('input[data-accion="activo"]');
    if (!interruptor) return;
    const usuario = usuarios.find((u) => u.id === interruptor.closest('tr').dataset.id);
    if (!usuario) return;
    try {
      const error = (await sb().from('usuarios').update({ activo: interruptor.checked }).eq('id', usuario.id)).error;
      if (error) throw new Error(mensajeError(error));
      usuario.activo = interruptor.checked;
      toast(interruptor.checked ? `«${usuario.nombre || usuario.email}» puede volver a entrar.` : `«${usuario.nombre || usuario.email}» desactivado: no podrá iniciar sesión.`);
    } catch (error) {
      interruptor.checked = !interruptor.checked;
      toast(error.message, 'error');
    }
  });

  zona.addEventListener('click', (evento) => {
    const boton = evento.target.closest('button[data-accion="editar"]');
    if (!boton) return;
    const usuario = usuarios.find((u) => u.id === boton.closest('tr').dataset.id);
    if (usuario) abrirFormularioEdicion(usuario, cargar);
  });

  await cargar();
}

function abrirFormularioEdicion(usuario, alGuardar) {
  const { cerrar, cuerpo } = abrirModal(`Editar: ${usuario.nombre || usuario.email}`, `
    <form class="formulario">
      <label>Nombre</label>
      <input name="nombre" maxlength="120" value="${escapar(usuario.nombre || '')}">
      <label>Rol</label>
      <select name="rol">
        ${ROLES.map((r) => `<option value="${r}" ${usuario.rol === r ? 'selected' : ''}>${escapar(ETIQUETA_ROL[r])}</option>`).join('')}
      </select>
      <p class="nota-secreto">Las contraseñas se gestionan desde Supabase (Authentication → Users: «Send password recovery» para que cada persona fije la suya).</p>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
        <button type="submit" class="boton boton-primario">Guardar</button>
      </div>
    </form>`, '26rem');

  const formulario = cuerpo.querySelector('form');
  cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      const error = (await sb().from('usuarios').update({
        nombre: formulario.elements.nombre.value.trim(),
        rol: formulario.elements.rol.value,
      }).eq('id', usuario.id)).error;
      if (error) throw new Error(mensajeError(error));
      toast('Usuario actualizado.');
      cerrar();
      alGuardar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}
