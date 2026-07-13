export type EtpStatus = 'green' | 'amber' | 'red';

export function etpStatus(totalVendu: number): EtpStatus {
  if (totalVendu >= 90 && totalVendu <= 105) return 'green';
  if ((totalVendu >= 80 && totalVendu < 90) || (totalVendu > 105 && totalVendu <= 115)) return 'amber';
  return 'red';
}
