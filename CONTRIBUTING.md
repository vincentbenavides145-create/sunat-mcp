# Contribuir a SUNAT Perú MCP

Gracias por ayudar a mejorar el proyecto. La primera versión es alfa y funciona en Windows con el Brave existente. Empieza por la [instalación](docs/instalacion.md) y los [límites de seguridad](SECURITY.md).

## Preparar un cambio

1. Crea un fork y una rama para el cambio.
2. Instala las dependencias con `npm ci`. Usa datos sintéticos y una carpeta temporal para bóveda, trabajos y aprendizaje durante las pruebas.
3. Ejecuta `npm run check`, `npm test`, `npm run check:public` y `npm run check:secrets`.
4. Abre un pull request con el problema, comportamiento resultante, comprobaciones y límites pendientes. Las pruebas automáticas no necesitan credenciales ni una sesión SUNAT.

No ejecutes pruebas contra una cuenta real desde GitHub Actions. Nunca adjuntes Clave SOL, RUC/DNI reales, nombres de clientes, documentos, importes, periodos, capturas de sesiones, cookies, tokens, planillas o archivos DPAPI. Para explicar un fallo usa etiquetas genéricas, códigos de error saneados y datos inventados.

## Cambios de navegador y procedimientos

- Conserva una sola conexión CDP por proceso y la sesión Brave existente. Los errores no deben reconectar ni repetir clics inciertos.
- Mantén la separación entre navegación, preparación, envío y pago. Todo cambio tributario conserva la aprobación explícita de un solo uso y la comprobación de cuenta y formulario.
- Añade regresiones que reproduzcan un fallo relevante con páginas simuladas. No automatices emisiones ni pagos reales para probar una corrección.
- Una guía pública, una ruta observada y un trámite completado tienen evidencias distintas. Documenta únicamente lo comprobado y cita la fuente oficial cuando cambies procedimientos.
- Si cambias herramientas MCP, actualiza README, skill SUNAT y catálogo correspondiente. Evita herramientas duplicadas, servicios de fondo y almacenamiento de datos fiscales.
- Los documentos enlazados de terceros conservan sus derechos. Aporta resúmenes propios y referencias; no copies manuales o transcripciones completas.

## Reportar problemas

Usa las plantillas de issues para errores y propuestas. Describe Windows, Node, Brave, versión del proyecto, modo `hybrid` o `uia`, resultado esperado y código técnico. Revisa el texto antes de enviarlo. Las vulnerabilidades se comunican por el canal privado descrito en [SECURITY.md](SECURITY.md).

Las contribuciones al código se distribuyen bajo la [licencia MIT](LICENSE). Conserva los avisos de las dependencias y de los materiales de terceros.
