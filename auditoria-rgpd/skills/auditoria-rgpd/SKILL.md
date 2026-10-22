---
name: auditoria-rgpd
description: Auditoría técnica RGPD/LOPDGDD del código de una aplicación propia (.NET, Angular, Flutter): mapa de tratamientos, hallazgos con artículo, evidencia y corrección, y contraste docs vs código.
---

# Auditoría técnica RGPD (España) sobre código

Audita un repositorio (backend, frontend, móvil, despliegue y documentación) y genera un informe de hallazgos con cita de artículos del RGPD, la LOPDGDD y la normativa laboral española, severidad, confianza, evidencia (fichero:línea) y corrección recomendada.

Basada en la metodología de `gdpr-audit` (mastepanoski/claude-skills, licencia MIT), adaptada al contexto español y al stack .NET / EF Core / Angular / Flutter, y con una fase añadida de contraste entre lo que dice la documentación y lo que hace el código.

**El resultado es una auditoría técnica, nunca un dictamen de «cumple / no cumple».** El cumplimiento es una determinación jurídica. Incluye siempre el aviso final.

## Cuándo usarla

- Auditar una aplicación propia o de un cliente antes de salir a mercado, tras añadir una funcionalidad con datos personales o de forma periódica.
- Revisar un esquema de BD, un plan de implementación o una EIPD frente al código real.
- Preparar el material técnico para el DPO o para una EIPD.

## Cuándo no usarla

- Redactar desde cero políticas de privacidad, contratos de encargo o EIPDs: es redacción, no auditoría (se puede hacer después, a partir del informe).
- Auditar una web pública por URL: esta skill trabaja sobre código.
- Evaluar la madurez organizativa (formación, independencia del DPO): no se ve en el código.

---

## Reglas de trabajo

- **Solo lectura.** No se modifica código, no se hacen commits ni se ejecutan migraciones. El único fichero que se escribe es el informe.
- **Nunca reproducir secretos.** Si se encuentra una clave, contraseña o token, se cita fichero, nombre de la clave y, como mucho, un prefijo de 6-8 caracteres para identificarla (p. ej. `sk_test_`, `private_key_id 1a2b3c…`). Nunca el valor completo, ni en el informe ni en la respuesta.
- **No hablar de código sin abrirlo.** Cada hallazgo tiene evidencia literal con fichero y línea.
- **Distinguir lo comprobado de lo supuesto.** Lo que depende de configuración de producción (Infisical, variables de entorno, cron del servidor) va a «Supuestos» o a «Verificación necesaria», nunca se da por hecho.
- **Reconocer lo que está bien.** El resumen incluye los controles existentes que funcionan; el informe no es solo una lista de problemas.

---

## Flujo de la auditoría

Ejecuta las fases en orden. No te saltes ninguna.

### Fase 0 — Reconocimiento y afirmaciones documentadas

1. Lee `CLAUDE.md`, `README` y la estructura del repo para identificar el stack y los componentes.
2. Busca la documentación de privacidad existente: `doc/`, `docs/`, ficheros con `rgpd|gdpr|privacy|privacidad|eipd|dpia|rat|ropa|hosting|security|lopd` en el nombre o en el contenido.
3. Extrae una **lista de afirmaciones verificables** de esa documentación. Ejemplos:
   - «Todos los datos personales están cifrados en reposo» / «los campos X, Y, Z se cifran».
   - «Ningún dato de empleados sale de la UE».
   - «La única limitación conocida es…».
   - «Los datos se conservan N años y después se borran».
   - «El rol X nunca ve la geolocalización».

   Cada afirmación se comprobará en la Fase 4.
4. Determina los **roles**: ¿la aplicación es responsable o encargada del tratamiento para cada colectivo? (Típico en SaaS B2B: encargado respecto a los datos de empleados o clientes finales del cliente; responsable respecto a la facturación, los logs propios y el marketing.) Esto cambia qué obligaciones se buscan (art. 28 frente a arts. 13-14).

