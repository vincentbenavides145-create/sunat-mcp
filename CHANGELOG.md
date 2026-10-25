# Historial de cambios

## 0.1.0-alpha.1 — 2026-10-25

Primera distribución pública del código bajo licencia MIT. Versión alfa para Windows; no certifica todos los flujos ni elegibilidad de cuentas.

- Navegación híbrida sobre Brave existente: CDP local para la web y UI Automation para credenciales y controles nativos.
- Conexión CDP persistente, creación de pestaña SUNAT en segundo plano cuando falta y accesos SOL separados en la misma pestaña.
- Rutas observadas, biblioteca de guías y aprendizaje local genérico, sin almacenar formularios ni datos fiscales.
- Bóveda DPAPI, comprobación de cuenta y trabajos con protección ante duplicados, aprobaciones de un solo uso y resultados inciertos.
- Correcciones de validación NPS, animaciones y padres expandidos, carga tardía de marcos, acceso anual y avisos de obligación SIRE.
- Documentación de instalación, contribución, seguridad, plantillas y controles automáticos para publicación.
- Pruebas nativas serializadas y plazo acotado de DPAPI ajustado para el inicio en un Windows limpio; el proceso MCP de prueba se termina si vence su plazo.

### Evidencia y limitaciones

Se comprobaron once casos de navegación/consulta; véase el [informe](docs/pruebas-navegacion-2026-10-25.md). La entrada de Renta Empresas no acredita apertura del 710. Los avisos de acceso u obligación detienen SIRE y detracciones. Las pruebas de esta revisión no emitieron, presentaron ni pagaron operaciones. La selección de múltiples clientes y el aislamiento lógico se prueban con datos sintéticos; falta una validación completa entre cuentas reales autorizadas. No se implementan operaciones SIRE por API más allá de comprobar autenticación/scope.
