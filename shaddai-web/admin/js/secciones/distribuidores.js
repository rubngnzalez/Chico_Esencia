// Sección "Distribuidores": captación "Hazte distribuidor" y programa B2B.
//  · Solicitudes: cola con estados reales y detalle completo (cuestionario,
//    legales, IP, notas internas) + acciones aceptar/rechazar/descartar.
//  · Banco de emails: interesados que nunca verificaron su correo, con
//    eliminar y reenviar el enlace de verificación.
//  · Aceptados: % descuento, territorios, carpetas autorizadas y el
//    interruptor de acceso a la zona VIP.
//  · Recursos: material comercial (logos, posters, PDF…) en el bucket privado.
// Las escrituras que crean cuentas o envían correo pasan por la Edge Function
// «oms-distrib-gestion» (JWT del panel); el resto, directo por RLS.
import { sb, asegurar, mensajeError, invocarFuncion } from '../bd.js';
import { escapar, fechaHora, toast, abrirModal, confirmar, etiquetaVacia } from '../api.js';

const ESTADOS = {
  pendiente_verificacion: { texto: 'Email sin verificar', color: 'gris' },
  verificada: { texto: 'Verificado · formulario pendiente', color: 'azul' },
  completada: { texto: 'Pendiente de aceptación', color: 'oro' },
  aceptada: { texto: 'Aceptado', color: 'verde' },
  rechazada: { texto: 'Rechazado', color: 'rojo' },
  descartada: { texto: 'Descartado', color: 'gris' },
};

const TIPOS_RECURSO = {
  logo: 'Logotipo',
  poster: 'Póster',
  ficha_producto: 'Ficha de producto (PDF)',
  intencion_ventas: 'Intención de ventas',
  ventas_reales: 'Ventas reales',
  otro: 'Otro',
};

const MIME_OK = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/zip': 'zip',
};

function badge(estado) {
  const info = ESTADOS[estado] || { texto: estado, color: 'gris' };
  return `<span class="badge badge-${info.color}">${escapar(info.texto)}</span>`;
}

let pestana = 'solicitudes';
let filtroEstado = 'activos';
let busqueda = '';

