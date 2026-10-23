// Usuarios (solo admin): alta con contraseña temporal, rol, activación y cambio de contraseña.
import { pedir, escapar, fechaHora, toast, confirmar, abrirModal, etiquetaVacia } from '../api.js';

const ROLES = ['admin', 'editor', 'lector'];
const ETIQUETA_ROL = { admin: 'Administración', editor: 'Edición', lector: 'Lectura' };

export default async function (contenedor, contexto) {
  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">admin: todo · editor: catálogo, blog y correos · lector: solo lectura y bandeja.</p>
      <button id="boton-nuevo-usuario" class="boton boton-primario" type="button">+ Nuevo usuario</button>
    </div>
    <div id="zona-usuarios" class="zona-tabla"><p class="cargando">Cargando usuarios…</p></div>`;

  const zona = contenedor.querySelector('#zona-usuarios');
  let usuarios = [];

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando usuarios…</p>';
    try {
      usuarios = (await pedir('/api/usuarios')).datos;
      pintar();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar los usuarios: ${error.message}`);
    }
  }

  function pintar() {
    zona.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Último acceso</th><th>Activo</th><th class="alineado-derecha">Acciones</th></tr></thead>
        <tbody>
          ${usuarios.map((u) => {
            const soyYo = u.id === contexto.usuario.id;
            return `
          <tr data-id="${escapar(u.id)}">
            <td><strong>${escapar(u.nombre)}</strong>${soyYo ? ' <span class="chip">tú</span>' : ''}</td>
            <td class="texto-suave">${escapar(u.email)}</td>
            <td><span class="chip chip-oro">${escapar(ETIQUETA_ROL[u.rol] || u.rol)}</span></td>
            <td class="texto-suave">${u.ultimoAcceso ? fechaHora(u.ultimoAcceso) : 'nunca'}</td>
            <td><label class="interruptor"><input type="checkbox" data-accion="activo" ${u.activo !== false ? 'checked' : ''}><span class="interruptor-pista"></span></label></td>
            <td class="alineado-derecha">
              <button class="boton boton-fantasma boton-pequeno" data-accion="editar" type="button">Editar</button>
              <button class="boton boton-fantasma boton-pequeno" data-accion="contrasena" type="button">Contraseña</button>
              ${soyYo ? '' : `<button class="boton boton-peligro boton-pequeno" data-accion="eliminar" type="button">Eliminar</button>`}
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
      await pedir(`/api/usuarios/${usuario.id}`, { method: 'PUT', cuerpo: { activo: interruptor.checked } });
      usuario.activo = interruptor.checked;
      toast(interruptor.checked ? `«${usuario.nombre}» puede volver a entrar.` : `«${usuario.nombre}» desactivado: no podrá iniciar sesión.`);
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
      abrirFormularioContrasena(usuario);
      return;
    }
    if (boton.dataset.accion === 'eliminar') {
      const seguro = await confirmar('Eliminar usuario', `¿Eliminar a «${usuario.nombre}» (${usuario.email})? No podrá volver a entrar.`);
      if (!seguro) return;
      try {
        await pedir(`/api/usuarios/${usuario.id}`, { method: 'DELETE' });
        toast('Usuario eliminado.');
        cargar();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  contenedor.querySelector('#boton-nuevo-usuario').addEventListener('click', () => abrirFormularioNuevo(cargar));
  await cargar();
}

function generarContrasenaTemporal() {
  const grupos = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789'];
  const todo = grupos.join('');
  const azar = (texto) => texto[crypto.getRandomValues(new Uint32Array(1))[0] % texto.length];
  const letras = Array.from({ length: 9 }, () => azar(todo));
  const inicial = grupos.map((g) => azar(g));
  return [...inicial, ...letras].join('').slice(0, 12);
}

function abrirFormularioNuevo(alGuardar) {
  const temporal = generarContrasenaTemporal();
  const { cerrar, cuerpo } = abrirModal('Nuevo usuario', `
    <form class="formulario">
      <label>Nombre *</label>
      <input name="nombre" required maxlength="120">
      <label>Email *</label>
      <input name="email" type="email" required>
      <label>Rol *</label>
      <select name="rol">
        <option value="editor">Editor · catálogo, blog y correos</option>
        <option value="admin">Admin · todo</option>
        <option value="lector">Lector · solo lectura y bandeja</option>
      </select>
      <label>Contraseña temporal *</label>
      <div class="formulario-grid">
        <div class="crece"><input name="contrasena" required minlength="8" maxlength="128" value="${escapar(temporal)}" class="campo-mono"></div>
        <div><button type="button" class="boton boton-fantasma" data-regenerar>Regenerar</button></div>
      </div>
      <p class="nota-secreto">Cópiaseła a la persona ahora: no se volverá a mostrar (sí se puede cambiar después con «Contraseña»).</p>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
        <button type="submit" class="boton boton-primario">Crear usuario</button>
      </div>
    </form>`, '32rem');

  const formulario = cuerpo.querySelector('form');
  cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);
  cuerpo.querySelector('[data-regenerar]').addEventListener('click', () => {
    formulario.elements.contrasena.value = generarContrasenaTemporal();
  });

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      await pedir('/api/usuarios', {
        method: 'POST',
        cuerpo: {
          nombre: formulario.elements.nombre.value.trim(),
          email: formulario.elements.email.value.trim(),
          rol: formulario.elements.rol.value,
          contrasena: formulario.elements.contrasena.value,
        },
      });
      toast('Usuario creado. Recuerda enviarle su contraseña temporal.');
      cerrar();
      alGuardar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

function abrirFormularioEdicion(usuario, alGuardar) {
  const { cerrar, cuerpo } = abrirModal(`Editar: ${usuario.nombre}`, `
    <form class="formulario">
      <label>Nombre</label>
      <input name="nombre" required maxlength="120" value="${escapar(usuario.nombre)}">
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
    try {
      await pedir(`/api/usuarios/${usuario.id}`, {
        method: 'PUT',
        cuerpo: {
          nombre: formulario.elements.nombre.value.trim(),
          rol: formulario.elements.rol.value,
        },
      });
      toast('Usuario actualizado.');
      cerrar();
      alGuardar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

function abrirFormularioContrasena(usuario) {
  const temporal = generarContrasenaTemporal();
  const { cerrar, cuerpo } = abrirModal(`Nueva contraseña: ${usuario.nombre}`, `
    <form class="formulario">
      <label>Nueva contraseña (mínimo 8 caracteres)</label>
      <div class="formulario-grid">
        <div class="crece"><input name="contrasena" required minlength="8" maxlength="128" value="${escapar(temporal)}" class="campo-mono"></div>
        <div><button type="button" class="boton boton-fantasma" data-regenerar>Regenerar</button></div>
      </div>
      <p class="nota-secreto">Cópiaseła ahora: no se volverá a mostrar.</p>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
        <button type="submit" class="boton boton-primario">Cambiar contraseña</button>
      </div>
    </form>`, '30rem');

  const formulario = cuerpo.querySelector('form');
  cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);
  cuerpo.querySelector('[data-regenerar]').addEventListener('click', () => {
    formulario.elements.contrasena.value = generarContrasenaTemporal();
  });
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      await pedir(`/api/usuarios/${usuario.id}`, {
        method: 'PUT',
        cuerpo: { contrasena: formulario.elements.contrasena.value },
      });
      toast('Contraseña cambiada. Comunícasela a la persona.');
      cerrar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}
