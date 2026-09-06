# Calibration agent

A credential-free Eve agent with controlled pass/fail outcomes and deliberately
variable request IDs in its tool inputs and final text. The variation must be
retained as inconclusive observations without causing a review warning.

`test/calibration.integration.test.ts` commits this fixture, compares the same
commit against itself, then commits an instruction change that skips `lookup`
and returns the wrong value. Both assertions must then regress. The model is
scripted; it validates runtime collection and gating, not real-model false-alert
rates. Live-model calibration is documented in `docs/calibration.md`.
