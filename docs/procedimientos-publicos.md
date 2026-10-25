# Procedimientos públicos SUNAT

**Revisión documental general:** 23/10/2026. **Ampliación NPS:** 24/10/2026; guías oficiales de generación/pago y observación del formulario de consulta, sin ejecutar operaciones tributarias. **Evidencia general:** guia_publica, salvo las observaciones de consulta NPS identificadas en su ficha; no se realizaron presentaciones, generaciones ni pagos. Fuentes oficiales consultadas con Exa y Firecrawl mediante Composio.

## Uso de las fichas

El índice está en sunat://procedimientos; cada ficha se consulta con sunat://procedimientos/{id}. Lee solo la ficha necesaria. En el repositorio busca su ID en el encabezado. Una ruta publicada orienta; solo las rutas observadas o aprendidas confirmadas se ejecutan mediante routeId.

Identifica acceso SOL, perfil y operación: consultar, preparar, modificar, presentar o pagar. Usa sunat_iniciar_sesion; nunca solicites Clave SOL por chat. Los datos requeridos son categorías que se completan durante la ejecución, no valores que se guarden en estas fichas.

Antes de registrar o confirmar datos tributarios, aplica la aprobación del servidor a la acción y valores actuales. Preliminar, ticket y número de pago no equivalen a presentación, generación final, pago o resolución favorable. Ante una respuesta incierta, consulta el estado antes de reenviar.

El MCP actual permite navegar, leer y llenar campos autorizados; no transfiere archivos, envía correos ni controla aplicativos Desktop. Indica al usuario el paso externo concreto y retoma la parte disponible. No confundir una función documentada por SUNAT con una herramienta implementada.

Las fuentes sin fecha editorial y las capturas antiguas requieren comprobar la pantalla vigente. Los ejemplos de sus formularios no son datos de trabajo. Las etiquetas sirven para buscar controles, no son selectores permanentes. Cada ficha recibida por el MCP incorpora las observaciones locales de uso: pasos canónicos y evidencia genérica de fase, sin datos de cuenta. Las secuencias incompletas o con etiquetas omitidas se identifican como tales; una señal renderizada de finalización no equivale a una resolución favorable si la fase era presentar una solicitud. Si la interfaz difiere, explora únicamente la rama necesaria.

| ID | Operación | Acceso / perfil | Cobertura documental |
|---|---|---|---|
| ficha-ruc | Ficha RUC y régimen | Trámites y Consultas / Personas, Empresas | Ruta publicada |
| ruc-modificacion-3128 | Modificar RUC | Trámites y Consultas / Personas, Empresas | Ruta y bloques |
| ruc-suspension-reinicio | Suspensión / reinicio | FV 3128 | Secuencia de suspensión |
| sire-rvie-rce-sol | Propuestas y generación | Trámites y Consultas / perfil habilitado | Secuencia SOL |
| sire-rce-complementar | Complementar RCE | Gestión de Compras | Funciones y decisiones |
| sire-consultas-tickets | Tickets y constancias | Módulo SIRE | Consultas publicadas |
| sire-desktop | Aplicativo cliente | Desktop | Referencia de otro canal |
| sire-api-acceso | Revisar acceso API | Credenciales API en SOL | Autenticación, no registros |
| declara-facil-621 | IGV y renta mensual | Declaraciones y Pagos | Secuencia publicada |
| consulta-declaraciones-pagos | Declaraciones y constancias | Dos accesos SOL diferentes | Rutas y límites separados |
| nps-consulta | Consultar NPS y su estado | Trámites y Consultas / Personas | Pantalla observada; no pago |
| nps-generacion | Generar NPS desde una declaración o boleta | Declaraciones y Pagos | Guía oficial; presentación separada del pago |
| nps-pago | Pagar un NPS generado | Canal bancario | Paso externo; constancia FV 1663 |
| consulta-deuda | Valores pendientes | Trámites y Consultas / Personas, Empresas | Ruta publicada |
| detracciones-consulta-pago | Consulta de pagos / depósitos | Según consulta | Ruta interna parcial |
| detracciones-pago | Preparar y pagar detracciones | Declaraciones y Pagos | Acceso y búsqueda |
| buzon-sol | Notificaciones y mensajes | Trámites y Consultas | Acceso publicado |
| rhe-emision | Emitir recibo por honorarios | Trámites y Consultas / Personas | Secuencia publicada |
| rhe-registro-pagos | Registrar cobro de RHE | SEE SOL / Personas | Ruta; controles finales pendientes |
| see-sol-factura | Factura / boleta | Trámites y Consultas | Boleta descrita; factura parcial |
| t-registro | Consulta, alta, modificación y baja | Trámites y Consultas / Empresas | Ruta y operaciones |
| plame-web-601 | Planilla mensual web | Declaraciones y Pagos | Condiciones y secuencia general |
| devolucion-1649 | Solicitud y seguimiento | Trámites y Consultas / Personas, Empresas | Ruta y secuencia |
| fraccionamiento-art36 | Aplazamiento / fraccionamiento | Trámites y Consultas | Fases del FV 687 |
| modificacion-1693 | Modificación / inclusión de datos | Trámites y Consultas | Ruta y ejemplo |
| reconocimiento-pago-error | Código de tributo errado | MPV / presencial según caso | Selección de canal |
| renta-anual-personas-709 | Renta anual persona natural | Renta Anual Personas | Formulario; ruta interna parcial |
| renta-anual-empresas-710 | Renta anual empresarial | Renta Anual Empresas | Elección de formulario; ruta parcial |
| drawback-consulta | Consultar Drawback | Portal del Operador / Aduanas | Manual legado |
| exporta-facil | Declaración Exporta Fácil | Operador de Comercio Exterior | Flujo mixto web / Serpost |

