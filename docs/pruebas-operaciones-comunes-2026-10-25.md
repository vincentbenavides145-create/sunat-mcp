# Pruebas ampliadas de operaciones comunes — 25/10/2026

Navegación y consultas autorizadas en la web real, con guías locales leídas antes de operar. Sin emisión, presentación, pago, alta, baja ni modificación tributaria. Se conserva solo evidencia técnica genérica; no se guardan datos de cuenta, valores fiscales, permisos, páginas ni capturas.

## Resultados de la primera tanda

| Caso | Resultado técnico | Evidencia genérica |
|---|---|---|
| nps-ruta | reached | Ruta guardada ejecutada con referencias actuales. |
| t-registro-individual | aviso_sunat | Aviso previo al acceso a Registro Individual; sin alta ni cambios. |
| factura-emision-formulario | aviso_sunat | Aviso de validación de acceso; sin completar ni emitir. |
| factura-consulta-formulario | formulario_verificado | Filtros de fechas y tipo de consulta visibles; sin solicitar descargas. |
| ficha-ruc-ruta | fallo_reproducido | Ruta detenida en Ficha RUC fuera de vista; desplazamiento manual permitió continuar. |
| ficha-ruc-pantalla | pantalla_verificada | Comprobación semántica de ficha sin descargar ni enviar. |
| rhe-emision-formulario | formulario_verificado | Solo formulario inicial de receptor, sin completar datos. |
| fraccionamiento-precalificacion | consulta_verificada | Consulta de requisitos abierta y ejecutada; sin generar pedido ni solicitud. |

## Correcciones

- Una ruta con un enlace único fuera de vista lo revela y relee la página antes de clicar; mantiene ambigüedad, comprobación de sesión y aprobación tributaria.
- El aprendizaje exige evidencia de menú en el snapshot y excluye acciones/campos de formularios. Las rutas antiguas de esos controles dejan de ser ejecutables y se limpian al guardar de nuevo; se conservan rutas válidas sin límite de cantidad o profundidad.
- Se reconocen los avisos observados de registro de empleador y validación de afectación como condiciones que detienen el servicio; no se convierten en permisos de cuenta guardados.
- Regresiones automáticas: suite completa repetida con el código final, 124 pruebas aprobadas y cero fallos (60,3 segundos). TypeScript, validación de skill, control de distribución pública y revisión de espacios del diff aprobados.

## Continuación tras la recarga autorizada

| Caso | Resultado técnico | Evidencia genérica |
|---|---|---|
| ficha-ruc-ruta-repeticion | reached | La misma ruta antes fallida completó sus dos pasos con la corrección cargada. |
| declaraciones-pagos-consulta | formulario_verificado | Ruta guardada y formulario de fechas comprobados tras la carga; sin inventar criterios. |
| devoluciones-medios-consulta | formulario_verificado | Atajo abrió consulta de medios de pago; filtros de fechas y Buscar/Limpiar presentes. |
| devoluciones-solicitudes-consulta | formulario_verificado | Rama específica abrió consulta de formularios 4949/1649 por fechas, periodo o número de orden. |
| deuda-valores-consulta | formulario_verificado | Consulta de valores pendientes con rango de periodo o documento; sin efectuar pagos. |
| fraccionamiento-estado-solicitud | formulario_verificado | Pantalla de seguimiento F36 con fechas y Consultar; sin generar solicitudes. |
| fraccionamiento-estado-pedido | pantalla_verificada | Consulta de estados de pedidos F36 renderizada; sin crear pedidos de deuda. |
| sire-compras-regresion | precondition_not_met | Ruta detenida ante aviso de SUNAT; sin seleccionar periodos ni afiliar. |
| declaraciones-pagos-acceso | fallo_lectura_recuperado | Tras autenticación, una lectura devolvió cdp_operation_failed. Se detuvo y se comprobó la UI nativa; una lectura fresca posterior funcionó sobre la misma conexión, sin repetir login ni clics. |
| declara-facil-621-inicial | formulario_verificado | Identificador 0621 IGV Renta Mensual y secciones Información General, Detalle de Declaración y Determinación de la Deuda renderizados. Sin seleccionar periodo ni llenar valores. |
| plame-web-0601-inicial | pantalla_verificada | Rama Pago y presentación de otras declaraciones → Plame Web - 0601 y pantalla inicial con explicación y Continuar. Sin continuar ni presentar. |
| buzon-inicial | pantalla_verificada | Buzón Notificaciones, Buzón Mensajes, MIS CARPETAS y búsqueda por asunto visibles. Sin abrir comunicaciones individuales ni acuses. |

Total: 20 casos técnicos, incluidas la reproducción y repetición de Ficha RUC. Se reutilizó una conexión CDP persistente durante cada sesión; la única recarga con reconexión fue expresamente autorizada. Las lecturas de página y clics ordinarios usaron CDP; el acceso nativo se reservó a la autenticación, el diagnóstico de solo lectura y los controles de configuración. Se utilizó una captura diagnóstica, no conservada en el repositorio.

La lectura del perfil confirmó que los antiguos controles Continuar, Buscar y campos de pago dejaron de aparecer. Se detectó además un registro heredado terminado en Consultar: el filtro local y su regresión se ampliaron para excluir también Consultar y Limpiar. Este último ajuste TypeScript requiere la siguiente recarga del servidor; no se abrió otra conexión después del fallo CDP. Las demás correcciones ya habían sido cargadas y Ficha RUC se repitió con éxito en vivo. Las 51 regresiones específicas se repitieron con el filtro final y pasaron.

## Incidencia pendiente y límites

El fallo cdp_operation_failed no expone su excepción original, por lo que su causa concreta no quedó determinada. Ocurrió después de la autenticación y se recuperó mediante una lectura nueva sobre la conexión existente, tras confirmar la UI nativa. No se trató como pérdida de sesión ni se repitió ninguna acción física o tributaria. Queda pendiente mejorar su diagnóstico antes de atribuirlo a una condición concreta o implementar una corrección de la transición.

No se probaron presentaciones o pagos reales, otras cuentas, concurrencia de operadores ni todas las variantes de cada servicio. En 621 se comprobó el formulario inicial; en PLAME la pantalla previa al botón Continuar. No se consideran pruebas de una declaración completa. Los filtros de consulta que requieren fechas o documentos no se ejecutaron con datos inventados.

Una pantalla abierta no acredita un trámite completado ni disponibilidad general para otras cuentas. Los avisos se conservan aquí como categorías de prueba, sin textos ni datos de cuenta.
