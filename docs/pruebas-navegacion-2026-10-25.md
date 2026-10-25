# Pruebas de navegación SUNAT — 25/10/2026

Pruebas reales de navegación y consultas, sin presentación, emisión, pago, afiliación ni modificación tributaria. Este informe conserva solo resultados técnicos genéricos; no contiene datos de cuenta, valores fiscales, documentos ni capturas. Semilla de selección: `1903858281`.

## Cobertura real

| Operación | Resultado comprobado |
|---|---|
| Formulario 621 | Formulario e Información General visibles |
| Boleta SEE SOL | Formulario inicial visible tras corregir la espera de animación; sin completar datos |
| Consulta NPS | Criterios y filtros visibles, búsqueda de consulta ejecutada; repetición de ruta guardada completada en cinco pasos |
| SIRE Compras | Rama de Gestión de Compras alcanzada; aviso de obligación mostrado después de la carga. Se detuvo la operación |
| Ficha RUC | Contenido de datos generales visible; sin descarga ni envío |
| Honorarios | Formulario inicial visible; sin datos ni emisión |
| Consulta de declaraciones y pagos | Filtros de consulta y Buscar visibles |
| Valores pendientes de pago | Formulario de consulta visible; sin datos fiscales ingresados |
| Detracciones | Aviso de acceso de SUNAT; se detuvo esa operación |
| Renta Empresas | Página oficial de entrada; sin seleccionar campaña ni formulario 710 |
| Renta Personas | Autenticación anual y formulario inicial 709 con selector de ejercicio visibles; no se seleccionó ejercicio |

Una pantalla abierta o una búsqueda no acredita un trámite tributario completado. Los avisos se usan solo para detener la navegación actual: no se almacenan permisos por cuenta.

## Errores reproducidos y correcciones

- NPS daba un falso negativo porque exigía Periodo: ahora comprueba sus propios criterios y filtros. La ruta completa se repitió en vivo con resultado `reached`.
- Los servicios ocultaban perfiles: la ruta puede volver con el único control seguro Ir al inicio antes de recorrer otra rama.
- Un padre expandido se pulsaba y se cerraba: ahora conserva su estado. Los marcadores de expansión se verificaron en vivo en SIRE.
- SOL exponía etiquetas mientras seguía animando el submenú: el adaptador espera la animación existente antes de medir el clic. Boleta abrió en vivo tras la corrección.
- Los marcos agregados durante la carga no se esperaban: ahora la espera descubre los marcos oficiales actuales. NPS se repitió correctamente.
- Los fallos de clic conservan un código saneado y si se conoce el despacho. No se repite una entrada incierta.
- El acceso anual usa otro endpoint y el botón Entrar: se reconocen ambos formularios oficiales, sin leer contraseñas ni consultas OAuth. La selección nativa de credencial, el botón Entrar y el formulario 709 se comprobaron en vivo; la detección automática del nuevo nombre tiene regresión local.
- Una ventana auxiliar propiedad de Brave confundía la selección de ventana principal: ahora se ignora esa auxiliar sin elegir entre varias ventanas principales reales. La selección nativa de credencial funcionó tras la corrección.
- SIRE podía anunciar llegada durante el panel provisional antes del aviso de obligación. Se exigen señales de contenido del módulo descritas por la guía; la espera termina ante un aviso y relee la pantalla aunque no llegue la etiqueta. La rama sin restricción requiere validación futura en una sesión elegible; el aviso actual no se elude.

## Verificación

`npm test`: 113 pruebas aprobadas, cero fallos. `npm run check`, validación de la skill SUNAT y `git diff --check` aprobados. Las regresiones incluyen carga tardía, avisos asíncronos, menús expandidos, animación, ambigüedad de ventanas, autenticación anual y límites de aprobación tributaria.

Prueba final del detector SIRE tras recarga: la ruta completó cinco pasos y devolvió `precondition_not_met` ante el aviso de obligación, sin anunciar llegada ni ejecutar acciones dentro del módulo. Comprobado en vivo.
