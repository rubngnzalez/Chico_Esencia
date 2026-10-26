-- Migración inicial del Worker SHADDAI · Esencia de Umbral
-- Cada colección guarda el objeto completo en la columna `datos` (JSON),
-- igual que las colecciones JSON del servidor Node; las columnas escalares
-- existen para índices y búsquedas rápidas.
-- SIN datos semilla de usuarios: el primer admin se crea con /api/instalacion.

CREATE TABLE IF NOT EXISTS usuarios (
  id    TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  datos TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email);

CREATE TABLE IF NOT EXISTS productos (
  id     TEXT PRIMARY KEY,
  codigo TEXT,
  slug   TEXT,
  datos  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_productos_codigo ON productos (codigo);
CREATE INDEX IF NOT EXISTS idx_productos_slug   ON productos (slug);

CREATE TABLE IF NOT EXISTS categorias (
  id    TEXT PRIMARY KEY,
  slug  TEXT,
  datos TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_categorias_slug ON categorias (slug);

CREATE TABLE IF NOT EXISTS ofertas (
  id       TEXT PRIMARY KEY,
  producto TEXT NOT NULL,
  datos    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ofertas_producto ON ofertas (producto);

CREATE TABLE IF NOT EXISTS testimonios (
  id    TEXT PRIMARY KEY,
  datos TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS articulos (
  id     TEXT PRIMARY KEY,
  slug   TEXT,
  estado TEXT,
  datos  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_articulos_slug ON articulos (slug);
CREATE INDEX IF NOT EXISTS idx_articulos_estado ON articulos (estado);

CREATE TABLE IF NOT EXISTS mensajes (
  id    TEXT PRIMARY KEY,
  datos TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suscriptores (
  id    TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  datos TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suscriptores_email ON suscriptores (email);

CREATE TABLE IF NOT EXISTS campanas (
  id     TEXT PRIMARY KEY,
  estado TEXT,
  datos  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campanas_estado ON campanas (estado);

-- Registro de envío por destinatario de cada campaña
CREATE TABLE IF NOT EXISTS envios (
  id     TEXT PRIMARY KEY,
  campana TEXT NOT NULL,
  email  TEXT,
  datos  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_envios_campana ON envios (campana);

CREATE TABLE IF NOT EXISTS pedidos (
  id     TEXT PRIMARY KEY,
  numero TEXT,
  estado TEXT,
  datos  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_numero ON pedidos (numero);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos (estado);

-- Líneas de cada pedido (artículos con cantidad y precio unitario)
CREATE TABLE IF NOT EXISTS pedidos_lineas (
  id     TEXT PRIMARY KEY,
  pedido TEXT NOT NULL,
  datos  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pedidos_lineas_pedido ON pedidos_lineas (pedido);

-- Ajustes por secciones (clave/valor JSON): contacto, redes, smtp, redsys,
-- envio, emails-automaticos, notificaciones. La clave Redsys vive aquí,
-- NUNCA sale por la API salvo enmascarada.
CREATE TABLE IF NOT EXISTS ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Correos pendientes de envío (contenido .eml completo) cuando no hay
-- RESEND_API_KEY o el envío con Resend falla.
CREATE TABLE IF NOT EXISTS outbox (
  id       TEXT PRIMARY KEY,
  estado   TEXT NOT NULL,
  pedido   TEXT,
  campana  TEXT,
  creadoEn TEXT NOT NULL,
  datos    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_estado  ON outbox (estado);
CREATE INDEX IF NOT EXISTS idx_outbox_pedido  ON outbox (pedido);
CREATE INDEX IF NOT EXISTS idx_outbox_campana ON outbox (campana);

-- Rate-limit persistente: ventana por IP + ruta.
CREATE TABLE IF NOT EXISTS rate_limit (
  clave          TEXT PRIMARY KEY,
  intentos       INTEGER NOT NULL,
  ventanaInicio  INTEGER NOT NULL,
  bloqueadoHasta INTEGER NOT NULL DEFAULT 0,
  ultimo         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_ultimo ON rate_limit (ultimo);