### Fase 1 — Alcance

```
## Alcance
- Materiales revisados: <repo, rama, commit, rutas>
- Fecha: <AAAA-MM-DD>
- Excluido: <node_modules, bin/obj, builds, tests, historial git salvo comprobaciones puntuales…>
- Supuestos: <rol de encargado/responsable, configuración de producción no verificada…>
- Contexto que falta: <DPA, RAT, configuración real de secretos, cron del servidor…>
```

### Fase 2 — Mapa de tratamientos

Constrúyelo antes de buscar problemas. Cada hallazgo posterior se vincula a una fila.

```
| Actividad | Datos | Interesados | Finalidad | Base (declarada / inferida / no clara) | Destinatarios / encargados | País | Conservación (declarada / inferida / no clara) |
```

Fuentes: entidades y configuración de EF (`Entities/`, `IEntityTypeConfiguration`), migraciones, endpoints, DTOs, jobs (Quartz, Hangfire, `BackgroundService`), `HttpClient` hacia terceros, SDKs (Stripe, Firebase, Sentry, SMTP), `appsettings*.json`, `docker-compose`, scripts de despliegue y backups, `package.json`, `pubspec.yaml`, manifiestos Android/iOS.

Si no se puede construir un mapa, dilo y detente: un informe sin mapa no tiene fundamento.

### Fase 3 — Barrido de detección

Recorre los capítulos de la sección «Guía de detección» para cada fila del mapa. Siempre: C1, C2, C6, C7, C9, C10, C14 y C15. Condicionales según los disparadores: C3, C4, C5, C8, C11, C12 y C13. Aplica además la guía de stack que corresponda.

### Fase 4 — Contraste documentación frente a código

Para cada afirmación de la Fase 0, busca la evidencia en el código. Si el código la contradice:

- Es un hallazgo propio, aunque el problema técnico ya esté en otro hallazgo, con arts. 5.2 (responsabilidad proactiva) y, si la afirmación está en la EIPD, art. 35.11 (revisión de la EIPD).
- Cita las dos evidencias: la frase del documento (fichero:línea) y el código que la desmiente.

Esta fase suele dar los hallazgos más valiosos: los equipos que documentan privacidad tienden a añadir campos, integraciones o flujos después y no actualizan la documentación.

### Fase 5 — Hallazgos

Un hallazgo por cada carencia concreta, con el esquema de abajo. Agrupa solo variantes triviales del mismo problema (p. ej. cinco líneas de log iguales).

### Fase 6 — Informe

Escríbelo en español en `doc/AUDITORIA-RGPD-<AAAA-MM-DD>.md` del propio repositorio (o en `docs/`, según la convención del repo). Si el usuario indica otra ruta, usa esa. Orden:

1. Alcance
2. Mapa de tratamientos
3. Tablas de hallazgos por tipo (confirmados → probables → lagunas de evidencia → recomendaciones), cada una de Crítica a Baja
4. Detalle de cada hallazgo
5. Resumen: recuento por tipo, si procede EIPD (o su revisión) y qué está bien hecho
6. Próximas acciones, ordenadas por impacto (primero lo urgente que no depende del DPO, como rotar secretos)
7. Aviso

### Fase 7 — Oferta de parches

Al terminar, ofrece preparar los parches de los hallazgos que el usuario elija. No incluyas parches en el informe: tapan la señal de la auditoría.

---

## Esquema de hallazgo

```yaml
id: F-NN
titulo: <frase nominal corta>
severidad: Crítica | Alta | Media | Baja
tipo: confirmado | probable | laguna_de_evidencia | recomendacion
confianza: Alta | Media | Baja
riesgo_para_los_interesados: <qué le puede pasar a una persona; no «multas»>
ubicacion: <fichero:línea | sección | "(ausencia)">
articulos: [RGPD 5.1.c, RGPD 32.1.a, LOPDGDD 90, ET 34.9]
datos_afectados: [...]
interesados: [empleados, clientes, usuarios finales…]
actividad: <fila del mapa>
evidencia: |
  <fragmento literal con fichero:línea>
correccion_recomendada: |
  <1-3 frases, no un parche>
verificacion_necesaria: |
  <qué evidencia cerraría el hallazgo>
```

