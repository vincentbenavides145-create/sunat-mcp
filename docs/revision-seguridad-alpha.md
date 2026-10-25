# Revisión previa a la primera alfa — 25/10/2026

Revisión local del código y de los archivos candidatos de distribución. No es una certificación ni una auditoría independiente. No se probaron envíos tributarios reales para esta publicación.

## Superficies y permisos

| Herramienta | Capacidad efectiva y límite |
|---|---|
| sunat_estado | Lectura de configuración/estado local; con cuenta, red oficial para verificar autenticación/scope SIRE. No consulta registros SIRE |
| sunat_iniciar_sesion | Acceso a credenciales locales y entrada nativa; modifica la sesión Brave. No devuelve Clave SOL ni elige entre cuentas ambiguas |
| sunat_brave_ejecutar_lote | Navegación, consultas y mutaciones tributarias protegidas. La anotación declara capacidad potencialmente destructiva; el servidor exige trabajo y aprobación de un uso solo para el envío efectivo |
| sunat_brave_captura | Lectura visual de la página SUNAT; la imagen puede contener datos privados y se entrega al cliente MCP, sin incorporarse al repositorio |
| sunat_validar_comprobante | Red oficial para consultar validez CPE; credenciales de API por configuración local |
| sunat_guias | Lectura de procedimientos genéricos y fuentes locales; sin acceso a cuentas |
| sunat_trabajos | Escritura de ledger local, estados e HMACs. La conciliación requiere cuenta/página verificadas y aprobación humana; no ejecuta por sí misma un reenvío |

## Comprobaciones y cambios

- Transporte MCP por stdio. No se añadió un servidor HTTP/SSE ni un acceso remoto a la sesión.
- CDP limitado a loopback con comprobación del proceso Brave; URL SUNAT por HTTPS, referencias ligadas al documento y operaciones DOM fijas. No acepta JavaScript suministrado por el modelo.
- Credenciales DPAPI y teclado nativo mediante stdin; sin secretos en argumentos. DPAPI recibe una lista acotada de variables de sistema y rutas estándar del perfil Windows, sin heredar variables de API. El script de entrada es código local fijo. El importador rechaza fórmulas y no se ofrece como herramienta remota.
- Identificadores de operador y trabajo validados; SQL con parámetros para entradas variables. La bóveda y el ledger se ligan para no reiniciar silenciosamente la deduplicación.
- Trabajos `submitting`/`uncertain` no se reenvían; la aprobación liga cuenta, formulario y control actual. Los errores CDP no disparan reconexiones ni entradas de respaldo.
- Se bloquean redirecciones HTTP en OAuth CPE, OAuth SIRE y consultas CPE para no reenviar cuerpos sensibles a otro destino. Se añadieron regresiones con red simulada.
- Se corrigió la anotación de la herramienta de lotes para declarar su capacidad máxima. Esto no añade confirmaciones internas a la navegación segura.
- `.env`, bóvedas, aprendizaje, exportaciones y bases locales se excluyen de Git. El control de archivos revisa la lista candidata, incluidos archivos rastreados aunque luego se ignoren.
- Gitleaks fijado por versión y SHA-256 revisa el historial completo y los archivos actuales. Los reportes temporales se redactan y la salida solo contiene regla, archivo, línea y commit.
- Lockfile, auditoría npm, Actions fijadas por commit, permisos CI de lectura y pruebas Windows sin cuentas reales. Dependabot propone actualizaciones para npm y Actions.

## Límites pendientes

El proceso y cliente MCP tienen la confianza del usuario Windows. DPAPI no aísla malware ejecutado por ese usuario. No hay aislamiento de varios humanos dentro de una sesión Brave. Las capturas y consultas autorizadas pueden revelar datos al cliente de IA; no existe anonimización universal de resultados. No se certificó una instalación interactiva ni cambio completo entre contribuyentes en otro equipo físico. El panel provisional y el acceso a cada servicio se vuelven a comprobar en vivo; las guías y pruebas sintéticas no acreditan elegibilidad.

Los manuales y videos oficiales se enlazan y resumen; sus contenidos de terceros no pasan a tener licencia MIT por estar citados aquí. La revisión y los resultados automáticos de cada commit se consultan en GitHub Actions.