## ficha-ruc — Consultar Ficha RUC y régimen

**Acceso:** Trámites y Consultas; Personas o Empresas. **Fuente:** [Ficha RUC](https://orientacion.sunat.gob.pe/sites/default/files/inline-files/Ficha%20RUC_0.pdf), pasos 1–5; sin fecha editorial, capturas de 2020.

**Ruta publicada:** Mi RUC y Otros Registros → Mis Datos del RUC → RUC → Ficha RUC.

1. Abrir la ficha y localizar el dato pedido. Para determinar el régimen, revisar tributos afectos y descripción; ACTIVO, HABIDO o tipo de contribuyente no bastan.
2. Si el resumen no muestra ese dato, revisar su detalle visible; no deducir régimen por prefijo del RUC o acceso a SIRE.
3. Responder con el campo leído y señalar cualquier información que falte.

**Resultado:** ficha de la sesión correcta y dato solicitado visible. **Variante:** consultar en pantalla es distinto de obtener el reporte certificado; el manual describe Descargar Ficha RUC, descarga y correo. Las transferencias las realiza el usuario. **Pendiente:** controles del detalle actual. No abrir Modificación de Datos para una consulta.

## ruc-modificacion-3128 — Modificar datos del RUC

**Acceso:** Trámites y Consultas; Personas o Empresas. **Fuentes:** [Datos de contacto](https://personas.sunat.gob.pe/landing/actualiza-datos-contacto), Por SUNAT Virtual; [modificación por Internet](https://orientacion.sunat.gob.pe/6548-02-modificacion-de-datos-por-internet), FV 3128; sin fecha editorial visible.

**Ruta publicada:** Mi RUC y Otros Registros → Actualizo información de mi RUC → RUC → Formulario N° 3128 – Modificación de Datos del RUC.

1. Abrir solo el bloque del cambio solicitado: contacto, actividad, domicilio, tributos o establecimientos.
2. Comparar dato actual y nuevo; completar únicamente la modificación autorizada.
3. Revisar el resumen y aprobar antes de registrar/confirmar.
4. Comprobar mensaje final y dato actualizado.

**Datos:** campo, nuevo valor y sustento que exija la pantalla. **Variantes:** algunas restricciones requieren otro canal; informar la condición específica. Si aparece validación por código, la completa el usuario. **Pendiente:** campos y requisitos propios de cada bloque; la disponibilidad del FV 3128 no demuestra que todo dato pueda modificarse virtualmente.

## ruc-suspension-reinicio — Suspensión o reinicio

**Ruta:** FV 3128 de la ficha anterior → Suspensión / Reinicio de Actividades → Ingrese Aquí. **Fuente:** [Suspensión temporal](https://orientacion.sunat.gob.pe/sites/default/files/inline-files/IM_036_Suspensi%C3%B3n%20temporal%20de%20actividades.pdf), pasos 2–7; sin fecha editorial, capturas de 2020.

1. Precisar novedad, fecha y sustento. El ejemplo de suspensión pide comprobante emitido o recibido; no inventarlo ni extrapolar automáticamente ese requisito al reinicio.
2. Completar el bloque y revisar casillas modificadas y ficha preliminar.
3. Obtener aprobación antes de cada confirmación que registre el cambio.

**Resultado:** Comprobante de Información Registrada (CIR) y transacción correspondiente; una vista preliminar no acredita conclusión. **Recuperación:** si el envío queda incierto, consultar la ficha antes de repetir. **Pendiente:** requisitos específicos de reinicio y vigencia de condiciones temporales.

## sire-rvie-rce-sol — Propuestas y generación RVIE/RCE

**Acceso:** Trámites y Consultas. El manual muestra Empresas; la ruta observada local puede estar en Personas. **Fuente:** [Manual práctico SOL](https://cpe.sunat.gob.pe/sites/default/files/inline-files/SIRE%20ManualPracticoSOL_Propuesta_1.pdf), secciones 1, 2.1 y 3; sin fecha editorial. Paginación impresa inconsistente: usar secciones.

**Ruta publicada:** Empresas → Sistema Integrado de Registros Electrónicos → Registros Electrónicos → RVIE → Gestión de Ventas e Ingresos Electrónicos; o RCE → Gestión de Compras.

1. Precisar registro, periodo y operación. Revisar avisos de obligación; aceptar una afiliación no es navegación inocua.
2. En Generación de Registro abrir Propuesta del RVIE/RCE y revisar datos.
3. Aceptar Propuesta y su confirmación requieren aprobación; ticket/preliminar no equivale a generación final.
4. En Generación de Registros verificar registros y periodo. Aprobar Generar registro y sus confirmaciones.

**Resultado:** estado generado y constancia; continuar con sire-consultas-tickets. **Bloqueo:** informar falta de obligación/acceso sin cambiar periodos para eludirla. No aceptar una propuesta por defecto.

## sire-rce-complementar — Complementar RCE

**Acceso:** Gestión de Compras. **Fuente:** [Complementación RCE](https://cpe.sunat.gob.pe/sites/default/files/inline-files/SIRE-ManualPracticoSOL_Complementar.pdf), secciones 2.1–2.14; sin fecha editorial.

1. Precisar Agregar, Editar, Excluir, Eliminar o Actualizar. Excluir y Eliminar tienen condiciones distintas según origen del documento.
2. Aplicar datos y criterios contables sustentados por el usuario.
3. Antes de guardar o actualizar, mostrar campos y efecto y obtener aprobación.
4. Comprobar el cambio. Aceptar la propuesta y generar registro son decisiones posteriores.

**Datos:** documentos y cambios solicitados; prorrata, tipo de cambio y crédito fiscal no se infieren. **Archivos:** Importar, Comparar y Exportar requieren intervención del usuario. **Resultado:** propuesta modificada, sin afirmar presentación final. **Pendiente:** restricciones actuales de cada función y procedimiento específico de reemplazo. No excluir documentos para hacer desaparecer una validación.

## sire-consultas-tickets — Tickets, constancias e inconsistencias

**Acceso:** Información de Gestión → Consultas y Descargas del módulo RVIE/RCE. **Fuentes:** [Manual SOL](https://cpe.sunat.gob.pe/sites/default/files/inline-files/SIRE%20ManualPracticoSOL_Propuesta_1.pdf), sección 3.1; [formas de acceso](https://cpe.sunat.gob.pe/node/158), servicio Consultar estado del ticket, modificación visible 19/08/2025.

1. Elegir Constancia de Recepción, Estado de envío de ticket o Consulta de Reporte de inconsistencias.
2. Filtrar por periodo o ticket. Si está en proceso, informar estado y consultar después; no generar otra solicitud.
3. Comprobar operación y constancia relacionadas. Una descarga terminada no prueba registros generados.

**Resultado:** estado específico o constancia visible. **Límite:** el usuario transfiere archivos. **Errores:** separar tarea pendiente, rechazo funcional y fallo temporal. No usar un supuesto endpoint del informe como API implementada ni mantener un sondeo indefinido.

## sire-desktop — SIRE por aplicativo cliente

**Canal:** Desktop, distinto de SOL. **Fuente:** [Manual Desktop](https://cpe.sunat.gob.pe/sites/default/files/inline-files/SIRE%20desktop.pdf), pasos 1–22; sin fecha editorial.

El flujo publicado selecciona registro/periodo, solicita/descarga/migra propuesta, la revisa y envía el preliminar; después genera los registros en SOL.

**Ejecución:** el MCP no controla el aplicativo. Indicar el paso externo concreto y retomar SOL cuando el usuario confirme el envío. No afirmar que migró archivos.
**Aprobación:** aceptación, envío del preliminar y generación son efectos distintos.
**Resultado:** estados generados y constancia en SOL; archivo local no equivale a presentación.
**Pendiente:** versión instalada y requisitos del aplicativo.

## sire-api-acceso — Revisar acceso API SIRE

**Fuente:** [Formas de acceso](https://cpe.sunat.gob.pe/node/158), servicio web API SUNAT; modificación visible 19/08/2025.

1. Distinguir revisar acceso de operar registros. Clave SOL no demuestra credenciales API habilitadas.
2. Usar sunat_estado con la cuenta importada para la prueba de autenticación/scope.
3. Informar el resultado sin secretos; si falta habilitación, explicar el requisito.

SUNAT documenta propuesta, preliminar, tickets y archivos; estas operaciones API no están implementadas en el MCP. Usar el flujo SOL correspondiente.
**Efecto:** obtener nuevas credenciales inhabilita las anteriores según la fuente; no regenerarlas como diagnóstico.
**Resultado:** autenticación revisada, no registros consultados.
**Pendiente:** permisos y endpoint implementado para cada operación futura.

## declara-facil-621 — Declaración mensual IGV y Renta

**Acceso:** Mis Declaraciones y Pagos. **Fuentes:** [Paso a paso 621](https://emprender.sunat.gob.pe/sites/default/files/inline-files/TP_009%20%282%29_compressed.pdf), pasos 4–10, marca 11/2025; [funcionalidades](https://orientacion.sunat.gob.pe/sites/default/files/inline-files/ayudas_Funcionalidades_0_ccv.pdf), fases Completar, Presente/Pague y Constancia.

**Ruta publicada:** Presentación y Pago → Declara Fácil → IGV Renta Mensual - 621.

1. Precisar periodo, régimen y original/sustitutoria/rectificatoria. Revisar propuesta y sustento; falta de datos no equivale a cero.
2. Completar Información General, Detalle de Declaración y Determinación de la Deuda.
3. Validar y corregir inconsistencias con sustento.
4. Revisar formulario y bandeja antes de agregar: puede preparar boletas por conceptos con monto.
5. Aprobar antes de Presentar/Pagar y antes de cargos/confirmaciones de pago.

**Resultado:** constancia de presentación y pago comprobado por separado; NPS no acredita pago bancario. **Carga:** ante panel temporalmente vacío, aplicar espera de la skill sin repetir acceso. **Pendiente:** casillas y beneficios del periodo; no copiar cálculos de otra cuenta.

## consulta-declaraciones-pagos — Declaraciones, pagos y constancias

**Fuente:** [Reportes de declaraciones y pagos](https://orientacion.sunat.gob.pe/sites/default/files/inline-files/Reporte%20declaracion%20y%20pago_1.pdf), apartados 1–2; sin fecha editorial, ejemplos de 2024.

**Canal A, Declaraciones y Pagos:** Consultas → Consultas de Presentación y Pago → Consulta de Declaraciones y Pagos; formulario, fecha/periodo y Buscar. El tutorial indica hasta tres meses.

**Canal B, Trámites y Consultas:** Personas/Empresas → Mis declaraciones informativas → Consulto mis declaraciones y pagos → Declaraciones y pagos → Consulta general; tipo, formulario, rango y Buscar. El tutorial indica hasta seis meses.

Aplicar el límite actual del canal y dividir rangos mayores, sin reducir el alcance solicitado.
**Resultado:** filas/detalle del filtro; importe declarado no equivale a pagado.
**Variantes:** reporte resumido y Solicitud de descarga de declaraciones son diferentes. Registrar Pedido inicia una solicitud: revisar selección, obtener aprobación y comprobar ticket. Retomar por Consulta y descarga de pedidos de declaración. El tutorial anuncia atención posterior y cupos de reportes; comprobar avisos actuales. Archivos y correo los gestiona el usuario.

## consulta-deuda — Valores pendientes de pago

**Acceso:** Trámites y Consultas; Personas/Empresas. **Fuente:** [Valores pendientes](https://orientacion.sunat.gob.pe/sites/default/files/inline-files/Reporte%20de%20valores%20pendientes_0.pdf), pasos 1–3; sin fecha editorial.

**Ruta publicada:** Revisión de mis deudas → Valores pendientes de pago → Valores → Consulta valores pendientes de pago.

1. Buscar por documento o rango; el manual indica hasta seis meses. Dividir si la pantalla mantiene ese límite.
2. Revisar tipo/número de valor, tributo, periodo, notificación, etapa y saldo.
3. Comunicar alcance del resultado: sin filas no significa ausencia de toda deuda.

**Resultado:** valores de la consulta. **Frontera:** pagar, fraccionar o reclamar son operaciones distintas.
**Pendiente:** condiciones particulares y deuda actualizada; no calcularla desde una captura antigua.

## detracciones-consulta-pago — Consultar pagos o depósitos SPOT

**Fuentes:** [Accesos SOL](https://www.sunat.gob.pe/sol.html), tarjeta Declaraciones y Pagos; [pago de detracciones](https://emprender.sunat.gob.pe/principales-impuestos/impuesto-general-las-ventas-igv/pago-detracciones), características/acceso; sin fecha editorial.

Distinguir consulta de pago, depósitos/constancias SPOT y uso de la cuenta para pagar tributos. La tarjeta SOL anuncia pago y consulta de pago; el menú observado también incluye Consulta de Detracciones en Empresas. No demuestra equivalencia entre las dos consultas.

1. Precisar la operación según el pedido y usar ruta local confirmada si coincide.
2. Si falta, explorar solo la rama de consulta correspondiente. No abrir pago para sustituir consulta de operaciones efectuadas.
3. Leer filtros y rol proveedor/adquirente cuando aplique; comprobar el resultado y su estado.

**Resultado:** depósito, constancia o pago correcto; una factura seleccionable para pagar no acredita depósito.
**Pendiente:** ruta interna exacta, filtros e intervalos de cada consulta. No se crea routeId desde esta evidencia parcial.

## detracciones-pago — Preparar y pagar detracciones

**Acceso:** Declaraciones y Pagos. **Fuentes:** [Pago de detracciones](https://emprender.sunat.gob.pe/principales-impuestos/impuesto-general-las-ventas-igv/pago-detracciones), Cómo ingresar; [guía masiva](https://emprender.sunat.gob.pe/sites/default/files/inline-files/detracciones_masivo.pdf), pasos 1–3; sin fecha editorial.

**Ruta publicada:** Presentación y pago de otras declaraciones → Pago de Detracciones. La cartilla invierte “Pago y presentación”; contrastar etiqueta actual.

1. Precisar individual/masivo y datos de operación, cuenta y comprobantes.
2. Para búsqueda masiva: Información Depósito General → Tipo de depósito → Masivo; proveedor/adquirente, fechas y Buscar. La cartilla limita esta búsqueda a quince días, no todas las consultas SPOT.
3. Revisar destinatario, códigos, tasa e importe sustentados.
4. Aprobar presentación y pago; verificar constancia/estado final.

**Variantes:** cargo, tarjeta o Número de Pago de Detracciones (NPD), según pantalla. NPD y NPS no son intercambiables ni prueban pago.
**Pendiente:** controles posteriores a la búsqueda y cada medio de pago. Archivos los carga el usuario.

## buzon-sol — Notificaciones y mensajes

**Acceso:** Trámites y Consultas. **Fuente:** [Buzón SOL](https://orientacion.sunat.gob.pe/sites/default/files/inline-files/Buz%C3%B3n%20Electr%C3%B3nico.pdf), SUNAT Virtual, pasos 1–2; sin fecha editorial, captura de 2023.

1. Abrir Buzón Electrónico en la parte superior del Menú SOL.
2. Distinguir notificaciones y mensajes, filtrar y abrir la comunicación solicitada.
3. Leer fecha, asunto, acto y contenido disponible; señalar adjuntos o partes no revisadas.

**Resultado:** comunicación correcta y estado actual, no ausencia de notificaciones fuera del filtro.
**Criterio:** leído/no leído no determina por sí solo un plazo legal; comprobar norma si se pide calcularlo.
**Frontera:** no responder, presentar descargos, descargar o reenviar por una instrucción de consulta. Monitoreo recurrente requiere solicitud propia.
**Pendiente:** carpetas y controles de la interfaz actual. No guardar metadatos de empresas en el aprendizaje.

## rhe-emision — Emitir recibo por honorarios

**Acceso:** Trámites y Consultas; Personas. **Fuente:** [Pasos RHE](https://personas.sunat.gob.pe/sites/default/files/inline-files/Recibo_honorarios.pdf), pasos 1–8; sin fecha editorial.

**Acceso publicado:** Emisión de Recibos por Honorarios Electrónicos.

1. Validar documento del receptor y comprobar nombre devuelto.
2. Completar servicio, fecha, gratuidad, tipo de renta, retención, forma de pago, moneda e importe con datos aportados.
3. Si aparece activación/primera emisión, explicar el efecto y aprobar antes de aceptarlo.
4. Revisar vista previa y aprobar Emitir Recibo; ejecutar una sola vez.

**Resultado:** comprobante emitido visible y datos coincidentes. Ante incertidumbre, consultar antes de reemitir.
**Variantes:** registrar cobros, revertir o emitir nota de crédito son otras operaciones. No asumir suspensión de retenciones ni tratamiento fiscal.
**Pendiente:** controles actuales y condiciones específicas del recibo.

## rhe-registro-pagos — Registrar cobro de un RHE

**Acceso:** Trámites y Consultas; Personas. **Fuente:** [Pasos RHE](https://personas.sunat.gob.pe/sites/default/files/inline-files/Recibo_honorarios.pdf), Registra el pago que recibe por tus servicios; sin fecha editorial.

**Ruta publicada:** Comprobantes de pago → SEE-SOL → Recibo por Honorarios Electrónico → Registrar pagos.

1. Identificar recibo y comprobar pagos existentes.
2. Completar medio, importe y fecha reales; emisión no equivale a cobro.
3. Aprobar antes de registrar/confirmar.
4. Comprobar pago asociado y total.

**Resultado:** cobro registrado, no transferencia bancaria efectuada.
**Pendiente:** etiquetas finales, pagos parciales, reversión y plazo aplicable; no convertir el plazo del manual en regla universal sin contraste.

## see-sol-factura — Factura o boleta SEE SOL

**Acceso:** Trámites y Consultas; perfil habilitado. **Fuente:** [SEE SOL](https://cpe.sunat.gob.pe/sistema_emision/see_sol), Condiciones y SEE–PORTAL; sin fecha editorial en el texto consultado.

La fuente exige Clave SOL activa, domicilio habido y ausencia de suspensión/baja para este sistema; comprobar habilitación actual.
**Boleta, ruta publicada:** Comprobantes de Pago → Sistemas de Emisión Electrónica desde SOL → Boleta de Venta Portal; completar datos, revisar vista previa y aprobar emisión.
**Factura:** la fuente confirma disponibilidad, pero no describe aquí el formulario completo. Usar el acceso observado Emisión de Factura Electrónica si aparece; no copiar pasos de boleta.

**Datos:** receptor cuando corresponda, bienes/servicios, unidades, cantidades, precios, moneda, tributos y pago sustentados.
**Resultado:** comprobante emitido, no preliminar.
**Errores:** revisar habilitación y validación concreta; no cambiar tasa o comprobante para sortearla.
**Pendiente:** campos específicos de factura, notas y versión actual.

## t-registro — Consulta, alta, modificación y baja laboral

**Acceso:** Trámites y Consultas → Empresas → Mi RUC y Otros Registros → T-Registro. **Fuentes:** [Planilla electrónica](https://orientacion.sunat.gob.pe/sites/default/files/inline-files/PDF%20de%20T-Registro%20y%20PLAME.pdf), bloque T-Registro, enero de 2024; [Registro del prestador](https://www.sunat.gob.pe/ayuda/tributos/tregistro-E-P/T-Registro-H05.html), Opciones/Filtros, sin fecha editorial.

1. Precisar empleador/trabajador y operación; “RRHH” no identifica por sí solo un trámite.
2. En Registro Individual buscar documento/nombre; usar Mostrar Histórico de Prestadores para bajas.
3. Nuevo inicia alta; Modificar permite corrección/baja; Eliminar revierte inscripción indebida y no equivale a cese.
4. Revisar identidad y bloques laboral, seguridad social, educación y tributario aplicables.
5. Aprobar antes de grabar, dar baja o eliminar.

**Resultado:** CIR de alta, modificación o baja correcto.
**Datos:** información laboral sustentada; no inferir fechas ni régimen pensionario.
**Errores:** resolver validaciones de campos/fechas sin extrapolar requisitos entre categorías.
**Variantes:** reportes/archivo personalizado no modifican el registro, pero su transferencia la hace el usuario. No confundir web con carga PDT/PVS.

## plame-web-601 — Planilla mensual por web

**Acceso:** Declaraciones y Pagos, FV 0601 PLAME Web. **Fuentes:** [PLAME Web](https://orientacion.sunat.gob.pe/formulario-virtual-601-plame-web), Uso/Presentación; [planilla electrónica](https://orientacion.sunat.gob.pe/sites/default/files/inline-files/PDF%20de%20T-Registro%20y%20PLAME.pdf), bloque FV 0601, enero de 2024.

1. Comprobar elegibilidad para el periodo: las fuentes describen uso opcional, sector privado, hasta diez trabajadores/prestadores y conceptos específicos. Confirmar vigencia; no aplicar ese límite a todo PLAME/T-Registro.
2. Seleccionar periodo y recuperar datos del T-Registro con la función del sistema.
3. Revisar personal y completar jornadas, remuneraciones, retenciones y aportes sustentados.
4. Validar y aprobar presentación y pago por separado.

**Resultado:** constancia y estado de pago.
**Variantes:** PDT PLAME requiere aplicativo y archivos; no es la misma interfaz. Para rectificatoria revisar todos los conceptos exigidos.
**Vigencia pendiente:** las fuentes difieren sobre disponibilidad inicial; no rechazar periodos usando esa fecha sin consultar norma vigente.
**Pendiente:** recorrido interno y campos del empleador concreto.

## devolucion-1649 — Solicitud y seguimiento de devolución

**Acceso:** Trámites y Consultas; Personas/Empresas. **Fuente:** [Devolución FV 1649](https://emprender.sunat.gob.pe/sites/default/files/inline-files/Devoluci%C3%B3n%20FV 1649.pdf), pasos y consulta de estado; sin fecha editorial.

**Ruta publicada:** Otras declaraciones y solicitudes → Mis devoluciones → Registro de Solicitud de Devolución 1649.

1. Identificar concepto, periodo, pago y motivo; elegir tipo correspondiente, sin copiar códigos de otro supuesto.
2. Completar los requisitos del formulario.
3. Revisar importe/sustento y aprobar presentación.
4. Comprobar constancia y número de orden.
5. Para seguimiento: Consulta de estado - Solicitud de devolución, usando su referencia.

**Resultado inmediato:** solicitud presentada; **posterior:** resolución/abono si corresponde. No prometer aprobación por registrar.
**Variantes:** FV 1649, devolución automática y F4949/MPV no son equivalentes. Comprobar modalidad y adjuntos con [Devolución de impuestos](https://emprender.sunat.gob.pe/acciones-contribuyente/procedimiento-devolucion/devolucion-impuestos).
**Pendiente:** condiciones del tipo elegido, plazos vigentes y controles de archivos. NotebookLM aporta organización, no evidencia normativa.

## fraccionamiento-art36 — Aplazamiento o fraccionamiento

**Acceso:** Trámites y Consultas. **Fuente:** [Aplazar/fraccionar deuda](https://orientacion.sunat.gob.pe/sites/default/files/inline-files/Pasos%20para%20aplazar%20o%20fraccionar%20tu%20deuda.pdf), pasos 3–8; sin fecha editorial.

**Ruta publicada:** Mi Fraccionamiento → Solicito Fraccionamiento art.36 → Fracc Art.36.

1. Revisar precalificación por tipo de deuda; si falla, informar requisito concreto.
2. En Generación de pedido de deuda, revisar entidad y aprobar Enviar Solicitud.
3. Abrir Formulario Virtual 687 Sol. Fracc. Art.36 CT → Elaborar solicitud.
4. Revisar deudas, modalidad, cuotas, cuota de acogimiento y garantías sustentadas.
5. Validar y aprobar antes de Grabar/Generar Solicitud y sus confirmaciones.

**Resultado:** constancia de presentación, no aprobación del fraccionamiento. El pago de acogimiento es operación aparte.
**Recuperación:** ante pedido vencido/rechazo, leer mensaje antes de generar otro.
**Pendiente:** condiciones vigentes, modalidad y controles actuales. No codificar como universales los ocho requisitos o fórmulas no contrastados del informe. Se conserva su separación útil de fases respaldada por SUNAT.

## modificacion-1693 — Modificar o incluir datos

**Acceso:** Trámites y Consultas. **Fuentes:** [Paso a paso FV 1693](https://orientacion.sunat.gob.pe/sites/default/files/inline-files/Modificacion%20de%20datos%2022.08.25.pdf), pasos 1–4, archivo identificado 22.08.25; [pago con error](https://emprender.sunat.gob.pe/declaracion-pagos/pagos/reconocimiento-pago-con-error), apartado a.

**Ruta publicada:** Mis declaraciones informativas → Modifico datos de mis declaraciones y pagos → Modificación DDJJ → Form 1693 Solicitud de modificación de datos.

1. Identificar formulario/orden originales, campo y valores incorrecto/correcto.
2. Comprobar que ese formulario y campo admiten modificación. El ejemplo de periodo usa casilla 07, no todas las correcciones.
3. Completar formulario, orden, casilla, Dice y Debe decir.
4. Revisar y aprobar Registrar/Grabar según el efecto actual.

**Resultado:** constancia/estado y comprobación posterior del dato cuando proceda.
**Variantes:** corrección de tributo puede requerir reconocimiento de pago con error. FV 1693 no sustituye rectificar base/impuesto.
**Pendiente:** tabla vigente de campos/formularios y validaciones particulares.

## reconocimiento-pago-error — Pago con código de tributo errado

**Canal:** MPV o Centro de Servicios al Contribuyente, según supuesto. **Fuente:** [Reconocimiento de pago con error](https://emprender.sunat.gob.pe/declaracion-pagos/pagos/reconocimiento-pago-con-error), apartado b; sin fecha editorial.

La fuente contempla MPV además de presencial para algunos errores de código de tributo. Corrige “siempre presencial” del primer informe, sin extrapolarlo a toda corrección.

1. Distinguir dato modificable en FV 1693 de error de tributo.
2. Revisar el modelo oficial enlazado por SUNAT y requisitos del pago.
3. Preparar corrección, identificación y sustento.
4. Si requiere expediente/adjuntos, el usuario carga los archivos; presentar requiere aprobación propia.

**Resultado:** cargo y seguimiento; recepción no significa reconocimiento concedido.
**Pendiente:** modelo vigente y ruta MPV. No inventar reasignación automática mediante FV 1693.

## renta-anual-personas-709 — Renta anual de personas

**Acceso:** Renta Anual Personas. **Fuente:** [Cómo declarar, personas](https://renta.sunat.gob.pe/personas/como-realizar-la-declaracion-del-impuesto-la-renta), campaña Renta 2025 consultada en 2026.

1. Precisar ejercicio y obligación; abrir FV 709 de la campaña correcta.
2. Revisar información referencial de rentas, gastos, retenciones y pagos; modificar solo con sustento.
3. Completar conceptos aplicables, validar y revisar.
4. Aprobar presentación; pago/devolución son decisiones posteriores.

**Resultado:** constancia y estado independiente de pago/devolución.
**Pendiente:** ruta interna, casillas y requisitos del ejercicio. No fijar fechas, deducciones o vencimientos de una campaña como reglas futuras.
**Variante:** App Personas es otro canal.

## renta-anual-empresas-710 — Renta anual empresarial

**Acceso:** Renta Anual Empresas. **Fuente:** [Cómo declarar, empresas](https://renta.sunat.gob.pe/empresas/como-realizar-la-declaracion-del-impuesto-la-renta), campaña Renta 2025, FV 710 Simplificado/Completo.

1. Identificar ejercicio y supuestos oficiales para elegir formulario; tamaño aparente no basta.
2. Revisar estados financieros, renta/pérdida, adiciones, deducciones y créditos con sustento.
3. Validar y revisar resumen.
4. Aprobar presentación/pago y comprobar constancias respectivas.

**Resultado:** declaración del ejercicio/formulario pedido.
**Variantes:** versión portable no es interfaz web; no la controla este MCP.
**Pendiente:** casillas, anexos y requisitos de campaña. Consultar fuente vigente para elegibilidad; no fijar umbrales permanentemente en la skill.

## drawback-consulta — Consultar solicitud Drawback

**Acceso:** Portal del Operador, usuario habilitado. **Fuentes:** [Acceso](https://www.sunat.gob.pe/operatividadaduanera/manuales/drawback/ma_npase/paginas/pag2.html), secciones 2.1–2.2; [consulta](https://www.sunat.gob.pe/operatividadaduanera/manuales/drawback/ma_npase/paginas/pag3.2.html), sección 3.2; manual legado sin fecha editorial.

**Ruta publicada:** Portal del Operador de Comercio Exterior → SDA - Sistema de Despacho Aduanero → DrawBack → Consulta de Solicitud.

1. Confirmar modo consulta, no Solicitud de Restitución.
2. Filtrar por número/fechas y Consultar.
3. Abrir resultado y revisar datos generales, exportación/insumos y documentos.

**Resultado:** estado/detalle de la solicitud correcta.
**Frontera:** Rectificar/Modificar cambian datos y requieren solicitud/aprobación propias. Formato de impresión implica archivo del usuario.
**Pendiente:** correspondencia con portal actual y permisos; no asumir que toda cuenta es operador habilitado.

## exporta-facil — Declaración Exporta Fácil

**Acceso:** Operador de Comercio Exterior; flujo mixto SOL/Serpost. **Fuente:** [Exporta Fácil](https://asistenteaduanero.sunat.gob.pe/servicio-postal-nacional-serpost-importa-facil-fob-hasta-5000), requisitos y pasos 1–4; fecha visible 13/12/2017, referencia histórica.

1. Comprobar modalidad, mercancía y requisitos vigentes; no reutilizar límites monetarios, pesos/plazos históricos sin verificación.
2. Localizar Registro de declaración Exporta Fácil en el menú actual.
3. Completar mercancía, destino y documentos sustentados.
4. Revisar y aprobar antes de registrar/numerar DEF.
5. Comprobar número/estado; impresión, firma, entrega a Serpost y transporte son pasos externos.

**Resultado web:** declaración registrada; no exportación embarcada/regularizada.
**Pendiente:** ruta exacta, controles y documentos vigentes. No sustituir por Importa Fácil o exportación definitiva general.

## nps-consulta — Consulta de Número de Pago SUNAT

**Acceso:** Trámites y Consultas, perfil Personas. **Evidencia:** ruta_observada el 24/10/2026; formulario abierto, sin ejecutar una búsqueda ni un pago. **Ruta confirmada por menú, sin buscador:** Personas → Mis declaraciones informativas → Presento mis declaraciones y pagos → Declarativas → Consulta de NPS. `routeId: nps-consulta-menu-sol-personas`; destino comprobado: Consulta de Número de Pago SUNAT. No es un pago ni una búsqueda de operaciones verificada.

**Procedencia:** controles renderizados de la página oficial autenticada. No se encontró en esta revisión un manual público específico de esta consulta. [Concepto oficial de NPS](https://orientacion.sunat.gob.pe/nps-numero-de-pago-sunat-personas), apartados de generación y pago, aporta contexto; no se le atribuyen las etiquetas observadas. Fuente sin fecha editorial visible; revisión 24/10/2026.

1. Reutilizar la ruta observada de consulta en `sunat://operaciones`. Si cambió, explorar únicamente el tramo faltante.
2. Confirmar el título **Consulta de Número de Pago SUNAT** y **Criterios de Búsqueda de NPS**.
3. Elegir el criterio que corresponda al pedido: número de NPS; fechas Desde/Hasta; o Estado del NPS. La pantalla observada ofrece Vigente, Pagado, Vencido y Anulado. Cada bloque tiene su propio botón Buscar: no elegir un Buscar ambiguo sin comprobar el bloque.
4. Tras consultar, revisar las filas/detalle y el estado. Una pantalla vacía antes de buscar no acredita ausencia de NPS. No aplicar límites de otras consultas a este formulario.

**Frontera:** abrir/consultar no genera NPS ni paga. Si se pidió generar o pagar, usar la ficha específica, sin sustituir el pedido por esta consulta. No se comprobó búsqueda, detalle, pago ni acceso desde Empresas.

## nps-generacion — Generar Número de Pago SUNAT

**Acceso:** Mis Declaraciones y Pagos, distinto de Trámites y Consultas. **Evidencia:** guia_publica; generación no ejecutada.

**Fuentes:** [Generación del NPS](https://orientacion.sunat.gob.pe/6652-03-generacion-del-nps), acceso publicado; [guía de funcionalidades](https://e-plataformaunica.sunat.gob.pe/app/recaudacion/tributaria/internet/html/archivos-ayuda/AyudasFuncionalidadesParte3.pdf), pp. 11–15, fases Complete, Presente/Pague y Constancia; [Canal Virtual](https://e-renta.sunat.gob.pe/ol-ti-itcanal-bs/canal.do), pasos 1–3 y opción NPS. Sin fecha editorial/versionado visible en el contenido consultado; revisión 24/10/2026. Las ayudas conservan interfaces históricas: cotejar etiquetas vigentes.

**Complemento audiovisual oficial:** [¿Cómo genero el Número de Pago Sunat (NPS)?](https://www.youtube.com/watch?v=d2kRPkVpy8U), canal SUNAT, publicado el 18/03/2026. Se revisaron sus subtítulos: acceso 0:44–1:01; ruta de boletas 1:03–1:17; preparación y generación 1:18–1:46; constancia y pago posterior 1:49–2:07. Evidencia documental, sin observar esta ruta en una cuenta.

1. Identificar el formulario, tributos, periodo y deuda solicitados; leer también su ficha. No volver a presentar una declaración existente solo para obtener un código de pago.
2. Entrar por Declaraciones y Pagos; elegir y completar el formulario correcto. Revisar la bandeja y el preliminar. Un preliminar no es una presentación.
   Para una boleta de pago, el video publica **Mis declaraciones y pagos → Presentación y pago → Boletas de pago → tipo de pago**; «Pago de tributos» es su ejemplo, no una elección automática para cualquier deuda. Completar la información, Siguiente, revisar el importe y Pagar ahora según los controles actuales.
3. Revisar **Presentar/Pagar/NPS** o **Presente/Pague**, según interfaz, y la opción **Número de Pago SUNAT**. Antes del clic que presente o genere, mostrar contribuyente, formularios, tributos, periodos e importes y obtener aprobación expresa. La generación puede incluir presentación de declaraciones; explicarlo en esa aprobación.
4. Comprobar el NPS/voucher con su deuda asociada y, cuando corresponda, la constancia de presentación. Mantener ambos resultados separados del pago bancario.

**Punto decisivo del video (1:33–1:42):** indica que elegir NPS ya genera el código y luego muestra Presentar/Pagar. Obtener la aprobación antes de seleccionar NPS, sin esperar a un botón posterior. La constancia de generación se utiliza para pagar después; no acredita pago.

**Límite de ejecución:** ficha de orientación y preparación. El trabajo tributario debe corresponder al formulario y fase concretos (por ejemplo, presentación del 621), con cuenta importada verificada y aprobación del servidor; esta ficha genérica no habilita otro tipo de envío.
**Pendiente:** ruta y controles actuales de generación, restricciones y vigencia del NPS deben comprobarse en pantalla. No fijar listas de bancos, exclusiones, plazos ni cifras de ejemplos antiguos. Si el resultado es incierto, consultar antes de generar nuevamente.

## nps-pago — Pago posterior de un NPS

**Canal:** entidad bancaria o canal de pago autorizado. **Evidencia:** guia_publica; paso externo al navegador SUNAT controlado por este MCP. **Fuente:** [Concepto oficial de NPS](https://orientacion.sunat.gob.pe/nps-numero-de-pago-sunat-personas), párrafos de pago y constancia; sin fecha editorial visible, revisión 24/10/2026.

1. Partir de un NPS ya generado. Comprobar estado, deuda y vigencia; si figura Pagado o hubo un intento incierto, verificar la constancia antes de repetir.
2. El usuario efectúa el pago en un canal autorizado indicando el NPS. Este MCP no accede a banca ni solicita claves bancarias. La generación del código no constituye débito ni prueba el pago.
3. Verificar la constancia del pago, identificada por SUNAT como **Formulario Virtual 1663 – Boleta de Pago**, y después consultar el estado del NPS. No deducir pago de una presentación o de un voucher de generación.

**Frontera:** cualquier pago requiere autorización específica de acción y datos. No abrir bancos desde una ruta SOL ni marcar el trabajo como pagado por una pantalla pendiente. Comprobar canales actualmente disponibles en la fuente/pantalla; no asumir que NPS y NPD son equivalentes.

## Mantenimiento y procedencia

El informe del usuario de NotebookLM aportó estructura y separación de fases, especialmente devolución/fraccionamiento. No es fuente normativa ni se guarda su contenido privado. Se descartaron promesas de cero errores, cifras de rendimiento, requisitos no contrastados y el formulario presencial 1062 como supuesto recorrido de navegador.

Cada ficha identifica fuentes, alcance y vacíos. Comprobar normas/condiciones del periodo antes de decidir. Las rutas de manuales conservan evidencia guia_publica; solo pasan a ruta_observada tras verlas en sesión. El aprendizaje local guarda rutas y pasos canónicos de procedimientos, nunca formularios o valores. Distingue pasos observados de fases con una señal renderizada de finalización. No sobrescribe esta fuente oficial compartida: agrega el complemento local al recurso de cada ficha.
