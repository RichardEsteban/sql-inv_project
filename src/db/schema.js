// DDL portable (SQLite y PostgreSQL): solo tipos compatibles en ambos motores.
export const DDL = [
  `CREATE TABLE IF NOT EXISTS almacenes (
    id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, ciudad TEXT NOT NULL,
    region TEXT NOT NULL, capacidad INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY, nombre TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS proveedores (
    id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, pais TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL,
    categoria_id INTEGER NOT NULL REFERENCES categorias(id),
    proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
    precio_unitario DOUBLE PRECISION NOT NULL, costo_unitario DOUBLE PRECISION NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS stock (
    id INTEGER PRIMARY KEY,
    almacen_id INTEGER NOT NULL REFERENCES almacenes(id),
    producto_id INTEGER NOT NULL REFERENCES productos(id),
    cantidad INTEGER NOT NULL, stock_minimo INTEGER NOT NULL,
    UNIQUE (almacen_id, producto_id))`,
  `CREATE TABLE IF NOT EXISTS movimientos (
    id INTEGER PRIMARY KEY,
    producto_id INTEGER NOT NULL REFERENCES productos(id),
    almacen_id INTEGER NOT NULL REFERENCES almacenes(id),
    tipo TEXT NOT NULL, cantidad INTEGER NOT NULL, fecha TEXT NOT NULL,
    costo_total DOUBLE PRECISION NOT NULL)`,
  // --- tablas de seguridad (NO están en la whitelist del DSL) ---
  `CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    rol TEXT NOT NULL, almacen_id INTEGER REFERENCES almacenes(id))`,
  `CREATE TABLE IF NOT EXISTS politicas_acceso (
    id INTEGER PRIMARY KEY, rol TEXT NOT NULL, tabla TEXT NOT NULL,
    predicado TEXT, columnas_ocultas TEXT)`,
  `CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, usuario TEXT NOT NULL, rol TEXT NOT NULL,
    accion TEXT NOT NULL, ok INTEGER NOT NULL, detalle TEXT)`,
  'CREATE INDEX IF NOT EXISTS ix_mov_prod ON movimientos(producto_id)',
  'CREATE INDEX IF NOT EXISTS ix_mov_alm ON movimientos(almacen_id)',
  'CREATE INDEX IF NOT EXISTS ix_stock_alm ON stock(almacen_id)',
];

// Orden inverso de dependencias para reinicializar.
export const RESET_ORDER = [
  'auditoria', 'politicas_acceso', 'usuarios', 'movimientos', 'stock',
  'productos', 'proveedores', 'categorias', 'almacenes',
];
