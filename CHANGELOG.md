# Historial de cambios

## En desarrollo

- Instalador para Codex en Windows: requisitos con WinGet, dependencias, configuración automática, skill global y registro por CLI. Verifica stdio sin conectar Brave y conserva otras integraciones, archivos privados y cambios del usuario.
- Las rutas revelan un enlace único fuera de vista y releen la página antes de continuar, conservando las comprobaciones de sesión y aprobación.
- El aprendizaje exige evidencia de menú y excluye botones y campos de formulario; las rutas antiguas no válidas se retiran en la siguiente escritura local.
- Se reconocen los avisos de registro de empleador y validación de afectación para detener la navegación del servicio.
- Se amplían las regresiones a 140 pruebas, incluidas instalación, conservación de configuración y rutas Windows con símbolos. Se documentan [20 casos de navegación y consulta](docs/pruebas-operaciones-comunes-2026-10-25.md), sus límites y una incidencia de lectura tras el login aún sin causa determinada.

## 0.1.0-alpha.1 — 2026-10-25

Primera distribución pública del código bajo licencia MIT. Versión alfa para Windows; no certifica todos los flujos ni elegibilidad de cuentas.

- Navegación híbrida sobre Brave existente: CDP local para la web y UI Automation para credenciales y controles nativos.
- Conexión CDP persistente, creación de pestaña SUNAT en segundo plano cuando falta y accesos SOL separados en la misma pestaña.
- Rutas observadas, biblioteca de guías y aprendizaje local genérico, sin almacenar formularios ni datos fiscales.
- Bóveda DPAPI, comprobación de cuenta y trabajos con protección ante duplicados, aprobaciones de un solo uso y resultados inciertos.
- Correcciones de validación NPS, animaciones y padres expandidos, carga tardía de marcos, acceso anual y avisos de obligación SIRE.
- Documentación de instalación, contribución, seguridad, plantillas y controles automáticos para publicación.
- Pruebas nativas serializadas, entorno de perfil Windows conservado y plazo acotado de DPAPI ajustado para el inicio en un Windows limpio; los procesos de prueba tienen terminación ante vencimiento de plazo.
- Carga directa de las clases .NET para DPAPI y del módulo local de seguridad para migrar bóvedas antiguas, evitando la búsqueda automática de módulos.

### Evidencia y limitaciones

Se comprobaron once casos de navegación/consulta; véase el [informe](docs/pruebas-navegacion-2026-10-25.md). La entrada de Renta Empresas no acredita apertura del 710. Los avisos de acceso u obligación detienen SIRE y detracciones. Las pruebas de esta revisión no emitieron, presentaron ni pagaron operaciones. La selección de múltiples clientes y el aislamiento lógico se prueban con datos sintéticos; falta una validación completa entre cuentas reales autorizadas. No se implementan operaciones SIRE por API más allá de comprobar autenticación/scope.
