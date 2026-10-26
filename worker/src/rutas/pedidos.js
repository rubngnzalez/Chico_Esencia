// /api/pedidos (listado, detalle por id o número, cambio de estado admin)

import { requerirSesion, requerirRol } from '../seguridad.js';
import { validar, error400, error404, respuestaJson } from '../utilidades.js';

export const ESTADOS = ['pendiente', 'pagado', 'enviado', 'entregado', 'cancelado'];

export function registrar(enrutador, cx) {
  enrutador.get('/api/pedidos', async (c) => {
    const guard = requerirSesion(c);
    if (guard) return guard;
    const filtro = c.query.get('estado');
    let datos = await cx.coleccionPedidos.todo();
    if (filtro && ESTADOS.includes(filtro)) datos = datos.filter((p) => p.estado === filtro);
    datos.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    return respuestaJson({ datos, total: datos.length });
  });

  enrutador.get('/api/pedidos/:id', async (c) => {
    const guard = requerirSesion(c);
    if (guard) return guard;
    const pedido = (await cx.coleccionPedidos.leer()).find(
      (p) => p.id === c.params.id || p.numero === c.params.id
    );
    if (!pedido) return error404('Pedido no encontrado.');
    return respuestaJson({ dato: pedido });
  });

  enrutador.put('/api/pedidos/:id/estado', async (c) => {
    const guard = requerirRol(c, 'admin');
    if (guard) return guard;
    const pedido = (await cx.coleccionPedidos.leer()).find(
      (p) => p.id === c.params.id || p.numero === c.params.id
    );
    if (!pedido) return error404('Pedido no encontrado.');
    const comprobacion = validar(
      { estado: { tipo: 'texto', requerido: true, opciones: ESTADOS, etiqueta: 'el estado' } },
      c.cuerpo
    );
    if (!comprobacion.ok) return error400(comprobacion.errores);
    const actualizado = await cx.coleccionPedidos.modificar(pedido.id, {
      estado: comprobacion.datos.estado,
      estadoActualizadoEn: new Date().toISOString(),
    });
    return respuestaJson({ dato: actualizado });
  });
}
