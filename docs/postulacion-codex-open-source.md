# Preparación para Codex for Open Source

Este documento registra los requisitos oficiales de la convocatoria y el estado conocido del proyecto para preparar una postulación honesta. No implica que el proyecto ya cumpla los criterios ni garantiza selección.

Fuentes oficiales consultadas el 21 de octubre de 2026:

- [Codex for Open Source: programa y criterios](https://developers.openai.com/community/codex-for-oss)
- [Formulario oficial de postulación](https://openai.com/form/codex-for-oss/)

## Requisitos del formulario

- Perfil de GitHub con visibilidad pública.
- URL de un repositorio de GitHub público.
- Indicar si quien postula es maintainer principal o core maintainer.
- Explicar por qué el proyecto califica, en un máximo de 500 caracteres. OpenAI menciona uso, adopción, importancia para el ecosistema y actividad de mantenimiento; pueden servir estrellas, descargas, revisión de pull requests, atención de issues y lanzamientos.
- Indicar si interesa Codex Security o créditos de API.
- ID de organización de OpenAI.
- Explicar el uso previsto de los créditos de API, hasta 500 caracteres.
- Completar nombre, apellido y correo asociado a la cuenta de ChatGPT. El campo adicional es opcional y admite hasta 500 caracteres.

OpenAI acepta solicitudes de maintainers de proyectos OSS activos, revisa las postulaciones de forma continua y recomienda explicar la importancia del proyecto si no encaja claramente con sus criterios. Los beneficios descritos son seis meses de ChatGPT Pro con Codex, posibles créditos de API y acceso condicional a Codex Security; la selección y el acceso a seguridad no están garantizados.

## Estado verificado del proyecto

| Elemento | Estado conocido | Próximo paso |
| --- | --- | --- |
| Código y propósito identificables | MCP local en TypeScript para navegar SUNAT en Brave nativo y consultar un servicio oficial | Mantener README claro y limitar el alcance a funciones reales y verificadas |
| Repositorio Git local | Primer commit local en `main` con archivos revisados | Consultar `git log` para el historial real |
| Repositorio GitHub público | [sunat-mcp](https://github.com/vincentbenavides145-create/sunat-mcp) creado el 23/10/2026; preparar el primer envío de código | Publicar el commit revisado y verificar Windows CI antes de postular |
| Perfil GitHub público | [vincentbenavides145-create](https://github.com/vincentbenavides145-create), cuenta conectada y titular del repositorio | Mantener el perfil y rol de maintainer verificables |
| Rol del postulante | El usuario confirma ser maintainer principal | Respaldar el rol con el historial de commits, releases y mantenimiento público cuando exista |
| Licencia OSS | MIT añadida en `LICENSE` | Revisar que el nombre de copyright de contributors sea aceptable para la publicación |
| Plataforma | Windows 10/11; el paquete npm y el proceso MCP rechazan otros sistemas | Indicar Windows como único sistema soportado en GitHub y documentación |
| Privacidad de credenciales | `.env` está excluido por `.gitignore`; `.env.example` contiene valores vacíos | Antes de publicar, comprobar que ningún secreto, dato SUNAT o sesión se añadió al historial |
| Configuración de Codex | La plantilla usa un marcador genérico de ruta local | Cada persona debe reemplazar `C:/RUTA/A/SUNAT-MCP` después de clonar |
| Verificación y CI | Suite automática de navegación sintética, aprobación, aprendizaje, DPAPI y protocolo MCP; TypeScript y GitHub Actions sobre Windows | Mantener separadas estas pruebas de los recorridos reales en SUNAT |
| Mantenimiento público | No hay historial público de issues, pull requests o releases todavía | Registrar trabajo real, responder issues y publicar releases verificables |
| Uso y adopción | No hay métricas públicas disponibles todavía | Recopilar uso voluntario y verificable; no publicar datos fiscales o de cuenta |

La propiedad `private: true` de `package.json` bloquea la publicación accidental en npm; no vuelve privado un repositorio de GitHub. Se puede conservar si el proyecto se distribuye desde GitHub y no se publica en npm.

## Evidencia que conviene preparar

1. URL pública del repositorio y perfil público de GitHub.
2. Licencia elegida y documentación de instalación que funcione desde una clonación limpia.
3. Historial de cambios, issues atendidos, pull requests revisados y releases reales.
4. Evidencia de uso o una explicación concreta de la importancia del flujo SUNAT para quienes necesitan automatizar su navegación local con aprobación humana.
5. Un plan verdadero para usar créditos de API en mantenimiento del proyecto, por ejemplo revisión de pull requests, clasificación de issues o automatización de releases. No afirmar que esos flujos existen hasta implementarlos.
6. Texto breve para cada respuesta de 500 caracteres y el ID de organización de OpenAI, completados por la persona postulante.

## Límites de la postulación

- No afirmar que SUNAT respalda o patrocina el MCP.
- No presentar el catálogo de operaciones como procedimientos verificados si no se recorrieron y confirmaron en la interfaz.
- No incluir RUC, Clave SOL, tokens, cookies, declaraciones, pagos, capturas de una cuenta real ni otros datos fiscales en el repositorio o en evidencias públicas.
- La experiencia de un usuario no debe presentarse como adopción amplia. Usar métricas solo cuando existan y puedan comprobarse.
