# Catálogo inicial de operaciones SUNAT

El índice estructurado de enrutamiento que usa el MCP está en [`../data/operation-index.json`](../data/operation-index.json) y se expone como `sunat://operaciones`. Este documento mantiene el inventario y sus estados de evidencia. Las guías oficiales paso a paso resumidas están en [`procedimientos-publicos.md`](procedimientos-publicos.md); consulta solo la ficha que corresponde al servicio pedido.

**Revisión documental:** 2026-10-23
**Cobertura:** inventario de servicios y categorías observadas anteriormente en SOL, complementado con las fichas oficiales de procedimientos. La revisión documental no añade observaciones de la cuenta ni confirma acceso a todos los servicios; las opciones varían por perfil y permisos.

## Cómo leer el catálogo

- **Inventariado:** SUNAT publica el área o servicio o el menú SOL lo muestra.
- **Guía pública:** SUNAT publica instrucciones; sirven como referencia inicial y no están verificadas en la cuenta actual.
- **Ruta observada:** vimos el recorrido de categorías en la pantalla SOL iniciada; se puede reutilizar sin buscarlo nuevamente.
- **Recorrido verificado:** el usuario completó el flujo y comprobamos los pasos y el resultado en la página renderizada. No se asigna este estado solo por leer una guía.

La sesión SOL puede mostrar opciones distintas según perfil, permisos, régimen, estado del RUC y calidad de representante. Este documento no almacena Clave SOL, datos de declaraciones ni datos personales. `data/operation-index.json` conserva accesos, guías públicas enlazadas y rutas observadas. Las etiquetas de navegación confirmadas se aprenden en el perfil local; no se guardan formularios ni resultados tributarios.

## Ficha de ruta para reutilizar

Para cada operación que se incorpore al índice, registrar una sola vez:

- Nombre común y sinónimos que puede usar el usuario.
- Acceso SOL inicial: `declaraciones-pagos`, `tramites-consultas`, `renta-anual-personas` o `renta-anual-empresas`. Aunque compartan autenticación SOL, son áreas de entrada y funcionalidades diferentes; las guías no se deben mezclar.
- Perfil aplicable (Personas, Empresas u Operador de Comercio Exterior).
- Ruta exacta de categorías y subcategorías del menú; URL oficial inicial si existe.
- Requisitos previos y categorías de datos necesarias durante la ejecución; no pedir credenciales por chat ni guardar valores en la ficha.
- Resultado visible que confirma una consulta o trámite y el momento exacto donde se detiene para aprobación.
- Estado de evidencia y fecha de revisión.

En futuras solicitudes, usar la ruta observada coincidente con lotes cortos. Si falta, consultar la ficha publicada y descubrir solo la rama necesaria. Las instrucciones oficiales pueden documentarse como guia_publica antes de ejecutarlas; solo un flujo completado y comprobado obtiene el estado recorrido_verificado. El aprendizaje local conserva etiquetas de navegación y pasos canónicos de procedimientos por instalación, con evidencia genérica de fase; no guarda datos de cuenta ni resultados fiscales concretos.

## Menú SOL observado en sesión iniciada

### Accesos iniciales mostrados en la pantalla SOL

La pantalla de entrada distingue cuatro opciones funcionales, aunque las cuatro usan la autenticación SOL:

| Identificador MCP | Acceso visible | Funcionalidad que anuncia la pantalla |
|---|---|---|
| `declaraciones-pagos` | Mis Declaraciones y Pagos | Declaración y pago de IGV, renta mensual, agentes de retención y percepción; pago y consulta de detracciones. |
| `tramites-consultas` | Mis Trámites y Consultas | Trámites y consultas virtuales para Personas, Empresas y Operadores de Comercio Exterior. El perfil elegido aquí es una dimensión adicional, no un acceso equivalente. |
| `renta-anual-personas` | Declara Renta Anual → Personas | Declaración y pago del Impuesto a la Renta anual para Personas Naturales. |
| `renta-anual-empresas` | Declara Renta Anual → Empresas | Declaración y pago del Impuesto a la Renta anual para Empresas. |

Los procedimientos aprendidos llevan tanto el identificador de este acceso inicial como el perfil SOL. Así, el MCP puede reutilizar la ruta adecuada sin confundir una sesión compartida con funcionalidades compartidas. La imagen de referencia muestra ejercicios 2019–2025; esos años son contenido de la pantalla y no se fijan como una regla permanente del catálogo.