### Severidad

| Severidad | Significado |
|---|---|
| **Crítica** | Infracción directa, alto riesgo para los derechos y confianza alta. P. ej.: datos de salud expuestos públicamente; secretos de producción en un repo público; datos de la UE enviados a un tercer país sin mecanismo de transferencia. |
| **Alta** | Infracción directa o carencia de alto riesgo con confianza material. La AEPD actuaría si lo descubriera. |
| **Media** | Carencia material corregible con una decisión de diseño. |
| **Baja** | Desviación de buenas prácticas sin riesgo inmediato. |

La severidad es el juicio del auditor, no probabilidad × impacto. La confianza es un eje aparte.

### Tipo

| Tipo | Significado |
|---|---|
| `confirmado` | Hay evidencia positiva de la carencia en el código. |
| `probable` | Señal fuerte, pero falta contexto para tener certeza. |
| `laguna_de_evidencia` | Debería verse un control y no se ve. |
| `recomendacion` | Técnicamente defendible; mejora de diseño. |

**Disciplina con las lagunas:** solo se marca una ausencia cuando hay evidencia positiva del tratamiento Y un control razonablemente esperable. «No existe `doc/rat.md`» no es un hallazgo. «Se usa Firebase, salen datos de empleados a EE. UU. y no hay DPA ni lista de subencargados» sí lo es.

### Confianza

| Nivel | Significado |
|---|---|
| Alta | Evidencia directa en el código, sin interpretación alternativa razonable. |
| Media | Inferencia fuerte; hay alternativas, pero menos probables. |
| Baja | Sospecha por patrón; requiere verificación humana. |

---

## Capas que se activan con disparadores

### Categorías especiales (art. 9 RGPD, art. 9 LOPDGDD)
**Disparador:** salud (bajas, incapacidad temporal, justificantes médicos, discapacidad, adaptaciones de puesto, alergias), biometría (huella, reconocimiento facial para fichar), afiliación sindical (cuotas, delegados, representantes de los trabajadores), condenas o certificados de antecedentes.
**Efecto:** severidad mínima **Alta** para cualquier tratamiento sin protección reforzada. Exige base del art. 9.2 explícita (en el ámbito laboral, normalmente 9.2.b). Ojo: que un empleado conste «de baja» o en «incapacidad» ya es un dato de salud, aunque no se guarde el diagnóstico. Los adjuntos (`byte[]`, `bytea`, blobs, ficheros en disco o S3) se revisan siempre. EIPD casi segura.

### Ámbito laboral (España)
**Disparador:** registro de jornada, fichajes, turnos, ausencias, nóminas, evaluación del desempeño, control de actividad.
**Efecto:** el consentimiento casi nunca es base válida (art. 7.4, desequilibrio de poder): busca 6.1.b, 6.1.c (art. 34.9 ET) o 6.1.f. Comprueba las garantías de los arts. 87 a 91 LOPDGDD y que el producto permita al empleador cumplir su deber de informar. Los empleados son un colectivo vulnerable a efectos de EIPD.

### Geolocalización (art. 90 LOPDGDD)
**Disparador:** `geolocator`, `navigator.geolocation`, columnas de latitud/longitud, geocodificación inversa, comprobación de IP o redes.
**Efecto:**
- Comprueba que la captura es puntual (al fichar) y no continua.
- Revisa los permisos «always» o en segundo plano en Android/iOS.
- Comprueba que hay indicador visible mientras se captura y una alternativa menos intrusiva (IP o red).
- Comprueba la exención por usuario.
- Revisa la minimización (¿hace falta la dirección desglosada?), el cifrado de **todos** los campos derivados (coordenadas, dirección, calle, número, CP, IP), quién la ve y qué terceros la reciben (tiles de mapas, geocodificadores externos).

