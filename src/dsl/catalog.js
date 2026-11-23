// Catálogo = whitelist de tablas/columnas/relaciones + metamodelo del dominio.
// Es la ÚNICA fuente de identificadores SQL: ningún nombre que venga del cliente
// llega al SQL sin haber sido resuelto contra este objeto.

export const TYPES = { INTEGER: 'integer', NUMBER: 'number', TEXT: 'text', DATE: 'date' };

export const CATALOG = {
  almacenes: {
    label: 'Almacenes',
    columns: {
      id: { type: 'integer', label: 'ID' },
      nombre: { type: 'text', label: 'Nombre' },
      ciudad: { type: 'text', label: 'Ciudad' },
      region: { type: 'text', label: 'Región' },
      capacidad: { type: 'integer', label: 'Capacidad (uds)' },
    },
  },
  categorias: {
    label: 'Categorías',
    columns: {
      id: { type: 'integer', label: 'ID' },
      nombre: { type: 'text', label: 'Nombre' },
    },
  },
  proveedores: {
    label: 'Proveedores',
    columns: {
      id: { type: 'integer', label: 'ID' },
      nombre: { type: 'text', label: 'Nombre' },
      pais: { type: 'text', label: 'País' },
    },
  },
  productos: {
    label: 'Productos',
    columns: {
      id: { type: 'integer', label: 'ID' },
      sku: { type: 'text', label: 'SKU' },
      nombre: { type: 'text', label: 'Nombre' },
      categoria_id: { type: 'integer', label: 'Categoría (FK)' },
      proveedor_id: { type: 'integer', label: 'Proveedor (FK)' },
      precio_unitario: { type: 'number', label: 'Precio unitario' },
      costo_unitario: { type: 'number', label: 'Costo unitario' },
    },
  },
  stock: {
    label: 'Stock',
    columns: {
      id: { type: 'integer', label: 'ID' },
      almacen_id: { type: 'integer', label: 'Almacén (FK)' },
      producto_id: { type: 'integer', label: 'Producto (FK)' },
      cantidad: { type: 'integer', label: 'Cantidad' },
      stock_minimo: { type: 'integer', label: 'Stock mínimo' },
    },
  },
  movimientos: {
    label: 'Movimientos',
    columns: {
      id: { type: 'integer', label: 'ID' },
      producto_id: { type: 'integer', label: 'Producto (FK)' },
      almacen_id: { type: 'integer', label: 'Almacén (FK)' },
      tipo: { type: 'text', label: 'Tipo (ENTRADA/SALIDA/AJUSTE)' },
      cantidad: { type: 'integer', label: 'Cantidad' },
      fecha: { type: 'date', label: 'Fecha' },
      costo_total: { type: 'number', label: 'Costo total' },
    },
  },
};

// Relaciones FK permitidas para JOIN automático (el cliente NO escribe el ON).
export const RELATIONS = [
  { from: 'productos', fromCol: 'categoria_id', to: 'categorias', toCol: 'id' },
  { from: 'productos', fromCol: 'proveedor_id', to: 'proveedores', toCol: 'id' },
  { from: 'stock', fromCol: 'producto_id', to: 'productos', toCol: 'id' },
  { from: 'stock', fromCol: 'almacen_id', to: 'almacenes', toCol: 'id' },
  { from: 'movimientos', fromCol: 'producto_id', to: 'productos', toCol: 'id' },
  { from: 'movimientos', fromCol: 'almacen_id', to: 'almacenes', toCol: 'id' },
];

export const OPERATORS = {
  '=': { arity: 1 }, '!=': { arity: 1 }, '<': { arity: 1 }, '<=': { arity: 1 },
  '>': { arity: 1 }, '>=': { arity: 1 },
  LIKE: { arity: 1 }, 'NOT LIKE': { arity: 1 },
  IN: { arity: 'list' }, 'NOT IN': { arity: 'list' },
  BETWEEN: { arity: 2 },
  'IS NULL': { arity: 0 }, 'IS NOT NULL': { arity: 0 },
};

const NUM = ['=', '!=', '<', '<=', '>', '>=', 'BETWEEN', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL'];
export const OPS_BY_TYPE = {
  integer: NUM,
  number: NUM,
  text: ['=', '!=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL'],
  date: ['=', '!=', '<', '<=', '>', '>=', 'BETWEEN', 'IS NULL', 'IS NOT NULL'],
};

export const AGGREGATES = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
export const HAVING_OPS = ['=', '!=', '<', '<=', '>', '>=', 'BETWEEN'];
export const ORDER_DIRS = ['ASC', 'DESC'];

export const LIMITS = {
  MAX_ROWS: 1000,
  DEFAULT_ROWS: 200,
  MAX_SELECT: 20,
  MAX_JOINS: 5,
  MAX_CONDITIONS: 30,
  MAX_IN_LIST: 50,
  MAX_STRING: 200,
  // Niveles de anidamiento de grupos AND/OR: raíz (1) + subgrupo (2).
  MAX_WHERE_DEPTH: 2,
};

export const IDENT_RE = /^[a-z_][a-z0-9_]{0,40}$/;
export const ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;
