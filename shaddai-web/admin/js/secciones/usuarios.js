// Usuarios (solo admin): ESTA LISTA ES SOLO PARA EL STAFF DEL PANEL.
// Los clientes están en la sección «Clientes» y los distribuidores en su
// página dedicada (Distribuidores → Aceptados). El campo «ambito» separa los
// tres mundos; desde aquí se puede reclasificar una cuenta si entró mal.
// Las contraseñas van cifradas (Supabase Auth): nunca se pueden ver, solo se
// crean nuevas o se regeneran. Las acciones pasan por la función segura
// «gestion-usuarios», que comprueba rol admin en el servidor.
import { sb, asegurar, invocarFuncion, mensajeError } from '../bd.js';
import { escapar, fechaHora, toast, abrirModal, confirmar, etiquetaVacia } from '../api.js';

const ROLES = ['admin', 'editor', 'lector'];
const ETIQUETA_ROL = { admin: 'Administración', editor: 'Edición', lector: 'Lectura' };
const AMBITOS = ['staff', 'cliente', 'distribuidor'];
const ETIQUETA_AMBITO = { staff: 'Staff', cliente: 'Cliente', distribuidor: 'Distribuidor' };

let verAmbito = 'staff';

export default async function (contenedor, contexto) {
  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">Lista del <strong>staff del panel</strong>: admin: todo · editor: catálogo, blog y correos · lector: solo lectura y bandeja.
      Los clientes están en la sección «Clientes» y los distribuidores en «Distribuidores».
      Las contraseñas van cifradas: no se pueden ver, pero puedes crear cuentas, generar nuevas contraseñas o eliminar cuentas.</p>
      <div class="acciones-barra">
        <button class="boton boton-fantasma boton-pequeno" data-accion="mi-contrasena" type="button">Cambiar mi contraseña</button>
        <button class="boton boton-primario boton-pequeno" data-accion="nuevo" type="button">+ Nuevo usuario</button>
      </div>
    </div>
    <div class="pestanas" role="tablist" style="margin-bottom:1rem;">
      ${['staff', 'cliente', 'distribuidor', 'todos'].map((a) => {
        const etiquetas = { staff: 'Staff', cliente: 'Clientes', distribuidor: 'Distribuidores', todos: 'Todos' };
        return `<button class="pestana ${verAmbito === a ? 'activa' : ''}" data-ambito="${a}" type="button">${etiquetas[a]}${a === 'staff' ? ' (lista principal)' : ''}</button>`;
      }).join('')}
    </div>
    <div id="zona-usuarios" class="zona-tabla"><p class="cargando">Cargando usuarios…</p></div>`;

  const zona = contenedor.querySelector('#zona-usuarios');
  let usuarios = [];

  zona.querySelectorAll('[data-ambito]').forEach((boton) => {
    boton.addEventListener('click', () => {
      verAmbito = boton.dataset.ambito;
      zona.querySelectorAll('[data-ambito]').forEach((b) => b.classList.toggle('activa', b === boton));
      pintar();
    });
  });

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando usuarios…</p>';
    try {
      usuarios = (await asegurar(sb().from('oms_usuarios').select('id, nombre, email, rol, activo, ambito, creado_en, ultimo_acceso').order('creado_en'))) || [];
      pintar();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar los usuarios: ${error.message}`);
    }
  }

  function pintar() {
    const visibles = verAmbito === 'todos' ? usuarios : usuarios.filter((u) => (u.ambito || 'staff') === verAmbito);
    if (!visibles.length) {
      zona.innerHTML = etiquetaVacia(
        verAmbito === 'staff'
          ? 'El staff del panel aparecerá aquí.'
          : `Sin cuentas de ámbito «${ETIQUETA_AMBITO[verAmbito] || verAmbito}» todavía. Se clasifican con el selector de cada fila (vista Todos).`
      );
      return;
    }
    zona.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Ámbito</th><th>Último acceso</th><th>Alta</th><th>Activo</th><th class="alineado-derecha">Acciones</th></tr></thead>
        <tbody>
          ${visibles.map((u) => {
            const soyYo = u.id === contexto.usuario.id;
            return `
          <tr data-id="${escapar(u.id)}">
            <td><strong>${escapar(u.nombre || '(sin nombre)')}</strong>${soyYo ? ' <span class="chip">tú</span>' : ''}</td>
            <td class="texto-suave">${escapar(u.email)}</td>
            <td><span class="chip chip-oro">${escapar(ETIQUETA_ROL[u.rol] || u.rol)}</span></td>
            <td>
              <select data-accion="ambito" class="campo-select">
                ${AMBITOS.map((a) => `<option value="${a}" ${(u.ambito || 'staff') === a ? 'selected' : ''}>${escapar(ETIQUETA_AMBITO[a])}</option>`).join('')}
              </select>
            </td>
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
    const respuesta = await invocarFuncion('oms-gestion-usuarios', cuerpo);
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

  function abrirFormularioEdicion(usuario, alGuardar) {
    const { cerrar, cuerpo } = abrirModal(`Editar: ${usuario.nombre || usuario.email}`, `
      <form class="formulario">
        <label>Nombre</label>
        <input name="nombre" maxlength="120" required value="${escapar(usuario.nombre || '')}">
        <label>Email</label>
        <input value="${escapar(usuario.email)}" disabled>
        <p class="texto-suave">El email no se cambia aquí: está ligado al acceso (Supabase Auth).</p>
        <label>Rol</label>
        <select name="rol">
          ${ROLES.map((r) => `<option value="${r}" ${usuario.rol === r ? 'selected' : ''}>${escapar(ETIQUETA_ROL[r])}</option>`).join('')}
        </select>
        <div class="modal-acciones">
          <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
          <button type="submit" class="boton boton-primario">Guardar</button>
        </div>
      </form>`, '26rem');
    const formulario = cuerpo.querySelector('form');
    cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);
    formulario.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const boton = formulario.querySelector('button[type="submit"]');
      const nuevoRol = formulario.elements.rol.value;
      if (usuario.rol === 'admin' && nuevoRol !== 'admin') {
        const otrosAdmins = usuarios.filter((u) => u.rol === 'admin' && u.activo !== false && u.id !== usuario.id);
        if (!otrosAdmins.length) {
          toast('No puede dejar de haber al menos un administrador activo.', 'error');
          return;
        }
      }
      boton.disabled = true;
      try {
        const error = (await sb().from('oms_usuarios').update({
          nombre: formulario.elements.nombre.value.trim(),
          rol: nuevoRol,
        }).eq('id', usuario.id)).error;
        if (error) throw new Error(mensajeError(error));
        toast('Usuario actualizado.');
        cerrar();
        await alGuardar();
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
    const selectorAmbito = evento.target.closest('select[data-accion="ambito"]');
    if (selectorAmbito) {
      const usuario = usuarios.find((u) => u.id === selectorAmbito.closest('tr').dataset.id);
      if (!usuario) return;
      const nuevoAmbito = selectorAmbito.value;
      try {
        const error = (await sb().from('oms_usuarios').update({ ambito: nuevoAmbito }).eq('id', usuario.id)).error;
        if (error) throw new Error(mensajeError(error));
        usuario.ambito = nuevoAmbito;
        toast(`«${usuario.nombre || usuario.email}» ahora es ${ETIQUETA_AMBITO[nuevoAmbito] || nuevoAmbito}.`);
        if (verAmbito !== 'todos') pintar(); // si salió de la vista actual, desaparece de la lista
      } catch (error) {
        selectorAmbito.value = usuario.ambito || 'staff';
        toast(error.message, 'error');
      }
      return;
    }
    const interruptor = evento.target.closest('input[data-accion="activo"]');
    if (!interruptor) return;
    const usuario = usuarios.find((u) => u.id === interruptor.closest('tr').dataset.id);
    if (!usuario) return;
    try {
      const error = (await sb().from('oms_usuarios').update({ activo: interruptor.checked }).eq('id', usuario.id)).error;
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