### Perfilado y decisiones automatizadas (art. 22)
**Disparador:** detección de anomalías, puntuaciones, rankings, alertas automáticas sobre empleados, IA o embeddings sobre datos personales.
**Efecto:** revisa C13 y C14. Señala el art. 22 si la decisión se toma en la práctica sin intervención humana real.

### Menores (art. 8 RGPD, art. 7 LOPDGDD: 14 años)
**Disparador:** fecha de nacimiento, edad, centros educativos, datos de familias.
**Efecto:** sube un nivel la severidad de todo hallazgo que afecte a menores.

### Transferencias y proveedores
**Disparador:** SDK o endpoint fuera de la UE, región cloud no europea, SaaS sin residencia en la UE clara (Firebase/FCM, Google, Sentry, Mailtrap, SendGrid, OpenAI, Anthropic, Stripe…).
**Efecto:** revisa C11 y C12 y contrástalo con la documentación (Fase 4).

---

## Marco normativo español de referencia

| Norma | Qué mirar en código |
|---|---|
| LOPDGDD art. 7 | Edad mínima de consentimiento: 14 años. |
| LOPDGDD art. 9 | Categorías especiales: el consentimiento por sí solo no levanta la prohibición para ciertas finalidades. |
| LOPDGDD art. 11 | Información por capas: que exista un punto donde informar en cada formulario de recogida. |
| LOPDGDD art. 32 | Bloqueo: al vencer la finalidad, los datos se bloquean (accesibles solo para jueces o autoridades) antes de borrarse. Busca un estado «bloqueado» o equivalente, no solo un soft-delete. |
| LOPDGDD arts. 87-91 | Derechos digitales laborales: intimidad en dispositivos (87), desconexión digital (88), videovigilancia (89), geolocalización (90), negociación colectiva (91). |
| ET art. 34.9 (RD-ley 8/2019) | Registro diario de jornada; conservación 4 años; a disposición de trabajadores, representantes e Inspección de Trabajo. |
| ET art. 20.3 | Control empresarial con respeto a la dignidad: proporcionalidad de la monitorización. |
| ET art. 64 | Información a la representación legal de los trabajadores sobre sistemas de control y sobre algoritmos que afecten a las condiciones de trabajo. |
| LSSI art. 10 | Aviso legal (titular, NIF, domicilio, registro) en webs y apps. |
| LSSI art. 22.2 | Cookies o almacenamiento en el dispositivo no necesario: consentimiento previo. Criterio de la AEPD (guía de cookies): botón «Rechazar» al mismo nivel que «Aceptar». |
| LSSI arts. 27-28 | Contratación electrónica: información previa y prueba de la aceptación de las condiciones. |
| AEPD, lista del art. 35.4 | Tipos de tratamiento que requieren EIPD; incluye la monitorización sistemática de empleados y la geolocalización. Verifica la versión vigente antes de citarla. |

Si hay dudas sobre la vigencia o el contenido exacto de un artículo, dilo en el hallazgo («verificar con el DPO») en lugar de afirmarlo.

---

## Guía de detección por capítulos

### C1 — Descubrimiento de datos y mapa
Entidades con nombre, email, NIF/NIE/DNI, teléfono, dirección, IBAN, IP, user-agent, device id, token push, coordenadas o ficheros adjuntos. DTOs que exponen más campos que la entidad necesita. Seeds (`HasData`, `DataSeed`, ficheros `.xlsx`/`.csv` en `public/` o `assets/`). Abre las plantillas: una plantilla vacía no es un hallazgo.

### C2 — Finalidad y base jurídica
Datos recogidos para una finalidad y usados para otra (p. ej. la IP de seguridad usada para control horario). Consentimiento usado como base en el ámbito laboral. Base del art. 9.2 ausente para categorías especiales.

