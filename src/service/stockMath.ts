/**
 * Pieces and boxes: one derivation, used everywhere.
 *
 * A SupplyStockTrack row records the same amount twice — `stock` in
 * pieces and `quantity` in boxes, with `perQuantity` pieces to a box.
 * Two columns for one fact will drift unless one of them is derived, and
 * this module is where that derivation lives.
 *
 * **`stock` is the authority.** It is what a dispense decrements and what
 * "insufficient stock" is judged against, so it is the number that must
 * be right. `quantity` is a convenience for people who think in boxes.
 *
 * ── The invariant, and the one the code used to check ───────────────────
 *
 * The rule is `quantity === ceil(stock / perQuantity)`: eight full boxes
 * of twelve plus two loose pieces is 98 pieces in 9 boxes, the ninth
 * part-used.
 *
 * What the dispense path actually checked was
 * `stock === quantity * perQuantity`, which is only true when no box has
 * been opened. It therefore warned on ordinary, correct data — every row
 * with a part-used box — and, being the wrong rule, would equally have
 * stayed silent on real drift. A check that cries wolf gets ignored, and
 * this one did: it logged to the console and carried on, under a comment
 * reading "You might want to fix this".
 *
 * Measured against the live data before this was written: of ten rows,
 * ten satisfied the ceil rule and nine satisfied the multiply rule — the
 * single "inconsistent" row was the only one with an opened box.
 */

/** Boxes needed to hold this many pieces, the last possibly part-used. */
export const boxesFor = (stock: number, perQuantity: number): number => {
  if (!Number.isFinite(stock) || stock <= 0) return 0;
  // A ratio of zero is meaningless; keep the caller's pieces and claim no
  // boxes rather than dividing by zero and writing NaN into the column.
  if (!Number.isFinite(perQuantity) || perQuantity <= 0) return 0;
  return Math.ceil(stock / perQuantity);
};

/** Does this row hold the two numbers consistently? */
export const boxesConsistent = (row: {
  stock: number;
  quantity: number;
  perQuantity: number;
}): boolean => row.quantity === boxesFor(row.stock, row.perQuantity);

/**
 * The fields to write so the row stays consistent.
 *
 * Spread this instead of setting `stock` and `quantity` separately —
 * every place that set them independently is a place they could part
 * company.
 */
export const stockFields = (
  stock: number,
  perQuantity: number,
): { stock: number; quantity: number } => ({
  stock: Math.max(0, Math.trunc(stock)),
  quantity: boxesFor(stock, perQuantity),
});

/**
 * How many stock rows disagree with themselves, for /health/build.
 *
 * The invariant is enforced at every write now, so this should stay at
 * zero. Reporting it is what turns that from a claim into something
 * anyone can check — and if a future write path forgets the derivation,
 * the number moves instead of the drift accumulating unseen for months.
 *
 * Raw SQL because `ceil` cannot be expressed in a Prisma filter. The
 * query is a constant; nothing from a request reaches it.
 */
export const stockConsistency = async (): Promise<{
  rows: number;
  drifted: number;
  unratioed: number;
}> => {
  const { prisma } = await import("../barrel/prisma");
  const [r] = await prisma.$queryRaw<
    Array<{ rows: bigint; drifted: bigint; unratioed: bigint }>
  >`
    SELECT
      COUNT(*)                                             AS rows,
      COUNT(*) FILTER (
        WHERE "perQuantity" > 0
          AND "quantity" <> CEIL("stock"::numeric / "perQuantity")
      )                                                    AS drifted,
      COUNT(*) FILTER (WHERE "perQuantity" <= 0)           AS unratioed
    FROM "SupplyStockTrack"`;
  return {
    rows: Number(r?.rows ?? 0),
    drifted: Number(r?.drifted ?? 0),
    unratioed: Number(r?.unratioed ?? 0),
  };
};
