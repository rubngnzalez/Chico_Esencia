// Distribuidores: packs de la alianza B2B (precios y valores de la web
// pública), solicitudes de alianza del formulario y cuentas de acceso del
// área privada (usuario + contraseña, vía Edge Function oms-gestion-distribuidores).
// Packs y solicitudes: administración y edición. Cuentas: escritura solo admin.
import { sb, asegurar, invocarFuncion, mensajeError } from '../bd.js';
import { escapar, euro, fechaHora, toast, abrirModal, confirmar, etiquetaVacia, badgeEstado } from '../api.js';

const ETIQUETA_SOLICITUD = { pendiente: 'Pendiente', gestionada: 'Con cuenta', descartada: 'Descartada' };

export default async function (contenedor, contexto) {
  const soyAdmin = contexto.usuario.rol === 'admin';

  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">Los packs se pintan solos en la web (distribuidores.html). Las solicitudes llegan del formulario
      de la web; «Crear acceso» les abre usuario y contraseña para el área privada de distribuidores.</p>
      <div class="acciones-barra">
        <button class="boton boton-primario boton-pequeno" data-accion="nuevo-pack" type="button">+ Nuevo pack</button>
      </div>
    </div>
    <div class="pestanas" role="tablist">
      <button class="pestana activa" data-pestana="packs" type="button">Packs</button>
      <button class="pestana" data-pestana="solicitudes" type="button">Solicitudes <em class="contador" id="contador-solicitudes" hidden></em></button>
      <button class="pestana" data-pestana="cuentas" type="button">Cuentas de acceso</button>
    </div>
    <div id="zona-distribuidores"><p class="cargando">Cargando…</p></div>`;

  const zona = contenedor.querySelector('#zona-distribuidores');
  const contadorSolicitudes = contenedor.querySelector('#contador-solicitudes');
  let packs = [];
  let solicitudes = [];
  let cuentas = [];

  // ─── Utilidades ──────────────────────────────────────────────────────────

  function numeroDe(valor) {
    const texto = String(valor ?? '').trim().replace(',', '.');
    if (texto === '') return null;
    const n = Number(texto);
    return Number.isFinite(n) ? n : null;
  }

  function textoInversion(pack) {
    const min = pack.inversion_min == null ? null : Number(pack.inversion_min);
    const max = pack.inversion_max == null ? null : Number(pack.inversion_max);
    if (min == null && max == null) return '—';
    if (min != null && max != null && min !== max) return `${euro(min)} – ${euro(max)}`;
    return `~${euro(min != null ? min : max)}`;
  }

  function mostrarContrasena(email, contrasena) {
    const { cerrar, cuerpo } = abrirModal('Contraseña nueva', `
      <div class="formulario">
        <p class="texto-suave">Guárdala ahora: por seguridad no vuelve a mostrarse ni puede recuperarse.
        Entrégasela al distribuidor para que entre en el área privada de la web (distribuidores.html).</p>
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

  // ─── PACKS ───────────────────────────────────────────────────────────────

  async function cargarPacks() {
    zona.innerHTML = '<p class="cargando">Cargando packs…</p>';
    try {
      packs = (await asegurar(sb().from('oms_distribuidores_packs').select('*').order('orden'))) || [];
      pintarPacks();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar los packs: ${error.message}`);
    }
  }

  function pintarPacks() {
    zona.innerHTML = packs.length === 0
      ? etiquetaVacia('Todavía no hay packs. Crea el primero con «+ Nuevo pack»: aparecerá en la web al momento.')
      : `
      <div class="zona-tabla">
        <table class="tabla">
          <thead><tr><th>Orden</th><th>Pack</th><th>Inversión</th><th>PVP</th><th>Beneficio</th><th>Web</th><th class="alineado-derecha">Acciones</th></tr></thead>
          <tbody>
            ${packs.map((p) => `
            <tr data-id="${escapar(p.id)}">
              <td class="texto-suave">${escapar(p.orden)}</td>
              <td>
                <strong>${escapar(p.nombre)}</strong>
                ${p.destacado ? ' <span class="chip chip-oro">recomendado</span>' : ''}
                <br><span class="texto-suave">${escapar(p.etiqueta || p.clave)}</span>
              </td>
              <td>${escapar(textoInversion(p))}${p.inversion_nota ? `<br><span class="texto-suave">${escapar(p.inversion_nota)}</span>` : ''}</td>
              <td>${p.pvp == null ? '—' : escapar(euro(p.pvp))}</td>
              <td>${p.beneficio == null ? (p.beneficio_nota ? escapar(p.beneficio_nota) : '—') : escapar(`~${euro(p.beneficio)}`)}</td>
              <td><label class="interruptor"><input type="checkbox" data-accion="activo-pack" ${p.activo !== false ? 'checked' : ''}><span class="interruptor-pista"></span></label></td>
              <td class="alineado-derecha">
                <button class="boton boton-fantasma boton-pequeno" data-accion="editar-pack" type="button">Editar</button>
                <button class="boton boton-peligro boton-pequeno" data-accion="eliminar-pack" type="button">Eliminar</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function abrirFormularioPack(pack = null) {
    const nuevo = !pack;
    const { cerrar, cuerpo } = abrirModal(nuevo ? 'Nuevo pack de alianza' : `Editar «${pack.nombre}»`, `
      <form class="formulario">
        <label>Clave interna <span class="texto-suave">(identifica el pack; minúsculas y guiones)</span></label>
        <input name="clave" maxlength="40" ${nuevo ? 'required pattern="[a-z0-9-]+"' : 'disabled'} value="${escapar(pack?.clave || '')}">
        <label>Nombre (se muestra en la web)</label>
        <input name="nombre" maxlength="120" required value="${escapar(pack?.nombre || '')}">
        <label>Lema corto</label>
        <input name="etiqueta" maxlength="120" placeholder="Riesgo cero / Entrada rápida" value="${escapar(pack?.etiqueta || '')}">
        <label>¿Ideal para quién?</label>
        <textarea name="ideal_para" rows="2" maxlength="400">${escapar(pack?.ideal_para || '')}</textarea>
        <label>Contenido del pack</label>
        <textarea name="contenido" rows="2" maxlength="400" placeholder="3 Perfumes (50 ml) + 5 Bálsamos (12 g) + Testers…">${escapar(pack?.contenido || '')}</textarea>
        <div class="formulario-grid">
          <div>
            <label>Inversión mínima (€)</label>
            <input name="inversion_min" type="number" step="0.01" min="0" value="${pack?.inversion_min ?? ''}">
          </div>
          <div>
            <label>Inversión máxima (€) <span class="texto-suave">(opcional)</span></label>
            <input name="inversion_max" type="number" step="0.01" min="0" value="${pack?.inversion_max ?? ''}">
          </div>
        </div>
        <label>Nota de la inversión</label>
        <input name="inversion_nota" maxlength="120" placeholder="descuento aplicado" value="${escapar(pack?.inversion_nota || '')}">
        <div class="formulario-grid">
          <div>
            <label>Valor de venta · PVP (€)</label>
            <input name="pvp" type="number" step="0.01" min="0" value="${pack?.pvp ?? ''}">
          </div>
          <div>
            <label>Beneficio tienda (€)</label>
            <input name="beneficio" type="number" step="0.01" min="0" value="${pack?.beneficio ?? ''}">
          </div>
        </div>
        <label>Nota del beneficio</label>
        <input name="beneficio_nota" maxlength="120" placeholder="aprox. 50 % de margen" value="${escapar(pack?.beneficio_nota || '')}">
        <label>El argumento (cita de venta)</label>
        <textarea name="argumento" rows="3" maxlength="600">${escapar(pack?.argumento || '')}</textarea>
        <div class="formulario-grid">
          <div>
            <label>Orden en la web</label>
            <input name="orden" type="number" step="1" value="${pack?.orden ?? 0}">
          </div>
          <div>
            <label>&nbsp;</label>
            <label class="interruptor"><input type="checkbox" name="destacado" ${pack?.destacado ? 'checked' : ''}><span class="interruptor-pista"></span> Recomendado (sello dorado)</label>
            <label class="interruptor"><input type="checkbox" name="activo" ${!pack || pack.activo !== false ? 'checked' : ''}><span class="interruptor-pista"></span> Visible en la web</label>
          </div>
        </div>
        <div class="modal-acciones">
          <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
          <button type="submit" class="boton boton-primario">${nuevo ? 'Crear pack' : 'Guardar cambios'}</button>
        </div>
      </form>`, '36rem');
    const formulario = cuerpo.querySelector('form');
    cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);
    formulario.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const boton = formulario.querySelector('button[type="submit"]');
      boton.disabled = true;
      const datos = {
        nombre: String(formulario.elements.nombre.value || '').trim(),
        etiqueta: String(formulario.elements.etiqueta.value || '').trim(),
        ideal_para: String(formulario.elements.ideal_para.value || '').trim(),
        contenido: String(formulario.elements.contenido.value || '').trim(),
        inversion_min: numeroDe(formulario.elements.inversion_min.value),
        inversion_max: numeroDe(formulario.elements.inversion_max.value),
        inversion_nota: String(formulario.elements.inversion_nota.value || '').trim(),
        pvp: numeroDe(formulario.elements.pvp.value),
        beneficio: numeroDe(formulario.elements.beneficio.value),
        beneficio_nota: String(formulario.elements.beneficio_nota.value || '').trim(),
        argumento: String(formulario.elements.argumento.value || '').trim(),
        orden: Math.round(Number(formulario.elements.orden.value) || 0),
        destacado: formulario.elements.destacado.checked,
        activo: formulario.elements.activo.checked,
      };
      try {
        if (nuevo) {
          datos.clave = String(formulario.elements.clave.value || '').trim().toLowerCase();
          const { error } = await sb().from('oms_distribuidores_packs').insert(datos);
          if (error) throw new Error(mensajeError(error));
          toast('Pack creado: ya se ve en la web.');
        } else {
          const { error } = await sb().from('oms_distribuidores_packs').update(datos).eq('id', pack.id);
          if (error) throw new Error(mensajeError(error));
          toast('Pack actualizado: la web lo muestra al momento.');
        }
        cerrar();
        cargarPacks();
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
      }
    });
  }

  // ─── SOLICITUDES ─────────────────────────────────────────────────────────

  async function cargarSolicitudes() {
    zona.innerHTML = '<p class="cargando">Cargando solicitudes…</p>';
    try {
      solicitudes = (await asegurar(sb().from('oms_distribuidores_solicitudes').select('*').order('creado_en', { ascending: false }))) || [];
      const pendientes = solicitudes.filter((s) => s.estado === 'pendiente').length;
      contadorSolicitudes.hidden = pendientes === 0;
      contadorSolicitudes.textContent = pendientes > 99 ? '99+' : String(pendientes);
      pintarSolicitudes();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar las solicitudes: ${error.message}`);
    }
  }

  function pintarSolicitudes() {
    if (solicitudes.length === 0) {
      zona.innerHTML = etiquetaVacia('Sin solicitudes por ahora. Llegan solas desde el formulario «Solicitar alianza» de la web.');
      return;
    }
    zona.innerHTML = `
      <div class="zona-tabla">
        <table class="tabla">
          <thead><tr><th>Fecha</th><th>Espacio</th><th>Contacto</th><th>Estado</th><th class="alineado-derecha">Acciones</th></tr></thead>
          <tbody>
            ${solicitudes.map((s) => `
            <tr data-id="${escapar(s.id)}">
              <td class="texto-suave">${fechaHora(s.creado_en)}</td>
              <td>
                <strong>${escapar(s.empresa || '(sin nombre)')}</strong>
                <br><span class="texto-suave">${escapar(s.email || '')}${s.telefono ? ` · ${escapar(s.telefono)}` : ''}</span>
              </td>
              <td>${escapar(s.contacto || '—')}</td>
              <td>${badgeEstado(s.estado, ETIQUETA_SOLICITUD[s.estado] || s.estado)}</td>
              <td class="alineado-derecha">
                <button class="boton boton-fantasma boton-pequeno" data-accion="ver-solicitud" type="button">Ver</button>
                <button class="boton boton-primario boton-pequeno" data-accion="crear-acceso" type="button">Crear acceso</button>
                ${s.estado === 'pendiente'
                  ? '<button class="boton boton-fantasma boton-pequeno" data-accion="descartar" type="button">Descartar</button>'
                  : '<button class="boton boton-fantasma boton-pequeno" data-accion="reabrir" type="button">A pendiente</button>'}
                ${soyAdmin ? '<button class="boton boton-peligro boton-pequeno" data-accion="eliminar-solicitud" type="button">Eliminar</button>' : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function verSolicitud(s) {
    const { cerrar, cuerpo } = abrirModal(`Solicitud · ${s.empresa || '(sin nombre)'}`, `
      <div class="formulario">
        <p><strong>Espacio:</strong> ${escapar(s.empresa || '—')}</p>
        <p><strong>Contacto:</strong> ${escapar(s.contacto || '—')}</p>
        <p><strong>Email:</strong> ${escapar(s.email || '—')}${s.telefono ? `<br><strong>Teléfono:</strong> ${escapar(s.telefono)}` : ''}</p>
        <p><strong>Mensaje:</strong></p>
        <p>${escapar(s.mensaje || '—').replace(/\n/g, '<br>')}</p>
        <p class="texto-suave">Recibida el ${fechaHora(s.creado_en)}.</p>
        <div class="modal-acciones">
          <button type="button" class="boton boton-primario" data-cerrar2>Cerrar</button>
        </div>
      </div>`, '30rem');
    cuerpo.querySelector('[data-cerrar2]').addEventListener('click', cerrar);
  }

  async function cambiarEstadoSolicitud(id, estado) {
    const { error } = await sb().from('oms_distribuidores_solicitudes').update({ estado }).eq('id', id);
    if (error) throw new Error(mensajeError(error));
  }

  // ─── CUENTAS DE ACCESO ───────────────────────────────────────────────────

  async function cargarCuentas() {
    zona.innerHTML = '<p class="cargando">Cargando cuentas…</p>';
    try {
      cuentas = (await asegurar(sb().from('oms_distribuidores').select('*').order('creado_en'))) || [];
      pintarCuentas();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar las cuentas: ${error.message}`);
    }
  }

  function pintarCuentas() {
    zona.innerHTML = `
      ${soyAdmin ? '' : '<p class="texto-suave">Solo la administración puede crear cuentas o cambiar contraseñas; tu rol puede consultarlas.</p>'}
      ${cuentas.length === 0
        ? etiquetaVacia('Sin cuentas todavía. Usa «+ Nuevo distribuidor» o «Crear acceso» sobre una solicitud de la web.')
        : `
      <div class="zona-tabla">
        <table class="tabla">
          <thead><tr><th>Espacio</th><th>Contacto</th><th>Email</th><th>Descuento</th><th>Último acceso</th><th>Activo</th><th class="alineado-derecha">Acciones</th></tr></thead>
          <tbody>
            ${cuentas.map((c) => `
            <tr data-id="${escapar(c.id)}">
              <td><strong>${escapar(c.empresa || '(sin nombre)')}</strong>${c.ciudad ? `<br><span class="texto-suave">${escapar(c.ciudad)}</span>` : ''}</td>
              <td>${escapar(c.contacto || '—')}${c.notas ? `<br><span class="texto-suave">${escapar(c.notas.slice(0, 60))}</span>` : ''}</td>
              <td class="texto-suave">${escapar(c.email)}</td>
              <td>${Number(c.descuento) > 0 ? escapar(`${String(c.descuento).replace('.', ',')} %`) : '—'}</td>
              <td class="texto-suave">${c.ultimo_acceso ? fechaHora(c.ultimo_acceso) : 'nunca'}</td>
              <td><label class="interruptor"><input type="checkbox" data-accion="activo-cuenta" ${c.activo !== false ? 'checked' : ''} ${soyAdmin ? '' : 'disabled'}><span class="interruptor-pista"></span></label></td>
              <td class="alineado-derecha">
                ${soyAdmin ? `
                <button class="boton boton-fantasma boton-pequeno" data-accion="contrasena-cuenta" type="button">Contraseña</button>
                <button class="boton boton-fantasma boton-pequeno" data-accion="editar-cuenta" type="button">Editar</button>
                <button class="boton boton-peligro boton-pequeno" data-accion="eliminar-cuenta" type="button">Eliminar</button>` : '—'}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
      ${soyAdmin ? '<p style="margin-top:1rem;"><button class="boton boton-primario boton-pequeno" data-accion="nuevo-distribuidor" type="button">+ Nuevo distribuidor</button></p>' : ''}`;
  }

  function abrirFormularioCuenta(cuenta = null, precarga = null, alCrear = null) {
    const nuevo = !cuenta;
    const inicial = cuenta || precarga || {};
    const { cerrar, cuerpo } = abrirModal(nuevo ? 'Nuevo distribuidor' : `Editar «${cuenta.empresa || cuenta.email}»`, `
      <form class="formulario">
        <label>Empresa o espacio <span class="texto-suave">(se mostrará en su área privada)</span></label>
        <input name="empresa" maxlength="120" required value="${escapar(inicial.empresa || '')}">
        <label>Persona de contacto</label>
        <input name="contacto" maxlength="120" value="${escapar(inicial.contacto || '')}">
        ${nuevo ? `
        <label>Email <span class="texto-suave">(su usuario para el área privada)</span></label>
        <input name="email" type="email" maxlength="160" required value="${escapar(inicial.email || '')}">` : `
        <label>Email (su usuario)</label>
        <p class="texto-suave" style="margin:0;">${escapar(cuenta.email)}</p>`}
        <label>Teléfono</label>
        <input name="telefono" maxlength="40" value="${escapar(inicial.telefono || '')}">
        <label>Ciudad</label>
        <input name="ciudad" maxlength="120" value="${escapar(inicial.ciudad || '')}">
        <label>Descuento sobre los packs (%)</label>
        <input name="descuento" type="number" step="0.01" min="0" max="100" value="${inicial.descuento ?? 0}">
        ${nuevo ? `
        <label>Contraseña <span class="texto-suave">(vacía = generar una segura)</span></label>
        <input name="contrasena" type="text" minlength="8" placeholder="mínimo 8 caracteres">` : `
        <label>Notas internas</label>
        <textarea name="notas" rows="2" maxlength="2000">${escapar(cuenta.notas || '')}</textarea>`}
        <div class="modal-acciones">
          <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
          <button type="submit" class="boton boton-primario">${nuevo ? 'Crear cuenta y mostrar contraseña' : 'Guardar cambios'}</button>
        </div>
      </form>`, '28rem');
    const formulario = cuerpo.querySelector('form');
    cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);
    formulario.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const boton = formulario.querySelector('button[type="submit"]');
      boton.disabled = true;
      try {
        if (nuevo) {
          const resultado = await invocarFuncion('oms-gestion-distribuidores', {
            accion: 'crear',
            email: formulario.elements.email.value.trim(),
            empresa: formulario.elements.empresa.value.trim(),
            contacto: formulario.elements.contacto.value.trim(),
            telefono: formulario.elements.telefono.value.trim(),
            ciudad: formulario.elements.ciudad.value.trim(),
            descuento: numeroDe(formulario.elements.descuento.value) ?? 0,
            contrasena: String(formulario.elements.contrasena?.value || '').trim(),
          });
          cerrar();
          if (alCrear) await alCrear(resultado.email);
          await cargarCuentas();
          mostrarContrasena(resultado.email, resultado.contrasena);
        } else {
          const { error } = await sb().from('oms_distribuidores').update({
            empresa: String(formulario.elements.empresa.value || '').trim(),
            contacto: String(formulario.elements.contacto.value || '').trim(),
            telefono: String(formulario.elements.telefono.value || '').trim(),
            ciudad: String(formulario.elements.ciudad.value || '').trim(),
            descuento: numeroDe(formulario.elements.descuento.value) ?? 0,
            notas: String(formulario.elements.notas.value || '').trim(),
          }).eq('id', cuenta.id);
          if (error) throw new Error(mensajeError(error));
          cerrar();
          toast('Cuenta actualizada.');
          cargarCuentas();
        }
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
      }
    });
  }

  // ─── Eventos comunes ─────────────────────────────────────────────────────

  contenedor.querySelectorAll('.pestana').forEach((boton) => {
    boton.addEventListener('click', () => {
      contenedor.querySelectorAll('.pestana').forEach((p) => p.classList.toggle('activa', p === boton));
      const vista = boton.dataset.pestana;
      if (vista === 'packs') cargarPacks();
      else if (vista === 'solicitudes') cargarSolicitudes();
      else cargarCuentas();
    });
  });

  contenedor.querySelector('[data-accion="nuevo-pack"]').addEventListener('click', () => abrirFormularioPack());

  zona.addEventListener('change', async (evento) => {
    const interruptor = evento.target.closest('input[data-accion="activo-pack"], input[data-accion="activo-cuenta"]');
    if (!interruptor) return;
    const fila = interruptor.closest('tr');
    const esPack = interruptor.dataset.accion === 'activo-pack';
    const lista = esPack ? packs : cuentas;
    const registro = lista.find((x) => x.id === fila.dataset.id);
    if (!registro) return;
    try {
      const tabla = esPack ? 'oms_distribuidores_packs' : 'oms_distribuidores';
      const { error } = await sb().from(tabla).update({ activo: interruptor.checked }).eq('id', registro.id);
      if (error) throw new Error(mensajeError(error));
      registro.activo = interruptor.checked;
      if (esPack) toast(interruptor.checked ? `«${registro.nombre}» visible en la web.` : `«${registro.nombre}» oculto de la web.`);
      else toast(interruptor.checked ? `«${registro.empresa || registro.email}» puede volver a entrar.` : `«${registro.empresa || registro.email}» sin acceso al área privada.`);
    } catch (error) {
      interruptor.checked = !interruptor.checked;
      toast(error.message, 'error');
    }
  });

  zona.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const fila = boton.closest('tr');
    const id = fila ? fila.dataset.id : null;
    const accion = boton.dataset.accion;

    // Botones fuera de la tabla
    if (accion === 'nuevo-distribuidor') {
      abrirFormularioCuenta();
      return;
    }

    if (accion === 'editar-pack') {
      const pack = packs.find((p) => p.id === id);
      if (pack) abrirFormularioPack(pack);
      return;
    }
    if (accion === 'eliminar-pack') {
      const pack = packs.find((p) => p.id === id);
      if (!pack) return;
      const seguro = await confirmar('Eliminar pack', `¿Eliminar «${pack.nombre}»? Desaparecerá de la web; no se puede deshacer.`, 'Eliminar');
      if (!seguro) return;
      boton.disabled = true;
      try {
        const { error } = await sb().from('oms_distribuidores_packs').delete().eq('id', id);
        if (error) throw new Error(mensajeError(error));
        toast('Pack eliminado.');
        cargarPacks();
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
      }
      return;
    }

    // Solicitudes
    const solicitud = solicitudes.find((s) => s.id === id);
    if (accion === 'ver-solicitud' && solicitud) {
      verSolicitud(solicitud);
      return;
    }
    if (accion === 'crear-acceso' && solicitud) {
      abrirFormularioCuenta(null, {
        empresa: solicitud.empresa || '',
        contacto: solicitud.contacto || '',
        email: solicitud.email || '',
        telefono: solicitud.telefono || '',
      }, async (emailCreado) => {
        // La solicitud que dio origen a la cuenta queda «con cuenta»
        const objetivo = solicitudes.find((s) =>
          s.estado === 'pendiente' &&
          String(s.email || '').toLowerCase() === String(emailCreado || '').toLowerCase()
        );
        if (objetivo) {
          try {
            await cambiarEstadoSolicitud(objetivo.id, 'gestionada');
          } catch {}
        }
      });
      return;
    }
    if (accion === 'descartar' && solicitud) {
      boton.disabled = true;
      try {
        await cambiarEstadoSolicitud(solicitud.id, 'descartada');
        cargarSolicitudes();
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
      }
      return;
    }
    if (accion === 'reabrir' && solicitud) {
      boton.disabled = true;
      try {
        await cambiarEstadoSolicitud(solicitud.id, 'pendiente');
        cargarSolicitudes();
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
      }
      return;
    }
    if (accion === 'eliminar-solicitud' && solicitud) {
      const seguro = await confirmar('Eliminar solicitud', `¿Eliminar la solicitud de «${solicitud.empresa || '(sin nombre)'}»? No se puede deshacer.`, 'Eliminar');
      if (!seguro) return;
      boton.disabled = true;
      try {
        const { error } = await sb().from('oms_distribuidores_solicitudes').delete().eq('id', solicitud.id);
        if (error) throw new Error(mensajeError(error));
        toast('Solicitud eliminada.');
        cargarSolicitudes();
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
      }
      return;
    }

    // Cuentas
    const cuenta = cuentas.find((c) => c.id === id);
    if (accion === 'contrasena-cuenta' && cuenta) {
      if (!confirm(`¿Generar una contraseña nueva para «${cuenta.empresa || cuenta.email}»? La actual dejará de funcionar.`)) return;
      boton.disabled = true;
      try {
        const resultado = await invocarFuncion('oms-gestion-distribuidores', { accion: 'resetear', id: cuenta.id });
        mostrarContrasena(cuenta.email, resultado.contrasena);
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        boton.disabled = false;
      }
      return;
    }
    if (accion === 'editar-cuenta' && cuenta) {
      abrirFormularioCuenta(cuenta);
      return;
    }
    if (accion === 'eliminar-cuenta' && cuenta) {
      const seguro = await confirmar(
        'Eliminar cuenta',
        `¿Eliminar definitivamente la cuenta de «${cuenta.empresa || cuenta.email}» (${cuenta.email})? Perderá el acceso al área privada; no se puede deshacer.`,
        'Eliminar'
      );
      if (!seguro) return;
      boton.disabled = true;
      try {
        await invocarFuncion('oms-gestion-distribuidores', { accion: 'eliminar', id: cuenta.id });
        toast('Cuenta eliminada.');
        cargarCuentas();
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
      }
    }
  });

  await cargarPacks();
}
