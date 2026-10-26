// Capa de acceso a D1: cada colección guarda el objeto completo como JSON
// (columna `datos`), igual que el servidor Node con sus ficheros JSON.
// Los métodos son asíncronos y replican la interfaz de src/almacen.js.

function parsearFila(fila) {
  if (!fila) return null;
  try {
    return JSON.parse(fila.datos);
  } catch {
    return null;
  }
}

export class Coleccion {
  constructor(db, nombre, columnasExtra = []) {
    this.db = db;
    this.nombre = nombre;
    this.columnasExtra = columnasExtra; // [['producto', 'producto'], ...] → [campoObjeto, columna]
  }

  async leer() {
    const { results } = await this.db.prepare(`SELECT datos FROM ${this.nombre}`).all();
    return results.map(parsearFila).filter(Boolean);
  }

  async todo() {
    return this.leer();
  }

  async porId(id) {
    if (!id) return null;
    const fila = await this.db
      .prepare(`SELECT datos FROM ${this.nombre} WHERE id = ?1`)
      .bind(id)
      .first();
    return parsearFila(fila);
  }

  async buscarPor(campo, valor) {
    const columna = this.columnasExtra.find(([c]) => c === campo);
    if (!columna) return null;
    const fila = await this.db
      .prepare(`SELECT datos FROM ${this.nombre} WHERE ${columna[1]} = ?1 LIMIT 1`)
      .bind(valor)
      .first();
    return parsearFila(fila);
  }

  async insertar(objeto, extra = {}) {
    const columnas = ['id', 'datos'];
    const valores = [objeto.id, JSON.stringify(objeto)];
    for (const [campo, columna] of this.columnasExtra) {
      columnas.push(columna);
      valores.push(extra[campo] !== undefined ? extra[campo] : (objeto[campo] ?? null));
    }
    const placeholders = columnas.map((_, i) => `?${i + 1}`).join(', ');
    await this.db
      .prepare(`INSERT INTO ${this.nombre} (${columnas.join(', ')}) VALUES (${placeholders})`)
      .bind(...valores)
      .run();
    return objeto;
  }

  async modificar(id, cambios) {
    const existente = await this.porId(id);
    if (!existente) return null;
    const actualizado = { ...existente, ...cambios, id, actualizadoEn: new Date().toISOString() };
    const sentencias = [
      this.db.prepare(`UPDATE ${this.nombre} SET datos = ?1 WHERE id = ?2`).bind(JSON.stringify(actualizado), id),
    ];
    for (const [campo, columna] of this.columnasExtra) {
      if (actualizado[campo] !== undefined) {
        sentencias.push(
          this.db.prepare(`UPDATE ${this.nombre} SET ${columna} = ?1 WHERE id = ?2`).bind(actualizado[campo], id)
        );
      }
    }
    await this.db.batch(sentencias);
    return actualizado;
  }

  async quitar(id) {
    const resultado = await this.db.prepare(`DELETE FROM ${this.nombre} WHERE id = ?1`).bind(id).run();
    return resultado.meta.changes > 0;
  }
}

export async function filaAObjeto(db, sql, ...valores) {
  const fila = await db
    .prepare(sql)
    .bind(...valores)
    .first();
  return parsearFila(fila);
}

export async function listaObjetos(db, sql, ...valores) {
  const { results } = await db
    .prepare(sql)
    .bind(...valores)
    .all();
  return results.map(parsearFila).filter(Boolean);
}

// ─── Ajustes: tabla clave/valor JSON con fusión por secciones ───────────────

function fusionarProfundo(base, cambios) {
  const resultado = { ...base };
  for (const [clave, valor] of Object.entries(cambios || {})) {
    if (
      valor &&
      typeof valor === 'object' &&
      !Array.isArray(valor) &&
      base[clave] &&
      typeof base[clave] === 'object' &&
      !Array.isArray(base[clave])
    ) {
      resultado[clave] = fusionarProfundo(base[clave], valor);
    } else {
      resultado[clave] = valor;
    }
  }
  return resultado;
}

export class Ajustes {
  constructor(db) {
    this.db = db;
  }

  async leer() {
    const { results } = await this.db.prepare('SELECT clave, valor FROM ajustes').all();
    const objeto = {};
    for (const fila of results) {
      try {
        objeto[fila.clave] = JSON.parse(fila.valor);
      } catch {}
    }
    return objeto;
  }

  async guardar(valor) {
    const sentencias = [];
    for (const [clave, seccion] of Object.entries(valor)) {
      sentencias.push(
        this.db
          .prepare(
            'INSERT INTO ajustes (clave, valor) VALUES (?1, ?2) ON CONFLICT(clave) DO UPDATE SET valor = ?2'
          )
          .bind(clave, JSON.stringify(seccion))
      );
    }
    if (sentencias.length) await this.db.batch(sentencias);
    return valor;
  }

  async fusionar(seccion, cambios) {
    const actual = await this.leer();
    const nuevo = fusionarProfundo(actual, { [seccion]: cambios });
    await this.guardar({ [seccion]: nuevo[seccion] });
    return nuevo;
  }
}