export default async function (contenedor, contexto) {
  contenedor.innerHTML = `
    <div class="pestanas" role="tablist">
      <button class="pestana ${pestana === 'solicitudes' ? 'activa' : ''}" data-pestanas="solicitudes" type="button">Solicitudes</button>
      <button class="pestana ${pestana === 'banco' ? 'activa' : ''}" data-pestanas="banco" type="button">Banco de emails</button>
      <button class="pestana ${pestana === 'aceptados' ? 'activa' : ''}" data-pestanas="aceptados" type="button">Distribuidores aceptados</button>
      <button class="pestana ${pestana === 'recursos' ? 'activa' : ''}" data-pestanas="recursos" type="button">Recursos</button>
      <button class="pestana ${pestana === 'fichas' ? 'activa' : ''}" data-pestanas="fichas" type="button">Fichas de producto</button>
    </div>
    <div id="zona-distrib"></div>`;

  const zona = contenedor.querySelector('#zona-distrib');

  contenedor.querySelectorAll('.pestana').forEach((boton) => {
    boton.addEventListener('click', () => {
      pestana = boton.dataset.pestanas;
      contenedor.querySelectorAll('.pestana').forEach((b) => b.classList.toggle('activa', b === boton));
      pintar();
    });
  });

  function pintar() {
    if (pestana === 'solicitudes') pintarSolicitudes();
    else if (pestana === 'banco') pintarBanco();
    else if (pestana === 'aceptados') pintarAceptados();
    else if (pestana === 'recursos') pintarRecursos();
    else pintarFichas();
  }

  async function refrescarContadorDistrib() {
    try {
      const { count } = await sb()
        .from('oms_distrib_solicitudes')
        .select('id', { count: 'exact', head: true })
        .in('estado', ['pendiente_verificacion', 'verificada', 'completada']);
      const total = Number(count) || 0;
      const em = document.getElementById('contador-distribuidores');
      if (em) {
        em.hidden = total === 0;
        em.textContent = total > 99 ? '99+' : String(total);
      }
    } catch {}
  }

  // ─── SOLICITUDES ──────────────────────────────────────────────────────────
  async function pintarSolicitudes(seleccionId = null) {
    zona.innerHTML = `
      <div class="pestanas" role="tablist" style="margin-bottom:1rem;">
        ${['activos', 'completada', 'aceptada', 'rechazada', 'descartada', 'todas'].map((f) => {
          const etiquetas = {
            activos: 'En curso',
            completada: 'Pendientes de aceptación',
            aceptada: 'Aceptadas',
            rechazada: 'Rechazadas',
            descartada: 'Descartadas',
            todas: 'Todas',
          };
          return `<button class="pestana ${filtroEstado === f ? 'activa' : ''}" data-estado="${f}" type="button">${etiquetas[f]}</button>`;
        }).join('')}
        <input id="dist-buscar" type="search" placeholder="Buscar por email o empresa…" value="${escapar(busqueda)}" style="max-width:16rem;margin-left:auto;">
      </div>
      <div id="dist-lista"><p class="cargando">Cargando solicitudes…</p></div>`;

    zona.querySelectorAll('[data-estado]').forEach((boton) => {
      boton.addEventListener('click', () => {
        filtroEstado = boton.dataset.estado;
        pintarSolicitudes();
      });
    });
    const entrada = zona.querySelector('#dist-buscar');
    let temporizador = null;
    entrada.addEventListener('input', () => {
      busqueda = entrada.value.trim();
      clearTimeout(temporizador);
      temporizador = setTimeout(() => pintarSolicitudes(), 350);
    });

    const lista = zona.querySelector('#dist-lista');
    try {
      let consulta = sb()
        .from('oms_distrib_solicitudes')
        .select('*')
        .order('creado_en', { ascending: false })
        .limit(300);
      if (filtroEstado === 'activos') consulta = consulta.in('estado', ['pendiente_verificacion', 'verificada', 'completada']);
      else if (filtroEstado !== 'todas') consulta = consulta.eq('estado', filtroEstado);
      if (busqueda) consulta = consulta.or(`email.ilike.%${busqueda}%,datos->>empresa.ilike.%${busqueda}%`);
      const solicitudes = (await asegurar(consulta)) || [];

      if (!solicitudes.length) {
        lista.innerHTML = etiquetaVacia('No hay solicitudes en esta vista.');
        return;
      }
      lista.innerHTML = `
        <table class="tabla">
          <thead><tr><th>Fecha</th><th>Email</th><th>Empresa</th><th>Contacto</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${solicitudes
              .map((s) => {
                const empresa = String(s.datos?.empresa || '—');
                return `<tr>
                  <td>${fechaHora(s.creado_en)}</td>
                  <td>${escapar(s.email)}</td>
                  <td>${escapar(empresa)}</td>
                  <td>${escapar(s.datos?.personaContacto || s.persona_contacto || '—')}<br><span class="texto-suave">${escapar(s.datos?.telefono || s.telefono || '')}</span></td>
                  <td>${badge(s.estado)}</td>
                  <td><button class="boton boton-fantasma boton-pequeno" data-detalle="${escapar(s.id)}" type="button">Ver</button></td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>`;

      lista.querySelectorAll('[data-detalle]').forEach((boton) => {
        boton.addEventListener('click', () => {
          const solicitud = solicitudes.find((s) => s.id === boton.dataset.detalle);
          if (solicitud) abrirDetalleSolicitud(solicitud);
        });
      });

      if (seleccionId) {
        const solicitud = solicitudes.find((s) => s.id === seleccionId);
        if (solicitud) abrirDetalleSolicitud(solicitud);
      }
    } catch (error) {
      lista.innerHTML = etiquetaVacia(`No se pudieron cargar las solicitudes: ${error.message}`);
    }
  }

  function abrirDetalleSolicitud(s) {
    const datos = s.datos || {};
    const dir = datos.direccion || {};
    const fila = (etiqueta, valor) =>
      valor ? `<div><dt>${etiqueta}</dt><dd>${escapar(valor)}</dd></div>` : '';
    const lista = (valor) => (Array.isArray(valor) && valor.length ? escapar(valor.join(' · ')) : '—');

    const { cerrar, cuerpo } = abrirModal(
      `Solicitud · ${datos.empresa || s.email}`,
      `
      <p class="texto-suave">Recibida el ${fechaHora(s.creado_en)} · ${badge(s.estado)}</p>
      <dl class="detalle-datos">
        ${fila('Email', s.email)}
        ${fila('Persona de contacto', datos.personaContacto || s.persona_contacto)}
        ${fila('Teléfono', datos.telefono || s.telefono)}
        ${fila('Nombre comercial', datos.empresa)}
        ${fila('Razón social', datos.razonSocial)}
        ${fila('CIF / NIF', datos.cif)}
        ${fila('Dirección', [dir.calle, dir.cp, dir.poblacion, dir.provincia, dir.pais].filter(Boolean).join(', '))}
        ${fila('Web o redes', datos.web)}
        ${fila('Territorio de interés', datos.territorio)}
        ${fila('Tipo de establecimiento', datos.tipoEstablecimiento)}
        ${fila('Actividad principal', datos.actividad)}
        ${fila('Experiencia con perfumería', datos.experiencia)}
        ${fila('Motivación principal', lista(datos.motivaciones))}
        ${fila('Canales previstos', lista(datos.canales))}
        ${fila('Cómo nos conociste', datos.comoNosConociste)}
        ${fila('Comentarios', datos.comentarios)}
      </dl>
      <div class="detalle-respuesta">
        <p class="texto-suave">Trazas legales</p>
        <p class="texto-suave">
          Email ${s.verificado_en ? `verificado el ${fechaHora(s.verificado_en)}` : 'sin verificar'} ·
          Legales aceptados ${s.legal_aceptado_en ? fechaHora(s.legal_aceptado_en) : '—'} ·
          Privacidad aceptada ${s.privacidad_aceptado_en ? fechaHora(s.privacidad_aceptado_en) : '—'} ·
          Textos v${escapar(s.textos_version || '—')} · IP ${escapar(s.aceptacion_ip || '—')}
        </p>
      </div>
      <div class="detalle-nota">
        <details>
          <summary>Notas internas</summary>
          <textarea rows="3" id="dist-notas" placeholder="Notas del equipo sobre esta solicitud…">${escapar(s.notas_personal || '')}</textarea>
          <button class="boton boton-fantasma boton-pequeno" data-accion="guardar-notas" type="button">Guardar notas</button>
        </details>
      </div>
      <div class="modal-acciones envuelto">
        ${s.estado === 'completada' ? '<button class="boton boton-primario" data-accion="aceptar" type="button">✔ Aceptar distribuidor</button>' : ''}
        ${['completada', 'verificada', 'pendiente_verificacion'].includes(s.estado)
          ? '<button class="boton boton-fantasma" data-accion="rechazar" type="button">Rechazar</button>'
          : ''}
        ${s.estado !== 'aceptada' ? '<button class="boton boton-fantasma" data-accion="descartar" type="button">Descartar</button>' : ''}
        ${['pendiente_verificacion', 'verificada'].includes(s.estado)
          ? '<button class="boton boton-fantasma" data-accion="reenviar" type="button">↻ Reenviar enlace</button>'
          : ''}
      </div>`,
      '44rem'
    );

    const acciones = {
      'guardar-notas': async () => {
        try {
          await asegurar(sb().from('oms_distrib_solicitudes').update({ notas_personal: cuerpo.querySelector('#dist-notas').value }).eq('id', s.id));
          toast('Notas guardadas.');
        } catch (error) {
          toast(error.message, 'error');
        }
      },
      aceptar: () => {
        cerrar();
        abrirModalAceptar(s);
      },
      rechazar: async () => {
        cerrar();
        const enviar = await pedirConfirmacionCorreo('Rechazar solicitud', `¿Marcar la solicitud de «${datos.empresa || s.email}» como rechazada?`);
        try {
          const respuesta = await invocarFuncion('oms-distrib-gestion', { accion: 'rechazar', solicitudId: s.id, enviarCorreo: enviar });
          toast(respuesta?.mensaje || 'Solicitud rechazada.');
          pintarSolicitudes();
          refrescarContadorDistrib();
        } catch (error) {
          toast(error.message, 'error');
        }
      },
      descartar: async () => {
        const seguro = await confirmar('Descartar solicitud', `¿Descartar la solicitud de «${datos.empresa || s.email}»? Podrá solicitarse de nuevo con el mismo email.`, 'Descartar');
        if (!seguro) return;
        try {
          await invocarFuncion('oms-distrib-gestion', { accion: 'descartar', solicitudId: s.id });
          toast('Solicitud descartada.');
          cerrar();
          pintarSolicitudes();
          refrescarContadorDistrib();
        } catch (error) {
          toast(error.message, 'error');
        }
      },
      reenviar: async () => {
        try {
          const respuesta = await invocarFuncion('oms-distrib-gestion', { accion: 'reenviar-verificacion', solicitudId: s.id });
          toast(respuesta?.mensaje || 'Enlace reenviado.');
        } catch (error) {
          toast(error.message, 'error');
        }
      },
    };

    cuerpo.querySelectorAll('[data-accion]').forEach((boton) => {
      boton.addEventListener('click', () => acciones[boton.dataset.accion]?.());
    });
  }

  function pedirConfirmacionCorreo(titulo, mensaje) {
    return new Promise((resolver) => {
      const { cerrar, cuerpo } = abrirModal(
        titulo,
        `<p class="confirmar-texto">${escapar(mensaje)}</p>
         <label class="formulario-opciones" style="margin:1rem 0;">
           <input type="checkbox" id="dist-enviar-correo" checked> Enviar correo de aviso al interesado
         </label>
         <div class="modal-acciones">
           <button type="button" class="boton boton-fantasma" data-opcion="no">Cancelar</button>
           <button type="button" class="boton boton-primario" data-opcion="si">Confirmar</button>
         </div>`,
        '26rem'
      );
      cuerpo.querySelector('[data-opcion="no"]').addEventListener('click', () => { cerrar(); resolver(false); });
      cuerpo.querySelector('[data-opcion="si"]').addEventListener('click', () => {
        const enviar = cuerpo.querySelector('#dist-enviar-correo').checked;
        cerrar();
        resolver(enviar);
      });
    });
  }

  function abrirModalAceptar(s) {
    const datos = s.datos || {};
    const { cerrar, cuerpo } = abrirModal(
      `Aceptar a «${datos.empresa || s.email}»`,
      `
      <p class="texto-suave">Se creará su cuenta de zona VIP y recibirá un correo de marca con su contraseña temporal (podrá cambiarla después desde su zona).</p>
      <div class="modal-cuerpo-formulario">
        <label>Descuento de distribuidor (%) *</label>
        <input type="number" id="dist-descuento" min="0" max="100" step="0.5" value="10" required>
        <label>Territorios asignados (separados por comas)</label>
        <input type="text" id="dist-zonas" placeholder="Ej. Madrid, Toledo" value="${escapar(datos.territorio || '')}">
        <label class="formulario-opciones"><input type="checkbox" id="dist-acceso" checked> Habilitar acceso a la zona VIP ahora</label>
      </div>
      <p class="nota-secreto">El % se aplica en servidor sobre el precio efectivo cuando el distribuidor firma o crea sus pedidos. Podrás cambiarlo después.</p>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-opcion="no">Cancelar</button>
        <button type="button" class="boton boton-primario" data-opcion="si">Aceptar y crear cuenta</button>
      </div>`,
      '30rem'
    );

    cuerpo.querySelector('[data-opcion="no"]').addEventListener('click', cerrar);
    cuerpo.querySelector('[data-opcion="si"]').addEventListener('click', async () => {
      const descuento = Number(cuerpo.querySelector('#dist-descuento').value);
      const zonas = cuerpo.querySelector('#dist-zonas').value.split(',').map((z) => z.trim()).filter(Boolean);
      if (!Number.isFinite(descuento) || descuento < 0 || descuento > 100) {
        toast('El descuento debe estar entre 0 y 100.', 'error');
        return;
      }
      const boton = cuerpo.querySelector('[data-opcion="si"]');
      boton.disabled = true;
      const habilitarAhora = cuerpo.querySelector('#dist-acceso').checked;
      try {
        const respuesta = await invocarFuncion('oms-distrib-gestion', {
          accion: 'aceptar',
          solicitudId: s.id,
          descuentoPct: descuento,
          zonasTerritorio: zonas,
        });
        if (respuesta?.distribuidorId && !habilitarAhora) {
          // La función crea la cuenta habilitada; si el admin marcó lo contrario,
          // se deshabilita enseguida vía RLS.
          await asegurar(sb().from('oms_distribuidores').update({ acceso_habilitado: false }).eq('id', respuesta.distribuidorId));
        }
        // El acceso_habilitado llega del modal (la función lo deja habilitado)
        toast(respuesta?.mensaje || 'Distribuidor aceptado.');
        cerrar();
        pintarSolicitudes();
        refrescarContadorDistrib();
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
      }
    });
  }

  // ─── BANCO DE EMAILS (sin verificar / verificados sin formulario) ─────────
  async function pintarBanco() {
    zona.innerHTML = `
      <p class="texto-suave" style="margin-bottom:1rem;">Interesados que aún no completan la solicitud: elimínalos o reenvíales el enlace para continuar ahora.</p>
      <div id="dist-banco"><p class="cargando">Cargando…</p></div>`;
    const lista = zona.querySelector('#dist-banco');
    try {
      const registros = (await asegurar(
        sb()
          .from('oms_distrib_solicitudes')
          .select('*')
          .in('estado', ['pendiente_verificacion', 'verificada'])
          .order('creado_en', { ascending: false })
          .limit(300)
      )) || [];
      if (!registros.length) {
        lista.innerHTML = etiquetaVacia('No hay correos pendientes en el banco.');
        return;
      }
      lista.innerHTML = `
        <table class="tabla">
          <thead><tr><th>Fecha</th><th>Email</th><th>Contacto</th><th>Estado</th><th class="celda-acciones">Acciones</th></tr></thead>
          <tbody>
            ${registros
              .map(
                (r) => `<tr>
                  <td>${fechaHora(r.creado_en)}</td>
                  <td>${escapar(r.email)}</td>
                  <td>${escapar(r.persona_contacto || '—')}<br><span class="texto-suave">${escapar(r.telefono || '')}</span></td>
                  <td>${badge(r.estado)}</td>
                  <td class="celda-acciones">
                    <button class="boton boton-fantasma boton-pequeno" data-reenviar="${escapar(r.id)}" type="button" title="Reenviar enlace de verificación">↻</button>
                    <button class="boton boton-peligro boton-pequeno" data-eliminar="${escapar(r.id)}" type="button" title="Eliminar">🗑</button>
                  </td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>`;

      lista.querySelectorAll('[data-reenviar]').forEach((boton) => {
        boton.addEventListener('click', async () => {
          try {
            const respuesta = await invocarFuncion('oms-distrib-gestion', { accion: 'reenviar-verificacion', solicitudId: boton.dataset.reenviar });
            toast(respuesta?.mensaje || 'Enlace reenviado.');
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      });

      lista.querySelectorAll('[data-eliminar]').forEach((boton) => {
        boton.addEventListener('click', async () => {
          const registro = registros.find((r) => r.id === boton.dataset.eliminar);
          const seguro = await confirmar('Eliminar interesado', `¿Eliminar «${registro?.email}» del banco de emails? No se puede recuperar.`);
          if (!seguro) return;
          try {
            const error = (await sb().from('oms_distrib_solicitudes').delete().eq('id', boton.dataset.eliminar)).error;
            if (error) throw new Error(mensajeError(error));
            toast('Registro eliminado.');
            pintarBanco();
            refrescarContadorDistrib();
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      });
    } catch (error) {
      lista.innerHTML = etiquetaVacia(`No se pudo cargar el banco: ${error.message}`);
    }
  }

  // ─── DISTRIBUIDORES ACEPTADOS ─────────────────────────────────────────────
  async function pintarAceptados() {
    zona.innerHTML = '<div id="dist-aceptados"><p class="cargando">Cargando…</p></div>';
    const lista = zona.querySelector('#dist-aceptados');
    try {
      const [distribuidores, accesos, recursos] = await Promise.all([
        asegurar(sb().from('oms_distribuidores').select('*').order('creado_en', { ascending: false })),
        asegurar(sb().from('oms_distrib_recursos_accesos').select('distribuidor_id, zona')),
        asegurar(sb().from('oms_distrib_recursos').select('zona').order('zona')),
      ]);
      const zonasExistentes = [...new Set((recursos || []).map((r) => r.zona))].filter(Boolean);
      const accesosPorDistribuidor = {};
      (accesos || []).forEach((a) => {
        (accesosPorDistribuidor[a.distribuidor_id] = accesosPorDistribuidor[a.distribuidor_id] || []).push(a.zona);
      });

      if (!distribuidores.length) {
        lista.innerHTML = etiquetaVacia('Todavía no hay distribuidores aceptados. Acepta una solicitud para crear el primero.');
        return;
      }
      lista.innerHTML = `
        <table class="tabla">
          <thead><tr><th>Empresa</th><th>Contacto</th><th>Descuento</th><th>Territorios</th><th>Carpetas</th><th>Acceso</th><th class="celda-acciones">Acciones</th></tr></thead>
          <tbody>
            ${distribuidores
              .map((d) => {
                const carpetas = (accesosPorDistribuidor[d.id] || []).join(', ') || '—';
                return `<tr>
                  <td><strong>${escapar(d.empresa || '—')}</strong><br><span class="texto-suave">${escapar(d.email)}</span></td>
                  <td>${escapar(d.persona_contacto || '—')}<br><span class="texto-suave">${escapar(d.telefono || '')}</span></td>
                  <td><strong>${escapar(Number(d.descuento_pct) || 0)}%</strong></td>
                  <td>${escapar((d.zonas_territorio || []).join(', ') || '—')}</td>
                  <td>${escapar(carpetas)}</td>
                  <td><span class="badge ${d.acceso_habilitado ? 'badge-verde' : 'badge-rojo'}">${d.acceso_habilitado ? 'Habilitado' : 'Deshabilitado'}</span></td>
                  <td class="celda-acciones">
                    <button class="boton boton-fantasma boton-pequeno" data-editar="${escapar(d.id)}" type="button" title="Editar descuento, territorios y notas">✎</button>
                    <button class="boton boton-fantasma boton-pequeno" data-carpetas="${escapar(d.id)}" type="button" title="Carpetas autorizadas">▤</button>
                    <button class="boton boton-fantasma boton-pequeno" data-toggle="${escapar(d.id)}" type="button" title="${d.acceso_habilitado ? 'Deshabilitar acceso puntualmente' : 'Habilitar acceso'}">${d.acceso_habilitado ? '⏸' : '▶'}</button>
                    <button class="boton boton-fantasma boton-pequeno" data-regenerar="${escapar(d.id)}" type="button" title="Regenerar contraseña (enviar por email o copiar)">🔑</button>
                    <button class="boton boton-fantasma boton-pequeno" data-invite="${escapar(d.id)}" type="button" title="Reenviar email de activación">✉</button>
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>`;

      const porId = (id) => distribuidores.find((d) => d.id === id);

      lista.querySelectorAll('[data-editar]').forEach((boton) => {
        boton.addEventListener('click', () => abrirEditarDistribuidor(porId(boton.dataset.editar), () => pintarAceptados()));
      });

      lista.querySelectorAll('[data-carpetas]').forEach((boton) => {
        boton.addEventListener('click', () =>
          abrirCarpetas(porId(boton.dataset.carpetas), zonasExistentes, accesosPorDistribuidor[boton.dataset.carpetas] || [], () => pintarAceptados())
        );
      });

      lista.querySelectorAll('[data-toggle]').forEach((boton) => {
        boton.addEventListener('click', async () => {
          const d = porId(boton.dataset.toggle);
          const nuevo = d.acceso_habilitado ? false : true;
          const seguro = await confirmar(
            nuevo ? 'Habilitar acceso' : 'Deshabilitar acceso',
            nuevo
              ? `¿Volver a habilitar el acceso de «${d.empresa}» a la zona VIP?`
              : `¿Deshabilitar PUNTUALMENTE el acceso de «${d.empresa}»? No podrá entrar ni pedir mientras esté deshabilitado.`,
            nuevo ? 'Habilitar' : 'Deshabilitar',
            !nuevo
          );
          if (!seguro) return;
          try {
            await asegurar(sb().from('oms_distribuidores').update({ acceso_habilitado: nuevo }).eq('id', d.id));
            toast(nuevo ? 'Acceso habilitado.' : 'Acceso deshabilitado.');
            pintarAceptados();
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      });

      lista.querySelectorAll('[data-invite]').forEach((boton) => {
        boton.addEventListener('click', async () => {
          const d = porId(boton.dataset.invite);
          const seguro = await confirmar('Reenviar acceso', `¿Enviar a «${d.email}» un correo con una contraseña temporal nueva para la zona VIP? La anterior dejará de servir.`, 'Enviar', false);
          if (!seguro) return;
          try {
            const respuesta = await invocarFuncion('oms-distrib-gestion', { accion: 'reenviar-invite', distribuidorId: d.id });
            toast(respuesta?.mensaje || 'Enlace enviado.');
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      });

      lista.querySelectorAll('[data-regenerar]').forEach((boton) => {
        boton.addEventListener('click', () => abrirRegenerarPassword(porId(boton.dataset.regenerar)));
      });
    } catch (error) {
      lista.innerHTML = etiquetaVacia(`No se pudieron cargar los distribuidores: ${error.message}`);
    }
  }

  // ─── REGENERAR CONTRASEÑA ─────────────────────────────────────────────────
  // Contraseña temporal nueva para la zona VIP: opcionalmente se envía por
  // email y SIEMPRE queda en pantalla para copiarla al portapapeles y
  // entregársela al distribuidor por el canal que se prefiera.
  function abrirRegenerarPassword(d) {
    const { cerrar, cuerpo } = abrirModal(
      `Regenerar contraseña · ${d.empresa || d.email}`,
      `
      <p class="texto-suave">Se creará una <strong>contraseña temporal nueva</strong> para la zona VIP de este distribuidor y la actual dejará de servir enseguida.</p>
      <label class="formulario-opciones" style="margin:1rem 0;">
        <input type="checkbox" id="reg-enviar-correo" checked> Enviársela también por email a ${escapar(d.email)}
      </label>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-opcion="no">Cancelar</button>
        <button type="button" class="boton boton-primario" data-opcion="si">Regenerar</button>
      </div>`,
      '30rem'
    );
    cuerpo.querySelector('[data-opcion="no"]').addEventListener('click', cerrar);
    cuerpo.querySelector('[data-opcion="si"]').addEventListener('click', async () => {
      const enviar = cuerpo.querySelector('#reg-enviar-correo').checked;
      const boton = cuerpo.querySelector('[data-opcion="si"]');
      boton.disabled = true;
      boton.textContent = 'Regenerando…';
      try {
        const respuesta = await invocarFuncion('oms-distrib-gestion', {
          accion: 'regenerar-contrasena',
          distribuidorId: d.id,
          enviarCorreo: enviar,
        });
        cerrar();
        abrirPasswordRegenerada(d, respuesta, enviar);
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
        boton.textContent = 'Regenerar';
      }
    });
  }

  function abrirPasswordRegenerada(d, respuesta, enviar) {
    const contrasena = String(respuesta?.contrasena || '');
    const estadoEnvio = !enviar
      ? 'No se ha enviado por email: cópiala y entrégasela por el canal que prefieras.'
      : respuesta?.enviado
        ? `Enviada por email a ${escapar(d.email)}. Por si acaso, también puedes copiarla aquí.`
        : `NO se pudo enviar por email${respuesta?.detalle ? ` (${escapar(respuesta.detalle)})` : ''}: cópiala y entrégasela directamente.`;
    const { cerrar: cerrarResultado, cuerpo } = abrirModal(
      'Contraseña temporal nueva',
      `
      <p class="texto-suave">Entrará en <strong>zona-distribuidor.html</strong> con su correo (${escapar(d.email)}) y esta contraseña. Se la cambiará desde Mi perfil cuando quiera.</p>
      <div class="detalle-password">
        <code id="reg-password-texto">${escapar(contrasena)}</code>
        <button type="button" class="boton boton-primario" id="reg-copiar">📋 Copiar al portapapeles</button>
      </div>
      <p class="texto-suave">${estadoEnvio}</p>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-opcion="cerrar">Cerrar</button>
      </div>`,
      '30rem'
    );
    cuerpo.querySelector('[data-opcion="cerrar"]').addEventListener('click', cerrarResultado);
    cuerpo.querySelector('#reg-copiar').addEventListener('click', async () => {
      const copiado = await copiarAlPortapapeles(contrasena);
      toast(copiado ? 'Contraseña copiada al portapapeles.' : 'No se pudo copiar automáticamente: selecciónala y cópiala a mano.', copiado ? 'ok' : 'error');
    });
  }

  async function copiarAlPortapapeles(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      try {
        const area = document.createElement('textarea');
        area.value = texto;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  function abrirEditarDistribuidor(d, alGuardar) {
    const { cerrar, cuerpo } = abrirModal(
      `Editar «${d.empresa || d.email}»`,
      `
      <div class="modal-cuerpo-formulario">
        <label>Empresa</label>
        <input type="text" id="ed-empresa" value="${escapar(d.empresa || '')}">
        <label>Persona de contacto</label>
        <input type="text" id="ed-persona" value="${escapar(d.persona_contacto || '')}">
        <label>Teléfono</label>
        <input type="text" id="ed-telefono" value="${escapar(d.telefono || '')}">
        <label>Descuento (%) *</label>
        <input type="number" id="ed-descuento" min="0" max="100" step="0.5" value="${escapar(Number(d.descuento_pct) || 0)}" required>
        <label>Territorios (separados por comas)</label>
        <input type="text" id="ed-zonas" value="${escapar((d.zonas_territorio || []).join(', '))}">
        <label>Notas internas</label>
        <textarea id="ed-notas" rows="3">${escapar(d.notas_personal || '')}</textarea>
      </div>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-opcion="no">Cancelar</button>
        <button type="button" class="boton boton-primario" data-opcion="si">Guardar</button>
      </div>`,
      '30rem'
    );
    cuerpo.querySelector('[data-opcion="no"]').addEventListener('click', cerrar);
    cuerpo.querySelector('[data-opcion="si"]').addEventListener('click', async () => {
      const descuento = Number(cuerpo.querySelector('#ed-descuento').value);
      if (!Number.isFinite(descuento) || descuento < 0 || descuento > 100) {
        toast('El descuento debe estar entre 0 y 100.', 'error');
        return;
      }
      try {
        await asegurar(
          sb()
            .from('oms_distribuidores')
            .update({
              empresa: cuerpo.querySelector('#ed-empresa').value.trim(),
              persona_contacto: cuerpo.querySelector('#ed-persona').value.trim(),
              telefono: cuerpo.querySelector('#ed-telefono').value.trim(),
              descuento_pct: descuento,
              zonas_territorio: cuerpo.querySelector('#ed-zonas').value.split(',').map((z) => z.trim()).filter(Boolean).slice(0, 12),
              notas_personal: cuerpo.querySelector('#ed-notas').value,
            })
            .eq('id', d.id)
        );
        toast('Distribuidor actualizado.');
        cerrar();
        alGuardar();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  function abrirCarpetas(d, zonasExistentes, autorizadas, alGuardar) {
    const zonas = [...new Set([...zonasExistentes, ...autorizadas])];
    const { cerrar, cuerpo } = abrirModal(
      `Carpetas de «${d.empresa || d.email}»`,
      `
      <p class="texto-suave">Marca las carpetas de material comercial que este distribuidor puede ver en su zona VIP. Sin marca no ve ninguna.</p>
      <div class="formulario-opciones dist-carpetas">
        ${zonas.length
          ? zonas
              .map(
                (z) =>
                  `<label class="interruptor"><input type="checkbox" value="${escapar(z)}" ${autorizadas.includes(z) ? 'checked' : ''}><span class="interruptor-pista"></span> ${escapar(z)}</label>`
              )
              .join('')
          : '<p class="texto-suave">Todavía no hay carpetas: créalas al subir el primer recurso en la pestaña Recursos.</p>'}
        <label style="margin-top:.8rem;">Nueva carpeta (si procede): <input type="text" id="carpeta-nueva" placeholder="Ej. formacion"></label>
      </div>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-opcion="no">Cancelar</button>
        <button type="button" class="boton boton-primario" data-opcion="si">Guardar accesos</button>
      </div>`,
      '30rem'
    );
    cuerpo.querySelector('[data-opcion="no"]').addEventListener('click', cerrar);
    cuerpo.querySelector('[data-opcion="si"]').addEventListener('click', async () => {
      const marcadas = Array.from(cuerpo.querySelectorAll('.dist-carpetas input[type="checkbox"]:checked')).map((c) => c.value);
      const nueva = cuerpo.querySelector('#carpeta-nueva').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
      const finales = [...new Set([...marcadas, ...(nueva ? [nueva] : [])])].filter((z) => z).slice(0, 20);
      try {
        await asegurar(sb().from('oms_distrib_recursos_accesos').delete().eq('distribuidor_id', d.id));
        if (finales.length) {
          await asegurar(sb().from('oms_distrib_recursos_accesos').insert(finales.map((zona) => ({ distribuidor_id: d.id, zona }))));
        }
        toast('Carpetas actualizadas.');
        cerrar();
        alGuardar();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  // ─── RECURSOS ─────────────────────────────────────────────────────────────
  async function pintarRecursos() {
    zona.innerHTML = `
      <div class="modal-acciones envuelto" style="margin-bottom:1rem;">
        <button class="boton boton-primario" id="dist-subir" type="button">⬆ Subir recurso</button>
        <span class="texto-suave">Logos, pósters, fichas PDF, intención de ventas, ventas reales… (PDF, PNG, JPG, WebP o ZIP · máx. 20 MB). La carpeta (zona) decide quién lo ve.</span>
      </div>
      <div id="dist-recursos"><p class="cargando">Cargando…</p></div>`;

    zona.querySelector('#dist-subir').addEventListener('click', () => abrirSubirRecurso(() => pintarRecursos()));

    const lista = zona.querySelector('#dist-recursos');
    try {
      const recursos = (await asegurar(
        sb().from('oms_distrib_recursos').select('*').order('zona').order('creado_en', { ascending: false })
      )) || [];
      if (!recursos.length) {
        lista.innerHTML = etiquetaVacia('Sin material todavía. Sube el primer recurso (por ejemplo, el kit de logos en la carpeta «marca»).');
        return;
      }
      let zonaActual = null;
      lista.innerHTML = recursos
        .map((r) => {
          const cabecera = r.zona !== zonaActual
            ? `<tr class="fila-grupo"><th colspan="5">📁 ${escapar(r.zona)}</th></tr>`
            : '';
          zonaActual = r.zona;
          return `${cabecera}<tr>
            <td><strong>${escapar(r.titulo)}</strong><br><span class="texto-suave">${escapar(r.descripcion || '')}</span></td>
            <td>${escapar(TIPOS_RECURSO[r.tipo] || r.tipo)}</td>
            <td>${r.visible ? '<span class="badge badge-verde">Visible</span>' : '<span class="badge badge-gris">Oculto</span>'}</td>
            <td class="texto-suave">${fechaHora(r.creado_en)}</td>
            <td class="celda-acciones">
              ${r.archivo ? `<button class="boton boton-fantasma boton-pequeno" data-descargar="${escapar(r.archivo)}" type="button" title="Descargar">⬇</button>` : ''}
              <button class="boton boton-fantasma boton-pequeno" data-visible="${escapar(r.id)}" type="button" title="${r.visible ? 'Ocultar' : 'Mostrar'}">${r.visible ? '◌' : '◉'}</button>
              <button class="boton boton-peligro boton-pequeno" data-borrar="${escapar(r.id)}" type="button" title="Eliminar">🗑</button>
            </td>
          </tr>`;
        })
        .join('');

      lista.querySelectorAll('[data-descargar]').forEach((boton) => {
        boton.addEventListener('click', async () => {
          try {
            const { data, error } = await sb().storage.from('oms-distrib').createSignedUrl(boton.dataset.descargar, 600);
            if (error || !data?.signedUrl) throw new Error(error?.message || 'No se pudo firmar la descarga.');
            window.open(data.signedUrl, '_blank', 'noopener');
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      });

      lista.querySelectorAll('[data-visible]').forEach((boton) => {
        boton.addEventListener('click', async () => {
          const recurso = recursos.find((r) => r.id === boton.dataset.visible);
          try {
            await asegurar(sb().from('oms_distrib_recursos').update({ visible: !recurso.visible }).eq('id', recurso.id));
            toast(recurso.visible ? 'Recurso oculto.' : 'Recurso visible.');
            pintarRecursos();
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      });

      lista.querySelectorAll('[data-borrar]').forEach((boton) => {
        boton.addEventListener('click', async () => {
          const recurso = recursos.find((r) => r.id === boton.dataset.borrar);
          const seguro = await confirmar('Eliminar recurso', `¿Eliminar «${recurso.titulo}» y su archivo del bucket privado?`);
          if (!seguro) return;
          try {
            if (recurso.archivo) {
              const { error: errorStorage } = await sb().storage.from('oms-distrib').remove([recurso.archivo]);
              if (errorStorage) console.warn('Archivo no borrado del bucket:', errorStorage.message);
            }
            await asegurar(sb().from('oms_distrib_recursos').delete().eq('id', recurso.id));
            toast('Recurso eliminado.');
            pintarRecursos();
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      });
    } catch (error) {
      lista.innerHTML = etiquetaVacia(`No se pudieron cargar los recursos: ${error.message}`);
    }
  }

  function abrirSubirRecurso(alGuardar) {
    const { cerrar, cuerpo } = abrirModal(
      'Subir recurso comercial',
      `
      <div class="modal-cuerpo-formulario">
        <label>Título *</label>
        <input type="text" id="rec-titulo" placeholder="Ej. Kit de logos 2026">
        <label>Tipo</label>
        <select id="rec-tipo">
          ${Object.entries(TIPOS_RECURSO).map(([valor, texto]) => `<option value="${valor}">${texto}</option>`).join('')}
        </select>
        <label>Carpeta (zona) *</label>
        <input type="text" id="rec-zona" placeholder="Ej. marca, producto, formacion">
        <p class="texto-suave">Carpeta temática en minúsculas: decide qué distribuidores la ven (Distribuidores → Carpetas).</p>
        <label>Producto asociado (opcional)</label>
        <select id="rec-producto"><option value="">— Material general de carpeta —</option></select>
        <p class="texto-suave">Si lo vinculas a un producto, aparece en la ficha completa de ese producto en la zona VIP (siempre que el distribuidor tenga autorizada esta carpeta).</p>
        <label>Descripción</label>
        <input type="text" id="rec-descripcion" placeholder="Notas cortas para el distribuidor">
        <label>Archivo *</label>
        <input type="file" id="rec-archivo" accept=".pdf,.png,.jpg,.jpeg,.webp,.zip">
        <label class="formulario-opciones"><input type="checkbox" id="rec-visible" checked> Visible para los distribuidores autorizados</label>
      </div>
      <p class="nota-secreto">Máximo 20 MB. El archivo se guarda en el bucket PRIVADO: solo lo descargan los distribuidores con esa carpeta autorizada.</p>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-opcion="no">Cancelar</button>
        <button type="button" class="boton boton-primario" data-opcion="si">Subir</button>
      </div>`,
      '32rem'
    );
    cuerpo.querySelector('[data-opcion="no"]').addEventListener('click', cerrar);
    sb().from('oms_productos')
      .select('id, nombre')
      .order('nombre')
      .then(({ data }) => {
        const selector = cuerpo.querySelector('#rec-producto');
        (data || []).forEach((p) => {
          const opcion = document.createElement('option');
          opcion.value = p.id;
          opcion.textContent = p.nombre;
          selector.append(opcion);
        });
      })
      .catch(() => {});
    cuerpo.querySelector('[data-opcion="si"]').addEventListener('click', async () => {
      const titulo = cuerpo.querySelector('#rec-titulo').value.trim();
      const carpeta = cuerpo
        .querySelector('#rec-zona')
        .value.trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/^-+|-+$/g, '');
      const archivo = cuerpo.querySelector('#rec-archivo').files[0];
      if (!titulo || !carpeta) {
        toast('El título y la carpeta son obligatorios.', 'error');
        return;
      }
      if (!archivo) {
        toast('Elige un archivo.', 'error');
        return;
      }
      const tipo = MIME_OK[archivo.type];
      if (!tipo) {
        toast('Formato no admitido: usa PDF, PNG, JPG, WebP o ZIP.', 'error');
        return;
      }
      if (archivo.size > 20 * 1024 * 1024) {
        toast(`«${archivo.name}» supera el límite de 20 MB.`, 'error');
        return;
      }
      const boton = cuerpo.querySelector('[data-opcion="si"]');
      boton.disabled = true;
      boton.textContent = 'Subiendo…';
      try {
        const aleatorio = crypto.getRandomValues(new Uint32Array(2)).join('');
        const nombreLimpio = archivo.name
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9.-]/g, '-')
          .slice(-80);
        const ruta = `${carpeta}/${Date.now()}-${aleatorio}-${nombreLimpio}`;
        const respuesta = await sb().storage
          .from('oms-distrib')
          .upload(ruta, archivo, { contentType: archivo.type, upsert: false });
        if (respuesta.error) throw new Error(mensajeError(respuesta.error));
        await asegurar(
          sb().from('oms_distrib_recursos').insert({
            titulo,
            tipo: cuerpo.querySelector('#rec-tipo').value,
            zona: carpeta,
            archivo: ruta,
            descripcion: cuerpo.querySelector('#rec-descripcion').value.trim().slice(0, 300),
            visible: cuerpo.querySelector('#rec-visible').checked,
            producto_id: cuerpo.querySelector('#rec-producto').value || null,
          })
        );
        toast('Recurso subido.');
        cerrar();
        alGuardar();
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
        boton.textContent = 'Subir';
      }
    });
  }

  // ─── FICHAS DE PRODUCTO ───────────────────────────────────────────────────
  // Imagen exclusiva + dossier del distribuidor POR PRODUCTO. Lo que ve la
  // zona VIP en la ficha completa de cada producto.
  const MIME_IMAGEN = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

  async function pintarFichas() {
    zona.innerHTML = '<div id="dist-fichas"><p class="cargando">Cargando productos…</p></div>';
    const lista = zona.querySelector('#dist-fichas');
    try {
      const [productos, fichas] = await Promise.all([
        asegurar(sb().from('oms_productos').select('id, nombre, codigo, activo').order('nombre')),
        asegurar(sb().from('oms_distrib_producto_info').select('*')),
      ]);
      const porProducto = {};
      (fichas || []).forEach((f) => { porProducto[f.producto_id] = f; });

      if (!productos.length) {
        lista.innerHTML = etiquetaVacia('No hay productos en el catálogo.');
        return;
      }
      lista.innerHTML = `
        <p class="texto-suave" style="margin-bottom:1rem;">La ficha alimenta la página completa del producto en la zona VIP: imagen exclusiva, dossier extenso para el distribuidor y notas comerciales. La descripción del cliente final sigue en Productos, sin cambios.</p>
        <table class="tabla">
          <thead><tr><th>Producto</th><th>Imagen exclusiva</th><th>Dossier distribuidor</th><th>Notas comerciales</th><th class="celda-acciones">Acciones</th></tr></thead>
          <tbody>
            ${productos
              .map((p) => {
                const f = porProducto[p.id] || {};
                const punto = (hay) => (hay ? '<span class="badge badge-verde">✓</span>' : '<span class="texto-suave">—</span>');
                return `<tr>
                  <td><strong>${escapar(p.nombre)}</strong><br><span class="texto-suave">${escapar(p.codigo || '')}${p.activo === false ? ' · inactivo' : ''}</span></td>
                  <td>${punto(f.imagen_exclusiva)}</td>
                  <td>${punto(f.descripcion_distribuidor)}</td>
                  <td>${punto(f.notas_comerciales)}</td>
                  <td class="celda-acciones"><button class="boton boton-fantasma boton-pequeno" data-ficha="${escapar(p.id)}" type="button">Editar ficha</button></td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>`;

      lista.querySelectorAll('[data-ficha]').forEach((boton) => {
        boton.addEventListener('click', () => {
          abrirModalFicha(productos.find((p) => p.id === boton.dataset.ficha), porProducto[boton.dataset.ficha] || {}, () => pintarFichas());
        });
      });
    } catch (error) {
      lista.innerHTML = etiquetaVacia(`No se pudieron cargar las fichas: ${error.message}`);
    }
  }

  function abrirModalFicha(producto, ficha, alGuardar) {
    const { cerrar, cuerpo } = abrirModal(
      `Ficha distribuidor · ${producto.nombre}`,
      `
      <div class="modal-cuerpo-formulario">
        <label>Imagen exclusiva para distribuidores (PNG, JPG o WebP · máx. 5 MB)</label>
        <input type="file" id="fch-imagen" accept=".png,.jpg,.jpeg,.webp">
        ${ficha.imagen_exclusiva ? '<p class="texto-suave">Ya existe una imagen exclusiva: si subes otra, la sustituye.</p>' : '<p class="texto-suave">Sin imagen exclusiva: la zona VIP muestra la imagen pública del producto.</p>'}
        <label>Descripción extensa para el distribuidor (dossier)</label>
        <textarea name="descripcion" rows="8" placeholder="Historia del producto, notas olfativas detalladas, argumentos de venta, presentación, formato, unidades por caja…">${escapar(ficha.descripcion_distribuidor || '')}</textarea>
        <label>Notas comerciales</label>
        <textarea name="notas" rows="5" placeholder="Margen orientativo, unidades recomendadas, fechas clave de promoción…">${escapar(ficha.notas_comerciales || '')}</textarea>
      </div>
      <p class="nota-secreto">Los materiales comerciales (PDF, pósters…) se asocian al producto desde la pestaña Recursos → «Producto asociado».</p>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-opcion="no">Cancelar</button>
        <button type="button" class="boton boton-primario" data-opcion="si">Guardar ficha</button>
      </div>`,
      '34rem'
    );
    cuerpo.querySelector('[data-opcion="no"]').addEventListener('click', cerrar);
    cuerpo.querySelector('[data-opcion="si"]').addEventListener('click', async () => {
      const boton = cuerpo.querySelector('[data-opcion="si"]');
      const archivo = cuerpo.querySelector('#fch-imagen').files[0];
      if (archivo && !MIME_IMAGEN[archivo.type]) {
        toast('Formato no admitido: usa PNG, JPG o WebP.', 'error');
        return;
      }
      if (archivo && archivo.size > 5 * 1024 * 1024) {
        toast('La imagen supera el límite de 5 MB.', 'error');
        return;
      }
      boton.disabled = true;
      boton.textContent = 'Guardando…';
      try {
        let imagenExclusiva = ficha.imagen_exclusiva || '';
        if (archivo) {
          const ruta = `producto-imagenes/${producto.id}.${MIME_IMAGEN[archivo.type]}`;
          const respuesta = await sb().storage
            .from('oms-distrib')
            .upload(ruta, archivo, { contentType: archivo.type, upsert: true });
          if (respuesta.error) throw new Error(mensajeError(respuesta.error));
          imagenExclusiva = ruta;
        }
        await asegurar(
          sb().from('oms_distrib_producto_info').upsert(
            {
              producto_id: producto.id,
              imagen_exclusiva: imagenExclusiva,
              descripcion_distribuidor: cuerpo.querySelector('[name="descripcion"]').value,
              notas_comerciales: cuerpo.querySelector('[name="notas"]').value,
            },
            { onConflict: 'producto_id' }
          )
        );
        toast('Ficha guardada.');
        cerrar();
        alGuardar();
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
        boton.textContent = 'Guardar ficha';
      }
    });
  }

  await pintar();
  refrescarContadorDistrib();
}
