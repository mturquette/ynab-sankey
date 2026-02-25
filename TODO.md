# YNAB Rippling Sankey - TODO

## Future Enhancements

### High Priority

#### Handle Negative Flows with Side Swapping
**Status**: Not started
**Related Files**:
- `src/processors/ynab-processor.js` (data already tracked in `positiveAmount`/`negativeAmount`)
- `src/sankey/builder.js` (needs logic to split categories by sign)

**Description**:
Currently, refunds and reversals are netted against spending in the same category on the expense side. Instead, they should appear on the opposite side of the diagram:
- Refunds (positive amounts in expense categories) → should appear on income side
- Reversals (negative amounts in income categories) → should appear on expense side

**Implementation Approach**:
1. In `builder.js`, check the sign of each category's amount
2. For categories with mixed signs (both positive and negative):
   - Create two nodes: one for positive flow, one for negative flow
   - Example: "Groceries (Refunds)" on left, "Groceries" on right
3. Place nodes on appropriate side based on sign:
   - Positive expense amounts → right side (normal expenses)
   - Negative expense amounts (refunds) → left side (income)
   - Positive income amounts → left side (normal income)
   - Negative income amounts (reversals) → right side (expenses)
4. Use absolute values for all link.value amounts (Plotly requirement)
5. Update progressive disclosure logic to handle split categories

**Data Already Available**:
- `category.positiveAmount` - total of all positive flows
- `category.negativeAmount` - total of all negative flows (absolute value)
- `category.amount` - net amount (positive - negative)

**Example Use Case**:
If you returned an RV and got a refund, that refund should appear on the income side of the diagram, not just reduce expenses.

---

## Completed Features

### ✅ Enhanced Sankey with Progressive Disclosure (2026-02-25)
- Added symmetric income hierarchy: Sources → Categories → Groups → Accounts → Center
- Fixed hardcoded "Loan & Mortgage Payments" to use actual YNAB category groups
- Added six toggle controls for progressive disclosure (income/expense layers)
- Implemented separate tracking of positive/negative amounts
