import type { Translation } from './types';

/**
 * Spanish (neutral/peninsular).
 *
 * Uses real Spanish angling vocabulary: a bite is a *picada*, a rod is a *caña*,
 * live bait is *cebo vivo*. Phrased to read naturally in both Spain and Latin
 * America — no vosotros, no regionalisms — so one file serves both markets.
 *
 */
const es: Translation = {
  common: {
    cancel: 'Cancelar',
    save: 'Guardar',
    remove: 'Eliminar',
    back: 'Atrás',
    done: 'Listo',
    retry: 'Desliza hacia abajo para reintentar.',
    loading: 'Cargando…',
    notNow: 'Ahora no',
    keepIt: 'Conservar',
    unlocked: 'Desbloqueado',
    until: 'Hasta las {{time}}',
  },

  tabs: {
    fishing: 'Pesca',
    conditions: 'Condiciones',
    history: 'Historial',
    settings: 'Ajustes',
  },

  fishing: {
    title: 'Pesca',
    start: 'Iniciar',
    stop: 'Detener',
    manage: 'Gestionar',
    rodCount_one: '{{count}} caña',
    rodCount_other: '{{count}} cañas',
    monitoring: 'vigilando',
    idle: 'en espera',
    addRodFirst: 'Añade una caña primero.',
    bites: 'Picadas',
    threshold: 'Umbral',
    sensor: 'Sensor',
    bigFish: '¡Pez grande!',
    nibble: 'Mordisco',
    bitePeak: 'Pico {{peak}} g · {{confidence}} % de confianza',
    liveBait: 'Modo cebo vivo',
    liveBaitHelp: 'Filtra el movimiento constante del cebo — se aplica a todas las cañas',
    status: {
      idle: 'Sin activar',
      poweredOff: 'Bluetooth desactivado',
      unauthorized: 'Permiso necesario',
      scanning: 'Buscando…',
      connecting: 'Conectando…',
      connected: 'En directo',
      reconnecting: 'Reconectando…',
      error: 'Error',
      calibrating: 'Calibrando',
      ready: 'Listo',
    },
  },

  session: {
    label: 'Sesión',
    ended: 'Sesión finalizada',
    endingSoon: 'Termina pronto',
    noLimit: 'Sin límite de tiempo',
    remaining: 'Quedan {{time}}',
    notMonitored: 'Las cañas ya no están vigiladas',
    extend: '+{{hours}} h',
    upsell: 'Premium pesca sin límite de tiempo.',
    expired: 'finalizada',
    underMinute: 'menos de un minuto',
    warnTitle: '⏳ La sesión termina pronto',
    warnBody:
      'Tus cañas dejarán de estar vigiladas en breve. Abre Castmate para añadir más tiempo.',
    endedTitle: '🛑 Sesión finalizada',
    endedBody: 'Tus cañas ya no están vigiladas. Abre Castmate para seguir pescando.',
  },

  rods: {
    title: 'Cañas',
    intro:
      'Cada caña tiene su propio detector y su propia alarma, así que el aviso te dice qué caña recoger.',
    addRod: '＋ Añadir caña',
    addRodCount: '＋ Añadir caña ({{current}}/{{max}})',
    maxTitle: 'Número máximo de cañas',
    maxBody: 'Castmate vigila hasta {{max}} cañas a la vez.',
    removeTitle: 'Eliminar caña',
    removeBody: '¿Eliminar «{{name}}»? Las picadas registradas se conservan.',
    firstRodFixed: 'Tu primera caña no se puede eliminar.',
    armed: 'activa',
    sensorLabel: 'Sensor',
    pairedSensor: 'Sensor vinculado',
    notPaired: 'Sin vincular — toca para vincular',
    pairHint:
      'Cada caña debe vincularse a su propio sensor, o dos cañas leerían el mismo.',
    nameTitle: 'Nombre de la caña',
    namePlaceholder: 'p. ej. Caña izquierda',
    defaultName: 'Caña {{number}}',
  },

  pairing: {
    title: 'Vincular {{name}}',
    subtitleBroadcast:
      'Mueve el sensor que quieras para esta caña — el de señal más fuerte suele ser el más cercano.',
    subtitleGatt: 'Buscando dispositivos {{device}}.',
    currentlyPaired: 'Vinculado actualmente',
    unpair: 'Desvincular',
    scanning: 'Buscando…',
    takenBy: 'Ya vinculado a {{name}} — toca para moverlo aquí',
    rodNotFound: 'Caña no encontrada.',
    permissionDenied: 'Permiso de Bluetooth denegado.',
    bluetoothUnavailable: 'Bluetooth no disponible.',
  },

  conditions: {
    title: 'Condiciones',
    loading: 'Cargando condiciones locales…',
    loadFailed: 'No se pudieron cargar las condiciones.',
    fishActivity: 'Actividad de los peces',
    pressure: 'Presión',
    temperature: 'Temperatura',
    wind: 'Viento',
    waveHeight: 'Altura de las olas',
    tide: 'Marea',
    moon: 'Luna',
    bestWindow: '🎣 Mejor momento hoy sobre las {{time}} ({{percent}} %)',
    hourlyForecast: 'Previsión por horas',
    outlook: 'Tendencia',
    lockedDays_one: '🔒 {{count}} día más en la tendencia completa',
    lockedDays_other: '🔒 {{count}} días más en la tendencia completa',
    today: 'Hoy',
    tomorrow: 'Mañana',
    bestTimesLink: 'Calendario de mejores momentos',
    bestTimesSub: 'Tendencia solunar del mes — planifica tu próxima salida',
    attribution: 'Datos meteorológicos y marinos de Open-Meteo.com (CC BY 4.0)',
  },

  location: {
    title: 'Ubicación',
    intro:
      'Las condiciones, las mareas y la tendencia se obtienen para esta ubicación. Usa tu posición actual o fija una ciudad para consultar otro sitio.',
    useMyLocation: 'Usar mi ubicación',
    useMyLocationSub: 'Seguir tu posición actual',
    usePinned: 'Usar esta',
    permissionDenied: 'Permiso de ubicación denegado',
    permissionHint:
      'Permite la ubicación para Castmate en los Ajustes de tu dispositivo, o busca una ciudad abajo.',
    searchTitle: 'Buscar una ciudad',
    searchPlaceholder: 'p. ej. Bizerte, Valencia, Vigo',
    searchFailed: 'La búsqueda de lugares falló.',
    noResults: 'No se encontró nada para «{{query}}».',
    marineNote:
      'Los datos de marea y olas solo existen cerca de la costa — las ubicaciones de interior se muestran sin ellos.',
    notSet: 'Sin ubicación',
    change: 'Cambiar',
    neededTitle: 'Define tu lugar de pesca',
    neededSub:
      'Las condiciones son locales: no se puede mostrar nada hasta saber dónde estás.',
  },

  bestTimes: {
    title: 'Mejores momentos',
    subtitle:
      'Tendencia solunar — los grandes periodos de actividad siguen a la luna nueva y a la llena. Se basa en la luna, así que llega más lejos que la previsión meteorológica.',
    rating: 'Valoración',
    moon: 'Luna',
    moonLit: '{{name}} · {{percent}} % iluminada',
    hint: 'Pesca al amanecer y al atardecer — son las franjas que más pesan.',
    topDays: 'Mejores días del mes',
    ratings: {
      excellent: 'excelente',
      good: 'bueno',
      fair: 'regular',
      poor: 'flojo',
    },
  },

  history: {
    title: 'Historial de picadas',
    insights: '📊 Análisis',
    emptyTitle: 'Aún no hay picadas registradas',
    emptySub:
      'Conecta tu sensor y empieza a pescar — las picadas detectadas aparecerán aquí.',
    metrics: 'pico {{peak}} g · {{confidence}} % de confianza',
    addNote: 'Añadir una nota…',
    noteTitle: 'Nota',
    notePlaceholder: 'p. ej. trucha arcoíris, cucharilla',
    backedUp: '☁️ Copia guardada',
    onDevice: '📱 En este dispositivo',
    replace: 'Reemplazar',
    saving: 'Guardando…',
    hidden_one: '🔒 {{count}} picada anterior a los últimos {{days}} días',
    hidden_other: '🔒 {{count}} picadas anteriores a los últimos {{days}} días',
    permissionTitle: 'Permiso necesario',
    permissionBody: 'Permite el acceso a fotos para adjuntar una foto de la captura.',
    photoFailedTitle: 'No se pudo adjuntar la foto',
    photoFailedBody: 'Inténtalo de nuevo.',
    saveFailedTitle: 'Error al guardar',
    saveFailedBody: 'No se pudo guardar la nota.',
  },

  report: {
    title: 'Informe de sesión',
    noSessionTitle: 'No hay ninguna sesión que mostrar',
    noSessionSub: 'Termina una sesión de pesca y su resumen aparecerá aquí.',
    bites: 'Picadas',
    duration: 'Duración',
    bestStrike: 'Mejor picada',
    noBitesTitle: 'Ninguna picada esta vez',
    noBitesSub:
      'Las sesiones en blanco pasan. Consulta la pestaña Condiciones para encontrar el próximo buen momento.',
    timeline: 'Cronología de picadas',
    byRod: 'Por caña',
    rodTally_one: '{{count}} picada · pico {{peak}} g',
    rodTally_other: '{{count}} picadas · pico {{peak}} g',
    breakdown: 'Detalle de las picadas',
    bigFish: 'Peces grandes',
    nibbles: 'Mordiscos',
    biteRate: 'Frecuencia',
    biteRateValue: '{{rate}} / hora',
    meanConfidence: 'Confianza media',
    hottest: '🔥 Mejor media hora: {{time}} — {{count}} picadas',
    conditionsTitle: 'Las condiciones que las produjeron',
    air: 'Aire',
    lockedHint: '🔒 Desbloquea para ver el detalle completo',
  },

  insights: {
    title: 'Análisis de capturas',
    subtitle:
      'Tus picadas cruzadas con el reanálisis ERA5 — el registro histórico corregido, no una previsión. Cada condición se puntúa según la frecuencia con que produjo una picada en relación con la frecuencia con que realmente se dio, en los últimos {{days}} días.',
    loading: 'Cargando condiciones históricas…',
    loadFailed: 'No se pudieron cargar las condiciones históricas.',
    notEnoughTitle: 'Aún no hay datos suficientes',
    notEnoughBody:
      '{{matched}} de {{needed}} picadas asociadas a condiciones históricas. Sigue pescando — el análisis necesita una muestra real antes de poder decirte algo honesto.',
    locked: '🔒 Desbloquea para ver qué condiciones produjeron tus picadas',
    best: 'mejor: {{label}}',
    vsChance: 'vs. azar',
    lift: 'índice',
    count: 'n',
    howToRead: 'Cómo leer esto',
    liftExplainer:
      'indica cuántas veces más a menudo una condición produjo una picada de lo que predeciría el azar. 1,0× es exactamente la media; 2,0× significa el doble de productiva de lo que sugeriría su frecuencia por sí sola.',
    countExplainer: 'es el número de picadas en esa franja.',
    caveat:
      'Esto corrige la frecuencia de cada condición, pero no cuándo elegiste pescar. Si solo pescas al amanecer, el amanecer encabezará la lista con independencia de los peces.',
    footnote: '{{matched}} picadas analizadas frente a {{hours}} horas de reanálisis.',
    footnoteExcluded: ' {{count}} fuera del periodo o sin datos.',
    footnotePending: ' {{count}} demasiado recientes — el reanálisis lleva unos días de retraso.',
    headline:
      '{{label}} — {{dimension}} — produjo picadas {{lift}}× más a menudo que el azar.',
    dimensions: {
      pressureTrend: 'Tendencia barométrica',
      temperature: 'Temperatura del aire',
      wind: 'Viento',
      timeOfDay: 'Momento del día',
      moon: 'Luna',
      tide: 'Marea',
    },
  },

  settings: {
    detection: 'Detección',
    liveBait: 'Modo cebo vivo',
    liveBaitHelp:
      'Se adapta al movimiento constante del cebo para que un cebo inquieto no se confunda con una picada.',
    sensitivity: 'Sensibilidad',
    sensitivityHelp:
      'Una sensibilidad alta detecta los mordiscos más pequeños; una baja ignora todo salvo las picadas fuertes.',
    sensitivityLow: 'Baja',
    sensitivityHigh: 'Alta',
    alerts: 'Avisos',
    vibration: 'Vibración',
    sound: 'Sonido',
    preview: 'Escuchar',
    push: 'Notificaciones',
    pushHelp: 'Recibe una notificación en cuanto se detecte una picada.',
    pushDeniedTitle: 'Notificaciones desactivadas',
    pushDeniedBody:
      'Activa las notificaciones de Castmate en los Ajustes de tu dispositivo para recibir avisos de picada.',
    language: 'Idioma',
    languageSystem: 'Idioma del sistema',
    premium: 'Premium',
    premiumActive: 'Premium activo',
    premiumLifetime: 'Premium — de por vida',
    premiumTitle: 'Castmate Premium',
    premiumThanks: 'Anuncios eliminados y todas las funciones desbloqueadas. ¡Gracias!',
    premiumRenews:
      'Se renueva cada año. Gestiónalo en los ajustes de tu cuenta de la tienda.',
    premiumPitch: 'Elimina los anuncios y desbloquea todo.',
    upgrade: 'Mejorar',
    restore: 'Restaurar compras',
    working: 'Procesando…',
    account: 'Cuenta',
    signedIn: 'Sesión iniciada',
    signOut: 'Cerrar sesión',
    resetTitle: 'Restablecer ajustes',
    resetBody: '¿Restaurar todos los ajustes a sus valores por defecto?',
    reset: 'Restablecer',
    resetToDefaults: 'Restablecer valores por defecto',
  },

  paywall: {
    title: 'Castmate Premium',
    subhead: 'Pesca con más cabeza. Sin interrupciones.',
    yourePremium: 'Eres Premium ✓',
    lifetimeActive: 'Premium — para siempre ✓',
    thanks: 'Gracias por apoyar a Castmate.',
    renewsYearly:
      'Se renueva cada año. Gestiónalo en los ajustes de tu cuenta de la tienda.',
    restore: 'Restaurar compras',
    plans: {
      lifetimeTitle: 'De por vida',
      lifetimeBlurb: 'Un solo pago, para siempre',
      lifetimeTag: 'Mejor valor',
      yearlyTitle: 'Anual',
      yearlyBlurb: 'Se renueva cada año hasta que se cancele',
    },
    benefits: {
        outlook: 'Tendencia completa de 7 días',
      insights: 'Análisis a partir de tu propio historial',
      reports: 'Informes de sesión completos',
      history: 'Historial de picadas ilimitado',
      sounds: 'Todos los sonidos de aviso',
      backup: 'Copia en la nube de las fotos de capturas',
    },
  },



  battery: {
    lowTitle: '🔋 Batería del sensor baja',
    criticalTitle: '🪫 Batería del sensor crítica',
    warnBody: '{{rod}} está al {{percent}} % — cambia la pila antes de que deje de vigilar.',
    label: 'Batería',
    unknown: 'Batería desconocida',
  },

  chart: {
    waiting: 'Esperando datos del sensor…',
    acceleration: 'Aceleración (g)',
    threshold: 'Umbral',
    smallBite: 'Picada pequeña',
    bigBite: 'Picada grande',
  },

  auth: {
    signIn: 'Iniciar sesión',
    signUp: 'Crear cuenta',
    tagline: 'Inicia sesión para registrar tus picadas',
    email: 'Correo electrónico',
    password: 'Contraseña',
    passwordMin: 'Contraseña (mín. 6 caracteres)',
    confirmPassword: 'Confirmar contraseña',
    createAccount: 'Crear cuenta',
    createOne: 'Crear una',
    continueGoogle: 'Continuar con Google',
    demoMode: 'Continuar en modo demo (solo desarrollo)',
    verifyTitle: 'Confirma tu correo',
    resend: 'Reenviar correo',
    signOut: 'Cerrar sesión',
  },
};

export default es;