**Fecha de observación:** 2026-10-21. Se revisó el menú de Personas, Empresas y Operador de Comercio Exterior en la pestaña SUNAT abierta por el usuario. La revisión fue de solo lectura. Los nombres siguientes son categorías del menú, no confirmación de que se ejecutó cada servicio.

### Personas

Mi RUC y Otros Registros; Perfil de Cumplimiento; Propuesta información para declaración jurada; Comprobantes de pago; Sistema Integrado de Registros Electrónicos; Mis declaraciones informativas; Otras declaraciones y solicitudes; Ventanilla de Atención al Operador; Observaciones realizadas por SUNAT; Reactiva Perú; Presentación de Recursos y Trámites; Programa de Garantías COVID_19; Plataforma de Confirmación del RHE y de la FE; Libro de Reclamaciones; Revisión de mis deudas; Mi fraccionamiento; Expediente Virtual; Plataforma Electrónica de Fiscalización; Mis Avisos Electrónicos; Omiso a la presentación DJ; Operaciones de Comercio Exterior; SIGA; CCI Único; Credenciales de API SUNAT; Control Electrónico Trazabilidad de Mercancía.

Accesos directos visibles: Consulta de Devoluciones; Emisión y Consulta de Recibos por Honorarios Electrónicos; Suspensión de Retenciones de 4ta Categoría; Reporte Tributario para Terceros; Modificación de Datos del RUC; Registro de Trabajadores del Hogar; Consulta de Declaraciones Juradas y Pagos.

### Empresas

Mis Declaraciones y pagos; Mi RUC y Otros Registros; Guía de Remisión Electrónica; Perfil de Cumplimiento; Propuesta información para declaración jurada; Procedimientos No Contenciosos; Comprobantes de pago; Sistema Integrado de Registros Electrónicos; Sistema de Libros y Registros Electrónicos; Mis declaraciones informativas; Portal del Operador de Comercio Exterior; Ventanilla de Atención al Operador; Otras declaraciones y solicitudes; Observaciones realizadas por SUNAT; Reactiva Perú; Presentación de Recursos y Trámites; Programa de Garantías COVID_19; Nuevo Sist. de Embargo por Medios Telemáticos; Plataforma de Confirmación del RHE y de la FE; Libro de Reclamaciones; Revisión de mis deudas; Mi fraccionamiento; Expediente Virtual; Opción para Imprentas SOL; Plataforma Electrónica de Fiscalización; Acceso a Entidades Externas; Registro para control de Bienes Fiscalizados; Mis Avisos Electrónicos; Omiso a la presentación DJ; Operaciones de Comercio Exterior; SIGA; CCI Único; Credenciales de API SUNAT; Liquidación de la Declaración Jurada; Control Electrónico Trazabilidad de Mercancía.

Accesos directos visibles: Consulta de Detracciones; Emisión de Factura Electrónica; Consulta de Facturas y Notas Electrónicas; Registro de Trabajadores T Registro; Ficha RUC; Modificación de Datos de Declaraciones Juradas; Consulta de Declaraciones Juradas y Pagos; Consulta de Valores Pendientes de Pago.

### Operador de Comercio Exterior

Manifiesto de Carga de Ingreso; Regímenes Especiales; Ingreso y Salida de Mercancías; Despacho Aduanero de Ingreso; Destinación Aduanera de Mercancías; Avisos Electrónicos; Despacho Garantizado; Drawback; Exporta Fácil; Importa Fácil; Control Aduanero; Documentos Aduaneros; Recaudación; Transbordo.

Accesos directos visibles: Servicio Web Receptor; Designación de Almacén o Terminal Portuario - MC; Solicitud Drawback; Registro OEA; Consulta de Cta. Cte. - Despacho Garantizado; Registro Exporta Fácil; Consulta Exportación Simplificada; Registro de Solicitud de Tránsito A. I. CAN-ALADI.

### Primera rama desplegada

En **Mi RUC y Otros Registros → Mis Datos del RUC → RUC** se observaron las opciones **Ficha RUC** y **Captura de Acuse de Recibo**. El grupo **Mi RUC y Otros Registros** también muestra: Actualizo información de mi RUC; Reporte Tributario y Aduanero; Registro del Trab. del Hogar y sus derechohabientes; Envío Reporte Tributario; Establecimientos Afiliados; Establecimientos Autorizados; Registro Productores Mineros y Fab. Nac. Joyas D. Leg. 1552. Las ramas restantes siguen pendientes de despliegue.

## Áreas identificadas

