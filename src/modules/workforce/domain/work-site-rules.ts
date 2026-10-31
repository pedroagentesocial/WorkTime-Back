export const WORK_SITE_LIMITS = {
  nameMaxLength: 100,
  minRadiusMeters: 10,
  maxRadiusMeters: 60000,
  // Tope por empresa para que la lectura al marcar siga siendo barata
  maxSitesPerCompany: 50,
} as const;
