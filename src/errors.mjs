export const EXIT = Object.freeze({
  INPUT: 2,
  POLICY: 3,
  TERMINAL: 4,
  RUNTIME: 5,
  EVIDENCE: 6,
});

export class OrchestraterError extends Error {
  constructor(code, message, remediation, exitCode) {
    super(message);
    this.code = code;
    this.remediation = remediation;
    this.exitCode = exitCode;
  }

  toJSON() {
    return {
      ok: false,
      code: this.code,
      class: this.exitCode === EXIT.EVIDENCE ? "conflict" : "blocker",
      message: this.message,
      remediation: this.remediation,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function inputError(code, message, remediation) {
  return new OrchestraterError(code, message, remediation, EXIT.INPUT);
}

export function policyError(code, message, remediation) {
  return new OrchestraterError(code, message, remediation, EXIT.POLICY);
}

export function terminalError(code, message, remediation) {
  return new OrchestraterError(code, message, remediation, EXIT.TERMINAL);
}

export function runtimeError(code, message, remediation) {
  return new OrchestraterError(code, message, remediation, EXIT.RUNTIME);
}

export function evidenceError(code, message, remediation) {
  return new OrchestraterError(code, message, remediation, EXIT.EVIDENCE);
}
