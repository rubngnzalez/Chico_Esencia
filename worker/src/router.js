// Enrutador mínimo (sin dependencias) para el Worker.
// Patrones tipo Express: '/api/productos/:id'. Coincidencia por segmentos;
// tolera barra final igual que Express (strict routing desactivado).

function segmentos(ruta) {
  return ruta.replace(/\/+$/, '').split('/').filter((s) => s !== '');
}

export class Router {
  constructor() {
    this.rutas = [];
  }

  add(metodo, patron, manejador) {
    this.rutas.push({ metodo: metodo.toUpperCase(), segmentos: segmentos(patron), patron, manejador });
    return this;
  }

  get(patron, manejador) {
    return this.add('GET', patron, manejador);
  }

  post(patron, manejador) {
    return this.add('POST', patron, manejador);
  }

  put(patron, manejador) {
    return this.add('PUT', patron, manejador);
  }

  delete(patron, manejador) {
    return this.add('DELETE', patron, manejador);
  }

  // Devuelve { manejador, params } o null si nada coincide
  resolver(metodo, ruta) {
    const partes = segmentos(ruta);
    for (const rutaDefinida of this.rutas) {
      if (rutaDefinida.metodo !== metodo.toUpperCase()) continue;
      if (rutaDefinida.segmentos.length !== partes.length) continue;
      const params = {};
      let coincide = true;
      for (let i = 0; i < partes.length; i++) {
        const patron = rutaDefinida.segmentos[i];
        if (patron.startsWith(':')) {
          try {
            params[patron.slice(1)] = decodeURIComponent(partes[i]);
          } catch {
            params[patron.slice(1)] = partes[i];
          }
        } else if (patron !== partes[i]) {
          coincide = false;
          break;
        }
      }
      if (coincide) return { manejador: rutaDefinida.manejador, params, patron: rutaDefinida.patron };
    }
    return null;
  }
}
