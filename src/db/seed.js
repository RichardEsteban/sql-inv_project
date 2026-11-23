// Dataset semilla determinista (PRNG con semilla fija): 9 tablas, ~8 000 registros.
import { DDL, RESET_ORDER } from './schema.js';
import { hashPassword } from '../security/auth.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALMACENES = [
  ['Almacén Lima Centro', 'Lima', 'Costa', 12000],
  ['Almacén Callao Puerto', 'Callao', 'Costa', 20000],
  ['Almacén Arequipa Sur', 'Arequipa', 'Sur', 9000],
  ['Almacén Trujillo Norte', 'Trujillo', 'Norte', 8000],
  ['Almacén Cusco Andino', 'Cusco', 'Sierra', 6000],
];

const CATEGORIAS = {
  Electrónica: ['Cable HDMI', 'Cargador USB', 'Auriculares', 'Mouse óptico', 'Teclado', 'Parlante'],
  Herramientas: ['Taladro', 'Martillo', 'Destornillador', 'Alicate', 'Llave inglesa', 'Sierra'],
  Ferretería: ['Tornillo', 'Clavo', 'Perno', 'Tuerca', 'Arandela', 'Bisagra'],
  Limpieza: ['Detergente', 'Lejía', 'Desinfectante', 'Escoba', 'Trapeador', 'Esponja'],
  Oficina: ['Cuaderno', 'Lapicero', 'Folder', 'Grapadora', 'Resaltador', 'Papel bond'],
  Alimentos: ['Arroz', 'Azúcar', 'Fideos', 'Aceite', 'Harina', 'Atún'],
  Bebidas: ['Agua mineral', 'Gaseosa', 'Jugo', 'Cerveza', 'Té helado', 'Energizante'],
  Textil: ['Polo', 'Pantalón', 'Casaca', 'Gorro', 'Guantes', 'Bufanda'],
  Seguridad: ['Casco', 'Chaleco', 'Lentes', 'Extintor', 'Botas', 'Mascarilla'],
  Embalaje: ['Caja cartón', 'Cinta adhesiva', 'Stretch film', 'Bolsa', 'Pallet', 'Zuncho'],
};
const PAISES = ['Perú', 'Chile', 'México', 'China', 'Brasil', 'Colombia', 'EE.UU.'];
const VARIANTES = ['Básico', 'Pro', 'Industrial', 'Eco', 'Premium', 'XL', 'Mini', 'Plus'];

const isoDay = (d) => d.toISOString().slice(0, 10);

