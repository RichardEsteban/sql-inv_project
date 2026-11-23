// Fachada del DSL: AST -> validar (whitelist por rol) -> compilar (políticas + params).
import { validateQuery } from './validator.js';
import { compileQuery } from './compiler.js';
import { effectiveCatalog, loadPolicies } from '../security/policies.js';

export async function buildQuery(adapter, user, ast) {
  const policies = await loadPolicies(adapter, user.rol);
  const catalog = effectiveCatalog(policies);
  const normalized = validateQuery(ast, catalog);
  const ctx = { almacen_id: user.almacen_id, usuario_id: user.id };
  const compiled = compileQuery(normalized, { dialect: adapter.dialect, policies, ctx });
  return { ...compiled, normalized };
}

export async function runQuery(adapter, user, ast) {
  const built = await buildQuery(adapter, user, ast);
  const t0 = performance.now();
  const rows = await adapter.all(built.sql, built.params);
  const ms = Math.round((performance.now() - t0) * 100) / 100;
  return {
    sql: built.sql,
    params: built.params,
    policies: built.policies,
    columns: built.normalized.select.map((s) => ({ name: s.alias, type: s.type })),
    rows,
    rowCount: rows.length,
    ms,
  };
}
