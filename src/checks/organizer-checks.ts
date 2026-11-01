/**
 * Deterministic checks over an organizer's review context. Satella sends
 * signals, never the tax id itself, so the checksum verdict comes from it.
 */
import type { OrganizerReviewContext } from "../satella-client/schemas.js";
import { type SystemFinding, systemFinding } from "./types.js";

export function runOrganizerChecks(
  context: OrganizerReviewContext,
): SystemFinding[] {
  return [taxId(context), ...history(context)];
}

function taxId(context: OrganizerReviewContext): SystemFinding {
  const check = "organizer_identity";
  const { taxId } = context.fiscal;
  if (!taxId.present) {
    return systemFinding(
      "rule",
      check,
      "unknown",
      "El organizador no ha dado su NIF/CIF.",
    );
  }
  if (taxId.checksumValid === false) {
    return systemFinding(
      "rule",
      check,
      "fail",
      `Regla del dígito de control: el ${taxId.kind} del organizador tiene la letra o el dígito de control incorrecto.`,
    );
  }
  if (taxId.checksumValid === null) {
    return systemFinding(
      "rule",
      check,
      "unknown",
      "No se ha podido comprobar el dígito de control del NIF/CIF.",
    );
  }
  return systemFinding(
    "rule",
    check,
    "pass",
    `El ${taxId.kind} del organizador tiene un dígito de control válido.`,
  );
}

function history(context: OrganizerReviewContext): SystemFinding[] {
  const check = "organizer_history";
  const findings: SystemFinding[] = [];
  const rejected = context.owner.otherOrganizers.filter(
    (other) => other.status === "rejected",
  ).length;
  if (rejected > 0) {
    findings.push(
      systemFinding(
        "heuristic",
        check,
        "warn",
        `El dueño tiene ${String(rejected)} organización(es) rechazada(s) antes.`,
      ),
    );
  }
  const fraudReports = context.history.contentReports
    .filter((report) => report.category === "fraud")
    .reduce((total, report) => total + report.count, 0);
  if (fraudReports > 0) {
    findings.push(
      systemFinding(
        "heuristic",
        check,
        "warn",
        `El organizador tiene ${String(fraudReports)} denuncia(s) por fraude en eventos anteriores.`,
      ),
    );
  }
  if (findings.length === 0) {
    findings.push(
      systemFinding(
        "heuristic",
        check,
        "pass",
        "Sin organizaciones rechazadas del dueño ni denuncias por fraude.",
      ),
    );
  }
  return findings;
}
