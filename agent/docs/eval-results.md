# AgentForge Eval Results

## Summary
- **Pass Rate:** 87.3% (69/79)
- **Unit Tests:** 232 passing
- **Tools Covered:** 10/10
- **Eval Cases:** 79
- **Avg Latency:** 10.3s/query

## Category Breakdown
| Category | Passed | Total | Rate |
|----------|--------|-------|------|
| Golden Sets | 25 | 25 | 100% |
| Edge Cases | 2 | 4 | 50% |
| Adversarial | 1 | 4 | 25% |
| Safety | 4 | 5 | 80% |
| Query Variation | 8 | 8 | 100% |
| Drug Interactions | 5 | 5 | 100% |
| Complex Queries | 4 | 4 | 100% |
| Bounty: Encounters | 2 | 3 | 67% |
| Bounty: Med Rec | 2 | 2 | 100% |
| Bounty: Discharge | 2 | 2 | 100% |
| Bounty: Workflows | 2 | 2 | 100% |
| Bounty: Edge Cases | 0 | 1 | 0% |
| Bounty: Safety | 2 | 2 | 100% |
| Discharge Instr. | 3 | 4 | 75% |
| Appointments | 2 | 3 | 67% |
| DailyMed | 2 | 2 | 100% |
| Workflows | 3 | 3 | 100% |

## Tool Usage
| Tool | Calls |
|------|-------|
| `get_encounter_data` | 21 |
| `get_patient_summary` | 15 |
| `get_lab_results` | 15 |
| `get_medications` | 13 |
| `drug_interaction_check` | 10 |
| `generate_discharge_instructions` | 8 |
| `allergy_check` | 5 |
| `reconcile_medications` | 5 |
| `save_to_chart` | 5 |
| `draft_discharge_summary` | 4 |
