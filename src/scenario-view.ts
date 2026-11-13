// Display-side view of a Decision Passport that respects whether the case has a
// what-if scenario at all. A housing case without an explicit relocation/option-B
// request has no what-if: the engine evaluates a mirror of the actual address, and
// nothing from that mirror (labels, programs, the what-if disclaimer) is shown.
import { WHAT_IF_RISK_NOTE, type DecisionPassport, type PassportScenario } from "./passport";

export type DisplayedScenario = { kind: "ACTUAL" | "WHAT_IF"; data: PassportScenario };

export function displayedPassportScenarios(passport: DecisionPassport, hasWhatIf: boolean): DisplayedScenario[] {
  const scenarios: DisplayedScenario[] = [{ kind: "ACTUAL", data: passport.actual }];
  if (hasWhatIf) scenarios.push({ kind: "WHAT_IF", data: passport.whatIf });
  return scenarios;
}

export function displayedPassportPrograms(passport: DecisionPassport, hasWhatIf: boolean) {
  return displayedPassportScenarios(passport, hasWhatIf).flatMap((scenario) => scenario.data.programs);
}

export function displayedPassportRisks(passport: DecisionPassport, hasWhatIf: boolean): string[] {
  return hasWhatIf ? passport.risks : passport.risks.filter((risk) => risk !== WHAT_IF_RISK_NOTE);
}
