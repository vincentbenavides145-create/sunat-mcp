# SUNAT Perú MCP

Conecta tu IA con SUNAT desde Brave en Windows. Código abierto bajo licencia MIT; proyecto independiente, sin afiliación oficial con SUNAT.

**Alfa `0.1.0-alpha.1`** · [Instalar](docs/instalacion.md) · [Cambios](CHANGELOG.md) · [Contribuir](CONTRIBUTING.md)

## Qué permite

- Navegar SOL, consultar información y preparar formularios con asistencia de la IA.
- Consultar guías oficiales y reutilizar rutas aprendidas localmente.
- Gestionar trabajos de varios clientes por turnos, con comprobación de cuenta y protección ante envíos duplicados.
- Validar comprobantes mediante la API oficial, con sus credenciales configuradas.

## Instalar con Codex

En Codex para Windows 10/11, pide:

> Instala el MCP https://github.com/vincentbenavides145-create/sunat-mcp en mi equipo. Lee AGENTS.md, ejecuta install.ps1, verifica la instalación y activa la integración en Codex.

Codex instala los requisitos y dependencias, genera la configuración, incorpora la skill SUNAT y registra el MCP. No necesitas editar `.env` ni TOML. El instalador elige CDP si ya está disponible; en caso contrario configura el modo nativo.

Los permisos de Windows/Brave y el login son personales. Después puedes pedir «Ve a Consulta de NPS». [Instalación y límites](docs/instalacion.md).

## Navegación híbrida: CDP + UI Automation

**CDP** trabaja en una pestaña SUNAT en segundo plano. **UI Automation** gestiona el login y controles nativos, que pueden requerir foco.

Reutiliza tu Brave y una conexión persistente. Si falta una pestaña SUNAT, abre una en segundo plano. El modo híbrido requiere depuración local autorizada; ante una desconexión se detiene sin reconectar automáticamente.

[Configuración y funcionamiento técnico](docs/navegacion-hibrida.md).

## Herramientas MCP

| Herramienta | Función |
|---|---|
| `sunat_estado` | Diagnóstico local y comprobación de acceso API SIRE. |
| `sunat_iniciar_sesion` | Iniciar o reutilizar la sesión SOL. |
| `sunat_brave_ejecutar_lote` | Abrir accesos, seguir rutas y ejecutar acciones. |
| `sunat_brave_captura` | Capturar la página cuando sea necesario. |
| `sunat_validar_comprobante` | Consultar la validez de un comprobante. |
| `sunat_guias` | Buscar procedimientos y fuentes oficiales. |
| `sunat_trabajos` | Organizar trabajos y controlar su estado. |

Los parámetros y ejemplos están en la [referencia MCP](docs/referencia-mcp.md).

## Seguridad y límites

- Los envíos tributarios requieren cuenta importada verificada, trabajo y aprobación explícita de los datos finales.
- Las credenciales se cifran localmente con Windows DPAPI. Nunca compartas Clave SOL por chat ni subas datos privados a GitHub.
- Las lecturas y capturas se comparten con tu cliente de IA. Operadores simultáneos requieren sesiones Windows independientes.

Versión alfa con cobertura parcial: las guías y rutas no certifican todos los trámites ni el acceso de cada cuenta. Consulta [SECURITY.md](SECURITY.md).

## Documentación y pruebas

- [Instalación y solución de problemas](docs/instalacion.md).
- [Procedimientos oficiales](docs/procedimientos-publicos.md), [catálogo de operaciones](docs/catalogo-operaciones.md) y [fuentes documentales](docs/guias-oficiales.md).
- [Referencia de herramientas, clientes y aprendizaje](docs/referencia-mcp.md).
- [Skill SUNAT del proyecto](.agents/skills/sunat/SKILL.md).
- [Informe de 20 casos de navegación y consulta](docs/pruebas-operaciones-comunes-2026-10-25.md).

Pruebas automatizadas y comprobaciones en Windows con Node 22 y 24. Para desarrollo: `npm run check` y `npm test`.

## Licencia

[MIT](LICENSE).
