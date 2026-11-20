// Clientes (solo admin): cuentas con ámbito «cliente» — gente que accede a su
// zona de pedidos con su correo. NO es el staff del panel (eso está en
// «Usuarios») ni los distribuidores (su página dedicada es Distribuidores).
import { sb, asegurar, mensajeError } from '../bd.js';
import { escapar, fechaHora, toast, confirmar, etiquetaVacia } from '../api.js';

export default async function (contenedor) {
  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">Clientes registrados con acceso a su zona de pedidos (cuentas de ámbito «cliente»).
      Se crean solas cuando un cliente pide acceso a su zona por correo. Si una cuenta está aquí por error,
      conviértela en staff desde aquí mismo.</p>
    </div>
    <div id="zona-clientes" class="zona-tabla"><p class="cargando">Cargando clientes…</p></div>`;

  const zona = contenedor.querySelector('#zona-clientes');
  let clientes = [];

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando clientes…</p>';
    try {
      clientes = (await asegurar(sb().from('oms_usuarios').select('id, nombre, email, activo, ambito, ultimo_acceso, creado_en').eq('ambito', 'cliente').order('creado_en'))) || [];
      pintar();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar los clientes: ${error.message}`);
    }
  }

  function pintar() {
    if (!clientes.length) {
      zona.innerHTML = etiquetaVacia('Todavía no hay clientes registrados. Aparecerán aquí cuando alguien pida acceso a su zona de pedidos.');
      return;
    }
    zona.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Nombre</th><th>Email</th><th>Último acceso</th><th>Alta</th><th>Activo</th><th class="alineado-derecha">Acciones</th></tr></thead>
        <tbody>
          ${clientes.map((u) => `
          <tr data-id="${escapar(u.id)}">
            <td><strong>${escapar(u.nombre || '(sin nombre)')}</strong></td>
            <td class="texto-suave">${escapar(u.email)}</td>
            <td class="texto-suave">${u.ultimo_acceso ? fechaHora(u.ultimo_acceso) : 'nunca'}</td>
            <td class="texto-suave">${u.creado_en ? fechaHora(u.creado_en) : '—'}</td>
            <td><label class="interruptor"><input type="checkbox" data-accion="activo" ${u.activo !== false ? 'checked' : ''}><span class="interruptor-pista"></span></label></td>
            <td class="alineado-derecha">
              <button class="boton boton-fantasma boton-pequeno" data-accion="staff" type="button" title="Convertir en staff del panel">Convertir en staff</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  zona.addEventListener('change', async (evento) => {
    const interruptor = evento.target.closest('input[data-accion="activo"]');
    if (!interruptor) return;
    const cliente = clientes.find((u) => u.id === interruptor.closest('tr').dataset.id);
    if (!cliente) return;
    try {
      const error = (await sb().from('oms_usuarios').update({ activo: interruptor.checked }).eq('id', cliente.id)).error;
      if (error) throw new Error(mensajeError(error));
      cliente.activo = interruptor.checked;
      toast(interruptor.checked ? `«${cliente.email}» puede volver a entrar.` : `«${cliente.email}» desactivado: no podrá iniciar sesión.`);
    } catch (error) {
      interruptor.checked = !interruptor.checked;
      toast(error.message, 'error');
    }
  });

  zona.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion="staff"]');
    if (!boton) return;
    const cliente = clientes.find((u) => u.id === boton.closest('tr').dataset.id);
    if (!cliente) return;
    const seguro = await confirmar(
      'Convertir en staff',
      `¿Convertir «${cliente.email}» en staff del panel (rol lectura)? Pasará a la lista de Usuarios y dejará de figurar aquí.`
    );
    if (!seguro) return;
    boton.disabled = true;
    try {
      const error = (await sb().from('oms_usuarios').update({ ambito: 'staff' }).eq('id', cliente.id)).error;
      if (error) throw new Error(mensajeError(error));
      toast('Cuenta movida a staff: la verás en la sección Usuarios.');
      cargar();
    } catch (error) {
      toast(error.message, 'error');
      boton.disabled = false;
    }
  });

  await cargar();
}
