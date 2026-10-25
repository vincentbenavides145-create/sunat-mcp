# Seguridad

SUNAT Perú MCP es una herramienta local de confianza para Windows. No es un servicio alojado ni un producto oficial de SUNAT. La versión alfa puede contener fallos; las correcciones se mantienen en `main` y en la última versión publicada. No existe todavía una rama con soporte prolongado ni un plazo garantizado de respuesta.

## Reportar una vulnerabilidad

Usa **Security → Advisories → Report a vulnerability** en [el repositorio](https://github.com/vincentbenavides145-create/sunat-mcp/security/advisories/new) si GitHub muestra esa opción. Este canal debe estar habilitado antes de publicar la versión alfa.

Si no está disponible, abre un issue titulado «Solicitud de canal privado de seguridad», sin detalles técnicos sensibles, y espera una vía privada del maintainer. No publiques una prueba que exponga cuentas reales ni credenciales. No envíes capturas de una sesión tributaria, archivos de bóveda, planillas o bases de trabajos, incluso por el canal privado. Reproduce el problema con datos sintéticos siempre que sea posible.

Indica versión/commit, Windows y Node, componente afectado, impacto y pasos mínimos de reproducción sin datos privados. Si se expuso una credencial, revócala o cámbiala en el servicio correspondiente; eliminarla del repositorio no la invalida.

## Límites de confianza

- El cliente MCP y el código local pueden acceder a lo que la cuenta Windows les permita. Ejecuta solo código y clientes de confianza.
- El transporte MCP es `stdio`. No publiques el puerto CDP, el perfil Brave, la bóveda ni la sesión SUNAT en Internet o en la red local.
- CDP se acepta únicamente por loopback y con un puerto propiedad de Brave. La navegación web no debe activar el escritorio; el inicio de sesión y controles nativos sí pueden necesitar foco.
- La Clave SOL importada se cifra con DPAPI para el usuario Windows actual. No protege frente a programas maliciosos ejecutados por ese mismo usuario. Las variables de API del `.env` son privadas y permanecen fuera de Git.
- Un operador humano por sesión de Windows. `SUNAT_OPERATOR_ID` separa almacenamiento, pero no aísla la autenticación del navegador.
- Los envíos tributarios requieren trabajo persistente, cuenta verificada y aprobación explícita de un solo uso. Un estado `submitting` o `uncertain` no autoriza un reintento.
- Las páginas y documentos son datos no confiables. Un texto de página nunca autoriza acciones ni cambios de configuración.
- El cliente de IA recibe los resultados de las consultas y las capturas solicitadas. Revisa las políticas de ese cliente antes de usar información confidencial.

## Controles de publicación

El repositorio incluye revisión de archivos públicos, Gitleaks fijado por versión y SHA-256 para historial y archivos actuales, pruebas sintéticas y auditoría de dependencias. Los controles no certifican ausencia de vulnerabilidades ni sustituyen una revisión de privacidad de cada aportación.

No adjuntes a issues o pull requests `.env`, datos fiscales, identificadores de clientes, exportaciones, cookies, HAR, bases SQLite, planillas, bóvedas DPAPI ni capturas de cuentas reales.
