# 2. Justificación del DSL

**Pregunta:** ¿por qué SQL (vía una capa de construcción dinámica) es mejor que JavaScript de propósito general para consultar inventarios?

| Criterio | JS puro (arreglos y bucles) | SQL como DSL |
|---|---|---|
| Declaratividad | Se escribe el *cómo*: índices, bucles, acumuladores, orden. | Se describe el *qué*; el motor elige el plan. |
| Volumen | Trae tablas completas a Node (`SELECT *`) y filtra allí. | Filtra, agrega y limita en el motor; solo viaja el resultado. |
| Legibilidad | 45 líneas y 8 pasos mentales (ver [03](03-demostracion-abstraccion.md)). | 10 líneas, una sola sentencia. |
| Seguridad | Construir condiciones con strings invita a la inyección. | Parámetros `?` + whitelist: las entradas nunca son código. |
| Políticas de acceso | Filtros repartidos en cada endpoint. | Un predicado SQL por rol y tabla, inyectado siempre. |
| Portabilidad | Acoplado a estructuras en memoria. | Cambiar de motor = cambiar el adaptador. |

El dominio (stock por almacén, rotación por categoría, movimientos) es de **agrupaciones y uniones entre varias tablas**, exactamente el problema para el que SQL fue diseñado.

**Uso idiomático del DSL en el proyecto:** `JOIN` automáticos derivados de claves foráneas, `GROUP BY` + `HAVING` con agregados (`SUM`, `COUNT`, `AVG`, `MIN`, `MAX`), filtros `IN`/`BETWEEN`/`LIKE`, y las dos gráficas del dashboard salen de agregaciones SQL.
