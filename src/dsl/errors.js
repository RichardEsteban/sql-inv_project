// Error de dominio del DSL. `status` se mapea directamente a HTTP.
export class DslError extends Error {
  constructor(code, message, status = 400, path = null) {
    super(message);
    this.name = 'DslError';
    this.code = code;
    this.status = status;
    this.path = path; // ruta dentro del AST (p. ej. "where.items[1].field")
  }
}