### C3 — Transparencia (arts. 13-14, art. 11 LOPDGDD)
Puntos de recogida sin información. Textos de permisos de iOS/Android (`NS*UsageDescription`) inexactos. Si la app es encargada: que el producto facilite al cliente informar (banner de geolocalización, textos configurables).

### C4 — Consentimiento
Casillas premarcadas, consentimiento agrupado con las condiciones, sin registro (quién, cuándo, qué versión) y sin retirada igual de fácil.

### C5 — Cookies, almacenamiento y SDKs (LSSI 22.2)
Scripts en `index.html`, Google Fonts o CDNs remotos (envían la IP a terceros), analítica (GA, Clarity, Hotjar, Meta Pixel), `firebase/analytics`, Crashlytics, Sentry sin scrubbing, tiles de mapas de terceros. `localStorage` solo para lo estrictamente necesario.

### C6 — Privacidad desde el diseño y por defecto (art. 25)
Campos opcionales que se guardan por defecto, geolocalización activada por defecto sin necesidad, sobre-recogida (dirección desglosada cuando bastan las coordenadas), roles que ven más de lo que necesitan.

### C7 — Conservación y supresión (art. 5.1.e, art. 17, art. 32 LOPDGDD)
- ¿Existe un job de retención para clientes **activos**, no solo para los que se dan de baja?
- Soft-delete sin purga posterior.
- Empleados dados de baja retenidos indefinidamente.
- Logs, tablas de auditoría, adjuntos y backups sin plazo.
- Retenciones legales (4 años del ET, plazos de prescripción) documentadas como tales.
- Existencia de un estado de bloqueo.

### C8 — Derechos de los interesados (arts. 15-22)
Exportación por persona (no solo por tenant), rectificación, supresión o anonimización por persona, oposición. Si la app es encargada: herramientas para que el responsable atienda los derechos (art. 28.3.e).

### C9 — Seguridad (art. 32)
Cifrado en tránsito y en reposo; cobertura del cifrado por campo (**todos** los campos sensibles, incluidos los añadidos después); secretos en el repo (revisa `git ls-files`, no solo el árbol de trabajo); hash de contraseñas; tokens de refresco y reseteo en claro; tokens en `localStorage`; rate limiting; autorización por rol y tenant; claves compartidas o estáticas para accesos externos.

### C10 — Logs, telemetría y auditoría
PII en mensajes de log; enrichers que añaden IP o user-agent; logs del cliente que envían URLs con tokens o emails; retención de sinks (tablas de logs en BD, Seq, Loki, OTLP); auditoría de lecturas de PII; tablas de auditoría que copian valores en claro (ver la guía .NET).

### C11 — Encargados y subencargados (art. 28)
Inventario de todo tercero que recibe datos, frente a la lista documentada. Contrato de encargo con los clientes y prueba de su aceptación. Contenido mínimo enviado a terceros (p. ej. push genéricos).

### C12 — Transferencias internacionales (arts. 44-49)
Destino real de cada proveedor, mecanismo (adecuación, Data Privacy Framework, cláusulas tipo) y coherencia con lo que se afirma a clientes e inspectores.

### C13 — Perfilado e IA
Reglas de anomalías o puntuaciones sobre empleados, alertas que desencadenan decisiones, envío de datos personales a LLMs, embeddings y almacenes vectoriales con PII.

### C14 — EIPD (art. 35)
Si se cumplen dos o más de los nueve criterios del EDPB (evaluación o puntuación; decisiones automatizadas; monitorización sistemática; datos sensibles; gran escala; combinación de conjuntos de datos; interesados vulnerables, como empleados o menores; tecnología innovadora; impedimento del ejercicio de derechos), se requiere EIPD. Si ya existe, compárala con el código (Fase 4) y señala si necesita revisión (art. 35.11).