export async function seedDatabase(adapter, { reset = true, seed = 20261123, today = new Date() } = {}) {
  const rnd = mulberry32(seed);
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (arr) => arr[int(0, arr.length - 1)];

  if (reset) for (const t of RESET_ORDER) await adapter.exec(`DROP TABLE IF EXISTS ${t}`);
  for (const stmt of DDL) await adapter.exec(stmt);

  await adapter.transaction(async (tx) => {
    const ins = (sql, params) => tx.run(sql, params);

    for (const [i, a] of ALMACENES.entries()) {
      await ins('INSERT INTO almacenes (id, nombre, ciudad, region, capacidad) VALUES (?, ?, ?, ?, ?)', [i + 1, ...a]);
    }
    const catNames = Object.keys(CATEGORIAS);
    for (const [i, n] of catNames.entries()) {
      await ins('INSERT INTO categorias (id, nombre) VALUES (?, ?)', [i + 1, n]);
    }
    const NPROV = 25;
    for (let i = 1; i <= NPROV; i++) {
      await ins('INSERT INTO proveedores (id, nombre, pais) VALUES (?, ?, ?)', [i, `Proveedor ${String(i).padStart(2, '0')} S.A.C.`, pick(PAISES)]);
    }

    // Productos (400)
    const productos = [];
    let pid = 1;
    for (const [ci, cat] of catNames.entries()) {
      for (const base of CATEGORIAS[cat]) {
        for (let v = 0; v < 7 && productos.length < 420; v++) {
          if (rnd() < 0.05) continue;
          const costo = Math.round((2 + rnd() * rnd() * 300) * 100) / 100;
          const precio = Math.round(costo * (1.15 + rnd() * 0.6) * 100) / 100;
          const p = { id: pid, sku: `SKU-${String(ci + 1).padStart(2, '0')}-${String(pid).padStart(4, '0')}`, nombre: `${base} ${VARIANTES[v]}`, cat: ci + 1, prov: int(1, NPROV), precio, costo };
          productos.push(p);
          await ins('INSERT INTO productos (id, sku, nombre, categoria_id, proveedor_id, precio_unitario, costo_unitario) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [p.id, p.sku, p.nombre, p.cat, p.prov, p.precio, p.costo]);
          pid++;
        }
      }
    }

    // Stock: cada producto en 3 a 5 almacenes
    let sid = 1;
    const stockPairs = [];
    for (const p of productos) {
      const almacenes = [1, 2, 3, 4, 5].sort(() => rnd() - 0.5).slice(0, int(3, 5));
      for (const a of almacenes) {
        const min = int(5, 60);
        await ins('INSERT INTO stock (id, almacen_id, producto_id, cantidad, stock_minimo) VALUES (?, ?, ?, ?, ?)',
          [sid++, a, p.id, int(0, 600), min]);
        stockPairs.push([a, p]);
      }
    }

    // Movimientos (6 000) sobre pares (almacén, producto) que existen en stock
    for (let m = 1; m <= 6000; m++) {
      const [a, p] = pick(stockPairs);
      const r = rnd();
      const tipo = r < 0.35 ? 'ENTRADA' : r < 0.9 ? 'SALIDA' : 'AJUSTE';
      const cant = int(1, 120);
      const fecha = new Date(today.getTime() - int(0, 364) * 86400000);
      await ins('INSERT INTO movimientos (id, producto_id, almacen_id, tipo, cantidad, fecha, costo_total) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [m, p.id, a, tipo, cant, isoDay(fecha), Math.round(cant * p.costo * 100) / 100]);
    }

    // Usuarios de demostración (contraseñas documentadas en el README: solo para desarrollo)
    const users = [
      ['admin', 'admin123', 'admin', null],
      ['operario1', 'oper123', 'operario', 1],
      ['operario2', 'oper123', 'operario', 2],
      ['consulta', 'cons123', 'consulta', null],
    ];
    for (const [i, [u, pw, rol, alm]] of users.entries()) {
      await ins('INSERT INTO usuarios (id, username, password_hash, rol, almacen_id) VALUES (?, ?, ?, ?, ?)', [i + 1, u, hashPassword(pw), rol, alm]);
    }

    // Políticas de acceso expresadas en SQL (RLS emulada + column-level security)
    const pol = [
      ['operario', 'stock', '{t}.almacen_id = :almacen_id', null],
      ['operario', 'movimientos', '{t}.almacen_id = :almacen_id', 'costo_total'],
      ['operario', 'almacenes', '{t}.id = :almacen_id', null],
      ['operario', 'productos', null, 'costo_unitario'],
      ['consulta', 'productos', null, 'costo_unitario'],
      ['consulta', 'movimientos', null, 'costo_total'],
    ];
    for (const [i, row] of pol.entries()) {
      await ins('INSERT INTO politicas_acceso (id, rol, tabla, predicado, columnas_ocultas) VALUES (?, ?, ?, ?, ?)', [i + 1, ...row]);
    }
  });

  const counts = {};
  for (const t of ['almacenes', 'categorias', 'proveedores', 'productos', 'stock', 'movimientos', 'usuarios', 'politicas_acceso']) {
    counts[t] = Number((await adapter.all(`SELECT COUNT(*) AS n FROM ${t}`))[0].n);
  }
  counts.total = Object.values(counts).reduce((a, b) => a + b, 0);
  return counts;
}