| Área | Operaciones publicadas por SUNAT | Estado inicial |
|---|---|---|
| RUC y datos del contribuyente | Inscripción; suspensión y reinicio de actividades; modificación o confirmación de domicilio fiscal; actividad económica; alta/baja de tributos y establecimientos; actualización de contacto; baja del RUC; consulta y descarga de Ficha RUC. | Inventariado; algunas guías públicas |
| Acceso SOL y usuarios | Obtener o cambiar Clave SOL; crear usuarios secundarios y asignarles opciones. Las credenciales se resuelven localmente mediante sunat_iniciar_sesion; los desafíos de autenticación los completa el usuario. | Inventariado; guía pública parcial |
| Comprobantes de pago | Emisión electrónica de factura, boleta, recibo por honorarios, notas, liquidación de compra y guías; baja de comprobantes o series; autorizaciones de impresión; consulta de emisión y validación de comprobantes recibidos. | Inventariado; guías públicas por tipo |
| Declaraciones y pagos tributarios | Declaraciones mensuales y anuales; formularios virtuales/PDT; Declara Fácil; NRUS; tributos de independientes y arrendamiento; retenciones/percepciones; consulta de declaraciones y pagos; pagos por los medios disponibles en SOL. | Inventariado; guías públicas por formulario |
| Libros y registros electrónicos | SIRE: Registro de Ventas e Ingresos Electrónico (RVIE) y Registro de Compras Electrónico (RCE); propuesta, ajustes, generación, consultas y opciones de acceso por SOL, aplicativo cliente o API según el servicio. | Inventariado; guías públicas; falta verificar el menú actual |
| Solicitudes tributarias | Devoluciones; liberación de fondos; compensación; aplazamiento/fraccionamiento; modificación de datos de declaraciones o pagos; solicitudes relacionadas con saldos y procedimientos especiales. | Inventariado; guías públicas por solicitud |
| Consultas, reportes y deuda | Buzón SOL y notificaciones; Ficha RUC; declaraciones y pagos; reporte tributario para terceros; rentas y retenciones; valores/deudas y pagos pendientes; estado de solicitudes, quejas y devoluciones. | Inventariado; guías públicas por reporte |
| Detracciones, retenciones y percepciones | Consultas y solicitudes relacionadas con SPOT/detracciones, retenciones y percepciones, incluida reimputación cuando corresponda. | Inventariado; guía pública parcial |
| Otras gestiones tributarias | Escritos virtuales vinculados a cobranza coactiva; quejas, sugerencias y denuncias; declaración de predios y otras declaraciones informativas; avisos y registros relacionados con planilla según el perfil. | Inventariado; requiere delimitar cada trámite |
| Planilla electrónica | T-Registro y operaciones relacionadas para quienes declaran Planilla Electrónica. | Inventariado; requiere delimitar cada trámite |
| Aduanas: consultas públicas | Consulta de declaraciones/DUA, expedientes, aduanas, origen/destino, importadores/exportadores, partidas, contenedores, envíos, órdenes, levante, manifiestos y otras consultas aduaneras. | Inventariado en el portal de Operatividad Aduanera |
| Aduanas: operaciones y regímenes | Importación definitiva; exportación definitiva y temporal; admisión temporal; depósito; reembarque; tránsito; manifiestos; declaración simplificada de exportación; Importa Fácil/Exporta Fácil; pago electrónico aduanero; Drawback; SDA/SEIDA y Teledespacho para operadores habilitados. | Inventariado; las rutas y permisos varían por operación y operador |

## Procedimientos prioritarios para convertir en recorridos

La prioridad se decide por el flujo que pida el usuario. Candidatos iniciales, por la disponibilidad de guías oficiales: consultar RUC y generar Ficha RUC; consultar/validar un comprobante; emitir recibo por honorarios; emitir factura/boleta; consultar declaraciones y pagos; presentar una declaración seleccionada; consultar una deuda; y navegar SIRE. Aduanas se trabaja por régimen y rol del operador, no como un único procedimiento.

Cada recorrido debe especificar:

1. Servicio y perfil al que aplica; URL oficial de entrada.
2. Requisitos previos (sin copiar secretos ni datos de declaraciones a la documentación).
3. Menú y pasos observados, incluyendo bifurcaciones relevantes.
4. Qué resultado visible confirma la consulta o trámite.
5. Acciones que presentan, emiten, modifican, pagan, anulan o registran: detenerse, mostrar los datos exactos y esperar aprobación explícita antes de confirmar.
6. Fecha de verificación y límites conocidos (por ejemplo, permisos o versión de la plataforma).

Antes del paso que presenta o confirma una operación tributaria, mostrar acción y datos y obtener aprobación explícita de un uso. No descargar ni subir archivos por las herramientas de navegación del MCP.

