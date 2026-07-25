"""CLI for LLM pricing, usage and credits. See src.billing for examples."""
from __future__ import annotations

import argparse
import sys
from decimal import Decimal

from src.billing import metering
from src.db.connection import get_control_connection


def _org_id(slug: str) -> int:
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM organizations WHERE slug = %s;", (slug,))
        row = cur.fetchone()
    if not row:
        raise SystemExit(f"[billing] no organization with slug {slug!r}.")
    return row[0]


def _fmt(d: Decimal, places: str = "0.000001") -> str:
    return str(Decimal(d).quantize(Decimal(places)))


def _cmd_sync(_args) -> None:
    """Apply prices.yaml now: append a dated history row for any changed price."""
    n = metering.sync_prices_from_yaml()
    if n == 0:
        print("[billing] prices.yaml already matches the price history — nothing to record.")
    else:
        print(f"[billing] recorded {n} price change(s) from prices.yaml into the history.")


def _cmd_prices(_args) -> None:
    """Show the dated price history (newest first per model). Edit prices in prices.yaml."""
    rows = metering.list_prices()
    if not rows:
        print("[billing] no prices recorded yet — run 'sync' to apply prices.yaml.")
        return
    print(f"{'model':28} {'cur':4} {'in/Mtok':>14} {'out/Mtok':>14} {'effective_from':26} note")
    for model, cur, inp, outp, eff, note in rows:
        print(f"{model:28} {cur:4} {inp!s:>14} {outp!s:>14} {str(eff):26} {note or ''}")


def _cmd_usage(args) -> None:
    org_id = _org_id(args.slug) if args.slug else None
    s = metering.usage_summary(org_id)
    scope = f"org {args.slug!r}" if args.slug else "all orgs"
    print(f"[billing] usage ({scope}):")
    print(f"    calls               {s['calls']}")
    print(f"    input tokens        {s['prompt_tokens']}")
    print(f"    output tokens       {s['completion_tokens']}")
    print(f"    input cost          {_fmt(s['input_cost'])}")
    print(f"    output cost         {_fmt(s['output_cost'])}")
    print(f"    TOTAL cost          {_fmt(s['total_cost'])}")
    if s["by_model"]:
        print("    by model:")
        for m in s["by_model"]:
            print(
                f"      {m['model']:28} calls={m['calls']:<5} "
                f"in={m['prompt_tokens']:<8} out={m['completion_tokens']:<8} "
                f"cost={_fmt(m['total_cost'])}"
            )


def _cmd_grant(args) -> None:
    org_id = _org_id(args.slug)
    eid = metering.grant_credits(
        org_id, args.amount, kind=args.kind, currency=args.currency,
        actor=args.actor, note=args.note,
    )
    print(f"[billing] credit entry {eid}: {args.kind} {args.amount} {args.currency} for {args.slug!r}.")


def _cmd_balance(args) -> None:
    org_id = _org_id(args.slug)
    b = metering.balance(org_id)
    print(f"[billing] credit balance for {args.slug!r}:")
    print(f"    granted   {_fmt(b['credits_granted'])}")
    print(f"    spent     {_fmt(b['credits_spent'])}")
    print(f"    BALANCE   {_fmt(b['balance'])}")


def _cmd_recost(_args) -> None:
    n = metering.recost_unpriced()
    print(f"[billing] recosted {n} previously-unpriced usage event(s).")


def _cmd_limit(args) -> None:
    """Set, clear, or show an org's hard credit limit."""
    org_id = _org_id(args.slug)
    if args.clear:
        metering.set_credit_limit(org_id, None)
        print(f"[billing] credit limit removed for {args.slug!r} (now uncapped).")
        return
    if args.amount is not None:
        metering.set_credit_limit(org_id, args.amount)
        print(f"[billing] credit limit for {args.slug!r} set to {args.amount}.")
    s = metering.credit_status(org_id)
    if s["limit"] is None:
        print(f"[billing] {args.slug!r}: no limit (uncapped). spent {_fmt(s['spent'])}.")
        return
    pct = f"{(s['fraction_used'] * 100):.1f}%"
    print(f"[billing] credit limit status for {args.slug!r}:")
    print(f"    limit       {_fmt(s['limit'])}")
    print(f"    spent       {_fmt(s['spent'])}  ({pct})")
    print(f"    headroom    {_fmt(s['headroom'])}")
    if s["alert"]:
        print(f"    ALERT       {s['alert'].upper()}")


def _cmd_estimate(args) -> None:
    """Project a backfill's cost (INTERNAL view — shows our cost + markup)."""
    e = metering.estimate_backfill(args.input_tokens, args.output_tokens)
    print("[billing] backfill estimate (INTERNAL — do not show the customer):")
    print(f"    input tokens     {e.input_tokens}")
    print(f"    output tokens    {e.output_tokens}")
    print(f"    basis model      {e.basis_model}  "
          f"(in {e.basis_input_per_mtok}/Mtok, out {e.basis_output_per_mtok}/Mtok)")
    print(f"    raw token cost   {_fmt(e.raw_cost)}   <- what it costs us")
    print(f"    markup           {e.markup}x")
    print(f"    CUSTOMER QUOTE   {_fmt(e.customer_quote)}   <- the only number we show")


def main() -> None:
    p = argparse.ArgumentParser(description="Indigo Iota LLM metering + credits.")
    sub = p.add_subparsers(dest="command", required=True)

    yp = sub.add_parser("sync", help="Apply prices.yaml now (record any changed prices).")
    yp.set_defaults(func=_cmd_sync)

    pp = sub.add_parser("prices", help="Show the dated price history (edit prices in prices.yaml).")
    pp.set_defaults(func=_cmd_prices)

    up = sub.add_parser("usage", help="Show metered usage + cost.")
    up.add_argument("--slug", default=None, help="Limit to one org (default: all).")
    up.set_defaults(func=_cmd_usage)

    gp = sub.add_parser("grant", help="Add credit (setup fee / monthly grant / adjustment).")
    gp.add_argument("--slug", required=True)
    gp.add_argument("--amount", required=True)
    gp.add_argument("--kind", default="grant", choices=["grant", "setup", "adjustment"])
    gp.add_argument("--currency", default="USD")
    gp.add_argument("--actor", default=None)
    gp.add_argument("--note", default=None)
    gp.set_defaults(func=_cmd_grant)

    bp = sub.add_parser("balance", help="Show an org's credit balance.")
    bp.add_argument("--slug", required=True)
    bp.set_defaults(func=_cmd_balance)

    rp = sub.add_parser("recost", help="Re-price usage events recorded before a price existed.")
    rp.set_defaults(func=_cmd_recost)

    lp = sub.add_parser("limit", help="Set / clear / show an org's hard credit limit.")
    lp.add_argument("--slug", required=True)
    lp.add_argument("--amount", default=None, help="Set the limit to this value.")
    lp.add_argument("--clear", action="store_true", help="Remove the limit (uncapped).")
    lp.set_defaults(func=_cmd_limit)

    ep = sub.add_parser("estimate", help="Project a backfill's cost (internal: 10x cheapest model).")
    ep.add_argument("--input-tokens", type=int, required=True, dest="input_tokens")
    ep.add_argument("--output-tokens", type=int, default=None, dest="output_tokens")
    ep.set_defaults(func=_cmd_estimate)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())
