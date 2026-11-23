# 5.1 Caso de uso principal

## UC-001: Construir y ejecutar una consulta de inventario

| Campo | Descripción |
|---|---|
| **ID** | UC-001 |
| **Actor principal** | Usuario autenticado (admin, operario o consulta) |
| **Actores secundarios** | Motor de base de datos (vía adaptador); módulo de auditoría |
| **Precondiciones** | 1) El usuario inició sesión con un rol válido. 2) El dataset semilla está cargado. 3) Existen políticas de acceso para el rol. |
| **Postcondiciones** | 1) El resultado muestra solo filas y columnas permitidas al rol. 2) El intento (ejecutado o rechazado) queda en auditoría. 3) Ningún valor del usuario se concatenó al SQL. |

### Flujo principal
1. El usuario elige la tabla base y, si hace falta, los JOIN.
2. Selecciona los campos y agregados.
3. Define las condiciones del WHERE (AND/OR anidados, hasta 2 niveles).
4. Define GROUP BY, HAVING, ORDER BY y LIMIT.
5. El sistema valida el AST y muestra el SQL parametrizado.
6. El usuario ejecuta.
7. El sistema agrega las políticas del rol, ejecuta y devuelve tabla y gráfico.

### Flujos alternos
- **5.a** El validador detecta tabla/columna no autorizada, patrón de inyección o tipo inválido: se rechaza con código de error y no se ejecuta nada.
- **5.b** La consulta supera los límites (profundidad, nº de condiciones, LIMIT): se rechaza.

## Reglas de negocio
- **RN-01** El usuario no escribe SQL; solo usa tablas y columnas del catálogo.
- **RN-02** Ningún valor del usuario se concatena al SQL; todos viajan como `?`.
- **RN-03** El WHERE admite grupos AND/OR anidados hasta 2 niveles.
- **RN-04** Toda columna no agregada del SELECT debe estar en GROUP BY; HAVING solo con agregados.
- **RN-05** El operario ve solo su almacén; consulta solo lee; admin ve todo.
- **RN-06** `costo_unitario` y `costo_total` están ocultas para operario y consulta (incluso para filtrar u ordenar).
- **RN-07** Toda consulta ejecutada o rechazada queda en auditoría.
- **RN-08** Una salida no puede dejar el stock negativo; el operario solo registra movimientos en su almacén.
