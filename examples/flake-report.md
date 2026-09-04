<!-- Organic nondeterminism evidence: real model (claude-haiku-4.5), N=5 per ref, captured
     2026-08-03. The raw runs, counts, timing, and cost below are unchanged. Eval labels have been
     updated to the current Fisher + complete-family Holm contract. No eval was contrived for
     this. -->

> [!NOTE]
> Historical real-model capture from 2026-08-03 (Eve 0.29.5, N=5). For the current Eve 0.47.5,
> N=10 public showcase, see [PR #8](https://github.com/knowbody/diff0/pull/8).
> The sandbox line is preserved verbatim from the historical output. Current diff0 reports the
> actual sandbox as unknown and labels Docker only as the host-default candidate.

<!-- diff0-report -->
## diff0: main...tighten-instructions 🟡

**No confirmed eval regressions across 5 runs per ref — 2 eval changes inconclusive, behavioral drift detected.**

eve 0.29.5 · model `anthropic/claude-haiku-4.5` · 5 runs per ref · sandbox docker (inferred) · comparison cost $0.0982 (gateway)

### Evals

| Eval | Base | Head | Status |
| :-- | :--: | :--: | :-- |
| `revenue/reply-format` | 1/5 | 5/5 | 🟡 higher pass rate (inconclusive) · score 0 → 1 (+1) · Fisher raw p=0.0238 · Holm p=0.0952 |
| `revenue/uses-sql-tool` | 4/5 | 5/5 | 🟡 higher pass rate (inconclusive) · score 1 → 1 (+0) · Fisher raw p=0.5 · Holm p=1 |
| `revenue/no-failed-actions` | 5/5 | 5/5 | ✅ pass · score 1 → 1 (+0) |
| `revenue/total-revenue` | 5/5 | 5/5 | ✅ pass · score 1 → 1 (+0) |

### Behavioral drift

> Historical capture note: the tool sequence/count evidence below was aggregated across the whole
> suite by the 2026-08-03 build. Current diff0 scopes tool sequences and counts per eval; this
> historical aggregate cannot be losslessly reconstructed into the newer representation.

**Tool sequences**

- base most common (in 3 of 5 runs): `load_skill → run_sql → load_skill → load_skill → run_sql → load_skill → run_sql`
- head most common (in 3 of 5 runs): `load_skill → run_sql → load_skill → run_sql → load_skill → run_sql → load_skill → run_sql`
- most common tool sequence diverges: base saw it in 3 of 5 runs, head saw a different one in 3 of 5 runs
- `run_sql`: median 3 call(s)/run on base → 4 on head

### Cost & performance

| Metric | Base (median) | Head (median) | Δ |
| :-- | --: | --: | :-- |
| Cost / session | $0.0100 ($0.0093–$0.0110) | $0.0102 ($0.0083–$0.0104) | +2% |
| Tokens in | 55,146 (50,051–60,412) | 60,123 (49,799–60,152) | +9% |
| Tokens out | 921 (870–1,011) | 856 (676–901) | -7% |
| Duration | 21.0s (20.7s–25.3s) | 19.6s (17.5s–23.6s) | -7% |

### Changed files

- `agent/instructions.md` (+1 −2)

_1 file changed, 1 insertion(+), 2 deletions(-). File attribution is correlational, not causal._

<details>
<summary>Per-run raw summaries</summary>

**base — `main` @ `2eceb21`**

| Run | Evals passed | Tool calls | Skills loaded | Cost | Duration |
| :-- | :-- | --: | :-- | --: | --: |
| 1 | 3/4 | 7 | revenue-definitions | $0.0094 | 21.0s |
| 2 | 4/4 | 8 | revenue-definitions | $0.0110 | 21.7s |
| 3 | 3/4 | 7 | revenue-definitions | $0.0100 | 20.7s |
| 4 | 3/4 | 7 | revenue-definitions | $0.0103 | 20.9s |
| 5 | 2/4 | 6 | revenue-definitions | $0.0093 | 25.3s |

**head — `tighten-instructions` @ `32da8ff`**

| Run | Evals passed | Tool calls | Skills loaded | Cost | Duration |
| :-- | :-- | --: | :-- | --: | --: |
| 1 | 4/4 | 8 | revenue-definitions | $0.0102 | 23.6s |
| 2 | 4/4 | 6 | revenue-definitions | $0.0083 | 17.8s |
| 3 | 4/4 | 7 | revenue-definitions | $0.0091 | 17.5s |
| 4 | 4/4 | 8 | revenue-definitions | $0.0102 | 19.6s |
| 5 | 4/4 | 8 | revenue-definitions | $0.0104 | 20.6s |

</details>

---

_Statistical comparison across 5 runs per ref — LLM runs are nondeterministic; treat proportions, not absolutes._