## Cobertura documental revisada el 23/10/2026

El índice `sunat://procedimientos` contiene 30 fichas; cada una se consulta con `sunat://procedimientos/{id}`. La fuente mantenida es [Procedimientos públicos](procedimientos-publicos.md), investigada con fuentes oficiales mediante Exa y Firecrawl en Composio. Cubre RUC, SIRE, declaración mensual, consultas de pagos/deuda, detracciones, buzón, comprobantes, T-Registro/PLAME, devoluciones, fraccionamiento, correcciones, renta anual y referencias aduaneras. La cobertura parcial y los manuales históricos están marcados en cada ficha.

Los IDs documentales se distinguen de `observedRoutes`: no se añadieron rutas observadas por leer manuales. Se separan el registro de una solicitud, su constancia, el pago y la resolución posterior. Los límites de intervalo publicados se aplican por canal y se resuelven con consultas sucesivas si el pedido es más amplio.

## Fuentes oficiales consultadas

- [Trámites y transacciones que puedes hacer por Internet](https://orientacion.sunat.gob.pe/1089-tramites-por-sunat-operaciones-en-linea)
- [Trámites y/o transacciones con la Clave SOL](https://orientacion.sunat.gob.pe/04-tramites-yo-transacciones-con-la-clave-sol)
- [Acceso a SUNAT Operaciones en Línea](https://orientacion.sunat.gob.pe/03-acceso-sunat-operaciones-en-linea-sol)
- [Declaraciones tributarias](https://emprender.sunat.gob.pe/declaracion-pagos/declaracion/declaraciones-tributarias)
- [Sistema Integrado de Registros Electrónicos (SIRE)](https://emprender.sunat.gob.pe/comprobantes-libros/registros-libros-electronicos/sistema-integrado-registros-electronicos-sire)
- [Formas de acceso al SIRE](https://cpe.sunat.gob.pe/node/158)
- [Reportes Electrónicos](https://centrovirtual.sunat.gob.pe/tramites/reportes-electronicos)
- [Operatividad Aduanera](https://www.sunat.gob.pe/operatividadaduanera/index.html)

## NPS: consulta, generación y pago

Ampliación 24/10/2026. `nps-consulta` documenta el formulario observado y la ruta Personas → Mis declaraciones informativas → Presento mis declaraciones y pagos → Declarativas → Consulta de NPS. Se abrió su destino sin ejecutar búsquedas ni pagos; evidencia `ruta_observada`. Reutilizar `routeId: nps-consulta-menu-sol-personas`.

`nps-generacion` y `nps-pago` enlazan las guías oficiales de [generación](https://orientacion.sunat.gob.pe/6652-03-generacion-del-nps) y [concepto/pago](https://orientacion.sunat.gob.pe/nps-numero-de-pago-sunat-personas). La generación pertenece a Declaraciones y Pagos y puede acompañar una presentación; el pago posterior se realiza por un canal autorizado. No confundirlos con la consulta SOL, ni registrar un voucher NPS como constancia de pago. Ver las tres fichas para requisitos, comprobaciones y fronteras.

## Biblioteca documental de los índices oficiales

La herramienta `sunat_guias` devuelve primero fichas estructuradas con pasos locales y rutas observadas asociadas. Filtra canal y operación; el [catálogo de referencias](guias-oficiales.md) se consulta explícitamente con alcance referencias o todo. Las fuentes fallidas se retiran y se conservan cantidades agregadas; las copias se fusionan solo con huella binaria idéntica. Sus IDs documentales no crean rutas ni contratos fiscales nuevos. Las revisiones adicionales pueden persistirse con una huella del contenido consultado para reutilizar sus pasos sin abrir de nuevo la URL.

## Accesos SOL sin ventanas del portal

`sunat_brave_ejecutar_lote` acepta `entryPoint` como alternativa a `routeId` o `steps`: `declaraciones-pagos`, `tramites-consultas`, `renta-anual-personas` y `renta-anual-empresas`. Navega en la pestaña controlada; los destinos públicos, fuentes y fecha de revisión están en `data/operation-index.json`. Una dirección pública no demuestra acceso de la cuenta ni finalización del trámite. Renta Empresas conserva la página de entrada oficial, sin seleccionar campaña ni formulario.

Las ventanas hijas excepcionales deben proceder del clic y contexto actuales y terminar en HTTPS SUNAT. Al seguirlas se descartan controles y aprobaciones anteriores y se comprueba otra vez la cuenta importada; nunca se escoge la última ventana ni se repite un clic incierto.
