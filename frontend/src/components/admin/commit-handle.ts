// Shared imperative handle for the "settings" panels (scope, caution,
// ontology). In the onboarding wizard these panels hide their own Save button
// and instead expose commit() — the wizard calls it when the user clicks Next,
// so one click both persists the step and advances. commit() rejects if the
// save fails, so the wizard can stay put and surface the error.
//
// In the steady-state dashboard the panels render their own Save button as
// usual; the ref is simply unused there.
export interface CommitHandle {
  commit: () => Promise<void>;
}
