-- Recursos (imágenes subidas desde el panel) en la propia D1:
-- BLOB directo, servido por GET /recursos/<clave>. Límite práctico 2 MB.
CREATE TABLE IF NOT EXISTS recursos (
  clave  TEXT PRIMARY KEY,
  tipo   TEXT NOT NULL,
  bytes  BLOB NOT NULL,
  creado TEXT NOT NULL
);
