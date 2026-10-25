# Instalar con Codex

En Codex para Windows, pide:

> Instala el MCP https://github.com/vincentbenavides145-create/sunat-mcp en mi equipo. Lee AGENTS.md, ejecuta install.ps1, verifica la instalación y activa la integración en Codex.

Codex debe descargar o clonar la rama `main`, revisar el instalador y ejecutarlo. Para obtener estos cambios usa [Code → Download ZIP](https://github.com/vincentbenavides145-create/sunat-mcp/archive/refs/heads/main.zip) o clona el repositorio; una release anterior puede no incluir el instalador.

## Qué hace automáticamente

1. Detecta Node.js y Brave; instala los que falten mediante WinGet. Requiere Windows 10/11 y Codex instalado. Node 22/24 son las versiones comprobadas.
2. Ejecuta `npm ci` y crea `.env` si falta, sin reemplazar valores existentes.
3. Configura CDP si detecta un endpoint local de Brave verificado. Si no hay uno, una instalación nueva usa UI Automation, que puede activar Brave. No habilita depuración, abre perfiles ni reinicia el navegador.
4. Comprueba el servidor y sus siete herramientas por stdio, con datos temporales aislados y sin conectar el navegador.
5. Instala la skill SUNAT en el directorio de skills de Codex y registra `sunat_peru` con rutas absolutas. El registro usa la [CLI oficial de Codex](https://developers.openai.com/codex/mcp), sin editar manualmente TOML.
6. Codex verifica la instalación con `npm run setup:check` y recarga las integraciones mediante los controles disponibles del cliente. Si este no permite recargarlas en la conversación actual, debe indicar que la activación requiere una nueva sesión; el registro queda preparado.

No tienes que copiar `.env.example` ni `codex-mcp.example.toml`. Esos archivos siguen siendo plantillas para instalaciones manuales u otros clientes MCP.

## Comando del instalador

Lo ejecuta Codex desde la carpeta descargada:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ./install.ps1
```

Si Node y npm ya están disponibles, también puede usar `npm run setup`. La comprobación posterior `npm run setup:check` no instala, no modifica archivos ni solicita depuración.

`-Mode auto` es el valor predeterminado. `-Mode uia` o `-Mode hybrid` eligen el modo al crear una configuración nueva; una configuración existente se conserva. Para cambiarla después, consulta la [navegación híbrida](navegacion-hibrida.md).

## Datos y reinstalaciones

El instalador conserva `.env`, bóveda, trabajos y otras integraciones de Codex. Antes de agregar una entrada, guarda una copia de `config.toml` dentro del directorio local de Codex. No imprime esa configuración ni los secretos. La skill solo se actualiza si su contenido anterior sigue siendo el que instaló este proyecto; una skill ajena o editada por el usuario se conserva y se informa el conflicto.

Si las dependencias ya coinciden con el lockfile y el runtime verificados por el instalador, se reutilizan. Si hace falta reinstalarlas y hay un servidor dueño de la sesión Brave, se detiene la instalación: Codex debe terminar o pausar el trabajo y detener ese servidor antes de continuar. No se repiten registros inciertos: se consulta lo que quedó guardado. Una entrada deshabilitada o perteneciente a otra instalación no se sustituye automáticamente.

## Lo que requiere al usuario

Windows puede solicitar permisos al instalar programas. Brave puede pedir autorización de depuración si se usa CDP. CAPTCHA, OTP y la elección entre cuentas ambiguas se completan personalmente; no son pasos de edición de configuración.

Abre tu Brave habitual para operar. El login puede usar una única credencial guardada o cuentas importadas desde una planilla local. Las credenciales API son opcionales para navegar y consultar guías; validación CPE y comprobación de acceso SIRE necesitan las credenciales correspondientes. El instalador no las inventa ni importa cuentas por su cuenta.

El instalador no garantiza la compatibilidad de todas las versiones de Codex/Brave. Si WinGet no está disponible, Codex debe resolver los requisitos desde sus distribuidores oficiales; si la CLI de Codex no existe o una política administrada bloquea la instalación, debe informar ese impedimento concreto.

## Desarrollo y problemas

Las comprobaciones de desarrollo están en [CONTRIBUTING.md](../CONTRIBUTING.md). La [referencia MCP](referencia-mcp.md) conserva los parámetros de herramientas, cuentas y trabajos. Para otros clientes existe la [plantilla de registro](../codex-mcp.example.toml).

La bóveda y los trabajos están bajo `%LOCALAPPDATA%\SUNAT MCP\`. DPAPI está ligado al usuario Windows: conserva juntos bóveda y ledger. No los copies al repositorio. Las lecturas y capturas se comparten con el cliente de IA.

Reporta problemas con versiones y códigos saneados, sin datos de cuentas ni capturas reales. Consulta [SECURITY.md](../SECURITY.md) para vulnerabilidades y límites de seguridad.
