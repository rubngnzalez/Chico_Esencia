// /api/suscriptores (alta pública, listado admin/editor, exportar CSV con BOM)

import { requerirRol } from '../seguridad.js';
import { validar, error400, respuestaJson, ahora, nuevoId, ErrorEstado } from '../utilidades.js';

export function aCsv(lista) {
  const escapar = (valor) => `"${String(valor == null ? '' : valor).replace(/"/g, '""')}"`;
  const cabecera = ['email', 'nombre', 'etiquetas', 'fechaAlta', 'activo'].join(',');
  const filas = lista.map((s) =>
    [s.email, s.nombre || '', (s.etiquetas || []).join(' | '), s.fechaAlta || '', s.activo === false ? 'no' : 'si']
      .map(escapar)
      .join(',')
  );
  return '\uFEFF' + [cabecera, ...filas].join('\r\n');
}

export function registrar(enrutador, cx) {
  enrutador.get('/api/suscriptores', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const datos = (await cx.coleccionSuscriptores.todo()).sort((a, b) =>
      String(b.fechaAlta || '').localeCompare(String(a.fechaAlta || ''))
    );
    return respuestaJson({ datos, total: datos.length });
  });

  enrutador.get('/api/suscriptores/exportar', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const datos = await cx.coleccionSuscriptores.todo();
    const fecha = new Date().toISOString().slice(0, 10);
    return new Response(aCsv(datos), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="suscriptores-shaddai-${fecha}.csv"`,
      },
    });
  });

  enrutador.delete('/api/suscriptores/:id', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const suscriptor = await cx.coleccionSuscriptores.porId(c.params.id);
    if (!suscriptor) return respuestaJson({ error: 'Suscriptor no encontrado.' }, 404);
    await cx.coleccionSuscriptores.quitar(suscriptor.id);
    return respuestaJson({ ok: true });
  });
}

// Usada por /api/public/suscribirse y por las campañas: duplicados ignorados
export async function insertarSuscriptor(coleccionSuscriptores, datos) {
  const existente = (await coleccionSuscriptores.leer()).find((s) => s.email === datos.email);
  if (existente) return existente;
  return coleccionSuscriptores.insertar({
    id: nuevoId('sus'),
    email: datos.email,
    nombre: datos.nombre || '',
    etiquetas: datos.etiquetas || [],
    activo: true,
    fechaAlta: ahora(),
  }, { email: datos.email });
}