### C15 — Responsabilidad proactiva (art. 5.2, art. 30, arts. 33-34)
RAT coherente con el mapa, procedimiento de brechas (detección, registro, 72 horas), registro de aceptaciones, inventario de DPAs.

---

## Guía por stack

### .NET / ASP.NET Core / EF Core
- **Interceptores de auditoría** (`SaveChangesInterceptor`): si serializan `entry.CurrentValues`, `OriginalValue` o `CurrentValue` en tablas de auditoría, copian el valor **ya descifrado**. Los `ValueConverter` solo actúan en la frontera con la BD, así que la auditoría se salta el cifrado y el crypto-shredding. Comprueba qué entidades están auditadas y si las columnas de auditoría tienen converter.
- **Cobertura de converters:** compara las propiedades de cada entidad con PII con las que tienen `.HasConversion(...)` en su `IEntityTypeConfiguration`. Lo típico: campos añadidos después del plan de cifrado.
- **Consultas LINQ sobre columnas cifradas** con nonce aleatorio (`u.Nif == x`, `.ToUpper()`, `Contains`, `OrderBy`): no pueden funcionar; deben usar blind index (HMAC). Es un fallo funcional que puede impedir cumplir obligaciones legales (p. ej. dar los registros a la Inspección).
- **Soft-delete** vía interceptor y `HasQueryFilter`: busca si existe alguna purga real (`ExecuteDelete`, `RemoveRange`, SQL `DELETE`) para cada entidad con PII.
- **Adjuntos** `byte[]` / `bytea` sin cifrar.
- **Serilog:** sinks en `appsettings.json` (tabla PostgreSQL o SQL con `needAutoCreateTable` y sin purga, Seq, OTLP); enrichers `WithClientIp` y `WithClientAgent`; `UseSerilogRequestLogging` con query strings; mensajes con `user.Email` (incluido como valor de un placeholder llamado `{UserId}`); `LogContext.PushProperty` con datos del cliente sin sanear.
- **Secretos:** `git ls-files | grep appsettings`; valores en `appsettings.json` base frente a `Development`; `ServiceAccountJson`, `SmtpPassword`, `SigningKey`, `MasterKey`, `ApiKey`, `ConnectionStrings`; ficheros `keys/`, `*.json` de service accounts, `*.jks`, `*.p12`, `*.pfx`.
- **Autenticación:** `PasswordHasher`/Identity; JWT (vida, clave); `RefreshToken`/`ResetToken` en claro en BD; rate limiting en login, reseteo y endpoints públicos; claves estáticas en middlewares (`X-*-Api-Key`).
- **Exposición:** Swagger/Scalar en producción, `DeveloperExceptionPage`, `ProblemDetails` con detalle de excepciones.
- **Jobs** (Quartz/Hangfire): inventario y comprobación de si hay jobs de retención.
- **Terceros:** `HttpClient` con `BaseAddress`, SDKs (Stripe, FirebaseAdmin, SMTP, OpenAI…).

### Angular
- Tokens y objetos de usuario en `localStorage`/`sessionStorage`; alternativa: cookie `HttpOnly`.
- Interceptores o servicios de log que envían `location.href`, `req.url` o cuerpos de error: comprueba rutas con `?token=` o `?email=` (reseteo de contraseña, invitaciones, magic links) y si la URL se limpia **antes** de cualquier llamada que pueda fallar.
- `index.html`, `angular.json` (`scripts`, `styles`), fuentes y CDNs externos, `firebase/analytics`, mapas con tiles de terceros (`tile.openstreetmap.org`, Google Maps, Mapbox).
- `environment*.ts` con claves; service workers que cachean respuestas de la API con PII.
- Banner de cookies si hay almacenamiento no necesario.

