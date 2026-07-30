import type { Translation } from './types';

/**
 * French.
 *
 * Uses real French angling vocabulary rather than literal translation: a bite
 * is a *touche*, a rod is a *canne*, live-bait mode is *mode vif*. An angler
 * reading "morsure" instead of "touche" would know immediately that nobody who
 * fishes wrote this.
 *
 */
const fr: Translation = {
  common: {
    cancel: 'Annuler',
    save: 'Enregistrer',
    remove: 'Supprimer',
    back: 'Retour',
    done: 'Terminé',
    retry: 'Tirez vers le bas pour réessayer.',
    loading: 'Chargement…',
    notNow: 'Plus tard',
    keepIt: 'Conserver',
    unlocked: 'Débloqué',
    until: "Jusqu'à {{time}}",
  },

  tabs: {
    fishing: 'Pêche',
    conditions: 'Conditions',
    history: 'Historique',
    settings: 'Réglages',
  },

  fishing: {
    title: 'Pêche',
    start: 'Démarrer',
    stop: 'Arrêter',
    manage: 'Gérer',
    rodCount_one: '{{count}} canne',
    rodCount_other: '{{count}} cannes',
    monitoring: 'surveillance active',
    idle: 'en veille',
    addRodFirst: "Ajoutez d'abord une canne.",
    bites: 'Touches',
    threshold: 'Seuil',
    sensor: 'Capteur',
    bigFish: 'Gros poisson !',
    nibble: 'Petite touche',
    bitePeak: 'Pic {{peak}} g · {{confidence}} % de confiance',
    liveBait: 'Mode vif',
    liveBaitHelp: "Filtre l'agitation constante du vif — s'applique à toutes les cannes",
    status: {
      idle: 'Non armée',
      poweredOff: 'Bluetooth désactivé',
      unauthorized: 'Autorisation requise',
      scanning: 'Recherche…',
      connecting: 'Connexion…',
      connected: 'En direct',
      reconnecting: 'Reconnexion…',
      error: 'Erreur',
      calibrating: 'Calibrage',
      ready: 'Prêt',
    },
  },

  session: {
    label: 'Session',
    ended: 'Session terminée',
    endingSoon: 'Bientôt terminée',
    noLimit: 'Sans limite de durée',
    remaining: '{{time}} restant',
    notMonitored: 'Les cannes ne sont plus surveillées',
    extend: '+{{hours}} h',
    upsell: 'Premium pêche sans limite de durée.',
    expired: 'expirée',
    underMinute: "moins d'une minute",
    warnTitle: '⏳ Session bientôt terminée',
    warnBody:
      'La surveillance de vos cannes va bientôt cesser. Ouvrez Castmate pour prolonger.',
    endedTitle: '🛑 Session terminée',
    endedBody:
      'Vos cannes ne sont plus surveillées. Ouvrez Castmate pour continuer à pêcher.',
  },

  rods: {
    title: 'Cannes',
    intro:
      'Chaque canne a son propre détecteur et sa propre alarme : une alerte vous dit quelle canne relever.',
    addRod: '＋ Ajouter une canne',
    addRodCount: '＋ Ajouter une canne ({{current}}/{{max}})',
    maxTitle: 'Nombre maximal de cannes',
    maxBody: "Castmate surveille jusqu'à {{max}} cannes à la fois.",
    removeTitle: 'Supprimer la canne',
    removeBody: 'Supprimer « {{name}} » ? Les touches enregistrées sont conservées.',
    firstRodFixed: 'Votre première canne ne peut pas être supprimée.',
    armed: 'armée',
    sensorLabel: 'Capteur',
    pairedSensor: 'Capteur associé',
    notPaired: 'Non associé — appuyez pour associer',
    pairHint:
      'Chaque canne doit être associée à son propre capteur, sinon deux cannes liraient le même.',
    nameTitle: 'Nom de la canne',
    namePlaceholder: 'ex. Canne de gauche',
    defaultName: 'Canne {{number}}',
  },

  pairing: {
    title: 'Associer {{name}}',
    subtitleBroadcast:
      'Bougez le capteur destiné à cette canne — le signal le plus fort est en général le plus proche.',
    subtitleGatt: 'Recherche des appareils {{device}}.',
    currentlyPaired: 'Actuellement associé',
    unpair: 'Dissocier',
    scanning: 'Recherche…',
    takenBy: 'Déjà associé à {{name}} — appuyez pour le déplacer ici',
    rodNotFound: 'Canne introuvable.',
    permissionDenied: 'Autorisation Bluetooth refusée.',
    bluetoothUnavailable: 'Bluetooth indisponible.',
  },

  conditions: {
    title: 'Conditions',
    loading: 'Chargement des conditions locales…',
    loadFailed: 'Impossible de charger les conditions.',
    fishActivity: 'Activité des poissons',
    pressure: 'Pression',
    temperature: 'Température',
    wind: 'Vent',
    waveHeight: 'Hauteur des vagues',
    tide: 'Marée',
    moon: 'Lune',
    bestWindow: '🎣 Meilleur créneau aujourd’hui vers {{time}} ({{percent}} %)',
    hourlyForecast: 'Prévisions horaires',
    outlook: 'Tendance',
    lockedDays_one: '🔒 {{count}} jour de plus dans la tendance complète',
    lockedDays_other: '🔒 {{count}} jours de plus dans la tendance complète',
    today: "Aujourd'hui",
    tomorrow: 'Demain',
    bestTimesLink: 'Calendrier des meilleurs moments',
    bestTimesSub: 'Tendance solunaire du mois — préparez votre prochaine sortie',
    attribution: 'Données météo et marines par Open-Meteo.com (CC BY 4.0)',
  },

  location: {
    title: 'Lieu',
    intro:
      'Les conditions, les marées et la tendance sont toutes récupérées pour ce lieu. Utilisez votre position actuelle, ou choisissez une ville pour consulter ailleurs.',
    useMyLocation: 'Utiliser ma position',
    useMyLocationSub: 'Suivre votre position actuelle',
    usePinned: 'Utiliser',
    permissionDenied: 'Autorisation de localisation refusée',
    permissionHint:
      'Autorisez la localisation pour Castmate dans les Réglages de votre appareil, ou recherchez une ville ci-dessous.',
    searchTitle: 'Rechercher une ville',
    searchPlaceholder: 'ex. Bizerte, Valence, Nantes',
    searchFailed: 'La recherche de lieu a échoué.',
    noResults: 'Aucun résultat pour « {{query}} ».',
    marineNote:
      'Les données de marée et de vagues n’existent qu’à proximité des côtes — les lieux à l’intérieur des terres s’affichent sans elles.',
    notSet: 'Aucun lieu défini',
    change: 'Modifier',
    neededTitle: 'Définissez votre lieu de pêche',
    neededSub:
      'Les conditions sont locales : rien ne peut s’afficher avant de savoir où vous êtes.',
  },

  bestTimes: {
    title: 'Meilleurs moments',
    subtitle:
      'Tendance solunaire — les grandes périodes d’activité suivent la nouvelle et la pleine lune. Basée sur la lune, elle va donc plus loin que les prévisions météo.',
    rating: 'Note',
    moon: 'Lune',
    moonLit: '{{name}} · {{percent}} % éclairée',
    hint: 'Pêchez à l’aube et au crépuscule — ce sont les créneaux qui pèsent le plus.',
    topDays: 'Meilleurs jours du mois',
    ratings: {
      excellent: 'excellent',
      good: 'bon',
      fair: 'moyen',
      poor: 'faible',
    },
  },

  history: {
    title: 'Historique des touches',
    insights: '📊 Analyses',
    emptyTitle: 'Aucune touche enregistrée',
    emptySub:
      'Connectez votre capteur et commencez à pêcher — les touches détectées apparaîtront ici.',
    metrics: 'pic {{peak}} g · {{confidence}} % de confiance',
    addNote: 'Ajouter une note…',
    noteTitle: 'Note',
    notePlaceholder: 'ex. truite arc-en-ciel, cuillère tournante',
    backedUp: '☁️ Sauvegardé',
    onDevice: '📱 Sur cet appareil',
    replace: 'Remplacer',
    saving: 'Enregistrement…',
    hidden_one: '🔒 {{count}} touche plus ancienne que les {{days}} derniers jours',
    hidden_other: '🔒 {{count}} touches plus anciennes que les {{days}} derniers jours',
    permissionTitle: 'Autorisation requise',
    permissionBody: 'Autorisez l’accès aux photos pour joindre une photo de prise.',
    photoFailedTitle: 'Impossible de joindre la photo',
    photoFailedBody: 'Veuillez réessayer.',
    saveFailedTitle: 'Échec de l’enregistrement',
    saveFailedBody: 'Impossible d’enregistrer la note.',
  },

  report: {
    title: 'Rapport de session',
    noSessionTitle: 'Aucune session à afficher',
    noSessionSub: 'Terminez une session de pêche et son bilan apparaîtra ici.',
    bites: 'Touches',
    duration: 'Durée',
    bestStrike: 'Meilleure touche',
    noBitesTitle: 'Aucune touche cette fois',
    noBitesSub:
      'Les sorties bredouilles arrivent. Consultez l’onglet Conditions pour trouver le prochain bon créneau.',
    timeline: 'Chronologie des touches',
    byRod: 'Par canne',
    rodTally_one: '{{count}} touche · pic {{peak}} g',
    rodTally_other: '{{count}} touches · pic {{peak}} g',
    breakdown: 'Détail des touches',
    bigFish: 'Gros poissons',
    nibbles: 'Petites touches',
    biteRate: 'Fréquence',
    biteRateValue: '{{rate}} / heure',
    meanConfidence: 'Confiance moyenne',
    hottest: '🔥 Meilleure demi-heure : {{time}} — {{count}} touches',
    conditionsTitle: 'Les conditions qui les ont produites',
    air: 'Air',
    lockedHint: '🔒 Débloquez pour voir le détail complet',
  },

  insights: {
    title: 'Analyses des prises',
    subtitle:
      'Vos touches croisées avec la réanalyse ERA5 — l’historique corrigé, pas une prévision. Chaque condition est notée selon la fréquence des touches qu’elle a produites par rapport à sa fréquence réelle, sur les {{days}} derniers jours.',
    loading: 'Chargement des conditions historiques…',
    loadFailed: 'Impossible de charger les conditions historiques.',
    notEnoughTitle: 'Pas encore assez de données',
    notEnoughBody:
      '{{matched}} touches sur {{needed}} associées à des conditions historiques. Continuez à pêcher — l’analyse a besoin d’un échantillon réel pour dire quoi que ce soit d’honnête.',
    locked: '🔒 Débloquez pour voir quelles conditions ont produit vos touches',
    best: 'meilleur : {{label}}',
    vsChance: 'vs hasard',
    lift: 'indice',
    count: 'n',
    howToRead: 'Comment lire ceci',
    liftExplainer:
      'indique combien de fois plus souvent une condition a produit une touche que ne le prédirait le hasard. 1,0× correspond exactement à la moyenne ; 2,0× signifie deux fois plus productif que sa seule fréquence ne le suggère.',
    countExplainer: 'est le nombre de touches dans cette plage.',
    caveat:
      'Ceci corrige la fréquence de chaque condition, mais pas le moment où vous avez choisi de pêcher. Si vous ne pêchez qu’à l’aube, l’aube arrivera en tête quels que soient les poissons.',
    footnote: '{{matched}} touches analysées sur {{hours}} heures de réanalyse.',
    footnoteExcluded: ' {{count}} hors de la fenêtre ou sans données.',
    footnotePending: ' {{count}} trop récentes — la réanalyse a quelques jours de retard.',
    headline:
      '{{label}} — {{dimension}} — a produit des touches {{lift}}× plus souvent que le hasard.',
    dimensions: {
      pressureTrend: 'Tendance barométrique',
      temperature: 'Température de l’air',
      wind: 'Vent',
      timeOfDay: 'Moment de la journée',
      moon: 'Lune',
      tide: 'Marée',
    },
  },

  settings: {
    detection: 'Détection',
    liveBait: 'Mode vif',
    liveBaitHelp:
      'S’adapte à l’agitation constante du vif pour qu’un vif remuant ne soit pas pris pour une touche.',
    sensitivity: 'Sensibilité',
    sensitivityHelp:
      'Une sensibilité élevée détecte les plus petites touches ; une sensibilité faible ne retient que les touches franches.',
    sensitivityLow: 'Faible',
    sensitivityHigh: 'Élevée',
    alerts: 'Alertes',
    vibration: 'Vibration',
    sound: 'Son',
    preview: 'Écouter',
    push: 'Notifications',
    pushHelp: 'Recevez une notification dès qu’une touche est détectée.',
    pushDeniedTitle: 'Notifications désactivées',
    pushDeniedBody:
      'Activez les notifications pour Castmate dans les Réglages de votre appareil pour recevoir les alertes de touche.',
    language: 'Langue',
    languageSystem: 'Langue du système',
    premium: 'Premium',
    premiumActive: 'Premium actif',
    premiumLifetime: 'Premium — à vie',
    premiumTitle: 'Castmate Premium',
    premiumThanks: 'Publicités supprimées et toutes les fonctions débloquées. Merci !',
    premiumRenews:
      'Renouvellement annuel. Gérez-le dans les réglages de votre compte de store.',
    premiumPitch: 'Supprimez les publicités et débloquez tout.',
    upgrade: 'Passer à Premium',
    restore: 'Restaurer les achats',
    working: 'En cours…',
    account: 'Compte',
    signedIn: 'Connecté',
    signOut: 'Se déconnecter',
    resetTitle: 'Réinitialiser les réglages',
    resetBody: 'Rétablir tous les réglages par défaut ?',
    reset: 'Réinitialiser',
    resetToDefaults: 'Rétablir les valeurs par défaut',
  },

  paywall: {
    title: 'Castmate Premium',
    subhead: 'Pêchez plus malin. Sans interruption.',
    yourePremium: 'Vous êtes Premium ✓',
    lifetimeActive: 'Premium — à vie ✓',
    thanks: 'Merci de soutenir Castmate.',
    renewsYearly:
      'Renouvellement annuel. Gérez-le dans les réglages de votre compte de store.',
    restore: 'Restaurer les achats',
    plans: {
      lifetimeTitle: 'À vie',
      lifetimeBlurb: 'Un paiement unique, pour toujours',
      lifetimeTag: 'Meilleure offre',
      yearlyTitle: 'Annuel',
      yearlyBlurb: 'Se renouvelle chaque année jusqu’à résiliation',
    },
    benefits: {
        outlook: 'Tendance complète sur 7 jours',
      insights: 'Analyses issues de votre propre historique',
      reports: 'Rapports de session complets',
      history: 'Historique des touches illimité',
      sounds: 'Tous les sons d’alerte',
      backup: 'Sauvegarde cloud des photos de prises',
    },
  },



  battery: {
    lowTitle: '🔋 Batterie du capteur faible',
    criticalTitle: '🪫 Batterie du capteur critique',
    warnBody:
      '{{rod}} est à {{percent}} % — changez la pile avant qu’elle ne cesse de surveiller.',
    label: 'Batterie',
    unknown: 'Batterie inconnue',
  },

  chart: {
    waiting: 'En attente des données du capteur…',
    acceleration: 'Accélération (g)',
    threshold: 'Seuil',
    smallBite: 'Petite touche',
    bigBite: 'Grosse touche',
  },

  auth: {
    signIn: 'Se connecter',
    signUp: 'Créer un compte',
    tagline: 'Connectez-vous pour suivre vos touches',
    email: 'E-mail',
    password: 'Mot de passe',
    passwordMin: 'Mot de passe (6 caractères minimum)',
    confirmPassword: 'Confirmez le mot de passe',
    createAccount: 'Créer un compte',
    createOne: 'En créer un',
    continueGoogle: 'Continuer avec Google',
    demoMode: 'Continuer en mode démo (dev uniquement)',
    verifyTitle: 'Confirmez votre e-mail',
    resend: 'Renvoyer l’e-mail',
    signOut: 'Se déconnecter',
  },
};

export default fr;
