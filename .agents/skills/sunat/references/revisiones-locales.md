# Guardar una revisión documental reutilizable

Se usa después de consultar realmente una fuente pública del catálogo. El servidor no abre URL ni resume documentos por su cuenta. La investigación utiliza las herramientas autorizadas disponibles; el MCP conserva solo orientación genérica y la huella del contenido, nunca el manual, guion completo, páginas autenticadas ni datos tributarios del usuario.

1. Leer el registro con `sunat_guias({accion:"leer",id})`. Conservar su `revision` como `expectedRevision`. Revisar lo que ya está guardado y consultar únicamente el tramo necesario.
2. Recuperar el documento, texto extraído, subtítulos o video oficial con una herramienta adecuada. Comprobar título y contenido: HTTP 200 o una página «Request Rejected» no acreditan lectura. Leer la fuente completa que se vaya a resumir o indicar las secciones exactas revisadas; no inferir pasos desde el título. Las capturas, tablas y condiciones decisivas requieren revisión visual cuando la extracción textual no las recoge.
3. Guardar temporalmente el contenido público realmente consultado. Preparar un JSON con los campos siguientes. Los campos desconocidos se dejan en arrays vacíos y se explican en `gaps`; no inventar requisitos, perfil, canal ni verificación del resultado.

```json
{
  "id": "guia-ID_EXISTENTE",
  "expectedRevision": "SHA256_DEVUELTO_POR_LEER",
  "reading": "content-reviewed",
  "summary": "Resumen genérico de la fuente consultada.",
  "steps": [{"text": "Paso respaldado por la fuente."}],
  "purpose": "procedimiento",
  "channels": ["sol-web"],
  "operations": ["consulta"],
  "historical": false,
  "requirements": [],
  "checks": [],
  "gaps": ["Aspectos relevantes que la fuente no permite determinar."],
  "limitations": [],
  "entryPoints": [],
  "profiles": [],
  "sourceSections": ["Sección o páginas efectivamente consultadas."],
  "fingerprintBasis": "texto"
}
```

El ejemplo tiene marcadores, no IDs válidos. `reading` admite `content-reviewed`, `transcript-reviewed` y `visual-reviewed`; los dos últimos son para videos. En subtítulos, los pasos conservan `at` con una marca real. `purpose` admite `procedimiento`, `referencia`, `tecnico`, `normativa`, `formulario` e `informativo`. `channels` admite también `web-sunat`, `app-movil`, `escritorio`, `api`, `banco`, `presencial` y `sin-determinar`. `operations` admite consulta, preparacion, modificacion, presentacion, pago, emision, anulacion y generacion; son etiquetas documentales y no amplían `sunat://flujos`.

4. Aplicar desde la raíz del proyecto con `npm run sunat:catalogo-guias -- --revision REVISION.json --contenido CONTENIDO_PUBLICO`. El importador calcula SHA-256 sobre el archivo real, valida el ID y la revisión esperada, exige contenido no vacío y rechaza ejemplos de identidades, importes, periodos y credenciales. `fingerprintBasis` es `archivo`, `texto`, `subtitulos` o `video`, según el archivo entregado. Una huella textual o de subtítulos no acredita identidad de dos videos o PDF completos.
5. Si cambió la revisión, leer de nuevo antes de guardar. Si la fuente es inaccesible, no crear un resumen: retirarla en el JSON de actualización y regenerar el catálogo con el importador. Los estados fallidos en entradas de importación se descartan automáticamente. La depuración conserva cantidades, sin listas de enlaces fallidos.
6. Confirmar con `leer` que los pasos ya están disponibles localmente. Las actualizaciones de datos y fichas se leen en la siguiente consulta con caché por contenido; un archivo inválido detiene la lectura y no reutiliza una versión anterior. No se requiere reiniciar MCP para actualizar una revisión. Mantener la aprobación tributaria y la comprobación de la pantalla actual.

Máximo 200 palabras por fuente entre resumen, pasos y limitaciones; ampliar una sección operativa mediante la ficha correspondiente cuando haga falta, conservando las fuentes. El guardado documental no es aprendizaje de una cuenta ni prueba de un trámite completado.