### Flutter / móvil
- `AndroidManifest.xml`: `ACCESS_BACKGROUND_LOCATION`, `FINE_LOCATION`. `Info.plist`: `NSLocationAlwaysAndWhenInUseUsageDescription` y exactitud de los textos.
- `geolocator`: `getPositionStream` (captura continua) frente a `getCurrentPosition` (puntual).
- `SharedPreferences`, `hive`, `sqflite` o colas offline guardando PII sin cifrar (sugiere `flutter_secure_storage` o cifrado).
- `firebase_analytics`, `firebase_crashlytics`, `sentry_flutter`; contenido de las notificaciones push.
- `print`/`debugPrint` con datos personales; keystores o `google-services.json` con claves de servidor versionados.

### Despliegue e infraestructura
- `docker-compose`, Traefik o Nginx: access logs con query strings y su retención.
- Backups: ubicación, región, cifrado, rotación y si los datos borrados persisten en ellos.
- Scripts de retención (`*retention*.sh`): ¿están realmente programados? Si no se puede ver el cron, va a verificación.
- CI (`.gitlab-ci.yml`, GitHub Actions): ¿hay escaneo de secretos (`gitleaks`)?
- `.gitignore` frente a lo realmente versionado.

---

## Recetas de búsqueda útiles

```bash
# Secretos versionados (mostrar solo nombres, nunca valores)
git ls-files | grep -E "appsettings.*json$|\.env|keys/|\.jks$|\.p12$|\.pfx$|service.?account"

# Propiedades con PII sin converter (comparar listados)
grep -rn "HasConversion" <Repositories>/Data --include=*.cs

# Interceptores que serializan valores
grep -rn -E "CurrentValue|OriginalValue|CurrentValues" --include=*.cs

# PII en logs
grep -rn -E "Log(Information|Warning|Error|Debug)\(.*(Email|Nif|Phone|Latitude|Address|Token|Ip)" --include=*.cs

# Purgas reales
grep -rn -E "ExecuteDelete|RemoveRange|DELETE FROM" --include=*.cs --include=*.sql --include=*.sh

# Almacenamiento en el navegador y URLs en logs
grep -rn -E "localStorage|sessionStorage|location\.href" src --include=*.ts

# Terceros
grep -rn -E "https://[a-z0-9.-]+\.[a-z]{2,}" --include=*.cs --include=*.ts --include=*.dart | grep -v -E "w3\.org|schemas|example"
```

---

## Racionalizaciones que hay que rebatir

| Excusa | Realidad |
|---|---|
| «Está cifrado en BD.» | Comprueba la auditoría, los logs, los backups, los exports y los campos añadidos después. El cifrado se suele escapar por los lados. |
| «Solo es la ciudad y la calle, no las coordenadas.» | Calle + número + CP es una dirección exacta; en teletrabajo, el domicilio. |
| «No guardamos el diagnóstico, solo que está de baja.» | Estar de baja ya es un dato de salud (art. 9). |
| «Somos encargados, eso es cosa del cliente.» | El encargado tiene obligaciones propias (arts. 28.3, 32, 33.2) y debe dar herramientas al responsable para cumplir. |
| «Hay que conservarlo 4 años por el ET.» | Eso justifica 4 años y bloqueo, no conservar para siempre ni conservar la geolocalización con el mismo plazo. |
| «El repo es privado.» | Los secretos en git llegan a clones, runners, backups y portátiles. Se rotan y se purgan igualmente. |
| «Firebase o Stripe ya cumplen el RGPD.» | Su cumplimiento no cubre tu tratamiento: necesitas DPA, mecanismo de transferencia y declararlos como subencargados. |
| «El empleado aceptó.» | En el ámbito laboral el consentimiento casi nunca es válido (art. 7.4). |
| «Ya tenemos EIPD.» | Una EIPD que no refleja el código actual no cumple el art. 35.11. |

---

## Aviso (incluir siempre al final del informe)

> Esta es una auditoría técnica de los materiales proporcionados. No es asesoramiento jurídico ni constituye una determinación de cumplimiento. Para cuestiones legales, relación con la AEPD o decisiones relevantes, consulta con el DPO o un abogado especializado en protección de datos.
