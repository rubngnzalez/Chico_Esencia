// Precios con ofertas (compartido por productos públicos y pagos)

export function ofertaActiva(oferta, ahoraMs) {
  if (!oferta.activa) return false;
  const inicio = oferta.inicio ? Date.parse(oferta.inicio) : 0;
  const fin = oferta.fin ? Date.parse(oferta.fin) : Infinity;
  return inicio <= ahoraMs && ahoraMs <= fin;
}

export function calcularPrecioEfectivo(producto, ofertas, ahoraMs = Date.now()) {
  let precio = Number(producto.precioOferta) > 0 ? Number(producto.precioOferta) : Number(producto.precio);
  const activas = ofertas.filter((o) => o.producto === producto.id && ofertaActiva(o, ahoraMs));
  for (const oferta of activas) {
    const base = Number(producto.precio) || 0;
    const valor = Number(oferta.valor) || 0;
    const candidato = oferta.tipo === 'porcentaje' ? base * (1 - valor / 100) : valor;
    if (candidato >= 0 && candidato < precio) precio = Math.round(candidato * 100) / 100;
  }
  return Math.round(precio * 100) / 100;
}
