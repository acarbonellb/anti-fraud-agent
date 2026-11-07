/**
 * Money as the admin reads it: integer cents inside (CLAUDE.md §5), euros in
 * Spanish format in the texts the checks and the policy write.
 */
export function euros(cents: number): string {
  return `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}
