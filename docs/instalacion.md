# Instalar desde GitHub

Esta versión alfa funciona en Windows 10/11 con Node.js y Brave. El servidor MCP usa `stdio` y se ejecuta en tu equipo. Las pruebas de distribución cubren Node 22 y 24; usa una de esas versiones. No requiere desplegar un servidor ni crear cuentas en servicios de memoria.

## Obtener el proyecto

Descarga **Source code (zip)** desde [Releases](https://github.com/vincentbenavides145-create/sunat-mcp/releases) y descomprímelo en una carpeta propia. También puedes clonar el repositorio con GitHub Desktop. Abre una terminal en esa carpeta y ejecuta:

```powershell
npm ci
Copy-Item .env.example .env
```

`npm ci` utiliza el lockfile e instala WinApp, Playwright Core y SQLite nativo; no descarga un navegador. Si SQLite necesita compilar y no encuentra herramientas de compilación, usa Node 22/24 x64 con sus actualizaciones y vuelve a instalar. El soporte ARM64 no se ha validado de extremo a extremo.

El `.env` inicial permite configurar modo y puerto. Las variables de API CPE pueden quedar vacías si solo necesitas la navegación web. No coloques Clave SOL en ese archivo ni en la conversación.

## Elegir conexión con Brave

**Híbrido (`hybrid`)** usa CDP para trabajar en la web sin activar la pestaña. Requiere que tu instalación de Brave ya ofrezca un endpoint de depuración local autorizado y compatible. El MCP no habilita ese modo, reinicia Brave ni cambia sus ajustes por ti.

1. Comprueba en tu instalación la disponibilidad del acceso de depuración de Brave. El mecanismo y sus restricciones dependen de la versión y de las políticas del navegador.
2. Autoriza la conexión local cuando Brave lo solicite. Configura en `.env` el endpoint que realmente ofrezca; la plantilla contiene `http://127.0.0.1:9222` como ejemplo, no como garantía de que esté disponible.
3. Mantén el listener exclusivamente en loopback. No uses `0.0.0.0`, una IP de red, un proxy público ni un túnel.
4. Si tu Brave no permite esa conexión sobre el perfil existente, usa el modo nativo o espera soporte compatible. No copies cookies ni crees otro perfil para trasladar una sesión tributaria.

**Nativo (`uia`)** funciona sin CDP y puede activar Brave para operar. Para elegirlo cambia `SUNAT_BROWSER_MODE=uia` en `.env` y en la configuración MCP; las variables del cliente pueden prevalecer sobre `.env`. Mantén una única ventana Brave identificable y una sesión Windows interactiva desbloqueada para la entrada de teclado.

Una desconexión CDP detiene el flujo. Recarga el MCP cuando decidas iniciar otra conexión; puede volver a pedir autorización. No se promete un permiso permanente.

## Registrar en un cliente MCP

Copia [codex-mcp.example.toml](../codex-mcp.example.toml) a la configuración local de Codex, reemplazando `C:/RUTA/A/SUNAT-MCP` por tu carpeta. Conserva el comando `node`, los argumentos y el directorio de trabajo. Reinicia o recarga el servidor desde tu cliente. Otros clientes compatibles necesitan el mismo comando por `stdio` y soporte de solicitud de aprobación para los envíos tributarios; la compatibilidad con todos los clientes no está certificada.

La API y el navegador son capacidades distintas. Dejar vacías las credenciales API no impide consultar las guías locales.

## Primera comprobación

1. Abre Brave con tu perfil habitual y evita varias pestañas SUNAT durante la vinculación.
2. Solicita al asistente consultar una guía con `sunat_guias`, sin iniciar una operación tributaria.
3. Si necesitas diagnóstico, solicita `sunat_estado` con `comprobarNavegador:true`: comprueba el estado local, sin abrir una conexión CDP.
4. Solicita una consulta o navegación concreta. En híbrido, cuando falta la pestaña SUNAT el MCP abre el acceso oficial en segundo plano.
5. Para login, usa una única credencial guardada por Brave o importa una planilla local mediante `npm run sunat:importar-cuentas`. La planilla no se distribuye ni se sube a Git. Con varias cuentas importadas indica el nombre exacto de cliente. CAPTCHA/OTP se completan en Brave.

Las presentaciones, pagos, emisiones y anulaciones requieren una cuenta importada verificable, un trabajo y aprobación explícita del dato final. No uses una acción tributaria como prueba de instalación.

## Verificar el código sin entrar en SUNAT

```powershell
npm run check
npm test
npm run check:public
npm run check:secrets
npm audit
```

Las pruebas crean bóvedas y bases sintéticas en carpetas temporales. No necesitan Clave SOL, no navegan tu sesión ni presentan operaciones. Los comandos `check:public` y `check:secrets` son controles de desarrollo y publicación: requieren Git y una clonación completa, no un ZIP. La revisión de secretos descarga un ejecutable Gitleaks de la versión fijada y verifica su SHA-256 antes de ejecutarlo.

## Datos locales y problemas

La bóveda y los trabajos están bajo `%LOCALAPPDATA%\SUNAT MCP\`; no los copies al repositorio. Conserva juntos bóveda y ledger para evitar perder la historia de duplicados. DPAPI está ligado al usuario Windows. Los snapshots y capturas sí se comparten con el cliente de IA que utiliza las herramientas.

Si hay un problema, usa la plantilla de [issues](https://github.com/vincentbenavides145-create/sunat-mcp/issues/new/choose) con versiones y código de error saneado, sin datos de cuentas, documentos ni capturas reales. Para vulnerabilidades consulta [SECURITY.md](../SECURITY.md).
