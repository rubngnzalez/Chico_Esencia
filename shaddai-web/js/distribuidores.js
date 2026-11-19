// Asistente "Hazte distribuidor" (distribuidores.html).
// Paso 1: email + persona de contacto + teléfono (obligatorios) + captcha
//         matemático firmado → correo de verificación (24 h).
// Paso 2: al volver desde el correo (?verificar=token) — formulario completo
//         de empresa + cuestionario + aceptación legal → solicitud completa.
// Paso 3: confirmación visual.
// Todo viaja a las Edge Functions oms-distrib-captcha / solicitar / verificar /
// completar. Sin Supabase JS: son llamadas fetch públicas (CORS de la web).
(() => {
  // URL del proyecto (js/config-supabase.js, con reserva por si viniera vacío)
  const REF = 'zjzqbugpdpfuttdwagai';
  const URL_PROYECTO = window.SUPABASE_URL || `https://${REF}.supabase.co`;
  const BASE = `${URL_PROYECTO.replace(/\/$/, '')}/functions/v1`;

  const $ = (id) => document.getElementById(id);
  const pasos = ['dist-paso-1', 'dist-paso-espera', 'dist-paso-2', 'dist-paso-gracias'];
  const CLAVE_BORRADOR = 'dist-solicitud-borrador';

  let captcha = null; // { datos, firma } vigente
  let tokenVerificado = '';

  // ─── Borrador del formulario (la información escrita nunca se pierde) ────
  function leerBorrador() {
    try {
      const datos = JSON.parse(localStorage.getItem(CLAVE_BORRADOR) || 'null');
      return datos && typeof datos === 'object' ? datos : null;
    } catch {
      return null;
    }
  }

  function guardarBorrador() {
    try {
      localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({ token: tokenVerificado || '', datos: camposFormulario() }));
    } catch {}
  }

  function borrarTokenBorrador() {
    // El token dejó de servir, pero lo escrito se conserva para el reintento
    try {
      const borrador = leerBorrador();
      if (borrador) {
        borrador.token = '';
        localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(borrador));
      }
    } catch {}
  }

  function camposFormulario() {
    const v = (id) => $(id).value.trim();
    const marcados = (id) => Array.from($(id).querySelectorAll('input:checked')).map((c) => c.value);
    return {
      empresa: v('d2-empresa'),
      razonSocial: v('d2-razon'),
      cif: v('d2-cif'),
      personaContacto: v('d2-persona'),
      telefono: v('d2-telefono'),
      web: v('d2-web'),
      calle: v('d2-calle'),
      cp: v('d2-cp'),
      poblacion: v('d2-poblacion'),
      provincia: v('d2-provincia'),
      pais: $('d2-pais').value,
      territorio: v('d2-territorio'),
      comentarios: v('d2-comentarios'),
      tipoEstablecimiento: $('d2-tipo').value,
      actividad: $('d2-actividad').value,
      experiencia: $('d2-experiencia').value,
      comoNosConociste: $('d2-conociste').value,
      motivaciones: marcados('d2-motivaciones'),
      canales: marcados('d2-canales'),
      legal: $('d2-legal').checked,
      privacidad: $('d2-privacidad').checked,
    };
  }

  function restaurarCampos(datos) {
    if (!datos || typeof datos !== 'object') return;
    const textos = {
      'd2-empresa': 'empresa', 'd2-razon': 'razonSocial', 'd2-cif': 'cif',
      'd2-persona': 'personaContacto', 'd2-telefono': 'telefono', 'd2-web': 'web',
      'd2-calle': 'calle', 'd2-cp': 'cp', 'd2-poblacion': 'poblacion',
      'd2-provincia': 'provincia', 'd2-territorio': 'territorio', 'd2-comentarios': 'comentarios',
    };
    // Solo rellena campos vacíos: lo escrito por el interesado manda siempre
    Object.entries(textos).forEach(([id, clave]) => {
      const valor = String(datos[clave] || '').trim();
      if (valor && !$(id).value.trim()) $(id).value = valor;
    });
    const selects = { 'd2-pais': 'pais', 'd2-tipo': 'tipoEstablecimiento', 'd2-actividad': 'actividad', 'd2-experiencia': 'experiencia', 'd2-conociste': 'comoNosConociste' };
    Object.entries(selects).forEach(([id, clave]) => {
      const valor = String(datos[clave] || '').trim();
      if (valor) $(id).value = valor;
    });
    [['d2-motivaciones', 'motivaciones'], ['d2-canales', 'canales']].forEach(([id, clave]) => {
      const guardadas = Array.isArray(datos[clave]) ? datos[clave] : [];
      if (guardadas.length) {
        $(id).querySelectorAll('input[type="checkbox"]').forEach((c) => {
          c.checked = guardadas.includes(c.value) || c.checked;
        });
      }
    });
    if (datos.legal === true) $('d2-legal').checked = true;
    if (datos.privacidad === true) $('d2-privacidad').checked = true;
  }

  const mostrar = (id) => {
    pasos.forEach((paso) => $(paso).classList.toggle('activo', paso === id));
    if (id === 'dist-paso-1') cargarCaptcha();
    window.scrollTo({ top: $('dist-wizard').offsetTop - 120, behavior: 'smooth' });
  };

  const aviso = (id, texto, tipo = '') => {
    const zona = $(id);
    zona.textContent = texto || '';
    zona.style.color = tipo === 'error' ? '#a33' : '';
  };

  async function llamar(nombre, cuerpo) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), 20000);
    try {
      const respuesta = await fetch(`${BASE}/oms-distrib-${nombre}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo || {}),
        signal: control.signal,
      });
      const contenido = await respuesta.json().catch(() => ({}));
      return { ok: respuesta.ok && !contenido.error, contenido };
    } catch {
      return { ok: false, contenido: { error: 'No hemos podido conectar. Revisa tu conexión e inténtalo de nuevo.' } };
    } finally {
      clearTimeout(reloj);
    }
  }

  async function cargarCaptcha() {
    const pregunta = $('dist-captcha-pregunta');
    if (!pregunta) return;
    pregunta.textContent = 'Cargando…';
    const { ok, contenido } = await llamar('captcha');
    if (ok && contenido.pregunta) {
      captcha = { datos: contenido.datos, firma: contenido.firma };
      pregunta.textContent = contenido.pregunta;
      $('dist-captcha-respuesta').value = '';
      // Textos legales de la marca (con reserva en la propia página)
      if (contenido.textos && contenido.textos.legal) {
        $('dist-texto-legal').innerHTML = String(contenido.textos.legal);
      }
      if (contenido.textos && contenido.textos.privacidad) {
        $('dist-texto-privacidad').innerHTML = String(contenido.textos.privacidad);
      }
    } else {
      pregunta.textContent = 'No disponible';
    }
  }

  // ─── Paso 1 ───────────────────────────────────────────────────────────────
  $('dist-captcha-refrescar').addEventListener('click', cargarCaptcha);
  $('dist-volver-1').addEventListener('click', () => mostrar('dist-paso-1'));

  $('dist-form-1').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    aviso('dist-aviso-1', '');
    const email = $('dist-email').value.trim();
    const persona = $('dist-persona').value.trim();
    const telefono = $('dist-telefono').value.trim();
    const respuestaCaptcha = $('dist-captcha-respuesta').value.trim();

    if (!email || !persona || !telefono) {
      aviso('dist-aviso-1', 'El correo, la persona de contacto y el teléfono son obligatorios.', 'error');
      return;
    }
    if (!respuestaCaptcha) {
      aviso('dist-aviso-1', 'Resuelve la comprobación de seguridad para continuar.', 'error');
      return;
    }

    const boton = $('dist-form-1').querySelector('button[type="submit"]');
    boton.disabled = true;
    const { ok, contenido } = await llamar('solicitar', {
      email,
      personaContacto: persona,
      telefono,
      captcha: captcha ? { ...captcha, respuesta: respuestaCaptcha } : null,
      web: $('dist-web').value,
    });
    boton.disabled = false;

    if (ok) {
      $('dist-espera-texto').textContent =
        contenido.mensaje || 'Te hemos enviado un mensaje para confirmar tu dirección. El enlace dura 24 horas.';
      mostrar('dist-paso-espera');
    } else {
      aviso('dist-aviso-1', contenido.error || 'No se pudo enviar. Inténtalo de nuevo.', 'error');
      cargarCaptcha();
    }
  });

  // ─── Paso 2 (llega desde el correo: ?verificar=token) ────────────────────
  async function iniciarVerificacion(token) {
    tokenVerificado = '';
    mostrar('dist-paso-2');
    const zonaEmail = $('dist-email-verificado');
    zonaEmail.textContent = 'Confirmando tu correo…';
    const { ok, contenido } = await llamar('verificar', { token });
    if (ok) {
      tokenVerificado = token;
      zonaEmail.textContent = `Correo confirmado: ${contenido.email}. Completa la solicitud a continuación (tarda unos minutos).`;
      // Datos ya recogidos en el paso 1: llegan rellenados desde el servidor
      const borrador = leerBorrador();
      if (String(contenido.personaContacto || '').trim() && !$('d2-persona').value.trim()) {
        $('d2-persona').value = String(contenido.personaContacto).trim();
      }
      if (String(contenido.telefono || '').trim() && !$('d2-telefono').value.trim()) {
        $('d2-telefono').value = String(contenido.telefono).trim();
      }
      restaurarCampos(borrador?.datos);
      guardarBorrador();
      // Limpiar el token de la barra de direcciones para evitar reenvíos accidentales
      try {
        window.history.replaceState({}, '', 'distribuidores.html');
      } catch {}
    } else {
      zonaEmail.textContent = '';
      aviso('dist-aviso-2', contenido.error || 'El enlace no es válido.', 'error');
      borrarTokenBorrador();
      $('dist-form-2').querySelector('button[type="submit"]').disabled = true;
    }
  }

  const marcados = (contenedorId, maximo) => {
    const valores = Array.from($(contenedorId).querySelectorAll('input:checked')).map((c) => c.value);
    if (maximo && valores.length > maximo) return { error: `Máximo ${maximo} opciones.`, valores: [] };
    return { valores };
  };

  $('dist-form-2').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    aviso('dist-aviso-2', '');

    if (!tokenVerificado) {
      aviso('dist-aviso-2', 'Tu correo aún no está confirmado. Abre el enlace del email de verificación.', 'error');
      return;
    }

    const f = (id) => $(id).value.trim();
    const faltan = [];
    if (!f('d2-empresa')) faltan.push('nombre comercial');
    if (!f('d2-persona')) faltan.push('persona de contacto');
    if (!f('d2-telefono')) faltan.push('teléfono');
    if (!f('d2-calle')) faltan.push('dirección');
    if (!f('d2-cp')) faltan.push('código postal');
    if (!f('d2-poblacion')) faltan.push('población');
    if (!f('d2-provincia')) faltan.push('provincia');
    if (!$('d2-legal').checked || !$('d2-privacidad').checked) faltan.push('aceptar los avisos legales y la protección de datos');
    if (faltan.length > 0) {
      aviso('dist-aviso-2', `Faltan campos obligatorios: ${faltan.join(', ')}.`, 'error');
      return;
    }

    const motivaciones = marcados('d2-motivaciones', 3);
    if (motivaciones.error) {
      aviso('dist-aviso-2', `Motivación principal: ${motivaciones.error}`, 'error');
      return;
    }

    const boton = $('dist-form-2').querySelector('button[type="submit"]');
    boton.disabled = true;
    const recogidos = camposFormulario();
    const { ok, contenido } = await llamar('completar', {
      token: tokenVerificado,
      legalAceptado: $('d2-legal').checked,
      privacidadAceptado: $('d2-privacidad').checked,
      datos: {
        ...recogidos,
        direccion: {
          calle: recogidos.calle,
          cp: recogidos.cp,
          poblacion: recogidos.poblacion,
          provincia: recogidos.provincia,
          pais: recogidos.pais,
        },
      },
    });
    boton.disabled = false;

    if (ok) {
      try { localStorage.removeItem(CLAVE_BORRADOR); } catch {}
      mostrar('dist-paso-gracias');
    } else {
      aviso('dist-aviso-2', contenido.error || 'No se pudo enviar la solicitud. Inténtalo de nuevo.', 'error');
    }
  });

  // Autoguardado: cualquier cambio del formulario queda guardado al momento
  $('dist-form-2').addEventListener('input', guardarBorrador);
  $('dist-form-2').addEventListener('change', guardarBorrador);

  // ─── Arranque ─────────────────────────────────────────────────────────────
  const parametros = new URLSearchParams(window.location.search);
  const tokenUrl = (parametros.get('verificar') || '').trim();
  const borrador = leerBorrador();
  if (tokenUrl.length === 64) {
    iniciarVerificacion(tokenUrl);
  } else if (borrador?.token && String(borrador.token).length === 64) {
    // Recarga o vuelta atrás con el correo ya confirmado: se recupera el
    // formulario con todo lo escrito (el servidor revalida el enlace).
    iniciarVerificacion(borrador.token);
  } else {
    cargarCaptcha();
  }
})();
