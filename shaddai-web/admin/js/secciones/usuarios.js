// Usuarios (solo admin): alta desde el panel, roles, activación, contraseñas.
// Las contraseñas van cifradas (Supabase Auth): nunca se pueden ver, solo se
// crean nuevas o se regeneran. Las acciones pasan por la función segura
// «gestion-usuarios», que comprueba rol admin en el servidor.
import { sb, asegurar, invocarFuncion, mensajeError } from '../bd.js';
import { escapar, fechaHora, toast, abrirModal, confirmar, etiquetaVacia } from '../api.js';

const ROLES = ['admin', 'editor', 'lector'];
const ETIQUETA_ROL = { admin: 'Administración', editor: 'Edición', lector: 'Lectura' };

export default async function (contenedor, contexto) {
  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">admin: todo · editor: catálogo, blog y correos · lector: solo lectura y bandeja.
      Las contraseñas van cifradas: no se pueden ver, pero puedes crear cuentas, generar nuevas contraseñas o eliminar cuentas.</p>
      <div class="acciones-barra">
        <button class="boton boton-fantasma boton-pequeno" data-accion="mi-contrasena" type="button">Cambiar mi contraseña</button>
        <button class="boton boton-primario boton-pequeno" data-accion="nuevo" type="button">+ Nuevo usuario</button>
      </div>
    </div>
    <div id="zona-usuarios" class="zona-tabla"><p class="cargando">Cargando usuarios…</p></div>`;

  const zona = contenedor.querySelector('#zona-usuarios');
  let usuarios = [];

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando usuarios…</p>';
    try {
      usuarios = (await asegurar(sb().from('usuarios').select('id, nombre, email, rol, activo, creado_en, ultimo_acceso').order('creado_en'))) || [];
      pintar();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar los usuarios: ${error.message}`);
    }
  }

  function pintar() {
    zona.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Último acceso</th><th>Alta</th><th>Activo</th><th class="alineado-derecha">Acciones</th></tr></thead>
        <tbody>
          ${usuarios.map((u) => {
            const soyYo = u.id === contexto.usuario.id;
            return `
          <tr data-id="${escapar(u.id)}">
            <td><strong>${escapar(u.nombre || '(sin nombre)')}</strong>${soyYo ? ' <span class="chip">tú</span>' : ''}</td>
            <td class="texto-suave">${escapar(u.email)}</td>
            <td><span class="chip chip-oro">${escapar(ETIQUETA_ROL[u.rol] || u.rol)}</span></td>
            <td class="texto-suave">${u.ultimo_acceso ? fechaHora(u.ultimo_acceso) : 'nunca'}</td>
            <td class="texto-suave">${u.creado_en ? fechaHora(u.creado_en) : '—'}</td>
            <td><label class="interruptor"><input type="checkbox" data-accion="activo" ${u.activo !== false ? 'checked' : ''}><span class="interruptor-pista"></span></label></td>
            <td class="alineado-derecha">
              <button class="boton boton-fantasma boton-pequeno" data-accion="contrasena" type="button">Contraseña</button>
              <button class="boton boton-fantasma boton-pequeno" data-accion="editar" type="button">Editar</button>
              ${soyYo ? '' : `<button class="boton boton-peligro boton-pequeno" data-accion="eliminar" type="button">Eliminar</button>`}
            </td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  function mostrarContrasena(email, contrasena) {
    const { cerrar, cuerpo } = abrirModal('Contraseña nueva', `
      <div class="formulario">
        <p class="texto-suave">Guárdala ahora: por seguridad no vuelve a mostrarse ni puede recuperarse.</p>
        <p><strong>${escapar(email)}</strong></p>
        <p class="contrasena-visible"><code>${escapar(contrasena)}</code></p>
        <div class="modal-acciones">
          <button type="button" class="boton boton-fantasma" data-copiar>Copiar</button>
          <button type="button" class="boton boton-primario" data-cerrar2>Hecho</button>
        </div>
      </div>`, '24rem');
    cuerpo.querySelector('[data-copiar]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(contrasena);
        toast('Contraseña copiada.');
      } catch {
        toast('No se pudo copiar: selecciónala a mano.', 'error');
      }
    });
    cuerpo.querySelector('[data-cerrar2]').addEventListener('click', cerrar);
  }

  async function llamar(cuerpo) {
    const respuesta = await invocarFuncion('gestion-usuarios', cuerpo);
    return respuesta || { ok: true };
  }

  function abrirNuevoUsuario() {
    const { cerrar, cuerpo } = abrirModal('Nuevo usuario', `
      <form class="formulario">
        <label>Nombre</label>
        <input name="nombre" maxlength="120" required>
        <label>Email</label>
        <input name="email" type="email" maxlength="160" required>
        <label>Rol</label>
        <select name="rol">
          ${ROLES.map((r) => `<option value="${r}" ${r === 'lector' ? 'selected' : ''}>${escapar(ETIQUETA_ROL[r])}</option>`).join('')}
        </select>
        <label>Contraseña <span class="texto-suave">(vacía = generar una segura)</span></label>
        <input name="contrasena" type="text" minlength="8" placeholder="mínimo 8 caracteres">
        <div class="modal-acciones">
          <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
          <button type="submit" class="boton boton-primario">Crear usuario</button>
        </div>
      </form>`, '26rem');
    const formulario = cuerpo.querySelector('form');
    cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);
    formulario.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const boton = formulario.querySelector('button[type="submit"]');
      boton.disabled = true;
      try {
        const resultado = await llamar({
          accion: 'crear',
          email: formulario.elements.email.value.trim(),
          nombre: formulario.elements.nombre.value.trim(),
          rol: formulario.elements.rol.value,
          contrasena: formulario.elements.contrasena.value.trim(),
        });
        cerrar();
        await cargar();
        mostrarContrasena(resultado.email, resultado.contrasena);
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
      }
    });
  }

  function abrirMiContrasena() {
    const { cerrar, cuerpo } = abrirModal('Cambiar mi contraseña', `
      <form class="formulario">
        <label>Contraseña actual</label>
        <input name="actual" type="password" required>
        <label>Nueva contraseña <span class="texto-suave">(mín. 8)</span></label>
        <input name="nueva" type="password" minlength="8" required>
        <div class="modal-acciones">
          <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
          <button type="submit" class="boton boton-primario">Cambiar</button>
        </div>
      </form>`, '24rem');
    const formulario = cuerpo.querySelector('form');
    cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);
    formulario.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const boton = formulario.querySelector('button[type="submit"]');
      boton.disabled = true;
      try {
        await llamar({
          accion: 'cambiar',
          contrasenaActual: formulario.elements.actual.value,
          contrasenaNueva: formulario.elements.nueva.value,
        });
        cerrar();
        toast('Contraseña actualizada. Úsala en tu próximo inicio de sesión.');
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
      }
    });
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

  zona.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const usuario = usuarios.find((u) => u.id === boton.closest('tr').dataset.id);
    if (!usuario) return;
    if (boton.dataset.accion === 'editar') {
      abrirFormularioEdicion(usuario, cargar);
      return;
    }
    if (boton.dataset.accion === 'contrasena') {
      if (!confirm(`¿Generar una contraseña nueva para «${usuario.nombre || usuario.email}»? La actual dejará de funcionar.`)) return;
      boton.disabled = true;
      try {
        const resultado = await llamar({ accion: 'resetear', id: usuario.id });
        mostrarContrasena(usuario.email, resultado.contrasena);
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        boton.disabled = false;
      }
      return;
    }
    if (boton.dataset.accion === 'eliminar') {
      const seguro = await confirmar(
        'Eliminar usuario',
        `¿Eliminar definitivamente a «${usuario.nombre || usuario.email}» (${usuario.email})? Perderá el acceso y su cuenta desaparecerá; no se puede deshacer.`,
        'Eliminar'
      );
      if (!seguro) return;
      boton.disabled = true;
      try {
        await llamar({ accion: 'eliminar', id: usuario.id });
        toast('Usuario eliminado.');
        cargar();
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
      }
    }
  });

  contenedor.querySelector('[data-accion="nuevo"]').addEventListener('click', abrirNuevoUsuario);
  contenedor.querySelector('[data-accion="mi-contrasena"]').addEventListener('click', abrirMiContrasena);

  await cargar();
}
