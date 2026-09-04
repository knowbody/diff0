<!-- Historical real-model evidence captured 2026-08-03. The raw runs, counts, timing, and cost
     below are unchanged. Eval labels have been updated to the current Fisher + complete-family
     Holm contract. -->

> [!NOTE]
> Historical real-model capture from 2026-08-03 (Eve 0.29.5, N=5). For the current Eve 0.47.5,
> N=10 public showcase, see [PR #15](https://github.com/knowbody/diff0/pull/15).
> The sandbox line is preserved verbatim from the historical output. Current diff0 reports the
> actual sandbox as unknown and labels Docker only as the host-default candidate.

<!-- diff0-report -->
## diff0: main...simplify-pipeline 🟡

**No confirmed eval regressions across 5 runs per ref — 2 eval changes inconclusive, behavioral drift detected.**

eve 0.29.5 · model `anthropic/claude-haiku-4.5` · 5 runs per ref · sandbox docker (inferred) · comparison cost $0.1188 (gateway)

### Evals

| Eval | Base | Head | Status |
| :-- | :--: | :--: | :-- |
| `revenue/reply-format` | 5/5 | 3/5 | 🟡 lower pass rate (inconclusive) · score 1 → 1 (+0) · Fisher raw p=0.2222 · Holm p=0.8889 |
| `revenue/uses-sql-tool` | 5/5 | 4/5 | 🟡 lower pass rate (inconclusive) · score 1 → 1 (+0) · Fisher raw p=0.5 · Holm p=1 |
| `revenue/no-failed-actions` | 5/5 | 5/5 | ✅ pass · score 1 → 1 (+0) |
| `revenue/total-revenue` | 5/5 | 5/5 | ✅ pass · score 1 → 1 (+0) |

### Behavioral drift

> Historical capture note: the tool sequence/count evidence below was aggregated across the whole
> suite by the 2026-08-03 build. Current diff0 scopes tool sequences and counts per eval; this
> historical aggregate cannot be losslessly reconstructed into the newer representation. The
> subagent and cost observations remain directly supported by the raw runs.

**Tool sequences**

- base most common (in 5 of 5 runs): `load_skill → run_sql → load_skill → run_sql → load_skill → run_sql → load_skill → run_sql`
- head most common (in 2 of 5 runs): `load_skill → run_sql → load_skill → load_skill → run_sql → load_skill → run_sql`
- most common tool sequence diverges: base saw it in 5 of 5 runs, head saw a different one in 2 of 5 runs
- `run_sql`: median 4 call(s)/run on base → 3 on head

**Subagents**

- `reporter` (unattributed): used in 5 of 5 base runs → 0 of 5 head runs — **statistically-confirmed** (Fisher raw p=0.0079, Holm p=0.0159)

### Cost & performance

| Metric | Base (median) | Head (median) | Δ |
| :-- | --: | --: | :-- |
| Cost / session | $0.0141 ($0.0136–$0.0142) | $0.0095 ($0.0077–$0.0126) | -33% |
| Tokens in | 82,370 (77,251–82,468) | 55,282 (45,353–71,597) | -33% |
| Tokens out | 1,195 (1,177–1,225) | 775 (642–1,113) | -35% |
| Duration | 37.0s (34.2s–37.3s) | 22.1s (17.5s–26.5s) | -40% |

### Changed files

- `agent/instructions.md` (+0 −2)

_1 file changed, 2 deletions(-). File attribution is correlational, not causal._

<details>
<summary>Per-run raw summaries</summary>

**base — `main` @ `b8fb7f2`**

| Run | Evals passed | Tool calls | Skills loaded | Cost | Duration |
| :-- | :-- | --: | :-- | --: | --: |
| 1 | 4/4 | 8 | revenue-definitions | $0.0142 | 37.0s |
| 2 | 4/4 | 8 | revenue-definitions | $0.0142 | 34.2s |
| 3 | 4/4 | 8 | revenue-definitions | $0.0141 | 35.4s |
| 4 | 4/4 | 8 | revenue-definitions | $0.0136 | 37.2s |
| 5 | 4/4 | 8 | revenue-definitions | $0.0140 | 37.3s |

**head — `simplify-pipeline` @ `77d4334`**

| Run | Evals passed | Tool calls | Skills loaded | Cost | Duration |
| :-- | :-- | --: | :-- | --: | --: |
| 1 | 4/4 | 8 | revenue-definitions | $0.0098 | 22.1s |
| 2 | 3/4 | 7 | revenue-definitions | $0.0092 | 21.0s |
| 3 | 3/4 | 7 | revenue-definitions | $0.0095 | 23.1s |
| 4 | 3/4 | 6 | revenue-definitions | $0.0077 | 17.5s |
| 5 | 4/4 | 10 | revenue-definitions | $0.0126 | 26.5s |

</details>

---

_Statistical comparison across 5 runs per ref — LLM runs are nondeterministic; treat proportions, not absolutes._
